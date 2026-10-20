import { expect, it, vi } from 'vitest';
import { NotificationSettingsService } from './notification-settings.service';
import type { TenantDatabaseService, TenantTransaction } from './tenant-database.service';
import type { AuditLogService } from './audit-log.service';

function service(...results: unknown[][]) {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce(rows);
  const execute = vi.fn(() => {
    throw Error('A preview must not write');
  });
  const tx = { $queryRaw: query, $executeRaw: execute } as unknown as TenantTransaction;
  const transaction = vi.fn(
    async (_: object, operation: (tx: TenantTransaction) => Promise<unknown>) => operation(tx),
  );
  const audit = { recordInTransaction: vi.fn() };
  return {
    settings: new NotificationSettingsService(
      { withTenantTransaction: transaction } as unknown as TenantDatabaseService,
      audit as unknown as AuditLogService,
    ),
    query,
    execute,
    transaction,
    audit,
  };
}
const draft = {
  guestEnabled: true,
  staffEnabled: true,
  customStaffRecipients: true,
  rules: [{ target: 'EMAIL', email: 'owner@example.test' }],
};
it('separates suppressed recipients without writing or auditing a preview', async () => {
  const fixture = service(
    [
      { staffUserId: 'owner', email: 'OWNER@example.test' },
      { staffUserId: 'staff', email: 'staff@example.test' },
    ],
    [{ email: 'owner@example.test', reason: 'complaint' }],
  );
  expect(await fixture.settings.preview('tenant', 'property', 'new_booking', draft)).toEqual({
    guest: true,
    staff: [{ email: 'staff@example.test' }],
    suppressed: [{ email: 'owner@example.test', reason: 'complaint' }],
  });
  expect(fixture.transaction.mock.calls[0]?.[0]).toEqual({
    tenantId: 'tenant',
    propertyId: 'property',
  });
  expect(fixture.execute).not.toHaveBeenCalled();
  expect(fixture.audit.recordInTransaction).not.toHaveBeenCalled();
});
it('does not invent a guest address for a guest-only topic', async () => {
  const fixture = service();
  expect(
    await fixture.settings.preview('tenant', 'property', 'pre_arrival', {
      guestEnabled: true,
      customStaffRecipients: false,
      rules: [],
    }),
  ).toEqual({ guest: true, staff: [], suppressed: [] });
  expect(fixture.query).not.toHaveBeenCalled();
});
it('rejects an unavailable staff target before resolving recipients', async () => {
  const fixture = service([]);
  await expect(
    fixture.settings.preview('tenant', 'property', 'new_booking', {
      ...draft,
      rules: [{ target: 'STAFF_USER', userId: 'd1b998ee-f7a6-47ef-8cff-8d730ad88574' }],
    }),
  ).rejects.toThrow('not on this hotel account');
  expect(fixture.query).toHaveBeenCalledTimes(1);
});
it('applies existing input validation without creating a transaction', () => {
  const fixture = service();
  expect(() =>
    fixture.settings.preview('tenant', 'property', 'new_booking', {
      ...draft,
      rules: [{ target: 'EMAIL', email: 'bad\r\nBCC:injection@example.test' }],
    }),
  ).toThrow('not a valid email');
  expect(() => fixture.settings.preview('tenant', 'property', 'unknown', draft)).toThrow(
    'Unknown notification',
  );
  expect(fixture.transaction).not.toHaveBeenCalled();
});
