import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { EmailTransportFailures } from '../src/mail/email-transport-failures';
import { cleanupTenant } from './helpers/cleanup-tenant';
const admin = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking' },
  },
});
const db = new TenantDatabaseService({
  datasources: {
    db: { url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking' },
  },
});
const audit = new AuditLogService(db),
  failures = new EmailTransportFailures(db, audit);
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  propertyId = randomUUID(),
  otherPropertyId = randomUUID(),
  secondPropertyId = randomUUID(),
  ownerId = randomUUID();
const context = { tenantId, propertyId };
async function source(outcome: 'UNKNOWN' | 'REJECTED' = 'UNKNOWN') {
  const messageId = randomUUID();
  await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,idempotency_key,status) VALUES(${messageId}::uuid,${tenantId}::uuid,${propertyId}::uuid,'guest.fixture','guest@example.test','Private guest wording',${randomUUID()},'FAILED')`;
  await admin.$executeRaw`INSERT INTO email_transport_attempts(tenant_id,property_id,message_id,stage,provider,state,attempt) VALUES(${tenantId}::uuid,${propertyId}::uuid,${messageId}::uuid,'PRIMARY','smtp',${outcome},1)`;
  return { ...context, messageId };
}
describe('real PostgreSQL owner alerts and durable outbox, with no provider calls', () => {
  beforeAll(async () => {
    vi.stubEnv('WEB_APP_URL', 'http://localhost:3001');
    for (const id of [tenantId, otherTenantId])
      await admin.organization.create({ data: { id, name: 'Sender alert fixture' } });
    await admin.property.create({
      data: { id: propertyId, tenantId, name: 'Sender alert hotel', slug: 'sender-alert' },
    });
    await admin.property.create({
      data: {
        id: otherPropertyId,
        tenantId: otherTenantId,
        name: 'Other sender alert hotel',
        slug: 'other-sender-alert',
      },
    });
    await admin.property.create({
      data: {
        id: secondPropertyId,
        tenantId,
        name: 'Second alert hotel',
        slug: 'second-sender-alert',
      },
    });
    await admin.user.create({
      data: {
        id: ownerId,
        email: `sender-owner-${ownerId}@example.test`,
        emailVerifiedAt: new Date(),
      },
    });
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${ownerId}::uuid,'OWNER')`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const id of [tenantId, otherTenantId]) await cleanupTenant(admin, id);
    await admin.user.delete({ where: { id: ownerId } });
    await db.$disconnect();
    await admin.$disconnect();
  });
  it('deduplicates concurrent roots and groups concurrent different source failures into one anchored hour alert', async () => {
    const sources = await Promise.all(Array.from({ length: 4 }, () => source()));
    await Promise.all(sources.flatMap((scope) => [failures.record(scope), failures.record(scope)]));
    const [counts] = await admin.$queryRaw<
      { roots: bigint; notifications: bigint; outbox: bigint }[]
    >`
      SELECT (SELECT count(*) FROM email_transport_failures WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid) AS roots,
        (SELECT count(*) FROM notifications WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND type='EMAIL_DELIVERY_FAILED') AS notifications,
        (SELECT count(*) FROM email_transport_failure_outbox WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid) AS outbox
    `;
    expect(counts).toEqual({ roots: 4n, notifications: 1n, outbox: 1n });
    const pending = await failures.pending(context);
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(pending)).not.toContain('Private guest wording');
    expect(JSON.stringify(pending)).not.toContain('guest@example.test');
    expect(pending[0]?.command.eventType).toBe('owner.email_transport_failure');
    expect(pending[0]?.command.fromName).toBe('MUST Booking');
  });
  it('uses the original hour anchor rather than indefinitely extending an incident during an outage', async () => {
    await admin.$executeRaw`UPDATE email_transport_failures SET alert_started_at=clock_timestamp()-interval '61 minutes' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    const next = await source();
    await failures.record(next);
    const [count] = await admin.$queryRaw<
      { n: bigint }[]
    >`SELECT count(DISTINCT notification_id) AS n FROM email_transport_failures WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    expect(count?.n).toBe(2n);
  });
  it('does not create alerts for default-owner-alert failures without a custom attempt', async () => {
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,idempotency_key,status) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,'owner.email_transport_failure','owner@example.test','Owner alert',${randomUUID()},'FAILED')`;
    await failures.record({ ...context, messageId: id });
    const rows = await admin.$queryRaw<
      unknown[]
    >`SELECT message_id FROM email_transport_failures WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${id}::uuid`;
    expect(rows).toEqual([]);
  });
  it('rechecks owner membership/verification before publication and keeps foreign scopes empty', async () => {
    const [queued] = await failures.pending(context);
    expect(queued).toBeDefined();
    expect(await failures.allowed(context, queued!.command)).toBe(true);
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${ownerId}::uuid`;
    try {
      expect(await failures.pending(context)).toEqual([]);
      expect(await failures.allowed(context, queued!.command)).toBe(false);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${ownerId}::uuid`;
    }
    expect(await failures.pending({ tenantId, propertyId: secondPropertyId })).toEqual([]);
    expect(
      await failures.pending({ tenantId: otherTenantId, propertyId: otherPropertyId }),
    ).toEqual([]);
    const rows = await db.withTenantTransaction(
      { tenantId: otherTenantId, propertyId: otherPropertyId },
      (tx) =>
        tx.$queryRaw<
          unknown[]
        >`SELECT message_id FROM email_transport_failure_outbox WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
    );
    expect(rows).toEqual([]);
  });
  it('does not publish a receipt for a different message or recipient', async () => {
    const [alert] = await failures.pending(context);
    expect(alert).toBeDefined();
    const wrongMail = randomUUID();
    await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,idempotency_key,status) VALUES(${wrongMail}::uuid,${tenantId}::uuid,${propertyId}::uuid,'owner.email_transport_failure','wrong@example.test','Wrong receipt',${randomUUID()},'SENT')`;
    expect(await failures.confirm(context, alert!, wrongMail)).toBe(0);
    expect(
      (await failures.pending(context)).some((row) => row.messageId === alert!.messageId),
    ).toBe(true);
  });
  it('confirms the same actual owner-mail receipt once and keeps retries idempotent', async () => {
    const [alert] = await failures.pending(context);
    expect(alert).toBeDefined();
    const mailId = randomUUID();
    await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,idempotency_key,status)
      VALUES(${mailId}::uuid,${tenantId}::uuid,${propertyId}::uuid,'owner.email_transport_failure',${alert!.command.to},'Owner alert',${alert!.command.idempotencyKey},'SENT')`;
    expect(await failures.confirm(context, alert!, mailId)).toBe(1);
    expect(await failures.confirm(context, alert!, mailId)).toBe(0);
    expect(
      (await failures.pending(context)).some((row) => row.messageId === alert!.messageId),
    ).toBe(false);
  });
  it('rolls a newly discovered failure root and notification back with its audit, then recovers it', async () => {
    await admin.$executeRaw`UPDATE email_transport_failures SET alert_started_at=clock_timestamp()-interval '61 minutes' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    const current = await source();
    const spy = vi
      .spyOn(audit, 'recordInTransaction')
      .mockRejectedValueOnce(Error('Simulated owner-alert audit failure'));
    try {
      await expect(failures.record(current)).rejects.toThrow('Simulated owner-alert audit failure');
    } finally {
      spy.mockRestore();
    }
    const before = await admin.$queryRaw<
      unknown[]
    >`SELECT message_id FROM email_transport_failures WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${current.messageId}::uuid`;
    expect(before).toEqual([]);
    await failures.discover(context);
    const after = await admin.$queryRaw<
      unknown[]
    >`SELECT message_id FROM email_transport_failures WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${current.messageId}::uuid`;
    expect(after).toHaveLength(1);
  });
  it('expires outbox bodies while retaining source and in-app evidence', async () => {
    await admin.$executeRaw`UPDATE email_transport_failure_outbox SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    await failures.cleanup(context);
    expect(await failures.pending(context)).toEqual([]);
    const roots = await admin.$queryRaw<
      unknown[]
    >`SELECT message_id FROM email_transport_failures WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    expect(roots.length).toBeGreaterThan(0);
  });
});
