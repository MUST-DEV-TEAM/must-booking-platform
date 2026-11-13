import { expect, it, vi } from 'vitest';
import { DataRetentionService } from './data-retention.service';
import type { TenantDatabaseService } from './tenant-database.service';

it('nightly sweep counts every hotel once and logs one dry-run line per hotel, writing nothing', async () => {
  const hotels = [
    { tenantId: 't1', propertyId: 'p1' },
    { tenantId: 't1', propertyId: 'p2' },
  ];
  const queries: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (sql: { strings?: string[]; sql?: string }) => {
      queries.push(String(sql.sql ?? sql.strings?.join('?')));
      return [{ n: 3 }];
    }),
  };
  const db = {
    $queryRaw: vi.fn(async () => hotels),
    withTenantTransaction: vi.fn(async (_scope: unknown, work: (t: unknown) => unknown) =>
      work(tx),
    ),
  } as unknown as TenantDatabaseService;
  const service = new DataRetentionService(db);
  const log = vi.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

  await service.sweep();

  expect(log).toHaveBeenCalledTimes(2);
  expect(String(log.mock.calls[0]![0])).toContain('no data changed');
  expect(String(log.mock.calls[0]![0])).toContain('"propertyId":"p1"');
  expect(queries.length).toBeGreaterThan(0);
  expect(queries.every((q) => /^\s*SELECT count\(\*\)/i.test(q))).toBe(true);
});
