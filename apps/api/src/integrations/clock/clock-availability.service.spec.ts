import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  ClockAvailabilityService,
  rateOfferLabel,
  classifyUnavailable,
} from './clock-availability.service';

const credentials = { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' };
const query = { roomTypeId: 'local-rt-1', startsOn: '2026-08-10', endsOn: '2026-08-12' };

function makeService(
  overrides: {
    client?: { request: ReturnType<typeof vi.fn> };
    mappedExternalId?: string | null;
    mappedExternalRoomId?: string | null;
    rankOrder?: string[];
    hasActiveRoomConflict?: boolean;
    displayPriceStore?: unknown;
    hiddenRateIds?: string[];
  } = {},
) {
  const database = {
    withTenantTransaction: vi.fn((_ctx, callback) =>
      callback({
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string) => {
          const mapped = sql.includes("entity_type = 'ROOM'")
            ? overrides.mappedExternalRoomId === undefined
              ? '606113'
              : overrides.mappedExternalRoomId
            : overrides.mappedExternalId === undefined
              ? '42023'
              : overrides.mappedExternalId;
          return Promise.resolve(mapped === null ? [] : [{ externalEntityId: mapped }]);
        }),
      }),
    ),
  };
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue({ connectionId: 'c1', provider: 'CLOCK_PMS', credentials }),
  };
  const client = overrides.client ?? { request: vi.fn() };
  const rateLimiter = { consume: vi.fn().mockResolvedValue({ allowed: true }) };
  const circuitBreaker = {
    assertClosed: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  const rateRankings = { rankOrder: vi.fn().mockResolvedValue(overrides.rankOrder ?? []) };
  const bookingConsistency = {
    hasActiveRoomConflict: vi.fn().mockResolvedValue(overrides.hasActiveRoomConflict ?? false),
  };
  const service = new ClockAvailabilityService(
    database as never,
    connections as never,
    client as never,
    rateLimiter as never,
    circuitBreaker as never,
    rateRankings as never,
    bookingConsistency as never,
    overrides.displayPriceStore as never,
    { hiddenRateIds: vi.fn().mockResolvedValue(new Set(overrides.hiddenRateIds ?? [])) } as never,
  );
  return { service, client, connections, rateRankings, bookingConsistency, rateLimiter };
}

describe('ClockAvailabilityService.isAvailableForBooking', () => {
  it('rejects a specific room when the verified booking overlap check finds an active conflict', async () => {
    const { service, client, bookingConsistency } = makeService({ hasActiveRoomConflict: true });

    await expect(
      service.isAvailableForBooking('t1', 'p1', {
        ...query,
        roomId: 'local-room-101',
      }),
    ).resolves.toEqual({ ok: true, value: false });
    expect(bookingConsistency.hasActiveRoomConflict).toHaveBeenCalledWith(
      credentials,
      { startsOn: '2026-08-10', endsOn: '2026-08-12' },
      '606113',
    );
    expect(client.request).not.toHaveBeenCalled();
  });

  it('accepts a genuinely available specific room', async () => {
    const { service, bookingConsistency } = makeService({ hasActiveRoomConflict: false });

    await expect(
      service.isAvailableForBooking('t1', 'p1', { ...query, roomId: 'local-room-101' }),
    ).resolves.toEqual({ ok: true, value: true });
    expect(bookingConsistency.hasActiveRoomConflict).toHaveBeenCalledOnce();
  });

  it('uses the short search cache only when explicitly requested', async () => {
    const { service, bookingConsistency } = makeService({ hasActiveRoomConflict: false });
    const physicalRoomQuery = { ...query, roomId: 'local-room-101' };

    await expect(
      service.isAvailableForBooking('t1', 'p1', physicalRoomQuery, { cache: true }),
    ).resolves.toEqual({ ok: true, value: true });
    await expect(
      service.isAvailableForBooking('t1', 'p1', physicalRoomQuery, { cache: true }),
    ).resolves.toEqual({ ok: true, value: true });

    expect(bookingConsistency.hasActiveRoomConflict).toHaveBeenCalledOnce();
  });

  it('rejects a room type when Clock reports no free rooms for an occupied night', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': { free: true, room_type_free_rooms: 1 },
                '2026-08-11': { free: false, room_type_free_rooms: 0 },
              },
            },
          },
        ],
      });
    const { service, bookingConsistency } = makeService({ client: { request } });

    await expect(service.isAvailableForBooking('t1', 'p1', query)).resolves.toEqual({
      ok: true,
      value: false,
    });
    expect(bookingConsistency.hasActiveRoomConflict).not.toHaveBeenCalled();
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        path: '/rates_availability',
        query: expect.objectContaining({ room_types: '42023' }),
      }),
    );
  });

  it('accepts a room type when Clock reports free inventory for every night', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': { free: true, room_type_free_rooms: 1 },
                '2026-08-11': { free: true, room_type_free_rooms: 1 },
              },
            },
          },
        ],
      });
    const { service, bookingConsistency } = makeService({ client: { request } });

    await expect(service.isAvailableForBooking('t1', 'p1', query)).resolves.toEqual({
      ok: true,
      value: true,
    });
    expect(bookingConsistency.hasActiveRoomConflict).not.toHaveBeenCalled();
  });
});

describe('ClockAvailabilityService.getAvailability', () => {
  it('reports a configuration error when the room type has no confirmed Clock mapping', async () => {
    const { service } = makeService({ mappedExternalId: null });

    const result = await service.getAvailability('t1', 'p1', query);

    expect(result).toEqual({
      ok: false,
      error: {
        category: 'configuration',
        code: 'clock_configuration',
        message:
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        retryable: false,
      },
    });
  });

  it('summarizes availability across every night of the stay, requiring every night to be free', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      }) // /rates/
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': { free: true, room_type_free_rooms: 3 },
                '2026-08-11': { free: true, room_type_free_rooms: 1 },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getAvailability('t1', 'p1', query);

    expect(result).toEqual({
      ok: true,
      value: {
        roomTypeId: 'local-rt-1',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        isAvailable: true,
        availableUnits: 1, // min across both nights
      },
    });
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        path: '/rates_availability',
        query: {
          from: '2026-08-10',
          to: '2026-08-11',
          rates: ['69242'],
          room_types: '42023',
          adults: '1',
          children: '0',
        },
      }),
    );
  });

  it('always sends adult/children counts to Clock, matching what the booking-time check sends, so the listing and Select steps agree on occupancy restrictions', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': { free: true, room_type_free_rooms: 3 },
                '2026-08-11': { free: true, room_type_free_rooms: 3 },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    await service.getAvailability('t1', 'p1', { ...query, adultCount: 2, childrenCount: 1 });

    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        query: expect.objectContaining({ adults: '2', children: '1' }),
      }),
    );
  });

  it('is unavailable when any occupied night is missing or not free', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': { free: true, room_type_free_rooms: 3 },
                // 2026-08-11 missing entirely
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getAvailability('t1', 'p1', query);

    expect(result).toEqual({
      ok: true,
      value: {
        roomTypeId: 'local-rt-1',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        isAvailable: false,
        availableUnits: 0,
      },
    });
  });

  it('is unavailable when the only rate showing free rooms is stopped from sale (real Clock shape: free:true alongside rate_restriction.stop_from_sale:true)', async () => {
    // Reproduces a real incident: Clock's /rates_availability marked a rate
    // `free: true` with `room_type_free_rooms: 1` even though staff had
    // turned it off for sale (`rate_restriction.stop_from_sale: true`) — the
    // listing showed "1 available" while /products correctly refused to
    // quote it. `errors` also carries this ("rate_restriction_stop_from_sale?").
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 1,
                  errors: { rate_restriction_stop_from_sale: ['Rate restriction stop from sale?'] },
                  rate_restriction: { stop_from_sale: true },
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 1,
                  errors: { rate_restriction_stop_from_sale: ['Rate restriction stop from sale?'] },
                  rate_restriction: { stop_from_sale: true },
                },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getAvailability('t1', 'p1', query);

    expect(result).toEqual({
      ok: true,
      value: {
        roomTypeId: 'local-rt-1',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        isAvailable: false,
        availableUnits: 0,
      },
    });
  });

  it('remains available when a different, non-stopped rate still shows free rooms on a night where one rate is stopped from sale', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [
          { id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
          { id: 69999, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
        ],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 1,
                  rate_restriction: { stop_from_sale: true },
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 1,
                  rate_restriction: { stop_from_sale: true },
                },
              },
              '69999': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 2,
                  rate_restriction: { stop_from_sale: false },
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 2,
                  rate_restriction: { stop_from_sale: false },
                },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getAvailability('t1', 'p1', query);

    expect(result).toEqual({
      ok: true,
      value: {
        roomTypeId: 'local-rt-1',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        isAvailable: true,
        availableUnits: 2,
      },
    });
  });

  it('caches a result for the same room type and date range', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': { free: true, room_type_free_rooms: 2 },
                '2026-08-11': { free: true, room_type_free_rooms: 2 },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    await service.getAvailability('t1', 'p1', query);
    const callsAfterFirst = request.mock.calls.length;
    await service.getAvailability('t1', 'p1', query);

    expect(request.mock.calls.length).toBe(callsAfterFirst);
  });

  it('does not share a cached result between different occupancy counts', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
    });
    request.mockResolvedValueOnce({
      status: 200,
      body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
    });
    request.mockResolvedValueOnce({
      status: 200,
      body: [
        {
          id: 42023,
          rates: {
            '69242': {
              '2026-08-10': { free: true, room_type_free_rooms: 2 },
              '2026-08-11': { free: true, room_type_free_rooms: 2 },
            },
          },
        },
      ],
    });
    request.mockResolvedValueOnce({
      status: 200,
      body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
    });
    request.mockResolvedValueOnce({
      status: 200,
      body: [
        {
          id: 42023,
          rates: {
            '69242': {
              '2026-08-10': { free: false, room_type_free_rooms: 0 },
              '2026-08-11': { free: false, room_type_free_rooms: 0 },
            },
          },
        },
      ],
    });
    const { service } = makeService({ client: { request } });

    const oneAdult = await service.getAvailability('t1', 'p1', { ...query, adultCount: 1 });
    const twoAdults = await service.getAvailability('t1', 'p1', { ...query, adultCount: 2 });

    // /rates/ is cached per room type (occupancy-independent), so only the
    // /rates_availability call repeats for the second, differently-occupied query.
    expect(request.mock.calls.length).toBe(3);
    expect(oneAdult).toMatchObject({ ok: true, value: { isAvailable: true } });
    expect(twoAdults).toMatchObject({ ok: true, value: { isAvailable: false } });
  });
});

describe('ClockAvailabilityService.getAvailabilityCalendar', () => {
  it('sends the requested occupancy to Clock, matching getAvailability and isAvailableForBooking', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': { free: true, room_type_free_rooms: 2 },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    await service.getAvailabilityCalendar('t1', 'p1', {
      roomTypeId: 'local-rt-1',
      month: '2026-08',
      adultCount: 2,
      childrenCount: 1,
    });

    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        query: expect.objectContaining({ adults: '2', children: '1' }),
      }),
    );
  });

  it('defaults occupancy to 1 adult, 0 children when the caller omits it', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: { '69242': { '2026-08-10': { free: true, room_type_free_rooms: 2 } } },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    await service.getAvailabilityCalendar('t1', 'p1', {
      roomTypeId: 'local-rt-1',
      month: '2026-08',
    });

    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        query: expect.objectContaining({ adults: '1', children: '0' }),
      }),
    );
  });

  it('marks a day unavailable when the only rate showing free rooms is stopped from sale', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 1,
                  rate_restriction: { stop_from_sale: true },
                },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getAvailabilityCalendar('t1', 'p1', {
      roomTypeId: 'local-rt-1',
      month: '2026-08',
    });

    expect(result).toEqual({
      ok: true,
      value: expect.arrayContaining([
        { date: '2026-08-10', isAvailable: false, status: 'closed', availableUnits: 1 },
      ]),
    });
  });

  // Runs one calendar month against a single rate whose cells are given by the test.
  async function calendarFor(cells: Record<string, unknown>, extra: { roomCount?: number } = {}) {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 42023, rates: { '69242': cells } }],
      });
    const { service } = makeService({ client: { request } });
    const result = await service.getAvailabilityCalendar('t1', 'p1', {
      roomTypeId: 'local-rt-1',
      month: '2026-08',
      ...extra,
    });
    if (!result.ok) throw new Error('expected an ok calendar');
    return Object.fromEntries(result.value.map((day) => [day.date, day]));
  }

  it('tells a stop-sale closure (rooms free) apart from a sold-out night (no rooms free)', async () => {
    const days = await calendarFor({
      '2026-08-10': {
        free: true,
        room_type_free_rooms: 7,
        rate_restriction: { stop_from_sale: true },
      },
      '2026-08-11': { free: false, room_type_free_rooms: 0 },
      '2026-08-12': {
        free: true,
        room_type_free_rooms: 0,
        rate_restriction: { stop_from_sale: true },
      },
      '2026-08-13': { free: true, room_type_free_rooms: 3 },
    });

    expect(days['2026-08-10']).toMatchObject({ isAvailable: false, status: 'closed' });
    expect(days['2026-08-11']).toMatchObject({ isAvailable: false, status: 'sold_out' });
    // Stopped AND no rooms left is a booked-out night first, not a staff closure.
    expect(days['2026-08-12']).toMatchObject({ isAvailable: false, status: 'sold_out' });
    expect(days['2026-08-13']).toMatchObject({ isAvailable: true, status: 'available' });
  });

  it('requires enough free rooms for a multi-room search', async () => {
    const cells = { '2026-08-10': { free: true, room_type_free_rooms: 2 } };

    expect((await calendarFor(cells, { roomCount: 2 }))['2026-08-10']).toMatchObject({
      isAvailable: true,
    });
    expect((await calendarFor(cells, { roomCount: 3 }))['2026-08-10']).toMatchObject({
      isAvailable: false,
      status: 'sold_out',
    });
  });

  it('reports arrival/departure closures and minimum stay only when every open rate has them', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [
          { id: 1, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
          { id: 2, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
        ],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '1': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 2,
                  rate_restriction: {
                    close_for_arrival: true,
                    close_for_departure: true,
                    min_stay: 3,
                  },
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 2,
                  rate_restriction: { close_for_arrival: true, min_stay_on_arrival: 2 },
                },
              },
              '2': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 2,
                  rate_restriction: { min_stay: 5 },
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 2,
                  rate_restriction: { close_for_arrival: true, min_stay_on_arrival: 4 },
                },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getAvailabilityCalendar('t1', 'p1', {
      roomTypeId: 'local-rt-1',
      month: '2026-08',
    });
    if (!result.ok) throw new Error('expected an ok calendar');
    const days = Object.fromEntries(result.value.map((day) => [day.date, day]));

    // Rate 2 is unrestricted for arrival/departure on the 10th, so the guest can use it.
    expect(days['2026-08-10']).toMatchObject({ isAvailable: true, minStay: 3 });
    expect(days['2026-08-10']?.closedToArrival).toBeUndefined();
    expect(days['2026-08-10']?.closedToDeparture).toBeUndefined();
    // Both rates close arrival on the 11th; the smaller minimum stay is the one offered.
    expect(days['2026-08-11']).toMatchObject({
      isAvailable: true,
      closedToArrival: true,
      minStay: 2,
    });
  });
});

describe('ClockAvailabilityService.getQuote', () => {
  it('reports a configuration error when the room type has no confirmed Clock mapping', async () => {
    const { service } = makeService({ mappedExternalId: null });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({
      ok: false,
      error: {
        category: 'configuration',
        code: 'clock_configuration',
        message:
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        retryable: false,
      },
    });
  });

  it('returns the real price from /products for the confirmed rate', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      }) // /rates/
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 23000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      }); // /products
    const { service } = makeService({ client: { request } });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({ ok: true, value: { amount: '230.00', currency: 'EUR' } });
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        path: '/products',
        query: {
          'product_search[arrival]': '2026-08-10',
          'product_search[departure]': '2026-08-12',
          'product_search[adult_count]': '1',
          'product_search[children_count]': '0',
          rates: ['69242'],
        },
      }),
    );
  });

  it('derives the nightly breakdown from a single /rates_availability call, scaled to the real total', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      }) // /rates/
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 23000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      }) // full-stay /products (the real total)
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 3,
                  price: { cents: 11000, currency: 'EUR' },
                  errors: {},
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 3,
                  price: { cents: 12000, currency: 'EUR' },
                  errors: {},
                },
              },
            },
          },
        ],
      }); // single /rates_availability call for the shape
    const { service } = makeService({ client: { request } });

    await expect(service.getQuoteWithNightlyRates('t1', 'p1', query)).resolves.toEqual({
      ok: true,
      value: {
        total: { amount: '230.00', currency: 'EUR' },
        nightlyRates: [
          { date: '2026-08-10', amount: '110.00' },
          { date: '2026-08-11', amount: '120.00' },
        ],
      },
    });
    expect(request).toHaveBeenCalledTimes(3); // /rates/, full-stay /products, one /rates_availability — never N per-night calls
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        path: '/rates_availability',
        query: {
          from: '2026-08-10',
          to: '2026-08-11',
          rates: ['69242'],
          room_types: '42023',
          adults: '1',
          children: '0',
        },
      }),
    );
  });

  it('scales an uneven shape to nights that still sum to exactly the real total (no rounding drift)', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 10001, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      }) // real total: 100.01
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                // Equal weights — an even 3-way split of 10001 cents isn't a whole number.
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 3,
                  price: { cents: 100, currency: 'EUR' },
                  errors: {},
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 3,
                  price: { cents: 100, currency: 'EUR' },
                  errors: {},
                },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getQuoteWithNightlyRates('t1', 'p1', query);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const centsSum = result.value.nightlyRates.reduce(
      (sum, night) => sum + Math.round(Number(night.amount) * 100),
      0,
    );
    expect(centsSum).toBe(10001); // must reconcile exactly to the real /products total
  });

  it('falls back to one /products call per night when the single /rates_availability call is missing a night', async () => {
    const product = (cents: number) => ({
      status: 200,
      body: [
        {
          id: 42023,
          rates: {
            '69242': [
              {
                available: true,
                room_type_free_rooms: 3,
                price: { cents, currency: 'EUR' },
                errors: {},
              },
            ],
          },
        },
      ],
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      }) // /rates/
      .mockResolvedValueOnce(product(23000)) // full stay /products
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 3,
                  price: { cents: 11000, currency: 'EUR' },
                  errors: {},
                },
                // 2026-08-11 missing — shape is incomplete, must fall back
              },
            },
          },
        ],
      }) // /rates_availability
      .mockResolvedValueOnce(product(11000)) // first night /products
      .mockResolvedValueOnce(product(12000)); // second night /products
    const { service } = makeService({ client: { request } });

    await expect(service.getQuoteWithNightlyRates('t1', 'p1', query)).resolves.toEqual({
      ok: true,
      value: {
        total: { amount: '230.00', currency: 'EUR' },
        nightlyRates: [
          { date: '2026-08-10', amount: '110.00' },
          { date: '2026-08-11', amount: '120.00' },
        ],
      },
    });
    expect(request.mock.calls.slice(-2).map((call) => call[1].query)).toEqual([
      expect.objectContaining({
        'product_search[arrival]': '2026-08-10',
        'product_search[departure]': '2026-08-11',
      }),
      expect.objectContaining({
        'product_search[arrival]': '2026-08-11',
        'product_search[departure]': '2026-08-12',
      }),
    ]);
  });

  it('splits evenly when every night in the shape is priced at zero', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 20000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      }) // real total: 200.00
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': {
                '2026-08-10': {
                  free: true,
                  room_type_free_rooms: 3,
                  price: { cents: 0, currency: 'EUR' },
                  errors: {},
                },
                '2026-08-11': {
                  free: true,
                  room_type_free_rooms: 3,
                  price: { cents: 0, currency: 'EUR' },
                  errors: {},
                },
              },
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    await expect(service.getQuoteWithNightlyRates('t1', 'p1', query)).resolves.toEqual({
      ok: true,
      value: {
        total: { amount: '200.00', currency: 'EUR' },
        nightlyRates: [
          { date: '2026-08-10', amount: '100.00' },
          { date: '2026-08-11', amount: '100.00' },
        ],
      },
    });
  });

  it('fails when Clock has no available offer for the requested stay', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: false,
                  room_type_free_rooms: 0,
                  price: { cents: 23000, currency: 'EUR' },
                  errors: { min_stay: 'not met' },
                },
              ],
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({
      ok: false,
      error: {
        category: 'validation',
        code: 'clock_rate_unavailable',
        message: 'Clock has no available price for the requested stay.',
        retryable: false,
      },
    });
  });

  it('logs the real Clock rejection reason when no offer is available, so an operator does not need a one-off script to find it', async () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: false,
                  room_type_free_rooms: 1,
                  price: { cents: 23000, currency: 'EUR' },
                  errors: { base: ['Rate restriction stop from sale?'] },
                },
              ],
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    await service.getQuote('t1', 'p1', query);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('local-rt-1'),
      expect.objectContaining({
        '69242': [{ base: ['Rate restriction stop from sale?'] }],
      }),
    );
    warnSpy.mockRestore();
  });

  it('never quotes a rate not published to the booking engine (wbe: false), even when it is the only one available', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [
          { id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: false },
          { id: 69243, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
        ],
      }) // /rates/
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              // Only rate 69243 (wbe: true) should ever be requested from Clock — the
              // wbe:false rate 69242 must never even appear in the `rates` query param.
              '69243': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 15000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      }); // /products
    const { service } = makeService({ client: { request } });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({ ok: true, value: { amount: '150.00', currency: 'EUR' } });
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        path: '/products',
        query: expect.objectContaining({ rates: ['69243'] }),
      }),
    );
  });

  it('reports a distinct configuration error when every rate on the room type is wbe: false', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: false }],
    }); // /rates/
    const { service } = makeService({ client: { request } });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({
      ok: false,
      error: {
        category: 'configuration',
        code: 'clock_configuration',
        message:
          "This room type has Clock rates configured, but none are published to the booking engine (wbe) — check Clock's rate configuration.",
        retryable: false,
      },
    });
  });

  it('picks the cheapest valid offer deterministically, regardless of which rate id is numerically lowest', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [
          { id: 99999, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
          { id: 5, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
        ],
      }) // /rates/
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              // Rate id "5" is numerically lowest — the old `Object.values(...).find(...)`
              // selection would have picked it regardless of price. It must lose here
              // because rate "99999" is cheaper.
              '5': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 32500, currency: 'EUR' },
                  errors: {},
                },
              ],
              '99999': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 11000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      }); // /products
    const { service } = makeService({ client: { request } });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({ ok: true, value: { amount: '110.00', currency: 'EUR' } });
  });

  it('always sends adult/children counts to Clock so its own occupancy enforcement runs, even when the caller omits them', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 10000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    // `query` here carries no adultCount/childrenCount at all.
    await service.getQuote('t1', 'p1', query);

    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        query: expect.objectContaining({
          'product_search[adult_count]': '1',
          'product_search[children_count]': '0',
        }),
      }),
    );
  });

  it('a staff display order never overrides the lowest price when no rate was chosen', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [
          { id: 803404, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
          { id: 803405, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
        ],
      }) // /rates/
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              // 803404 is cheaper; the staff order lists 803405 first but does not choose it.
              '803404': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 11000, currency: 'EUR' },
                  errors: {},
                },
              ],
              '803405': [
                {
                  available: true,
                  room_type_free_rooms: 3,
                  price: { cents: 25000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      }); // /products
    const { service } = makeService({ client: { request }, rankOrder: ['803405', '803404'] });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({ ok: true, value: { amount: '110.00', currency: 'EUR' } });
  });
});

describe('ClockAvailabilityService rate catalogue', () => {
  it('reads the whole rate catalogue once for many room types, even at the same moment', async () => {
    const request = vi.fn().mockImplementation((_credentials, options: { path: string }) =>
      Promise.resolve(
        options.path === '/rates/'
          ? {
              status: 200,
              body: [
                { id: 1, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
                { id: 2, bookable_id: 42024, bookable_type: 'Pms::RoomType', wbe: true },
              ],
            }
          : { status: 200, body: [] },
      ),
    );
    const { service } = makeService({ client: { request } });
    const read = (externalRoomTypeId: string) =>
      (
        service as unknown as {
          ratesForRoomType: (
            credentials: unknown,
            externalRoomTypeId: string,
          ) => Promise<{ ok: boolean; value?: { ids: string[] } }>;
        }
      ).ratesForRoomType(credentials, externalRoomTypeId);

    const [first, second] = await Promise.all([read('42023'), read('42024')]);

    expect(first.value?.ids).toEqual(['1']);
    expect(second.value?.ids).toEqual(['2']);
    expect(request.mock.calls.filter(([, options]) => options.path === '/rates/')).toHaveLength(1);
  });
});

describe('ClockAvailabilityService.getQuotesForStay', () => {
  it('uses one catalogue and one products request for multiple cold-cache room types', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [
          { id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
          { id: 69243, bookable_id: 42024, bookable_type: 'Pms::RoomType', wbe: true },
        ],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 2,
                  price: { cents: 11000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
          {
            id: 42024,
            rates: {
              '69243': [
                {
                  available: true,
                  room_type_free_rooms: 2,
                  price: { cents: 12500, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      });
    const { service, rateLimiter } = makeService({ client: { request } });
    rateLimiter.consume.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 1 });

    const stay = [
      {
        roomTypeId: 'local-rt-1',
        externalRoomTypeId: '42023',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        adultCount: 2,
        childrenCount: 0,
        currency: 'EUR',
      },
      {
        roomTypeId: 'local-rt-2',
        externalRoomTypeId: '42024',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        adultCount: 2,
        childrenCount: 0,
        currency: 'EUR',
      },
    ];
    const [result, simultaneous] = await Promise.all([
      service.getQuotesForStay('t1', 'p1', stay),
      service.getQuotesForStay('t1', 'p1', [...stay].reverse()),
    ]);
    expect(simultaneous).toEqual(result);

    expect(result).toEqual({
      'local-rt-1': { ok: true, value: { amount: '110.00', currency: 'EUR' } },
      'local-rt-2': { ok: true, value: { amount: '125.00', currency: 'EUR' } },
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        path: '/products',
        query: expect.objectContaining({ rates: ['69242', '69243'] }),
      }),
    );

    const cached = await service.getQuotesForStay('t1', 'p1', stay);
    expect(cached).toEqual(result);
    expect(request).toHaveBeenCalledTimes(2);
  });

  describe('remembered display prices', () => {
    const rates = {
      status: 200,
      body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
    };
    const products = (cents: number) => ({
      status: 200,
      body: [
        {
          id: 42023,
          rates: {
            '69242': [
              {
                available: true,
                room_type_free_rooms: 2,
                price: { cents, currency: 'EUR' },
                errors: {},
              },
            ],
          },
        },
      ],
    });
    const stay = [
      {
        roomTypeId: 'local-rt-1',
        externalRoomTypeId: '42023',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        adultCount: 2,
        childrenCount: 0,
        currency: 'EUR',
      },
    ];
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('serves a recent price from memory without asking Clock for it again', async () => {
      const request = vi.fn().mockResolvedValueOnce(rates).mockResolvedValueOnce(products(11000));
      const { service } = makeService({ client: { request } });
      await service.getQuotesForStay('t1', 'p1', stay);
      const again = await service.getQuotesForStay('t1', 'p1', stay);
      expect(again['local-rt-1']).toEqual({
        ok: true,
        value: { amount: '110.00', currency: 'EUR' },
      });
      // The rate list and the prices were read once; the second search asked Clock for nothing.
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('shows an older price at once and refreshes it in the background, so the next search sees the change', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-08-01T08:00:00Z'));
        const request = vi.fn().mockResolvedValueOnce(rates).mockResolvedValueOnce(products(11000));
        const { service } = makeService({ client: { request } });
        await service.getQuotesForStay('t1', 'p1', stay);

        // Two hours later: the old price is returned immediately, while Clock is asked again behind the scenes.
        vi.setSystemTime(new Date('2026-08-01T10:00:00Z'));
        request.mockResolvedValueOnce(rates).mockResolvedValueOnce(products(12500));
        const shown = await service.getQuotesForStay('t1', 'p1', stay);
        expect(shown['local-rt-1']).toEqual({
          ok: true,
          value: { amount: '110.00', currency: 'EUR' },
        });
        await settle();
        await settle();

        // The next search already shows the new price.
        request.mockResolvedValueOnce(rates);
        const next = await service.getQuotesForStay('t1', 'p1', stay);
        expect(next['local-rt-1']).toEqual({
          ok: true,
          value: { amount: '125.00', currency: 'EUR' },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps showing the last known price when the background refresh cannot reach Clock', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2026-08-01T08:00:00Z'));
        const request = vi.fn().mockResolvedValueOnce(rates).mockResolvedValueOnce(products(11000));
        const { service } = makeService({ client: { request } });
        await service.getQuotesForStay('t1', 'p1', stay);
        vi.setSystemTime(new Date('2026-08-01T13:00:00Z'));
        request.mockResolvedValueOnce(rates).mockResolvedValue({ status: 503, body: {} });
        const shown = await service.getQuotesForStay('t1', 'p1', stay);
        expect(shown['local-rt-1']).toEqual({
          ok: true,
          value: { amount: '110.00', currency: 'EUR' },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('remembers across a restart: a new service instance finds the price in the shared store', async () => {
      const shared = new Map<string, unknown>();
      const store = {
        get: async (key: string) => shared.get(key) ?? null,
        set: async (key: string, entry: unknown) => {
          shared.set(key, entry);
        },
      };
      const request = vi.fn().mockResolvedValueOnce(rates).mockResolvedValueOnce(products(11000));
      const first = makeService({ client: { request }, displayPriceStore: store });
      await first.service.getQuotesForStay('t1', 'p1', stay);
      expect(shared.size).toBe(1);

      const afterRestart = vi.fn().mockResolvedValueOnce(rates);
      const second = makeService({ client: { request: afterRestart }, displayPriceStore: store });
      const price = await second.service.getQuotesForStay('t1', 'p1', stay);
      expect(price['local-rt-1']).toEqual({
        ok: true,
        value: { amount: '110.00', currency: 'EUR' },
      });
      expect(afterRestart).toHaveBeenCalledTimes(1); // the rate list only
    });

    it('remembers "nothing available" briefly so a sold-out stay does not hit Clock on every search', async () => {
      const soldOut = {
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: false,
                  room_type_free_rooms: 0,
                  price: { cents: 0, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      };
      const request = vi.fn().mockResolvedValueOnce(rates).mockResolvedValueOnce(soldOut);
      const { service } = makeService({ client: { request } });
      const first = await service.getQuotesForStay('t1', 'p1', stay);
      expect(first['local-rt-1']).toMatchObject({ ok: false });
      const second = await service.getQuotesForStay('t1', 'p1', stay);
      expect(second['local-rt-1']).toMatchObject({ ok: false });
      expect(request).toHaveBeenCalledTimes(2); // no second prices request
    });
  });

  it('does not share display prices across tenants', async () => {
    const request = vi.fn().mockImplementation((_credentials, options: { path: string }) => {
      if (options.path === '/rates/') {
        return Promise.resolve({
          status: 200,
          body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true }],
        });
      }
      return Promise.resolve({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 2,
                  price: { cents: 11000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
        ],
      });
    });
    const { service } = makeService({ client: { request } });
    const stay = [
      {
        roomTypeId: 'local-rt-1',
        externalRoomTypeId: '42023',
        startsOn: '2026-08-10',
        endsOn: '2026-08-12',
        adultCount: 2,
        childrenCount: 0,
        currency: 'EUR',
      },
    ];

    await service.getQuotesForStay('tenant-a', 'p1', stay);
    await service.getQuotesForStay('tenant-a', 'p1', stay);
    await service.getQuotesForStay('tenant-b', 'p1', stay);

    expect(request.mock.calls.filter((call) => call[1]?.path === '/products')).toHaveLength(2);
  });
});

describe('ClockAvailabilityService.ratesForRoomTypeDetailed', () => {
  it('returns only wbe:true rates for the room type, with name and occupancy caps', async () => {
    const request = vi.fn().mockResolvedValueOnce({
      status: 200,
      body: [
        {
          id: 803404,
          bookable_id: 42023,
          bookable_type: 'Pms::RoomType',
          wbe: true,
          name: 'DBL - Summer',
          meals: [{ name: 'Breakfast' }],
          rate_restriction: { max_adults: 6, max_children: 6 },
        },
        {
          id: 803410,
          bookable_id: 42023,
          bookable_type: 'Pms::RoomType',
          wbe: false,
          name: 'DBL - Summer no WBE',
          rate_restriction: { max_adults: 5, max_children: 5 },
        },
        {
          id: 900001,
          bookable_id: 99999,
          bookable_type: 'Pms::RoomType',
          wbe: true,
          name: 'Different room type',
          rate_restriction: null,
        },
      ],
    });
    const { service } = makeService({ client: { request } });

    const result = await service.ratesForRoomTypeDetailed('t1', 'p1', 'local-rt-1');

    expect(result).toEqual({
      ok: true,
      value: [
        {
          externalRateId: '803404',
          name: 'DBL - Summer',
          label: 'Bed & breakfast',
          mealNames: ['Breakfast'],
          maxAdults: 6,
          maxChildren: 6,
        },
      ],
    });
  });

  it('reports a configuration error when the room type has no confirmed Clock mapping', async () => {
    const { service } = makeService({ mappedExternalId: null });

    const result = await service.ratesForRoomTypeDetailed('t1', 'p1', 'local-rt-1');

    expect(result).toEqual({
      ok: false,
      error: {
        category: 'configuration',
        code: 'clock_configuration',
        message:
          'This room type has no confirmed Clock catalog mapping — sync and confirm it first.',
        retryable: false,
      },
    });
  });
});

describe('ClockAvailabilityService.selectRateForStay', () => {
  it('selects the same rate and total that getQuote selects for identical stay data', async () => {
    const responses = () =>
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          body: [
            { id: 803404, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: false },
            { id: 803405, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
            { id: 803406, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
          ],
        })
        .mockResolvedValueOnce({
          status: 200,
          body: [
            {
              id: 42023,
              rates: {
                '803405': [
                  {
                    available: true,
                    room_type_free_rooms: 3,
                    price: { cents: 32500, currency: 'EUR' },
                    errors: {},
                  },
                ],
                '803406': [
                  {
                    available: true,
                    room_type_free_rooms: 3,
                    price: { cents: 11000, currency: 'EUR' },
                    errors: {},
                  },
                ],
              },
            },
          ],
        });

    const quoteService = makeService({
      client: { request: responses() },
      rankOrder: ['803405'],
    }).service;
    const bookingRequest = responses();
    const bookingService = makeService({
      client: { request: bookingRequest },
      rankOrder: ['803405'],
    }).service;
    const stay = {
      roomTypeId: 'local-rt-1',
      externalRoomTypeId: '42023',
      startsOn: '2026-08-10',
      endsOn: '2026-08-12',
      adultCount: 2,
      childrenCount: 1,
      childrenAges: [2],
    };

    const quote = await quoteService.getQuote('t1', 'p1', {
      roomTypeId: stay.roomTypeId,
      startsOn: stay.startsOn,
      endsOn: stay.endsOn,
      adultCount: stay.adultCount,
      childrenCount: stay.childrenCount,
      childrenAges: stay.childrenAges,
    });
    const selected = await bookingService.selectRateForStay(credentials, {
      tenantId: 't1',
      propertyId: 'p1',
      roomTypeId: stay.roomTypeId,
      externalRoomTypeId: stay.externalRoomTypeId,
      startsOn: stay.startsOn,
      endsOn: stay.endsOn,
      adultCount: stay.adultCount,
      childrenCount: stay.childrenCount,
      childrenAges: stay.childrenAges,
    });

    expect(bookingRequest).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        query: expect.objectContaining({ 'product_search[children_ages]': ['2'] }),
      }),
    );
    // The cheaper rate wins; the staff order (803405 first) does not choose for the guest.
    expect(quote).toEqual({ ok: true, value: { amount: '110.00', currency: 'EUR' } });
    expect(selected).toEqual({
      ok: true,
      value: { rateId: '803406', total: { amount: '110.00', currency: 'EUR' } },
    });
  });
});

const bedAndBreakfast = { id: 546549, name: 'BB', meals: [{ name: 'Breakfast' }] };
const fullBoard = {
  id: 615688,
  name: 'FB',
  meals: [{ name: 'Breakfast' }, { name: 'Lunch' }, { name: 'Dinner' }],
};
const ratesBody = [
  {
    ...bedAndBreakfast,
    bookable_id: 42023,
    bookable_type: 'Pms::RoomType',
    wbe: true,
    currency: 'EUR',
  },
  { ...fullBoard, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true, currency: 'EUR' },
  { id: 111, name: 'Reception', bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: false },
];
const offer = (cents: number, extra: Record<string, unknown> = {}) => ({
  available: true,
  room_type_free_rooms: 3,
  price: { cents, currency: 'EUR' },
  errors: {},
  ...extra,
});

describe('rateOfferLabel', () => {
  it.each([
    [[], 'Room only'],
    [['Breakfast'], 'Bed & breakfast'],
    [['Breakfast', 'Dinner'], 'Half board'],
    [['Breakfast', 'Lunch'], 'Half board'],
    [['Breakfast', 'Lunch', 'Dinner'], 'Full board'],
    [['dinner', 'breakfast', 'lunch'], 'Full board'],
  ])('labels meals %j as %s', (meals, label) => {
    expect(rateOfferLabel(meals, 'X')).toBe(label);
  });

  it('falls back to the Clock rate name for an unrecognised combination', () => {
    expect(rateOfferLabel(['Dinner'], 'Dinner only')).toBe('Dinner only');
  });
});

describe('ClockAvailabilityService.listOffersForStay', () => {
  it('returns every bookable published rate with a plain label, the cheapest first', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 42023, rates: { '615688': [offer(31000)], '546549': [offer(21000)] } }],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.listOffersForStay('t1', 'p1', { ...query, adultCount: 2 });

    expect(result).toEqual({
      ok: true,
      value: [
        {
          rateId: '546549',
          name: 'BB',
          label: 'Bed & breakfast',
          mealNames: ['Breakfast'],
          total: { amount: '210.00', currency: 'EUR' },
        },
        {
          rateId: '615688',
          name: 'FB',
          label: 'Full board',
          mealNames: ['Breakfast', 'Lunch', 'Dinner'],
          total: { amount: '310.00', currency: 'EUR' },
        },
      ],
    });
    // Only published rates are searched; the unpublished Reception rate (111) never is.
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({
        query: expect.objectContaining({ rates: ['546549', '615688'] }),
      }),
    );
  });

  it('lists the cheapest rate first and ignores any stored order', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 42023, rates: { '615688': [offer(31000)], '546549': [offer(21000)] } }],
      });
    const { service } = makeService({ client: { request }, rankOrder: ['615688'] });

    const result = await service.listOffersForStay('t1', 'p1', query);

    expect(result.ok && result.value.map((entry) => entry.rateId)).toEqual(['546549', '615688']);
  });

  it('leaves out an offer Clock marks unavailable or restricted, such as a party too large', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '546549': [offer(21000)],
              '615688': [
                offer(31000, {
                  available: false,
                  errors: { base: ['Maximum adults allowed - 1'] },
                }),
              ],
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });

    const result = await service.listOffersForStay('t1', 'p1', query);

    expect(result.ok && result.value.map((entry) => entry.rateId)).toEqual(['546549']);
  });

  it('returns an empty list, not an error, when nothing is bookable for the dates', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 42023, rates: { '546549': [offer(21000, { available: false })] } }],
      });
    const { service } = makeService({ client: { request } });

    await expect(service.listOffersForStay('t1', 'p1', query)).resolves.toEqual({
      ok: true,
      value: [],
    });
  });
});

describe('ClockAvailabilityService rate catalogue', () => {
  it('reads the whole rate catalogue once for many room types, even at the same moment', async () => {
    const request = vi.fn().mockImplementation((_credentials, options: { path: string }) =>
      Promise.resolve(
        options.path === '/rates/'
          ? {
              status: 200,
              body: [
                { id: 1, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
                { id: 2, bookable_id: 42024, bookable_type: 'Pms::RoomType', wbe: true },
              ],
            }
          : { status: 200, body: [] },
      ),
    );
    const { service } = makeService({ client: { request } });
    const read = (externalRoomTypeId: string) =>
      (
        service as unknown as {
          ratesForRoomType: (
            credentials: unknown,
            externalRoomTypeId: string,
          ) => Promise<{ ok: boolean; value?: { ids: string[] } }>;
        }
      ).ratesForRoomType(credentials, externalRoomTypeId);

    const [first, second] = await Promise.all([read('42023'), read('42024')]);

    expect(first.value?.ids).toEqual(['1']);
    expect(second.value?.ids).toEqual(['2']);
    expect(request.mock.calls.filter(([, options]) => options.path === '/rates/')).toHaveLength(1);
  });
});

describe('ClockAvailabilityService.publishedRateCurrency', () => {
  it('returns the most common currency of the rates published for online booking', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      body: [
        { id: 1, bookable_id: 1, bookable_type: 'Pms::RoomType', wbe: true, currency: 'EUR' },
        { id: 2, bookable_id: 1, bookable_type: 'Pms::RoomType', wbe: true, currency: 'EUR' },
        { id: 3, bookable_id: 1, bookable_type: 'Pms::RoomType', wbe: true, currency: 'ALL' },
        // Not published online, so it does not count.
        { id: 4, bookable_id: 1, bookable_type: 'Pms::RoomType', wbe: false, currency: 'ALL' },
        { id: 5, bookable_id: 1, bookable_type: 'Pms::RoomType', wbe: false, currency: 'ALL' },
      ],
    });
    const { service } = makeService({ client: { request } });

    await expect(service.publishedRateCurrency('t1', 'p1')).resolves.toBe('EUR');
  });

  it('is null when Clock cannot be read', async () => {
    const request = vi.fn().mockResolvedValue({ status: 503, body: 'down' });
    const { service } = makeService({ client: { request } });

    await expect(service.publishedRateCurrency('t1', 'p1')).resolves.toBeNull();
  });
});

describe('ClockAvailabilityService chosen rate', () => {
  const stay = {
    tenantId: 't1',
    propertyId: 'p1',
    roomTypeId: 'local-rt-1',
    externalRoomTypeId: '42023',
    startsOn: '2026-08-10',
    endsOn: '2026-08-12',
  };

  it('prices and selects only the rate the guest chose, even when another is cheaper', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 42023, rates: { '615688': [offer(31000)] } }],
      });
    const { service } = makeService({ client: { request } });

    const selected = await service.selectRateForStay(credentials, {
      ...stay,
      chosenRateId: '615688',
    });

    expect(selected).toEqual({
      ok: true,
      value: { rateId: '615688', total: { amount: '310.00', currency: 'EUR' } },
    });
    expect(request).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({ query: expect.objectContaining({ rates: ['615688'] }) }),
    );
  });

  it('refuses a rate that is not published for the room type, without asking Clock for prices', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 200, body: ratesBody });
    const { service } = makeService({ client: { request } });

    const selected = await service.selectRateForStay(credentials, {
      ...stay,
      chosenRateId: '111',
    });

    expect(selected).toMatchObject({ ok: false, error: { code: 'clock_rate_unavailable' } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('quotes the chosen rate through getQuote', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 42023, rates: { '615688': [offer(31000)] } }],
      });
    const { service } = makeService({ client: { request } });

    await expect(
      service.getQuote('t1', 'p1', { ...query, clockRateId: '615688' }),
    ).resolves.toEqual({
      ok: true,
      value: { amount: '310.00', currency: 'EUR' },
    });
  });
});

describe('classifyUnavailable', () => {
  const offer = (...messages: string[]) => ({
    available: false,
    room_type_free_rooms: 0,
    price: { cents: 0, currency: 'EUR' },
    errors: { base: messages },
  });

  it('reads the sentences Clock really sends', () => {
    expect(classifyUnavailable({ '1': [offer('Free?  ')] })).toBe('sold_out');
    expect(classifyUnavailable({ '1': [offer('Rate restriction stop from sale?  ')] })).toBe(
      'closed',
    );
    expect(
      classifyUnavailable({
        '1': [offer('Maximum children exceeded.', 'Maximum adults allowed - 2', 'Maximum guests')],
      }),
    ).toBe('capacity');
  });

  it('says sold out when one rate is sold out and another is closed, because that is what is happening', () => {
    expect(
      classifyUnavailable({
        '1': [offer('Free?  ', 'Rate restriction stop from sale?  ')],
        '2': [offer('Rate restriction stop from sale?  ')],
      }),
    ).toBe('sold_out');
  });

  it('knows minimum stay and arrival or departure closures, and falls back to a general reason', () => {
    expect(classifyUnavailable({ '1': [offer('Minimum stay 3 nights')] })).toBe('min_stay');
    expect(classifyUnavailable({ '1': [offer('Closed to arrival')] })).toBe('no_arrival');
    expect(classifyUnavailable({ '1': [offer('Closed to departure')] })).toBe('no_departure');
    expect(classifyUnavailable({ '1': [offer('Something new Clock invented')] })).toBe(
      'unavailable',
    );
    expect(classifyUnavailable(undefined)).toBe('unavailable');
  });
});

describe('ClockAvailabilityService.getStaySearch', () => {
  it('answers every room type from one product request: price and rooms left, or why not', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [
          { id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType', wbe: true },
          { id: 69243, bookable_id: 42024, bookable_type: 'Pms::RoomType', wbe: true },
        ],
      })
      .mockResolvedValueOnce({
        status: 200,
        body: [
          {
            id: 42023,
            rates: {
              '69242': [
                {
                  available: true,
                  room_type_free_rooms: 2,
                  price: { cents: 11000, currency: 'EUR' },
                  errors: {},
                },
              ],
            },
          },
          {
            id: 42024,
            rates: {
              '69243': [
                {
                  available: false,
                  room_type_free_rooms: 0,
                  price: { cents: 0, currency: 'EUR' },
                  errors: { base: ['Free?  '] },
                },
              ],
            },
          },
        ],
      });
    const { service } = makeService({ client: { request } });
    const stay = (roomTypeId: string, externalRoomTypeId: string) => ({
      roomTypeId,
      externalRoomTypeId,
      startsOn: '2026-08-10',
      endsOn: '2026-08-12',
      adultCount: 2,
      childrenCount: 0,
      currency: 'EUR',
    });
    const { details } = await service.getStaySearch('t1', 'p1', [
      stay('rt-1', '42023'),
      stay('rt-2', '42024'),
    ]);
    expect(details['rt-1']).toEqual({
      available: true,
      price: { amount: '110.00', currency: 'EUR' },
      freeRooms: 2,
    });
    expect(details['rt-2']).toEqual({ available: false, reason: 'sold_out' });
    expect(request).toHaveBeenCalledTimes(2); // the rate list and one product request

    // Asked again, both answers come from memory, including the reason a room type is not for sale.
    const again = await service.getStaySearch('t1', 'p1', [
      stay('rt-1', '42023'),
      stay('rt-2', '42024'),
    ]);
    expect(again.details['rt-2']).toEqual({ available: false, reason: 'sold_out' });
    expect(again.details['rt-1']).toMatchObject({ available: true, freeRooms: 2 });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('rates switched off for the website', () => {
  const twoOffers = [{ id: 42023, rates: { '615688': [offer(31000)], '546549': [offer(21000)] } }];

  it('are left out of what the website offers and searches, and staff still see them', async () => {
    const website = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({ status: 200, body: twoOffers });
    const site = makeService({ client: { request: website }, hiddenRateIds: ['615688'] });
    const guest = await site.service.listOffersForStay('t1', 'p1', {
      ...query,
      channel: 'website',
    });
    expect(guest.ok && guest.value.map((entry) => entry.rateId)).toEqual(['546549']);
    expect(website).toHaveBeenLastCalledWith(
      credentials,
      expect.objectContaining({ query: expect.objectContaining({ rates: ['546549'] }) }),
    );

    const staffRequest = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({ status: 200, body: twoOffers });
    const desk = makeService({ client: { request: staffRequest }, hiddenRateIds: ['615688'] });
    const staff = await desk.service.listOffersForStay('t1', 'p1', { ...query, channel: 'staff' });
    expect(staff.ok && staff.value.map((entry) => entry.rateId)).toEqual(['546549', '615688']);
  });

  it('say so when every rate of a room type is switched off', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 200, body: ratesBody });
    const { service } = makeService({
      client: { request },
      hiddenRateIds: ['546549', '615688'],
    });
    const result = await service.listOffersForStay('t1', 'p1', { ...query, channel: 'website' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/switched off for the website/);
  });

  it('cannot be priced by a guest who names one, but staff can still choose it', async () => {
    const request = vi.fn().mockResolvedValueOnce({ status: 200, body: ratesBody });
    const { service } = makeService({ client: { request }, hiddenRateIds: ['615688'] });
    const refused = await service.getQuote('t1', 'p1', {
      ...query,
      clockRateId: '615688',
      channel: 'website',
    });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error.code).toBe('clock_rate_unavailable');
  });

  it('are not part of the one search that answers every room card', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: ratesBody })
      .mockResolvedValueOnce({ status: 200, body: twoOffers });
    const { service } = makeService({ client: { request }, hiddenRateIds: ['546549'] });
    const search = await service.getStaySearch('t1', 'p1', [
      { roomTypeId: 'rt-1', startsOn: '2026-08-10', endsOn: '2026-08-12', channel: 'website' },
    ]);
    expect(search.results['rt-1']).toEqual({
      ok: true,
      value: { amount: '310.00', currency: 'EUR' },
    });
  });

  describe('a rate that needs a promo code', () => {
    const withCode = ratesBody.map((rate) =>
      rate.id === fullBoard.id ? { ...rate, bonus_codes: ['testcode'] } : rate,
    );
    const offers = [{ id: 42023, rates: { '615688': [offer(31000)], '546549': [offer(21000)] } }];
    const run = async (channel: 'website' | 'staff', rates = withCode) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, body: rates })
        .mockResolvedValueOnce({ status: 200, body: offers });
      const { service } = makeService({ client: { request } });
      const result = await service.listOffersForStay('t1', 'p1', { ...query, channel });
      return { result, request };
    };

    it('is not offered to the website, which would otherwise sell it to everyone, but staff still see it', async () => {
      const guest = await run('website');
      expect(guest.result.ok && guest.result.value.map((entry) => entry.rateId)).toEqual([
        '546549',
      ]);
      expect(guest.request).toHaveBeenLastCalledWith(
        credentials,
        expect.objectContaining({ query: expect.objectContaining({ rates: ['546549'] }) }),
      );
      const staff = await run('staff');
      expect(staff.result.ok && staff.result.value.map((entry) => entry.rateId)).toEqual([
        '546549',
        '615688',
      ]);
    });

    it('cannot be priced by a guest who names it', async () => {
      const request = vi.fn().mockResolvedValueOnce({ status: 200, body: withCode });
      const { service } = makeService({ client: { request } });
      const refused = await service.getQuote('t1', 'p1', {
        ...query,
        clockRateId: '615688',
        channel: 'website',
      });
      expect(!refused.ok && refused.error.code).toBe('clock_rate_unavailable');
    });

    it('says so when every rate of a room type needs a code', async () => {
      const allCoded = ratesBody.map((rate) => ({ ...rate, bonus_codes: ['VIP'] }));
      const guest = await run('website', allCoded as never);
      expect(guest.result.ok).toBe(false);
      expect(!guest.result.ok && guest.result.error.message).toMatch(/needs a promo code/);
    });
  });

  it('are also left out of the guest-facing availability checks, and kept for staff', async () => {
    const asked = async (call: 'availability' | 'booking', channel: 'website' | 'staff') => {
      const request = vi
        .fn()
        .mockResolvedValueOnce({ status: 200, body: ratesBody })
        .mockResolvedValue({ status: 200, body: [] });
      const { service } = makeService({ client: { request }, hiddenRateIds: ['615688'] });
      if (call === 'availability') await service.getAvailability('t1', 'p1', { ...query, channel });
      else await service.isAvailableForBooking('t1', 'p1', { ...query, channel });
      const search = request.mock.calls.find(([, options]) => options?.query?.rates)!;
      return search[1].query.rates;
    };
    expect(await asked('availability', 'website')).toEqual(['546549']);
    expect(await asked('availability', 'staff')).toEqual(['546549', '615688']);
    expect(await asked('booking', 'website')).toEqual(['546549']);
    expect(await asked('booking', 'staff')).toEqual(['546549', '615688']);
  });
});
