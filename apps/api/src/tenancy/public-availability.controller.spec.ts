import { describe, expect, it, vi } from 'vitest';

import { PublicAvailabilityController } from './public-availability.controller';

const request = { tenantContext: { tenantId: 'tenant-1', propertyId: 'property-1' } };

function makeController(availabilityResult: unknown) {
  const providers = { forProperty: vi.fn() };
  const availability = { getCalendar: vi.fn() };
  const clockAvailability = {
    isAvailableForBooking: vi.fn().mockResolvedValue(availabilityResult),
  };
  const controller = new PublicAvailabilityController(
    providers as never,
    availability as never,
    clockAvailability as never,
  );
  return { controller, clockAvailability };
}

describe('PublicAvailabilityController.checkAvailability', () => {
  it('delegates the advisory check to the shared cached booking guard', async () => {
    const { controller, clockAvailability } = makeController({ ok: true, value: false });

    await expect(
      controller.checkAvailability(
        {
          roomTypeId: 'room-type-1',
          roomId: 'room-1',
          startsOn: '2026-09-20',
          endsOn: '2026-09-22',
          adults: '2',
          children: '1',
        },
        request,
      ),
    ).resolves.toEqual({ isAvailable: false, checked: true });
    expect(clockAvailability.isAvailableForBooking).toHaveBeenCalledWith(
      'tenant-1',
      'property-1',
      {
        roomTypeId: 'room-type-1',
        roomId: 'room-1',
        startsOn: '2026-09-20',
        endsOn: '2026-09-22',
        adultCount: 2,
        childrenCount: 1,
      },
      { cache: true },
    );
  });

  it('fails open for classified and unexpected availability failures', async () => {
    const classified = makeController({ ok: false, error: { message: 'Clock unavailable' } });
    await expect(classified.controller.checkAvailability({}, request)).rejects.toThrow(
      'roomTypeId is required',
    );

    const failure = makeController({ ok: false, error: { message: 'Clock unavailable' } });
    await expect(
      failure.controller.checkAvailability(
        { roomTypeId: 'room-type-1', startsOn: '2026-09-20', endsOn: '2026-09-22' },
        request,
      ),
    ).resolves.toEqual({ isAvailable: true, checked: false });

    const unexpected = makeController(undefined);
    unexpected.clockAvailability.isAvailableForBooking.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      unexpected.controller.checkAvailability(
        { roomTypeId: 'room-type-1', startsOn: '2026-09-20', endsOn: '2026-09-22' },
        request,
      ),
    ).resolves.toEqual({ isAvailable: true, checked: false });
  });
});
