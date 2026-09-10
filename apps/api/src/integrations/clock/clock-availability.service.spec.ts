import { describe, expect, it, vi } from 'vitest';

import { ClockAvailabilityService } from './clock-availability.service';

const credentials = { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' };
const query = { roomTypeId: 'local-rt-1', startsOn: '2026-08-10', endsOn: '2026-08-12' };

function makeService(
  overrides: {
    client?: { request: ReturnType<typeof vi.fn> };
    mappedExternalId?: string | null;
    rankOrder?: string[];
  } = {},
) {
  const database = {
    withTenantTransaction: vi.fn((_ctx, callback) =>
      callback({
        $queryRawUnsafe: vi
          .fn()
          .mockResolvedValue(
            overrides.mappedExternalId === undefined
              ? [{ externalEntityId: '42023' }]
              : overrides.mappedExternalId === null
                ? []
                : [{ externalEntityId: overrides.mappedExternalId }],
          ),
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
  const service = new ClockAvailabilityService(
    database as never,
    connections as never,
    client as never,
    rateLimiter as never,
    circuitBreaker as never,
    rateRankings as never,
  );
  return { service, client, connections, rateRankings };
}

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
        },
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
                '2026-08-10': { free: true, room_type_free_rooms: 3, price: { cents: 11000, currency: 'EUR' }, errors: {} },
                '2026-08-11': { free: true, room_type_free_rooms: 3, price: { cents: 12000, currency: 'EUR' }, errors: {} },
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
                { available: true, room_type_free_rooms: 3, price: { cents: 10001, currency: 'EUR' }, errors: {} },
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
                '2026-08-10': { free: true, room_type_free_rooms: 3, price: { cents: 100, currency: 'EUR' }, errors: {} },
                '2026-08-11': { free: true, room_type_free_rooms: 3, price: { cents: 100, currency: 'EUR' }, errors: {} },
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
                '2026-08-10': { free: true, room_type_free_rooms: 3, price: { cents: 11000, currency: 'EUR' }, errors: {} },
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
                { available: true, room_type_free_rooms: 3, price: { cents: 20000, currency: 'EUR' }, errors: {} },
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
                '2026-08-10': { free: true, room_type_free_rooms: 3, price: { cents: 0, currency: 'EUR' }, errors: {} },
                '2026-08-11': { free: true, room_type_free_rooms: 3, price: { cents: 0, currency: 'EUR' }, errors: {} },
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
        category: 'configuration',
        code: 'clock_configuration',
        message: 'Clock has no available price for the requested stay.',
        retryable: false,
      },
    });
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
                { available: true, room_type_free_rooms: 3, price: { cents: 15000, currency: 'EUR' }, errors: {} },
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
      expect.objectContaining({ path: '/products', query: expect.objectContaining({ rates: ['69243'] }) }),
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
                { available: true, room_type_free_rooms: 3, price: { cents: 32500, currency: 'EUR' }, errors: {} },
              ],
              '99999': [
                { available: true, room_type_free_rooms: 3, price: { cents: 11000, currency: 'EUR' }, errors: {} },
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
                { available: true, room_type_free_rooms: 3, price: { cents: 10000, currency: 'EUR' }, errors: {} },
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

  it('a staff-set rate ranking (Task 13) wins over the cheapest-price default, even when the ranked rate costs more', async () => {
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
              // 803404 is cheaper, but 803405 is ranked #1 by staff — it must win.
              '803404': [
                { available: true, room_type_free_rooms: 3, price: { cents: 11000, currency: 'EUR' }, errors: {} },
              ],
              '803405': [
                { available: true, room_type_free_rooms: 3, price: { cents: 25000, currency: 'EUR' }, errors: {} },
              ],
            },
          },
        ],
      }); // /products
    const { service } = makeService({ client: { request }, rankOrder: ['803405', '803404'] });

    const result = await service.getQuote('t1', 'p1', query);

    expect(result).toEqual({ ok: true, value: { amount: '250.00', currency: 'EUR' } });
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
        { externalRateId: '803404', name: 'DBL - Summer', maxAdults: 6, maxChildren: 6 },
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
