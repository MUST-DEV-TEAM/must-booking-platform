import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialCipherService } from '../src/integrations/credential-cipher';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import {
  EmailTransportJournal,
  type TransportScope,
  type TransportClaim,
} from '../src/mail/email-transport-journal';
import { PreparedMailError } from '../src/mail/prepared-mail-transport';
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
  cipher = new CredentialCipherService(),
  journal = new EmailTransportJournal(db, cipher, audit);
const tenantId = randomUUID(),
  otherTenantId = randomUUID(),
  propertyId = randomUUID(),
  secondPropertyId = randomUUID(),
  foreignPropertyId = randomUUID();
let scope: TransportScope;
const prepare = () => ({
  provider: 'smtp' as const,
  contents: JSON.stringify({ text: 'private guest content', password: 'fake-smtp-secret' }),
});
function sending(claim: TransportClaim) {
  if (claim.kind !== 'send') throw Error('Expected an exclusively owned attempt');
  return claim;
}
describe('transport journal: real PostgreSQL locks, RLS, uncertainty and audit atomicity (no provider calls)', () => {
  beforeAll(async () => {
    vi.stubEnv('INTEGRATION_CREDENTIALS_KEY', Buffer.alloc(32, 53).toString('base64'));
    for (const id of [tenantId, otherTenantId])
      await admin.organization.create({ data: { id, name: 'Transport journal fixture' } });
    for (const [id, tenant] of [
      [propertyId, tenantId],
      [secondPropertyId, tenantId],
      [foreignPropertyId, otherTenantId],
    ])
      await admin.property.create({
        data: { id: id!, tenantId: tenant!, name: 'Transport hotel', slug: 'transport-' + id },
      });
  });
  beforeEach(async () => {
    scope = { tenantId, propertyId, messageId: randomUUID() };
    await admin.$executeRaw`
      INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,idempotency_key)
      VALUES(${scope.messageId}::uuid,${tenantId}::uuid,${propertyId}::uuid,'guest.transport_fixture','guest@example.test','Fixture',${randomUUID()})
    `;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const id of [tenantId, otherTenantId]) await cleanupTenant(admin, id);
    await db.$disconnect();
    await admin.$disconnect();
  });
  it('grants one real concurrent claim and returns the same accepted receipt on replay', async () => {
    const prepareOnce = vi.fn(async () => prepare());
    const claims = await Promise.all(
      Array.from({ length: 12 }, () => journal.claim(scope, 'PRIMARY', prepareOnce)),
    );
    expect(claims.filter((claim) => claim.kind === 'send')).toHaveLength(1);
    expect(claims.filter((claim) => claim.kind === 'busy')).toHaveLength(11);
    expect(prepareOnce).toHaveBeenCalledTimes(1);
    const owned = sending(claims.find((claim) => claim.kind === 'send')!);
    expect(
      await journal.finish(scope, 'PRIMARY', owned.fence, {
        provider: 'smtp',
        providerMessageId: 'receipt-1',
      }),
    ).toBe(true);
    expect(await journal.claim(scope, 'PRIMARY', prepareOnce)).toEqual({
      kind: 'accepted',
      receipt: { provider: 'smtp', providerMessageId: 'receipt-1' },
    });
    expect(prepareOnce).toHaveBeenCalledTimes(1);
    const [row] = await admin.$queryRaw<{ encrypted: string; attempt: number }[]>`
      SELECT encrypted_payload AS encrypted,attempt FROM email_transport_attempts WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${scope.messageId}::uuid
    `;
    expect(row!.encrypted).not.toContain('private guest content');
    expect(row!.encrypted).not.toContain('fake-smtp-secret');
    expect(row!.attempt).toBe(1);
  });
  it('fences old owners after a proven-rejected attempt is retried with its frozen payload', async () => {
    const first = sending(await journal.claim(scope, 'PRIMARY', async () => prepare()));
    expect(
      await journal.finish(scope, 'PRIMARY', randomUUID(), new PreparedMailError('rejected', true)),
    ).toBe(false);
    await journal.finish(scope, 'PRIMARY', first.fence, new PreparedMailError('rejected', true));
    const replacement = vi.fn(async () => ({
      provider: 'smtp' as const,
      contents: 'changed after queueing',
    }));
    const second = sending(await journal.claim(scope, 'PRIMARY', replacement));
    expect(second.fence).not.toBe(first.fence);
    expect(second.attempt).toBe(2);
    expect(second.snapshot).toEqual(first.snapshot);
    expect(replacement).not.toHaveBeenCalled();
    expect(
      await journal.finish(scope, 'PRIMARY', first.fence, {
        provider: 'smtp',
        providerMessageId: 'stale',
      }),
    ).toBe(false);
    expect(
      await journal.finish(scope, 'PRIMARY', second.fence, {
        provider: 'smtp',
        providerMessageId: 'current',
      }),
    ).toBe(true);
  });
  it('turns an expired lease into uncertainty without reclaiming or allowing fallback', async () => {
    const first = sending(await journal.claim(scope, 'PRIMARY', async () => prepare()));
    await admin.$executeRaw`UPDATE email_transport_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${scope.messageId}::uuid`;
    const neverPrepare = vi.fn(async () => prepare());
    expect(await journal.claim(scope, 'PRIMARY', neverPrepare)).toEqual({ kind: 'unknown' });
    expect(await journal.claim(scope, 'FALLBACK', neverPrepare)).toEqual({ kind: 'unknown' });
    expect(neverPrepare).not.toHaveBeenCalled();
    // The original owner may still record a late actual receipt; no replacement worker was sent.
    expect(
      await journal.finish(scope, 'PRIMARY', first.fence, {
        provider: 'smtp',
        providerMessageId: 'late-receipt',
      }),
    ).toBe(true);
  });
  it('never retries an explicitly unknown result', async () => {
    const first = sending(await journal.claim(scope, 'PRIMARY', async () => prepare()));
    await journal.finish(scope, 'PRIMARY', first.fence, new PreparedMailError('unknown', false));
    expect(await journal.claim(scope, 'PRIMARY', async () => prepare())).toEqual({
      kind: 'unknown',
    });
    expect(await journal.claim(scope, 'FALLBACK', async () => prepare())).toEqual({
      kind: 'unknown',
    });
  });
  it('does not resend an accepted record with a missing receipt', async () => {
    await journal.claim(scope, 'PRIMARY', async () => prepare());
    await admin.$executeRaw`UPDATE email_transport_attempts SET state='ACCEPTED',provider_message_id=NULL WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${scope.messageId}::uuid`;
    const neverPrepare = vi.fn(async () => prepare());
    expect(await journal.claim(scope, 'PRIMARY', neverPrepare)).toEqual({ kind: 'unknown' });
    expect(neverPrepare).not.toHaveBeenCalled();
  });
  it('makes fallback creation exclusive and prevents primary delivery restarting afterward', async () => {
    const first = sending(await journal.claim(scope, 'PRIMARY', async () => prepare()));
    await journal.finish(scope, 'PRIMARY', first.fence, new PreparedMailError('rejected', false));
    const claims = await Promise.all(
      Array.from({ length: 5 }, () =>
        journal.claim(scope, 'FALLBACK', async () => ({
          provider: 'resend',
          contents: 'frozen fallback',
        })),
      ),
    );
    expect(claims.filter((claim) => claim.kind === 'send')).toHaveLength(1);
    expect(await journal.claim(scope, 'PRIMARY', async () => prepare())).toEqual({
      kind: 'fallback',
    });
    const fallback = sending(claims.find((claim) => claim.kind === 'send')!);
    await journal.finish(scope, 'FALLBACK', fallback.fence, {
      provider: 'resend',
      providerMessageId: 'fallback-receipt',
    });
    expect(await journal.claim(scope, 'FALLBACK', async () => prepare())).toEqual({
      kind: 'accepted',
      receipt: { provider: 'resend', providerMessageId: 'fallback-receipt' },
    });
  });
  it('isolates tenant and property reads and rejects cross-scope claims', async () => {
    await journal.claim(scope, 'PRIMARY', async () => prepare());
    for (const target of [
      { tenantId, propertyId: secondPropertyId },
      { tenantId: otherTenantId, propertyId: foreignPropertyId },
    ]) {
      const rows = await db.withTenantTransaction(
        target,
        (tx) =>
          tx.$queryRaw<
            unknown[]
          >`SELECT message_id FROM email_transport_attempts WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${scope.messageId}::uuid`,
      );
      expect(rows).toEqual([]);
      await expect(
        journal.claim({ ...scope, ...target }, 'PRIMARY', async () => prepare()),
      ).rejects.toThrow('Scoped email intention was not found');
    }
  });
  it('rolls back the receipt when audit insertion fails, leaving an exclusive uncertain send', async () => {
    const first = sending(await journal.claim(scope, 'PRIMARY', async () => prepare()));
    const spy = vi
      .spyOn(audit, 'recordInTransaction')
      .mockRejectedValueOnce(Error('Simulated audit failure'));
    try {
      await expect(
        journal.finish(scope, 'PRIMARY', first.fence, {
          provider: 'smtp',
          providerMessageId: 'accepted-but-unrecorded',
        }),
      ).rejects.toThrow('Simulated audit failure');
      expect(await journal.claim(scope, 'PRIMARY', async () => prepare())).toEqual({
        kind: 'busy',
      });
      await admin.$executeRaw`UPDATE email_transport_attempts SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${scope.messageId}::uuid`;
      expect(await journal.claim(scope, 'PRIMARY', async () => prepare())).toEqual({
        kind: 'unknown',
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('expires encrypted payloads while retaining a non-reusable tombstone', async () => {
    await journal.claim(scope, 'PRIMARY', async () => prepare());
    await admin.$executeRaw`UPDATE email_transport_attempts SET expires_at=clock_timestamp()-interval '1 second',lease_expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${scope.messageId}::uuid`;
    await journal.cleanup(scope);
    const [row] = await admin.$queryRaw<
      { encrypted: string | null }[]
    >`SELECT encrypted_payload AS encrypted FROM email_transport_attempts WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${scope.messageId}::uuid`;
    expect(row?.encrypted).toBeNull();
    expect(await journal.claim(scope, 'PRIMARY', async () => prepare())).toEqual({
      kind: 'unknown',
    });
    const [rls] = await admin.$queryRaw<
      { enabled: boolean; forced: boolean }[]
    >`SELECT relrowsecurity AS enabled,relforcerowsecurity AS forced FROM pg_class WHERE oid='email_transport_attempts'::regclass`;
    expect(rls).toEqual({ enabled: true, forced: true });
  });
});
