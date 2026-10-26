import { describe, expect, it, vi } from 'vitest';
import { BookingRoomMoveController } from './booking-room-move.controller';
const context = { tenantId: 'tenant', propertyId: 'hotel', userId: 'user' };
const id = '11111111-1111-4111-8111-111111111111';
function setup(
  result: object = {
    ok: true,
    value: {
      unavailableRoomIds: ['busy'],
      source: 'CLOCK_SNAPSHOT',
      lastSyncedAt: '2026-10-24T12:00:00Z',
      complete: true,
      stale: false,
    },
  },
  pending: boolean | string = false,
) {
  const query = vi
    .fn()
    .mockResolvedValueOnce([
      {
        version: 3,
        roomId: 'current',
        roomTypeId: 'type',
        startsOn: '2028-04-09',
        endsOn: '2028-04-13',
        externalBookingId: '37746271',
        eligible: true,
      },
    ])
    .mockResolvedValueOnce([
      { id: 'current', name: '101' },
      { id: 'busy', name: '102' },
      { id: 'free', name: '103' },
    ])
    .mockResolvedValueOnce(
      pending
        ? [
            {
              key: pending === 'stay' ? 'clock-stay-amend:fixture' : 'clock-room-move:fixture',
              command: { bookingId: id },
            },
          ]
        : [],
    );
  const db = {
    withTenantTransaction: (_c: unknown, callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: query }),
  };
  const check = vi.fn().mockResolvedValue(result);
  const provider = { forProperty: vi.fn().mockResolvedValue({ unavailableRoomsForMove: check }) };
  return { controller: new BookingRoomMoveController(db as never, provider as never), check };
}
describe('whole-stay room move options', () => {
  it('reads saved candidates once for the booked dates, excluding the current reservation', async () => {
    const { controller, check } = setup();
    const result = await controller.options({ tenantContext: context }, id);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(context, {
      roomIds: ['busy', 'free'],
      startsOn: '2028-04-09',
      endsOn: '2028-04-13',
      excludeBookingId: id,
      excludeExternalBookingId: '37746271',
    });
    expect(result.rooms).toEqual([{ id: 'free', name: '103' }]);
    expect(result).toMatchObject({ availability: { source: 'CLOCK_SNAPSHOT', complete: true } });
  });
  it('does not offer unchecked rooms when the provider check fails', async () => {
    const { controller } = setup({ ok: false, error: { message: 'Clock unavailable' } });
    await expect(controller.options({ tenantContext: context }, id)).rejects.toThrow(
      'Clock unavailable',
    );
  });
  it('keeps recovery available without starting another availability search', async () => {
    const { controller, check } = setup(undefined, true);
    expect(await controller.options({ tenantContext: context }, id)).toMatchObject({
      rooms: [],
      pending: true,
    });
    expect(check).not.toHaveBeenCalled();
  });
  it('directs an earlier stay change to verification before another move', async () => {
    const { controller, check } = setup(undefined, 'stay');
    expect(await controller.options({ tenantContext: context }, id)).toMatchObject({
      rooms: [],
      pending: true,
      pendingChange: 'stay',
    });
    expect(check).not.toHaveBeenCalled();
  });
});
