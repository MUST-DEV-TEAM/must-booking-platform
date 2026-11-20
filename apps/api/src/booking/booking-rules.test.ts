import { describe, expect, it } from 'vitest';

import {
  evaluateBookingRules,
  isOverridableRule,
  effectiveMinimumStay,
  minimumStayForOpenRates,
  ruleRangesOverlap,
} from './booking-rules';

const now = new Date('2026-10-18T18:00:00Z');
const policy = {
  timezone: 'Europe/Tirane',
  minStayNights: 2,
  maxStayNights: 5,
  advanceBookingDays: 10,
  sameDayBookingAllowed: true,
  sameDayCutoffTime: '19:00',
};
const input = {
  channel: 'staff' as const,
  startsOn: '2026-10-19',
  endsOn: '2026-10-21',
  policy,
  now,
};
const codes = (result: ReturnType<typeof evaluateBookingRules>) =>
  result.errors.map((error) => error.code);

describe('booking rules', () => {
  it.each([
    ['2026-10-17', '2026-10-19', 'CHECK_IN_PAST'],
    ['2026-10-19', '2026-10-19', 'INVALID_RANGE'],
    ['2026-10-20', '2026-10-19', 'INVALID_RANGE'],
    ['2026-02-30', '2026-03-02', 'INVALID_DATE'],
    ['2026-10-19', '2026-10-20', 'MIN_STAY'],
    ['2026-10-19', '2026-10-25', 'MAX_STAY'],
    ['2026-10-29', '2026-10-31', 'ADVANCE_BOOKING_LIMIT'],
  ])('rejects %s through %s with %s', (startsOn, endsOn, code) => {
    expect(codes(evaluateBookingRules({ ...input, startsOn, endsOn }))).toContain(code);
  });
  it.each([
    ['2026-10-19', '2026-10-21'],
    ['2026-10-19', '2026-10-24'],
    ['2026-10-28', '2026-10-30'],
  ])('accepts today and exact stay/advance boundaries: %s to %s', (startsOn, endsOn) => {
    expect(evaluateBookingRules({ ...input, startsOn, endsOn }).valid).toBe(true);
  });
  it('accepts a same-day stay before the cutoff', () => {
    const beforeCutoff = new Date('2026-10-18T10:00:00Z');
    expect(
      evaluateBookingRules({
        ...input,
        now: beforeCutoff,
        startsOn: '2026-10-18',
        endsOn: '2026-10-20',
      }).valid,
    ).toBe(true);
  });
  it('uses property timezone at midnight and closes same-day bookings after the cutoff for staff too', () => {
    const nearMidnight = new Date('2026-10-18T23:00:00Z');
    expect(
      codes(
        evaluateBookingRules({
          ...input,
          now: nearMidnight,
          startsOn: '2026-10-18',
          endsOn: '2026-10-20',
        }),
      ),
    ).toContain('CHECK_IN_PAST');
    expect(
      codes(
        evaluateBookingRules({
          ...input,
          channel: 'guest',
          startsOn: '2026-10-18',
          endsOn: '2026-10-20',
        }),
      ),
    ).toContain('SAME_DAY_CLOSED');
    // The documented rule (booking-and-payments.md) applies the cutoff to staff as well as guests.
    expect(
      codes(evaluateBookingRules({ ...input, startsOn: '2026-10-18', endsOn: '2026-10-20' })),
    ).toContain('SAME_DAY_CLOSED');
  });
  it('enforces the exact same-day cutoff and an explicit same-day closure', () => {
    const start = {
      ...input,
      channel: 'guest' as const,
      startsOn: '2026-10-18',
      endsOn: '2026-10-20',
    };
    expect(evaluateBookingRules({ ...start, now: new Date('2026-10-18T16:59:00Z') }).valid).toBe(
      true,
    );
    expect(
      codes(evaluateBookingRules({ ...start, now: new Date('2026-10-18T17:00:00Z') })),
    ).toContain('SAME_DAY_CLOSED');
    expect(
      codes(
        evaluateBookingRules({
          ...start,
          policy: { ...policy, sameDayBookingAllowed: false, sameDayCutoffTime: null },
        }),
      ),
    ).toContain('SAME_DAY_CLOSED');
  });
  it('counts adults and children and checks catalog eligibility', () => {
    expect(evaluateBookingRules({ ...input, adults: 2, children: 1, maxOccupancy: 3 }).valid).toBe(
      true,
    );
    expect(
      codes(
        evaluateBookingRules({
          ...input,
          adults: 2,
          children: 2,
          maxOccupancy: 3,
          roomActive: false,
          roomTypeStatus: 'DRAFT',
        }),
      ),
    ).toEqual(['ROOM_TYPE_NOT_AVAILABLE', 'ROOM_NOT_AVAILABLE', 'CAPACITY_EXCEEDED']);
  });
  it('permits an exact checkout/check-in boundary and rejects overlapping bookings and blocks', () => {
    expect(ruleRangesOverlap(input, { startsOn: input.endsOn, endsOn: '2026-10-23' })).toBe(false);
    expect(
      evaluateBookingRules({
        ...input,
        conflicts: [{ startsOn: input.endsOn, endsOn: '2026-10-23', kind: 'booking' }],
      }).valid,
    ).toBe(true);
    expect(
      codes(
        evaluateBookingRules({
          ...input,
          conflicts: [
            { startsOn: '2026-10-20', endsOn: '2026-10-22', kind: 'booking' },
            { startsOn: '2026-10-20', endsOn: '2026-10-22', kind: 'block' },
          ],
        }),
      ),
    ).toEqual(['BOOKING_CONFLICT', 'AVAILABILITY_BLOCK_CONFLICT']);
  });
  it('blocks only future valid ranges without reservations, independently of stay limits', () => {
    expect(evaluateBookingRules({ ...input, channel: 'block', endsOn: '2026-10-20' }).valid).toBe(
      true,
    );
    expect(
      codes(evaluateBookingRules({ ...input, channel: 'block', startsOn: '2026-10-17' })),
    ).toContain('BLOCK_IN_PAST');
    expect(
      codes(
        evaluateBookingRules({
          ...input,
          channel: 'block',
          conflicts: [{ startsOn: '2026-10-20', endsOn: '2026-10-22', kind: 'booking' }],
        }),
      ),
    ).toEqual(['BLOCK_RESERVATION_CONFLICT']);
    expect(
      evaluateBookingRules({
        ...input,
        channel: 'block',
        conflicts: [{ startsOn: '2026-10-20', endsOn: '2026-10-22', kind: 'block' }],
      }).valid,
    ).toBe(true);
  });
  it('combines property/provider minimums and preserves pooled inventory capacity', () => {
    expect(effectiveMinimumStay(2, 4)).toBe(4);
    expect(minimumStayForOpenRates([3, 5])).toBe(3);
    expect(minimumStayForOpenRates([])).toBeNull();
    expect(evaluateBookingRules({ ...input, availableUnits: 1 }).valid).toBe(true);
    expect(codes(evaluateBookingRules({ ...input, availableUnits: 0 }))).toContain(
      'NO_AVAILABILITY',
    );
  });
});

describe('staff override of the hotel limits', () => {
  it('skips the hotel own limits for staff with a reason, and reports what was skipped', () => {
    const tooShort = { ...input, startsOn: '2026-10-19', endsOn: '2026-10-20' };
    expect(codes(evaluateBookingRules(tooShort))).toContain('MIN_STAY');
    const overridden = evaluateBookingRules({ ...tooShort, overrideRules: true });
    expect(overridden.valid).toBe(true);
    expect(overridden.overridden?.map((error) => error.code)).toEqual(['MIN_STAY']);
  });

  it('never skips safety rules, and never for guests', () => {
    const past = evaluateBookingRules({
      ...input,
      startsOn: '2026-10-17',
      endsOn: '2026-10-18',
      overrideRules: true,
    });
    expect(codes(past)).toContain('CHECK_IN_PAST');
    const full = evaluateBookingRules({ ...input, availableUnits: 0, overrideRules: true });
    expect(codes(full)).toContain('NO_AVAILABILITY');
    const tooMany = evaluateBookingRules({
      ...input,
      maxOccupancy: 2,
      adults: 3,
      overrideRules: true,
    });
    expect(codes(tooMany)).toContain('CAPACITY_EXCEEDED');
    const guest = evaluateBookingRules({
      ...input,
      channel: 'guest',
      endsOn: '2026-10-20',
      overrideRules: true,
    });
    expect(codes(guest)).toContain('MIN_STAY');
    expect(guest.overridden).toBeUndefined();
  });

  it('lists exactly the hotel limits as overridable', () => {
    for (const code of ['MIN_STAY', 'OUTSIDE_SEASON', 'MAX_GUESTS_PER_BOOKING', 'SAME_DAY_CLOSED'])
      expect(isOverridableRule({ code })).toBe(true);
    for (const code of [
      'CHECK_IN_PAST',
      'NO_AVAILABILITY',
      'CAPACITY_EXCEEDED',
      'BOOKING_CONFLICT',
    ])
      expect(isOverridableRule({ code })).toBe(false);
  });
});
