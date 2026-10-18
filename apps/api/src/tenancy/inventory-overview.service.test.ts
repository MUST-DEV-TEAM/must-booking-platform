import { describe, expect, it, vi } from 'vitest';
import { InventoryOverviewService } from './inventory-overview.service';
const context = {
  source: 'LOCAL',
  readOnly: false,
  today: '2035-03-25',
  timezone: 'Europe/Tirane',
  items: [],
};
describe('Inventory overview', () => {
  it('delegates preview to the existing evaluator with scope and channel', async () => {
    const evaluateRules = vi
      .fn()
      .mockResolvedValue({ booking: { valid: false, errors: [{ code: 'MIN_STAY' }] } });
    const service = new InventoryOverviewService(
      {} as never,
      {} as never,
      {} as never,
      { evaluateRules } as never,
    );
    const input = {
      roomTypeId: 'type',
      startsOn: '2035-03-29',
      endsOn: '2035-03-31',
      channel: 'guest',
    };
    expect(await service.preview('tenant', 'property', input)).toMatchObject({
      channel: 'guest',
      scope: 'saved_rules',
      booking: { valid: false },
    });
    expect(evaluateRules).toHaveBeenCalledWith('tenant', 'property', input);
  });
  it.each([
    {},
    { roomTypeId: 'x', startsOn: '2035-02-30', endsOn: '2035-03-01' },
    { roomTypeId: 'x', startsOn: '2035-03-01', endsOn: '2035-03-01' },
  ])('rejects malformed preview %j', async (input) => {
    const service = new InventoryOverviewService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.preview('t', 'p', input)).rejects.toThrow();
  });
  it('never requests provider data or fabricates Clock counts', async () => {
    const getCalendar = vi.fn();
    const service = new InventoryOverviewService(
      {} as never,
      {
        list: vi.fn().mockResolvedValue({ ...context, source: 'CLOCK_PMS', readOnly: true }),
      } as never,
      { list: vi.fn().mockResolvedValue(context) } as never,
      { getCalendar } as never,
    );
    expect(await service.overview('t', 'p')).toMatchObject({
      sellablePercentage: null,
      totalNights: null,
      coverage: null,
      activeRestrictions: null,
      activeBlocks: null,
    });
    expect(getCalendar).not.toHaveBeenCalled();
  });
  it('computes physical capacity and mixed limits over 30 dates crossing a DST boundary', async () => {
    const rows = [
      [{ bookingMode: 'MIXED' }],
      [{ id: 'type', name: 'King' }],
      [
        { id: 'r1', roomTypeId: 'type' },
        { id: 'r2', roomTypeId: 'type' },
      ],
      Array.from({ length: 30 }, (_, i) => ({
        roomTypeId: 'type',
        date: new Date(Date.parse(context.today) + i * 86400000).toISOString().slice(0, 10),
        capacity: 4,
        available: 3,
      })),
    ];
    const tx = { $queryRaw: vi.fn().mockImplementation(async () => rows.shift()) };
    const database = { withTenantTransaction: vi.fn(async (_scope, fn) => fn(tx)) };
    const getCalendar = vi.fn(async (_t, _p, q) => ({
      days: Array.from({ length: 31 }, (_, i) => ({
        date: `${q.month}-${String(i + 1).padStart(2, '0')}`,
        isAvailable: q.roomId === 'r1',
      })),
    }));
    const service = new InventoryOverviewService(
      database as never,
      { list: vi.fn().mockResolvedValue(context) } as never,
      { list: vi.fn().mockResolvedValue(context) } as never,
      { getCalendar } as never,
    );
    const result = await service.overview('t', 'p');
    expect(result).toMatchObject({
      totalNights: 60,
      sellableNights: 30,
      sellablePercentage: 50,
      endsOn: '2035-04-24',
    });
    expect(result.coverage?.[0].days).toHaveLength(30);
    expect(getCalendar).toHaveBeenCalledTimes(4);
  });
});
