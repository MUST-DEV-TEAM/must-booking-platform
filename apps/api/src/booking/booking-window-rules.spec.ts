import { describe, expect, it } from 'vitest';

import { evaluateBookingRules, windowViolations } from './booking-rules';

// 2026-11-18 is a Wednesday. The hotel clock is Europe/Tirane (UTC+1 in November).
const now = new Date('2026-11-18T10:00:00Z'); // 11:00 in Tirane
const codes = (startsOn: string, endsOn: string, policy: object) =>
  windowViolations(startsOn, endsOn, { timezone: 'Europe/Tirane', ...policy }, now).map(
    (v) => v.code,
  );

describe('minimum notice', () => {
  it('counts hours until the check-in day starts on the hotel clock', () => {
    // Tomorrow starts in 13 hours (24:00 - 11:00).
    expect(codes('2026-11-19', '2026-11-20', { minNoticeHours: 12 })).toEqual([]);
    expect(codes('2026-11-19', '2026-11-20', { minNoticeHours: 14 })).toEqual(['MIN_NOTICE']);
    expect(codes('2026-11-18', '2026-11-19', { minNoticeHours: 1 })).toEqual(['MIN_NOTICE']);
    expect(codes('2026-11-19', '2026-11-20', { minNoticeHours: 0 })).toEqual([]);
    expect(codes('2026-11-19', '2026-11-20', { minNoticeHours: null })).toEqual([]);
  });
});

describe('season', () => {
  const season = { seasonOpenFrom: '05-01', seasonOpenTo: '10-31' };
  it('refuses a stay with any night outside the season', () => {
    expect(codes('2027-06-10', '2027-06-12', season)).toEqual([]);
    expect(codes('2027-03-10', '2027-03-12', season)).toEqual(['OUTSIDE_SEASON']);
    expect(codes('2027-10-30', '2027-11-02', season)).toEqual(['OUTSIDE_SEASON']);
    // The night of 31 October is the last night; leaving on 1 November is fine.
    expect(codes('2027-10-30', '2027-11-01', season)).toEqual([]);
  });
  it('supports a season over the new year and an unset season', () => {
    const winter = { seasonOpenFrom: '11-15', seasonOpenTo: '03-15' };
    expect(codes('2027-01-10', '2027-01-12', winter)).toEqual([]);
    expect(codes('2027-07-10', '2027-07-12', winter)).toEqual(['OUTSIDE_SEASON']);
    expect(codes('2027-01-10', '2027-01-12', {})).toEqual([]);
  });
});

describe('arrival and departure days', () => {
  it('limits arrivals and departures to the chosen weekdays', () => {
    const weekly = { arrivalDays: [6], departureDays: [6] }; // Saturday only
    expect(codes('2026-11-21', '2026-11-28', weekly)).toEqual([]); // Sat to Sat
    expect(codes('2026-11-20', '2026-11-28', weekly)).toEqual(['ARRIVAL_DAY_NOT_ALLOWED']);
    expect(codes('2026-11-21', '2026-11-27', weekly)).toEqual(['DEPARTURE_DAY_NOT_ALLOWED']);
  });
  it('treats every day or an empty list as no limit', () => {
    expect(codes('2026-11-20', '2026-11-27', { arrivalDays: [1, 2, 3, 4, 5, 6, 7] })).toEqual([]);
    expect(codes('2026-11-20', '2026-11-27', { arrivalDays: [] })).toEqual([]);
  });
  it('names the allowed days in the message', () => {
    const [violation] = windowViolations(
      '2026-11-20',
      '2026-11-27',
      { timezone: 'Europe/Tirane', arrivalDays: [6, 1] },
      now,
    );
    expect(violation!.message).toContain('Monday, Saturday');
  });
});

describe('through the whole booking check', () => {
  it('reports these rules for guest and staff bookings but not for blocks', () => {
    const policy = { timezone: 'Europe/Tirane', arrivalDays: [6] };
    const base = { startsOn: '2026-11-20', endsOn: '2026-11-27', policy, now };
    expect(evaluateBookingRules({ ...base, channel: 'guest' }).errors.map((e) => e.code)).toContain(
      'ARRIVAL_DAY_NOT_ALLOWED',
    );
    expect(evaluateBookingRules({ ...base, channel: 'staff' }).errors.map((e) => e.code)).toContain(
      'ARRIVAL_DAY_NOT_ALLOWED',
    );
    expect(evaluateBookingRules({ ...base, channel: 'block' }).errors).toEqual([]);
  });
});
