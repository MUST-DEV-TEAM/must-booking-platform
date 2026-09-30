import { createHmac, randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ResendWebhookController } from '../src/mail/resend-webhook.controller';
import { ResendWebhookService } from '../src/mail/resend-webhook.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';

// Milestone 22 Task 5: the delivery webhook against real Postgres (RLS, email_webhook role),
// exercising signature checking, forward-only status changes and replay safety.
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

const keyBytes = Buffer.from('e2e-webhook-secret-bytes-0123456');
const secret = `whsec_${keyBytes.toString('base64')}`;

type Row = { status: string; last_error: string | null; delivered_at: Date | null };

describe('Resend delivery webhook (real Postgres)', () => {
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const controller = new ResendWebhookController(new ResendWebhookService(database));
  const previousSecret = process.env.RESEND_WEBHOOK_SECRET;

  async function seed(status: string): Promise<string> {
    const providerMessageId = `re_${randomUUID()}`;
    await migrationPrisma.$executeRaw`
      INSERT INTO email_messages
        (tenant_id, property_id, event_type, recipient_email, subject, idempotency_key, status, provider_message_id)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, 'booking.confirmed', 'guest@example.test', 'S',
        ${`k-${randomUUID()}`}, ${status}::"EmailMessageStatus", ${providerMessageId})
    `;
    return providerMessageId;
  }

  async function row(providerMessageId: string): Promise<Row> {
    const rows = await migrationPrisma.$queryRaw<Row[]>`
      SELECT status::text AS status, last_error, delivered_at FROM email_messages
      WHERE provider_message_id = ${providerMessageId}
    `;
    return rows[0]!;
  }

  function signedCall(event: object, overrides: { signature?: string; secretKey?: Buffer } = {}) {
    const body = JSON.stringify(event);
    const id = `msg_${randomUUID()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      overrides.signature ??
      `v1,${createHmac('sha256', overrides.secretKey ?? keyBytes)
        .update(`${id}.${timestamp}.${body}`)
        .digest('base64')}`;
    return controller.receive(id, timestamp, signature, { rawBody: Buffer.from(body) } as never);
  }

  const event = (
    type: string,
    emailId: string,
    extra: object = {},
    createdAt = new Date().toISOString(),
  ) => ({
    type,
    created_at: createdAt,
    data: { email_id: emailId, ...extra },
  });

  beforeAll(async () => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Resend webhook test')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Webhook property', ${`resend-webhook-${propertyId}`})
    `;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "email_messages" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    process.env.RESEND_WEBHOOK_SECRET = previousSecret;
    await migrationPrisma.$disconnect();
    await database.$disconnect();
  });

  it('rejects a bad signature and changes nothing', async () => {
    const id = await seed('SENT');
    await expect(signedCall(event('email.bounced', id), { signature: 'v1,AAAA' })).rejects.toThrow(
      'Invalid webhook signature',
    );
    await expect(
      signedCall(event('email.bounced', id), {
        secretKey: Buffer.from('wrong-secret-wrong-secret-wrong!!'),
      }),
    ).rejects.toThrow('Invalid webhook signature');
    expect((await row(id)).status).toBe('SENT');
  });

  it('refuses events (503) while no signing secret is configured, instead of accepting unsigned ones', async () => {
    process.env.RESEND_WEBHOOK_SECRET = '';
    try {
      await expect(signedCall(event('email.delivered', 'whatever'))).rejects.toThrow(
        'not configured',
      );
    } finally {
      process.env.RESEND_WEBHOOK_SECRET = secret;
    }
  });

  it('marks a sent email delivered, and a replay is harmless', async () => {
    const id = await seed('SENT');
    const delivered = event('email.delivered', id, {}, '2026-09-30T10:00:00.000Z');
    await expect(signedCall(delivered)).resolves.toEqual({ received: true });
    await expect(signedCall(delivered)).resolves.toEqual({ received: true });
    const result = await row(id);
    expect(result.status).toBe('DELIVERED');
    expect(result.delivered_at?.toISOString()).toBe('2026-09-30T10:00:00.000Z');
  });

  it('records a bounce with its reason, and a late "delivered" cannot overwrite it', async () => {
    const id = await seed('SENT');
    await signedCall(
      event('email.bounced', id, {
        bounce: { type: 'Permanent', subType: 'General', message: 'Mailbox does not exist' },
      }),
    );
    expect(await row(id)).toMatchObject({
      status: 'BOUNCED',
      last_error: 'Bounced: Permanent / General / Mailbox does not exist',
    });
    await signedCall(event('email.delivered', id));
    expect((await row(id)).status).toBe('BOUNCED');
  });

  it('records a spam complaint, even after delivery', async () => {
    const id = await seed('DELIVERED');
    await signedCall(event('email.complained', id));
    expect(await row(id)).toMatchObject({ status: 'COMPLAINED' });
  });

  it('marks a provider-side failure or suppression as FAILED', async () => {
    const failed = await seed('SENT');
    await signedCall(event('email.failed', failed, { failed: { reason: 'Quota exceeded' } }));
    expect(await row(failed)).toMatchObject({
      status: 'FAILED',
      last_error: 'Provider failed to send: Quota exceeded',
    });
    const suppressed = await seed('SENT');
    await signedCall(event('email.suppressed', suppressed));
    expect((await row(suppressed)).status).toBe('FAILED');
  });

  it('ignores event types it does not track', async () => {
    const id = await seed('SENT');
    await expect(signedCall(event('email.opened', id))).resolves.toEqual({ received: true });
    expect((await row(id)).status).toBe('SENT');
  });

  it('asks Resend to retry a fresh event for an unknown email, but acknowledges an old one', async () => {
    await expect(signedCall(event('email.delivered', `re_${randomUUID()}`))).rejects.toThrow(
      'retry',
    );
    await expect(
      signedCall(event('email.delivered', `re_${randomUUID()}`, {}, '2026-01-01T00:00:00.000Z')),
    ).resolves.toEqual({ received: true });
  });

  it('cannot be used to touch rows without the email_webhook role (plain runtime session sees none)', async () => {
    const id = await seed('SENT');
    const rows = await database.$queryRaw<{ id: string }[]>`
      SELECT id FROM email_messages WHERE provider_message_id = ${id}
    `;
    expect(rows).toEqual([]);
  });
});
