import { describe, expect, it, vi } from 'vitest';

const { reportOperationalFailure } = vi.hoisted(() => ({ reportOperationalFailure: vi.fn() }));
vi.mock('../../observability/error-tracking', () => ({ reportOperationalFailure }));

import { ClockBookingConsistencyService } from './clock-booking-consistency.service';

const credentials = { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' };

function makeService(
  bookings: unknown[],
  operations: Array<{ externalReference: string }>,
  clockResponses: unknown[],
) {
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValueOnce(bookings).mockResolvedValueOnce(operations),
  };
  const database = {
    withTenantTransaction: vi.fn((_context, callback) => callback(transaction)),
  };
  const connections = {
    activePmsConnectionCredentials: vi
      .fn()
      .mockResolvedValue({ connectionId: 'connection', provider: 'CLOCK_PMS', credentials }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const client = {
    request: vi.fn().mockImplementation(() => {
      const body = clockResponses.shift();
      return Promise.resolve({ status: 200, body });
    }),
  };
  const rateLimiter = { consume: vi.fn().mockResolvedValue({ allowed: true }) };
  const circuitBreaker = {
    assertClosed: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  };
  return {
    service: new ClockBookingConsistencyService(
      database as never,
      connections as never,
      audit as never,
      client as never,
      rateLimiter as never,
      circuitBreaker as never,
    ),
    client,
    audit,
    rateLimiter,
    circuitBreaker,
  };
}

describe('ClockBookingConsistencyService', () => {
  it('accepts Clock expected/no-show for local CONFIRMED and a missing Clock row for local CANCELLED', async () => {
    const { service, client, audit, rateLimiter, circuitBreaker } = makeService(
      [
        {
          id: 'local-confirmed',
          externalReference: 'must-1',
          externalBookingId: '100',
          status: 'CONFIRMED',
        },
        {
          id: 'local-cancelled',
          externalReference: 'must-2',
          externalBookingId: '200',
          status: 'CANCELLED',
        },
      ],
      [{ externalReference: 'must-1' }, { externalReference: 'must-2' }],
      [[100], { id: 100, status: 'no_show', reference_number: 'must-1' }],
    );

    await expect(
      service.check('tenant', 'property', { startsOn: '2026-08-01', endsOn: '2026-08-31' }),
    ).resolves.toEqual({
      startsOn: '2026-08-01',
      endsOn: '2026-08-31',
      localBookingCount: 2,
      clockBookingCount: 1,
      findings: [],
    });
    expect(client.request).toHaveBeenCalledWith(
      credentials,
      expect.objectContaining({
        path: '/bookings/',
        query: { 'arrival.lt': '2026-08-31', 'departure.gt': '2026-08-01' },
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      credentials,
      expect.objectContaining({ path: '/bookings/100', query: undefined }),
    );
    expect(rateLimiter.consume).toHaveBeenCalledTimes(2);
    expect(circuitBreaker.assertClosed).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'clock_booking_consistency.checked',
        details: expect.objectContaining({ findingCounts: {} }),
      }),
    );
  });

  it('flags missing/status-drift local bookings and only Clock-only rows corroborated by MUST operations', async () => {
    const { service } = makeService(
      [
        {
          id: 'local-missing',
          externalReference: 'must-missing',
          externalBookingId: '101',
          status: 'CONFIRMED',
        },
        {
          id: 'local-status',
          externalReference: 'must-status',
          externalBookingId: '102',
          status: 'CONFIRMED',
        },
      ],
      [{ externalReference: 'must-clock-only' }, { externalReference: 'must-order' }],
      [
        [102, 103, 105, 104],
        { id: 102, status: 'canceled', reference_number: 'must-status' },
        { id: 103, status: 'expected', reference_number: 'must-clock-only' },
        { id: 105, status: 'expected', reference_number: 'must-order-room1' },
        { id: 104, status: 'expected', reference_number: 'other-channel-booking' },
      ],
    );

    await expect(
      service.check('tenant', 'property', { startsOn: '2026-08-01', endsOn: '2026-08-31' }),
    ).resolves.toEqual({
      startsOn: '2026-08-01',
      endsOn: '2026-08-31',
      localBookingCount: 2,
      clockBookingCount: 4,
      findings: [
        {
          type: 'LOCAL_BOOKING_MISSING_FROM_CLOCK',
          localBookingId: 'local-missing',
          localStatus: 'CONFIRMED',
        },
        {
          type: 'BOOKING_STATUS_MISMATCH',
          localBookingId: 'local-status',
          clockBookingId: '102',
          localStatus: 'CONFIRMED',
          clockStatus: 'canceled',
        },
        {
          type: 'CLOCK_BOOKING_MISSING_LOCALLY',
          clockBookingId: '103',
          clockStatus: 'expected',
        },
        {
          type: 'CLOCK_BOOKING_MISSING_LOCALLY',
          clockBookingId: '105',
          clockStatus: 'expected',
        },
      ],
    });
    expect(reportOperationalFailure).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ operation: 'booking-consistency-check' }),
    );
  });
});
