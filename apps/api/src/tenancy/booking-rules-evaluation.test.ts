import { afterEach, describe, expect, it, vi } from 'vitest';

import { evaluatePropertyBookingRules } from './booking-rules-evaluation';
import { AvailabilityService } from './availability.service';

const tenantId = 'a1111111-1111-4111-8111-111111111111';
const propertyId = 'b2222222-2222-4222-8222-222222222222';
const roomTypeId = 'c3333333-3333-4333-8333-333333333333';
afterEach(() => vi.useRealTimers());
function database(results: unknown[][]) {
  const queryRaw = vi.fn().mockResolvedValue([]);
  results.forEach((result) => queryRaw.mockResolvedValueOnce(result));
  const executeRaw = vi.fn();
  return {
    queryRaw,
    executeRaw,
    withTenantTransaction: async (context: unknown, callback: (tx: unknown) => unknown) => {
      expect(context).toEqual({ tenantId, propertyId });
      return callback({ $queryRaw: queryRaw, $executeRaw: executeRaw });
    },
  };
}
describe('property booking rules evaluation', () => {
  it('returns property-clock disabled days and does not check inventory without a target', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const db = database([
      [{ timezone: 'UTC', minStayNights: 2, maxStayNights: 5, bookingMode: 'MIXED' }],
    ]);
    const check = vi.fn();
    const result = await evaluatePropertyBookingRules(db as never, check, tenantId, propertyId, {
      from: '2026-10-17',
      to: '2026-10-20',
      startsOn: '2026-10-18',
      endsOn: '2026-10-19',
    });
    expect(result.disabledDates).toEqual(['2026-10-17']);
    expect(result.booking.errors[0].code).toBe('MIN_STAY');
    expect(result.block.valid).toBe(true);
    expect(check).not.toHaveBeenCalled();
  });
  it('allows overlapping pooled bookings while capacity remains but rejects blocking them', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const db = database([
      [{ timezone: 'UTC', bookingMode: 'MIXED' }],
      [{ status: 'PUBLISHED', maxOccupancy: 2 }],
      [{ startsOn: '2026-10-19', endsOn: '2026-10-21', kind: 'booking' }],
      [],
    ]);
    const result = await evaluatePropertyBookingRules(
      db as never,
      async () => ({ availableUnits: 1, minimumStay: 2 }),
      tenantId,
      propertyId,
      { roomTypeId, startsOn: '2026-10-19', endsOn: '2026-10-21' },
    );
    expect(result.booking.valid).toBe(true);
    expect(result.block.errors[0].code).toBe('BLOCK_RESERVATION_CONFLICT');
    expect(result.minStayNights).toBe(2);
  });
  it('checks pooled capacity as well as an available physical room in mixed mode', async () => {
    const roomId = 'd4444444-4444-4444-8444-444444444444';
    const db = database([
      [{ timezone: 'UTC', bookingMode: 'MIXED' }],
      [{ roomTypeId, isActive: true }],
      [{ status: 'PUBLISHED', maxOccupancy: 2 }],
      [],
      [],
    ]);
    const connections = { activePmsConnectionCredentials: vi.fn().mockResolvedValue(null) };
    const service = new AvailabilityService(
      db as never,
      {} as never,
      connections as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service, 'getRoomAvailability').mockResolvedValue({ isAvailable: true } as never);
    const pool = vi
      .spyOn(service, 'getAvailability')
      .mockResolvedValue({ availableUnits: 0 } as never);
    const result = await service.evaluateRules(tenantId, propertyId, {
      roomId,
      roomTypeId,
      startsOn: '2035-10-19',
      endsOn: '2035-10-21',
    });
    expect(result.booking.errors).toContainEqual(
      expect.objectContaining({ code: 'NO_AVAILABILITY' }),
    );
    expect(pool).toHaveBeenCalled();
  });
  it('rejects past block creation before any write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const db = database([[{ timezone: 'UTC' }]]);
    const service = new AvailabilityService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.createAvailabilityBlock(tenantId, propertyId, 'actor', {
        startsOn: '2026-10-17',
        endsOn: '2026-10-19',
        all: true,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(db.executeRaw).not.toHaveBeenCalled();
  });
  it('keeps reservation conflicts as 409 and never cancels or changes a reservation', async () => {
    const db = database([
      [{ timezone: 'UTC' }],
      [], // No external PMS assignment.
      [{ id: 'booking', startsOn: '2035-10-19', endsOn: '2035-10-21' }],
    ]);
    const service = new AvailabilityService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.createAvailabilityBlock(tenantId, propertyId, 'actor', {
        startsOn: '2035-10-19',
        endsOn: '2035-10-21',
        all: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(db.executeRaw).not.toHaveBeenCalled();
  });
});
