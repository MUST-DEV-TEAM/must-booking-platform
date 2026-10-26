import { describe, expect, it, vi } from 'vitest';
import { ClockPmsProvider } from './clock-pms.provider';
const context = { tenantId: 'tenant', propertyId: 'property' };
const query = {
  roomIds: ['free', 'busy'],
  startsOn: '2028-04-09',
  endsOn: '2028-04-13',
  excludeBookingId: 'current',
};
describe('saved Clock room options', () => {
  it.each([false, true])(
    'reads stored conflicts without any Clock request, stale=%s',
    async (stale) => {
      const at = new Date(Date.now() - (stale ? 600000 : 1000));
      const read = vi
        .fn()
        .mockResolvedValueOnce([{ id: 'connection' }])
        .mockResolvedValueOnce([{ at, complete: true, status: stale ? 'RETRY' : 'SYNCED' }])
        .mockResolvedValueOnce([{ id: 'busy' }]);
      const tx = { $queryRaw: read, $executeRaw: vi.fn() };
      const db = {
        withTenantTransaction: vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) => fn(tx)),
      };
      const live = {
        unavailableRoomsForBooking: vi.fn(() => {
          throw Error('Unexpected Clock request');
        }),
      };
      const provider = new ClockPmsProvider(
        {} as never,
        {} as never,
        {} as never,
        db as never,
        live as never,
        {} as never,
        {} as never,
      );
      const result = await provider.unavailableRoomsForMove(context, query);
      expect(result).toMatchObject({
        ok: true,
        value: {
          source: 'CLOCK_SNAPSHOT',
          unavailableRoomIds: ['busy'],
          complete: true,
          stale,
          lastSyncedAt: at.toISOString(),
        },
      });
      expect(db.withTenantTransaction).toHaveBeenCalledWith(context, expect.any(Function));
      expect(read.mock.calls[2].slice(1)).toEqual(
        expect.arrayContaining([
          'connection',
          context.tenantId,
          context.propertyId,
          query.excludeBookingId,
          query.roomIds,
          query.startsOn,
          query.endsOn,
        ]),
      );
      expect(live.unavailableRoomsForBooking).not.toHaveBeenCalled();
    },
  );
  it('marks missing initial synchronization as incomplete instead of claiming current availability', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'connection' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const provider = new ClockPmsProvider(
      {} as never,
      {} as never,
      {} as never,
      {
        withTenantTransaction: async (_c: unknown, fn: (tx: unknown) => unknown) =>
          fn({ $queryRaw: read, $executeRaw: vi.fn() }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await provider.unavailableRoomsForMove(context, query)).toMatchObject({
      ok: true,
      value: { complete: false, stale: true, lastSyncedAt: null },
    });
  });
});
