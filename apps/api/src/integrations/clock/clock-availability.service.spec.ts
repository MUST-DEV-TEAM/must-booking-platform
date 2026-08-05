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
