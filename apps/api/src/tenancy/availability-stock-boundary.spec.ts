import { describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability.service';

// Exercise the stock guard used by real create/cancel, not source-text assertions.
const tenant = '11111111-1111-4111-8111-111111111111';
const property = '22222222-2222-4222-8222-222222222222';
const input = {
  roomTypeId: '33333333-3333-4333-8333-333333333333',
  startsOn: '2030-01-01',
  endsOn: '2030-01-03',
  units: 1,
};
function fixture(clock: boolean, nights: number, capacity = 1) {
  const rows = Array.from({ length: nights }, (_, i) => ({
    staysOn: new Date(`2030-01-0${i + 1}`),
    availableUnits: capacity,
    bookedUnits: 0,
  }));
  const tx = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray, ...args: unknown[]) => {
      const query = Array.isArray(sql) ? sql.join('?') : (sql as unknown as { sql: string }).sql;
      if (!Array.isArray(sql)) args = (sql as unknown as { values: unknown[] }).values;
      if (query.includes('inventory_restrictions')) return [];
      expect(args).toContain(tenant);
      expect(args).toContain(property);
      if (query.includes('AS "isPublished"')) return [{ isPublished: true }];
      if (query.includes('AS "isBlocked"')) return [{ isBlocked: false }];
      if (query.includes('FROM inventory_units')) return rows;
      if (query.includes('AS managed')) return [{ managed: clock }];
      return [{ id: property }];
    }),
    $executeRaw: vi.fn(async (sql: TemplateStringsArray, ...args: unknown[]) => {
      if (sql.join('').includes('UPDATE inventory_units'))
        for (const row of rows) row.bookedUnits += Number(args[0]);
      return 1;
    }),
  };
  const service = new AvailabilityService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { rows, tx, service };
}
describe('Clock/local stock boundary (2a2889d)', () => {
  it('allows the create/cancel stock steps with no local rows only when Clock owns stock', async () => {
    const f = fixture(true, 0);
    expect(await f.service.reserveBookedUnits(f.tx as never, tenant, property, input)).toBe(true);
    await expect(
      f.service.releaseBookedUnits(f.tx as never, tenant, property, input),
    ).resolves.toBeUndefined();
    expect(
      f.tx.$executeRaw.mock.calls.some(([sql]) => sql.join('').includes('UPDATE inventory_units')),
    ).toBe(false);
  });
  it('still refuses missing local stock for a non-Clock hotel', async () => {
    const f = fixture(false, 0);
    expect(await f.service.reserveBookedUnits(f.tx as never, tenant, property, input)).toBe(false);
    await expect(
      f.service.releaseBookedUnits(f.tx as never, tenant, property, input),
    ).rejects.toThrow('Cannot release');
  });
  it.each([false, true])(
    'preserves capacity and paired reserve/release with stock rows (Clock=%s)',
    async (clock) => {
      const f = fixture(clock, 2);
      expect(await f.service.reserveBookedUnits(f.tx as never, tenant, property, input)).toBe(true);
      expect(f.rows.map((r) => r.bookedUnits)).toEqual([1, 1]);
      expect(await f.service.reserveBookedUnits(f.tx as never, tenant, property, input)).toBe(
        false,
      );
      await f.service.releaseBookedUnits(f.tx as never, tenant, property, input);
      expect(f.rows.map((r) => r.bookedUnits)).toEqual([0, 0]);
      await expect(
        f.service.releaseBookedUnits(f.tx as never, tenant, property, input),
      ).rejects.toThrow('Cannot release');
    },
  );
  it('does not treat partially populated Clock stock as absent', async () => {
    const f = fixture(true, 1);
    expect(await f.service.reserveBookedUnits(f.tx as never, tenant, property, input)).toBe(false);
  });
});
