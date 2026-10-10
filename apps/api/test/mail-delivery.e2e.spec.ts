import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MailDeliveryError } from '../src/mail/mail-delivery-error';
import { describeMail } from '../src/mail/mail-descriptors';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';

// Milestone 22 Task 4: behavioral proof of the email queue against real Postgres (RLS) and
// real Redis/BullMQ, with a controllable fake transport standing in for Resend.
const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const database = new TenantDatabaseService({
  datasources: {
    db: {
      url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

type Row = {
  status: string;
  attempt_count: number;
  provider_message_id: string | null;
  last_error: string | null;
  recipient_email: string;
};

describe('MailDeliveryService (real Postgres + Redis/BullMQ)', () => {
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const context = { tenantId, propertyId };
  const send = vi.fn();
  const mail = {
    sendPaymentConfirmationEmail: send,
    sendNewBookingStaffNotification: send,
    sendRefundConfirmationEmail: send,
    sendBookingCancelledEmail: send,
    sendBookingCancelledStaffNotification: send,
    sendRenderedEmail: send,
    sendVerificationEmail: send,
    sendWelcomeEmail: send,
    sendPasswordResetEmail: send,
    sendStaffInvitationEmail: send,
  };
  const service = new MailDeliveryService(database, mail as never);
  const previousRedisUrl = process.env.REDIS_URL;

  function command(paymentId: string) {
    return {
      bookingId: randomUUID(),
      bookingReference: 'MAIL-TEST-1',
      paymentId,
      to: 'guest@example.test',
      amount: { amount: '100.00', currency: 'EUR' },
      brand: { name: 'Test Hotel' },
      paymentMethod: 'stripe' as const,
      guest: { name: 'Ada Guest' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Suite',
      guestCount: 2,
    };
  }

  async function row(paymentId: string): Promise<Row | null> {
    const rows = await migrationPrisma.$queryRaw<Row[]>`
      SELECT status::text AS status, attempt_count, provider_message_id, last_error, recipient_email
      FROM email_messages
      WHERE tenant_id = ${tenantId}::uuid AND idempotency_key = ${`payment-confirmation/${paymentId}`}
    `;
    return rows[0] ?? null;
  }

  async function waitForStatus(paymentId: string, statuses: string[], timeoutMs = 40_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await row(paymentId);
      if (current && statuses.includes(current.status)) return current;
      if (Date.now() > deadline)
        throw new Error(
          `Timed out waiting for ${statuses.join('/')}; last=${JSON.stringify(current)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Mail delivery test')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Mail delivery property', ${`mail-delivery-${propertyId}`})
    `;
    service.retryPolicy = { attempts: 3, backoffMs: 50 };
    service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
    await migrationPrisma.$executeRaw`DELETE FROM "email_messages" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    process.env.REDIS_URL = previousRedisUrl;
    await migrationPrisma.$disconnect();
    await database.$disconnect();
  });

  it('logs the email, sends it through the queue and records the provider message id', async () => {
    send.mockReset().mockResolvedValue({ providerMessageId: 'resend-msg-1' });
    const paymentId = `pay-${randomUUID()}`;

    await service.dispatch('paymentConfirmation', command(paymentId), context);
    const sent = await waitForStatus(paymentId, ['SENT']);

    expect(sent).toMatchObject({
      status: 'SENT',
      attempt_count: 1,
      provider_message_id: 'resend-msg-1',
      last_error: null,
      recipient_email: 'guest@example.test',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and then succeeds without sending twice', async () => {
    send
      .mockReset()
      .mockRejectedValueOnce(new MailDeliveryError('Resend status 503', true, 503))
      .mockRejectedValueOnce(new MailDeliveryError('Resend status 429', true, 429))
      .mockResolvedValue({ providerMessageId: 'resend-msg-2' });
    const paymentId = `pay-${randomUUID()}`;

    await service.dispatch('paymentConfirmation', command(paymentId), context);
    const sent = await waitForStatus(paymentId, ['SENT', 'FAILED']);

    expect(sent).toMatchObject({
      status: 'SENT',
      attempt_count: 3,
      provider_message_id: 'resend-msg-2',
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('marks a permanent failure FAILED on the first attempt without retrying', async () => {
    send.mockReset().mockRejectedValue(new MailDeliveryError('Resend status 422', false, 422));
    const paymentId = `pay-${randomUUID()}`;

    await service.dispatch('paymentConfirmation', command(paymentId), context);
    const failed = await waitForStatus(paymentId, ['FAILED', 'SENT']);

    expect(failed).toMatchObject({
      status: 'FAILED',
      attempt_count: 1,
      last_error: 'Resend status 422',
    });
    await new Promise((resolve) => setTimeout(resolve, 400)); // long enough for any (wrong) retry
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('marks the email FAILED once every retry is exhausted', async () => {
    send.mockReset().mockRejectedValue(new MailDeliveryError('Resend status 500', true, 500));
    const paymentId = `pay-${randomUUID()}`;

    await service.dispatch('paymentConfirmation', command(paymentId), context);
    const failed = await waitForStatus(paymentId, ['FAILED', 'SENT']);

    expect(failed).toMatchObject({
      status: 'FAILED',
      attempt_count: 3,
      last_error: 'Resend status 500',
    });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('never creates a second row or a second send for the same idempotency key', async () => {
    send.mockReset().mockResolvedValue({ providerMessageId: 'resend-msg-3' });
    const paymentId = `pay-${randomUUID()}`;
    const payload = command(paymentId);

    await Promise.all([
      service.dispatch('paymentConfirmation', payload, context),
      service.dispatch('paymentConfirmation', payload, context),
    ]);
    await waitForStatus(paymentId, ['SENT']);
    await service.dispatch('paymentConfirmation', payload, context); // replay after it was sent
    await new Promise((resolve) => setTimeout(resolve, 300));

    const [{ count }] = await migrationPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM email_messages
      WHERE tenant_id = ${tenantId}::uuid AND idempotency_key = ${`payment-confirmation/${paymentId}`}
    `;
    expect(Number(count)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never throws to the caller, even when logging is impossible', async () => {
    send.mockReset().mockResolvedValue({});
    await expect(
      service.dispatch('paymentConfirmation', command(`pay-${randomUUID()}`), {
        tenantId: 'not-a-uuid',
        propertyId,
      }),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  describe('account-level mail (no hotel account)', () => {
    const accountScope = { tenantId: null, propertyId: null } as const;
    const secret = `SECRET-${randomUUID()}`;
    const resetCommand = (userId: string) => ({
      userId,
      to: 'owner@example.test',
      resetUrl: `https://app.example.test/reset-password?token=${secret}`,
    });

    async function accountRow(key: string) {
      const rows = await migrationPrisma.$queryRaw<
        { status: string; tenant_id: string | null; attempt_count: number }[]
      >`SELECT status::text AS status, tenant_id, attempt_count FROM email_messages WHERE idempotency_key = ${key}`;
      return rows[0] ?? null;
    }
    const cleanup = (key: string) =>
      migrationPrisma.$executeRaw`DELETE FROM email_messages WHERE idempotency_key = ${key}`;

    it('sends before dispatch returns (inline first), logs it without a tenant, and keeps the secret out of the stored key', async () => {
      send.mockReset().mockResolvedValue({ providerMessageId: 'resend-account-1' });
      const command = resetCommand(randomUUID());
      const { idempotencyKey } = describeMail('passwordReset', command);

      await service.dispatch('passwordReset', command, accountScope, { inlineFirst: true });

      expect(send).toHaveBeenCalledTimes(1); // already sent when dispatch resolved: no waiting on the worker
      expect(await accountRow(idempotencyKey)).toMatchObject({
        status: 'SENT',
        tenant_id: null,
        attempt_count: 1,
      });
      expect(idempotencyKey).not.toContain(secret);
      await cleanup(idempotencyKey);
    });

    it('retries through the queue after a transient inline failure, within the total attempt budget', async () => {
      send
        .mockReset()
        .mockRejectedValueOnce(new MailDeliveryError('Resend status 503', true, 503))
        .mockResolvedValue({ providerMessageId: 'resend-account-2' });
      const command = resetCommand(randomUUID());
      const { idempotencyKey } = describeMail('passwordReset', command);

      await service.dispatch('passwordReset', command, accountScope, { inlineFirst: true });
      const deadline = Date.now() + 15_000;
      let current = await accountRow(idempotencyKey);
      while (current?.status !== 'SENT' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        current = await accountRow(idempotencyKey);
      }

      expect(current).toMatchObject({ status: 'SENT', attempt_count: 2 });
      expect(send).toHaveBeenCalledTimes(2);
      await cleanup(idempotencyKey);
    });

    it('does not retry a permanent inline failure and does not send a replay twice', async () => {
      send.mockReset().mockRejectedValue(new MailDeliveryError('Resend status 422', false, 422));
      const command = resetCommand(randomUUID());
      const { idempotencyKey } = describeMail('passwordReset', command);

      await service.dispatch('passwordReset', command, accountScope, { inlineFirst: true });
      await service.dispatch('passwordReset', command, accountScope, { inlineFirst: true });
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(await accountRow(idempotencyKey)).toMatchObject({
        status: 'FAILED',
        attempt_count: 1,
      });
      expect(send).toHaveBeenCalledTimes(1);
      await cleanup(idempotencyKey);
    });

    it('logs a staff invitation under the hotel account with no property', async () => {
      send.mockReset().mockResolvedValue({ providerMessageId: 'resend-invite-1' });
      const command = {
        to: 'new.staff@example.test',
        organizationName: 'Mail delivery test',
        invitedByEmail: 'owner@example.test',
        assignments: [{ propertyName: 'P', roleTemplateName: 'Front Desk' }],
        invitationUrl: `https://app.example.test/staff-invitation?token=${secret}`,
      };
      const { idempotencyKey } = describeMail('staffInvitation', command);

      await service.dispatch(
        'staffInvitation',
        command,
        { tenantId, propertyId: null },
        { inlineFirst: true },
      );

      const rows = await migrationPrisma.$queryRaw<
        { status: string; tenant_id: string; property_id: string | null }[]
      >`
        SELECT status::text AS status, tenant_id, property_id FROM email_messages
        WHERE tenant_id = ${tenantId}::uuid AND idempotency_key = ${idempotencyKey}
      `;
      expect(rows).toEqual([{ status: 'SENT', tenant_id: tenantId, property_id: null }]);
      expect(idempotencyKey).not.toContain(secret);
    });
  });

  it('falls back to a single inline send when no queue is available', async () => {
    send.mockReset().mockResolvedValue({ providerMessageId: 'resend-inline' });
    const inline = new MailDeliveryService(database, mail as never); // onModuleInit not called: no queue
    const paymentId = `pay-${randomUUID()}`;

    await inline.dispatch('paymentConfirmation', command(paymentId), context);

    expect(await row(paymentId)).toMatchObject({
      status: 'SENT',
      provider_message_id: 'resend-inline',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
