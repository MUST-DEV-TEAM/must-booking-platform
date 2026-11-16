import { describe, expect, it, vi } from 'vitest';

const { reportOperationalFailure } = vi.hoisted(() => ({ reportOperationalFailure: vi.fn() }));
vi.mock('../observability/error-tracking', () => ({ reportOperationalFailure }));

import { ManualReviewService } from './manual-review.service';

type Sql = { sql: string; values: unknown[] };

/** A fake transaction: `openRows` is how many OPEN items the dedupe UPDATE finds. */
function makeService(openRows = 0) {
  const sqls: Sql[] = [];
  const transaction = {
    $executeRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
      sqls.push({ sql, values });
      return sql.includes('UPDATE manual_review_items') ? openRows : 1;
    }),
  };
  const database = { withTenantTransaction: vi.fn((_context, callback) => callback(transaction)) };
  return { service: new ManualReviewService(database as never), transaction, sqls };
}

describe('ManualReviewService', () => {
  it('alerts in real time when a review item is recorded, not just writing the row', async () => {
    const { service } = makeService();
    reportOperationalFailure.mockClear();

    await service.record({
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      connectionId: 'connection-1',
      category: 'MISSING_MAPPING',
      referenceType: 'clock_booking',
      referenceId: '38149735',
      message: 'Clock booking references an unmapped room type.',
    });

    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
    const [error, context] = reportOperationalFailure.mock.calls[0]!;
    expect((error as Error).message).toContain('Clock booking references an unmapped room type.');
    expect(context).toEqual({
      component: 'clock',
      operation: 'manual-review.missing_mapping',
      tenantId: 'tenant-1',
      propertyId: 'property-1',
    });
  });

  it('alerts for every category, not just a hardcoded subset', async () => {
    const { service } = makeService();
    reportOperationalFailure.mockClear();

    for (const category of [
      'SCHEMA_MISMATCH',
      'UNKNOWN_RESULT',
      'PAYMENT_BOOKING_MISMATCH',
    ] as const) {
      await service.record({
        tenantId: 'tenant-1',
        propertyId: 'property-1',
        category,
        referenceType: 'booking',
        message: `test ${category}`,
      });
    }

    expect(reportOperationalFailure).toHaveBeenCalledTimes(3);
  });

  describe('dedupe key', () => {
    const base = {
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      category: 'PAYMENT_BOOKING_MISMATCH' as const,
      referenceType: 'booking',
      referenceId: 'b-1',
      message: 'first',
      context: { kind: 'FINANCIAL_SYNC_BLOCKED' },
    };
    const inserts = (sqls: Sql[]) => sqls.filter((c) => c.sql.includes('INSERT INTO'));
    const updates = (sqls: Sql[]) =>
      sqls.filter((c) => c.sql.includes('UPDATE manual_review_items'));

    it('inserts the first time, with the key built from category, kind, type and id', async () => {
      const { service, sqls } = makeService(0);
      reportOperationalFailure.mockClear();
      await service.record(base);
      expect(inserts(sqls)).toHaveLength(1);
      expect(inserts(sqls)[0]!.values).toContain(
        'PAYMENT_BOOKING_MISMATCH:FINANCIAL_SYNC_BLOCKED:booking:b-1',
      );
      expect(sqls[0]!.sql).toContain('pg_advisory_xact_lock');
      expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
    });

    it('counts a repeat on the open item: one UPDATE, no INSERT, no second alert', async () => {
      const { service, sqls } = makeService(1);
      reportOperationalFailure.mockClear();
      await service.record({ ...base, message: 'second' });
      expect(inserts(sqls)).toHaveLength(0);
      expect(updates(sqls)).toHaveLength(1);
      expect(updates(sqls)[0]!.sql).toContain('occurrences = occurrences + 1');
      expect(updates(sqls)[0]!.values).toContain('second');
      expect(reportOperationalFailure).not.toHaveBeenCalled();
    });

    it('a different kind or reference id is a different thing', async () => {
      const { service, sqls } = makeService(0);
      await service.record(base);
      await service.record({ ...base, context: { kind: 'OTHER' } });
      await service.record({ ...base, referenceId: 'b-2' });
      await service.record({ ...base, context: undefined });
      const keys = inserts(sqls).map((c) => c.values[8]);
      expect(keys).toEqual([
        'PAYMENT_BOOKING_MISMATCH:FINANCIAL_SYNC_BLOCKED:booking:b-1',
        'PAYMENT_BOOKING_MISMATCH:OTHER:booking:b-1',
        'PAYMENT_BOOKING_MISMATCH:FINANCIAL_SYNC_BLOCKED:booking:b-2',
        'PAYMENT_BOOKING_MISMATCH::booking:b-1',
      ]);
    });

    it('two operations on one booking are two items, so resolving one never closes the other', async () => {
      const { service, sqls } = makeService(0);
      await service.record({ ...base, context: { kind: 'X', operationKey: 'op-1' } });
      await service.record({ ...base, context: { kind: 'X', operationKey: 'op-2' } });
      const keys = inserts(sqls).map((c) => c.values[8]);
      expect(keys).toEqual([
        'PAYMENT_BOOKING_MISMATCH:X:booking:b-1:op-1',
        'PAYMENT_BOOKING_MISMATCH:X:booking:b-1:op-2',
      ]);
    });

    it('without a reference id it always inserts and takes no lock', async () => {
      const { service, sqls } = makeService(1);
      reportOperationalFailure.mockClear();
      await service.record({ ...base, referenceId: null });
      await service.record({ ...base, referenceId: '' });
      expect(inserts(sqls)).toHaveLength(2);
      expect(updates(sqls)).toHaveLength(0);
      expect(sqls.some((c) => c.sql.includes('pg_advisory_xact_lock'))).toBe(false);
      expect(inserts(sqls)[0]!.values[8]).toBeNull();
      expect(reportOperationalFailure).toHaveBeenCalledTimes(2);
    });

    it('inserts a new item once the earlier one is resolved (the UPDATE finds no open row)', async () => {
      const { service, sqls } = makeService(0);
      await service.record(base);
      await service.record(base);
      expect(updates(sqls)).toHaveLength(2);
      expect(inserts(sqls)).toHaveLength(2);
    });
  });
});
