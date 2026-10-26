import { afterEach, expect, it, vi } from 'vitest';
import { EmailTransportFailures, ownerSenderFailureEmail } from './email-transport-failures';
import type { TenantDatabaseService, TenantTransaction } from '../tenancy/tenant-database.service';
import type { AuditLogService } from '../tenancy/audit-log.service';
const scope = { tenantId: 'tenant', propertyId: 'property', messageId: 'message' };
afterEach(() => vi.unstubAllEnvs());
it.each(['UNKNOWN', 'FAILED', 'FALLBACK_USED'] as const)(
  'renders a safe immutable platform alert for %s with a scoped link',
  (outcome) => {
    vi.stubEnv('WEB_APP_URL', 'https://dashboard.example.test');
    const command = ownerSenderFailureEmail(
      scope,
      '<Hotel>',
      outcome,
      'owner',
      'owner@example.test',
    );
    expect(command.eventType).toBe('owner.email_transport_failure');
    expect(command.fromName).toBe('MUST Booking');
    expect(command.bookingId).toBeNull();
    expect(command.idempotencyKey).toBe('owner-email-failure/message/owner');
    expect(command.html).toContain('&lt;Hotel&gt;');
    expect(command.html).not.toContain('<Hotel>');
    expect(command.text).toContain('section=emails&emailMessageId=message');
    expect(command.html).not.toContain('Guest name');
  },
);
it('omits an unsafe or unconfigured URL without exposing URL credentials', () => {
  for (const base of ['', 'https://user:fake-secret@example.test']) {
    vi.stubEnv('WEB_APP_URL', base);
    const command = ownerSenderFailureEmail(
      scope,
      'Hotel',
      'UNKNOWN',
      'owner',
      'owner@example.test',
    );
    expect(command.text).not.toContain('fake-secret');
    expect(command.html).not.toContain('fake-secret');
    expect(command.html).not.toContain('Review delivery');
    expect(command.text).toContain('Open Emails > Delivery');
  }
});
function fixture(...results: unknown[][]) {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const execute = vi.fn(async () => 1);
  const tx = { $queryRaw: query, $executeRaw: execute } as unknown as TenantTransaction;
  const transaction = vi.fn(async (_: object, run: (tx: TenantTransaction) => Promise<unknown>) =>
    run(tx),
  );
  const audit = { recordInTransaction: vi.fn(async () => {}) };
  const service = new EmailTransportFailures(
    { withTenantTransaction: transaction } as unknown as TenantDatabaseService,
    audit as unknown as AuditLogService,
  );
  return { service, query, execute, audit, transaction };
}
it('prepares an in-app alert and owner outbox only after an actionable failure', async () => {
  const f = fixture(
    [{ id: 'property' }],
    [{ status: 'FAILED', propertyName: 'Hotel' }],
    [],
    [{ stage: 'PRIMARY', state: 'REJECTED' }],
    [],
    [{ userId: 'owner', email: 'owner@example.test' }],
  );
  await f.service.record(scope);
  expect(f.execute).toHaveBeenCalledTimes(3);
  expect(f.audit.recordInTransaction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      action: 'email_transport.owner_alert_created',
      details: expect.objectContaining({ ownerEmailIntentCount: 1, outcome: 'FAILED' }),
    }),
  );
  expect(f.transaction.mock.calls[0]?.[0]).toEqual(scope);
});
it('does not notify again for an existing failure root', async () => {
  const f = fixture(
    [{ id: 'property' }],
    [{ status: 'FAILED', propertyName: 'Hotel' }],
    [{ messageId: 'message' }],
  );
  await f.service.record(scope);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.audit.recordInTransaction).not.toHaveBeenCalled();
});
it('does not alert while a known transient rejection is still queued for retry', async () => {
  const f = fixture(
    [{ id: 'property' }],
    [{ status: 'QUEUED', propertyName: 'Hotel' }],
    [],
    [{ stage: 'PRIMARY', state: 'REJECTED' }],
  );
  await f.service.record(scope);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.audit.recordInTransaction).not.toHaveBeenCalled();
});
it('groups another source under an existing hour anchor without creating another owner email', async () => {
  const f = fixture(
    [{ id: 'property' }],
    [{ status: 'FAILED', propertyName: 'Hotel' }],
    [],
    [{ stage: 'PRIMARY', state: 'UNKNOWN' }],
    [{ notificationId: 'existing', startedAt: new Date() }],
  );
  await f.service.record(scope);
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.audit.recordInTransaction).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ action: 'email_transport.owner_alert_grouped' }),
  );
});
it('fails closed when a queued owner alert no longer has an eligible verified recipient', async () => {
  const command = ownerSenderFailureEmail(scope, 'Hotel', 'UNKNOWN', 'owner', 'owner@example.test');
  const denied = fixture([]),
    allowed = fixture([{ userId: 'owner' }]);
  expect(await denied.service.allowed(scope, command)).toBe(false);
  expect(await allowed.service.allowed(scope, command)).toBe(true);
  expect(denied.execute).not.toHaveBeenCalled();
  expect(allowed.execute).not.toHaveBeenCalled();
});
