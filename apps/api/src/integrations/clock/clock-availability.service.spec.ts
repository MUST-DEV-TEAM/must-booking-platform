import { describe, expect, it, vi } from 'vitest';

import { ClockAvailabilityService } from './clock-availability.service';

const credentials = { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' };
const query = { roomTypeId: 'local-rt-1', startsOn: '2026-08-10', endsOn: '2026-08-12' };

function makeService(
  overrides: {
    client?: { request: ReturnType<typeof vi.fn> };
    mappedExternalId?: string | null;
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
  const service = new ClockAvailabilityService(
    database as never,
    connections as never,
    client as never,
    rateLimiter as never,
    circuitBreaker as never,
  );
  return { service, client, connections };
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        query: { from: '2026-08-10', to: '2026-08-11', rates: ['69242'], room_types: '42023' },
      }),
    );
  });

  it('scales an uneven shape to nights that still sum to exactly the real total (no rounding drift)', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
        body: [{ id: 69242, bookable_id: 42023, bookable_type: 'Pms::RoomType' }],
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
});
