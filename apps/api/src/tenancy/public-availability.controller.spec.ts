import { describe, expect, it, vi } from 'vitest';

import { PublicAvailabilityController } from './public-availability.controller';

const request = { tenantContext: { tenantId: 'tenant-1', propertyId: 'property-1' } };

function makeController(availabilityResult: unknown) {
  const providers = { forProperty: vi.fn() };
  const availability = {
    getCalendar: vi.fn(),
    assertBookableSelection: vi.fn().mockResolvedValue(undefined),
  };
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

describe('PublicAvailabilityController.getAvailability', () => {
  it('passes the requested occupancy through to the provider so the listing agrees with the Select-step check', async () => {
    const getAvailability = vi.fn().mockResolvedValue({ ok: true, value: { isAvailable: true } });
    const providers = { forProperty: vi.fn().mockResolvedValue({ getAvailability }) };
    const availability = {
      getCalendar: vi.fn(),
      assertBookableSelection: vi.fn().mockResolvedValue(undefined),
    };
    const clockAvailability = { isAvailableForBooking: vi.fn() };
    const controller = new PublicAvailabilityController(
      providers as never,
      availability as never,
      clockAvailability as never,
    );

    await controller.getAvailability(
      {
        roomTypeId: 'room-type-1',
        startsOn: '2026-09-20',
        endsOn: '2026-09-22',
        adults: '2',
        children: '1',
      },
      request,
    );

    expect(getAvailability).toHaveBeenCalledWith(request.tenantContext, {
      roomTypeId: 'room-type-1',
      startsOn: '2026-09-20',
      endsOn: '2026-09-22',
      adultCount: 2,
      childrenCount: 1,
    });
  });
});

describe('PublicAvailabilityController.getCalendar', () => {
  it('passes the requested occupancy through to AvailabilityService.getCalendar', async () => {
    const providers = { forProperty: vi.fn() };
    const availability = {
      getCalendar: vi.fn().mockResolvedValue({ days: [] }),
      assertBookableSelection: vi.fn().mockResolvedValue(undefined),
    };
    const clockAvailability = { isAvailableForBooking: vi.fn() };
    const controller = new PublicAvailabilityController(
      providers as never,
      availability as never,
      clockAvailability as never,
    );

    await controller.getCalendar(
      { roomTypeId: 'room-type-1', month: '2026-09', adults: '2', children: '1' },
      request,
    );

    expect(availability.getCalendar).toHaveBeenCalledWith('tenant-1', 'property-1', {
      roomTypeId: 'room-type-1',
      roomId: '',
      month: '2026-09',
      adultCount: 2,
      childrenCount: 1,
      // Guests only see dates they could book with a rate that is on for the website.
      channel: 'website',
    });
  });

  it('passes the requested room count through so multi-room searches need enough free rooms', async () => {
    const providers = { forProperty: vi.fn() };
    const availability = {
      getCalendar: vi.fn().mockResolvedValue({ days: [] }),
      assertBookableSelection: vi.fn().mockResolvedValue(undefined),
    };
    const clockAvailability = { isAvailableForBooking: vi.fn() };
    const controller = new PublicAvailabilityController(
      providers as never,
      availability as never,
      clockAvailability as never,
    );

    await controller.getCalendar(
      { roomTypeId: 'room-type-1', month: '2026-09', adults: '2', rooms: '2' },
      request,
    );

    expect(availability.getCalendar).toHaveBeenCalledWith(
      'tenant-1',
      'property-1',
      expect.objectContaining({ roomCount: 2 }),
    );
  });

  it('allows a room-type-only calendar query with no roomId', async () => {
    const providers = { forProperty: vi.fn() };
    const availability = {
      getCalendar: vi.fn().mockResolvedValue({ days: [] }),
      assertBookableSelection: vi.fn().mockResolvedValue(undefined),
    };
    const clockAvailability = { isAvailableForBooking: vi.fn() };
    const controller = new PublicAvailabilityController(
      providers as never,
      availability as never,
      clockAvailability as never,
    );

    await expect(
      controller.getCalendar({ roomTypeId: 'room-type-1', month: '2026-09' }, request),
    ).resolves.toEqual({ days: [] });
  });
});

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
        channel: 'website',
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

describe('PublicAvailabilityController.getRateOffers', () => {
  const stay = {
    roomTypeId: 'room-type-1',
    startsOn: '2026-09-20',
    endsOn: '2026-09-22',
    adults: '2',
    children: '0',
  };

  function make(listOffersForStay: ReturnType<typeof vi.fn>) {
    const availability = {
      getCalendar: vi.fn(),
      assertBookableSelection: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new PublicAvailabilityController(
      { forProperty: vi.fn() } as never,
      availability as never,
      { listOffersForStay } as never,
    );
    return { controller, availability };
  }

  it('returns the rates a guest can choose between for the stay', async () => {
    const offers = [
      {
        rateId: '546549',
        name: 'BB',
        label: 'Bed & breakfast',
        mealNames: ['Breakfast'],
        total: { amount: '210.00', currency: 'EUR' },
      },
    ];
    const listOffersForStay = vi.fn().mockResolvedValue({ ok: true, value: offers });
    const { controller, availability } = make(listOffersForStay);

    await expect(controller.getRateOffers(stay, request)).resolves.toEqual({ offers });

    expect(availability.assertBookableSelection).toHaveBeenCalledWith(
      'tenant-1',
      'property-1',
      'room-type-1',
    );
    expect(listOffersForStay).toHaveBeenCalledWith('tenant-1', 'property-1', {
      roomTypeId: 'room-type-1',
      startsOn: '2026-09-20',
      endsOn: '2026-09-22',
      adultCount: 2,
      childrenCount: 0,
      // The website honours the rates staff switched off; staff screens do not.
      channel: 'website',
    });
  });

  it('passes the Clock discount display option only when explicitly requested', async () => {
    const listOffersForStay = vi.fn().mockResolvedValue({ ok: true, value: [] });
    const { controller } = make(listOffersForStay);
    await controller.getRateOffers({ ...stay, comparison: 'clock' }, request);
    expect(listOffersForStay).toHaveBeenCalledWith(
      'tenant-1',
      'property-1',
      expect.objectContaining({ clockDiscountDisplay: true, channel: 'website' }),
    );
  });

  it('gives a property without Clock an empty list instead of an error', async () => {
    const listOffersForStay = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'This property has no active Clock PMS connection.' },
    });
    const { controller } = make(listOffersForStay);

    await expect(controller.getRateOffers(stay, request)).resolves.toEqual({ offers: [] });
  });

  it('reports a real Clock failure to the caller', async () => {
    const listOffersForStay = vi.fn().mockResolvedValue({
      ok: false,
      error: { message: 'Clock did not respond.' },
    });
    const { controller } = make(listOffersForStay);

    await expect(controller.getRateOffers(stay, request)).rejects.toThrow('Clock did not respond.');
  });

  it('rejects a stay whose end date is not after its start', async () => {
    const { controller } = make(vi.fn());

    await expect(
      controller.getRateOffers({ ...stay, endsOn: stay.startsOn }, request),
    ).rejects.toThrow('endsOn must be after startsOn.');
  });
});

describe('PublicAvailabilityController.getAllCalendars', () => {
  function setup(getCalendar: ReturnType<typeof vi.fn>) {
    const availability = {
      getCalendar,
      assertBookableSelection: vi.fn(),
      publishedRoomTypeIds: vi.fn().mockResolvedValue(['a', 'b', 'c', 'd']),
    };
    return {
      availability,
      controller: new PublicAvailabilityController({} as never, availability as never, {} as never),
    };
  }

  it('returns every published room type, lists the ones it could not read, and asks as the website', async () => {
    const getCalendar = vi.fn(async (_t: string, _p: string, q: { roomTypeId: string }) => {
      if (q.roomTypeId === 'b') throw new Error('Clock is busy');
      return { days: [{ date: '2027-05-01', isAvailable: true, status: 'available' }] };
    });
    const { controller } = setup(getCalendar);
    const result = await controller.getAllCalendars({ month: '2027-05', adults: '2' }, request);
    expect(result.roomTypes.map((room) => room.roomTypeId)).toEqual(['a', 'c', 'd']);
    expect(result.failed).toEqual(['b']);
    expect(getCalendar.mock.calls[0]![2]).toMatchObject({
      month: '2027-05',
      adultCount: 2,
      channel: 'website',
    });
  });

  it('shares one read between identical requests made at the same moment', async () => {
    const getCalendar = vi.fn(async () => ({ days: [] }));
    const { controller, availability } = setup(getCalendar);
    await Promise.all([
      controller.getAllCalendars({ month: '2027-05' }, request),
      controller.getAllCalendars({ month: '2027-05' }, request),
    ]);
    expect(availability.publishedRoomTypeIds).toHaveBeenCalledTimes(1);
    expect(getCalendar).toHaveBeenCalledTimes(4);
    await controller.getAllCalendars({ month: '2027-05' }, request);
    expect(availability.publishedRoomTypeIds).toHaveBeenCalledTimes(2);
  });

  it('fails when no room type could be read, and refuses a bad month', async () => {
    const { controller } = setup(
      vi.fn(async () => {
        throw new Error('Clock is down');
      }),
    );
    await expect(controller.getAllCalendars({ month: '2027-05' }, request)).rejects.toThrow(
      'Clock is down',
    );
    expect(() => controller.getAllCalendars({ month: 'May' }, request)).toThrow('YYYY-MM');
  });
});
