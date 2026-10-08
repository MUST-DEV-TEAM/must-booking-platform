import { describe, expect, it, vi } from 'vitest';

import { ClockPrePaymentAvailability } from './clock-pre-payment-availability';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const stay = { startsOn: '2027-01-10', endsOn: '2027-01-12' };
const typeA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const typeB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function make(options: { freeUnits?: number; takenRooms?: string[] } = {}) {
  const availability = {
    unavailableRoomsForBooking: vi
      .fn()
      .mockResolvedValue({ ok: true, value: options.takenRooms ?? [] }),
    getAvailability: vi.fn().mockImplementation(async (_t, _p, query) => ({
      ok: true,
      value: {
        roomTypeId: query.roomTypeId,
        startsOn: stay.startsOn,
        endsOn: stay.endsOn,
        isAvailable: (options.freeUnits ?? 5) > 0,
        availableUnits: options.freeUnits ?? 5,
      },
    })),
  };
  return { check: new ClockPrePaymentAvailability(availability as never), availability };
}

describe('ClockPrePaymentAvailability', () => {
  it('checks all specific rooms in one call and unassigned rooms once per type and occupancy', async () => {
    const { check, availability } = make();
    await expect(
      check.confirmAvailable(context, {
        ...stay,
        rooms: [
          { roomTypeId: typeA, roomId: 'room-1', adults: 2, children: 0 },
          { roomTypeId: typeA, roomId: 'room-2', adults: 2, children: 0 },
          { roomTypeId: typeB, adults: 2, children: 0 },
          { roomTypeId: typeB, adults: 2, children: 0 },
          { roomTypeId: typeB, adults: 1, children: 1 },
        ],
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(availability.unavailableRoomsForBooking).toHaveBeenCalledOnce();
    expect(availability.unavailableRoomsForBooking).toHaveBeenCalledWith(
      context.tenantId,
      context.propertyId,
      { roomIds: ['room-1', 'room-2'], ...stay },
    );
    expect(availability.getAvailability).toHaveBeenCalledTimes(2);
    expect(availability.getAvailability).toHaveBeenCalledWith(
      context.tenantId,
      context.propertyId,
      expect.objectContaining({ roomTypeId: typeB, adultCount: 2, childrenCount: 0 }),
      { skipCache: true },
    );
  });

  it('refuses when Clock has fewer free units than the stay asks for of one type', async () => {
    const { check } = make({ freeUnits: 2 });
    await expect(
      check.confirmAvailable(context, {
        ...stay,
        rooms: [0, 1, 2].map(() => ({ roomTypeId: typeA, adults: 2, children: 0 })),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'AVAILABILITY_FAILED', retryable: false },
    });
  });

  it('refuses a taken room with the single-room message', async () => {
    const { check } = make({ takenRooms: ['room-1'] });
    await expect(
      check.confirmAvailable(context, {
        ...stay,
        rooms: [{ roomTypeId: typeA, roomId: 'room-1', adults: 2, children: 0 }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: 'The selected room is no longer available for the requested stay.' },
    });
  });

  it('passes through whether an unreachable Clock is worth retrying', async () => {
    const { check, availability } = make();
    availability.getAvailability.mockResolvedValueOnce({
      ok: false,
      error: { code: 'CLOCK_TIMEOUT', message: 'timeout', retryable: true },
    });
    await expect(
      check.confirmAvailable(context, {
        ...stay,
        rooms: [{ roomTypeId: typeA, adults: 2, children: 0 }],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'AVAILABILITY_FAILED', retryable: true },
    });
  });
});
