import { describe, expect, it } from 'vitest';

import { isSameDayBookingClosed, propertyClock } from './quote.service';

// 2026-10-01 16:30 UTC is 18:30 in Europe/Tirane (UTC+2 in autumn).
const evening = new Date('2026-10-01T16:30:00.000Z');
const tirane = { timezone: 'Europe/Tirane', sameDayBookingAllowed: true };

describe('propertyClock', () => {
  it('reads the date and time on the property clock, not UTC', () => {
    expect(propertyClock('Europe/Tirane', new Date('2026-09-30T22:30:00.000Z'))).toEqual({
      date: '2026-10-01',
      minutes: 30,
    });
  });

  it('falls back to UTC for a missing or invalid timezone', () => {
    expect(propertyClock(null, evening).date).toBe('2026-10-01');
    expect(propertyClock('Not/AZone', evening).minutes).toBe(16 * 60 + 30);
  });
});

describe('isSameDayBookingClosed', () => {
  it('closes today once the local cutoff has passed', () => {
    expect(isSameDayBookingClosed('2026-10-01', { ...tirane, sameDayCutoffTime: '18:00' }, evening)).toBe(true);
  });

  it('keeps today open before the local cutoff', () => {
    expect(isSameDayBookingClosed('2026-10-01', { ...tirane, sameDayCutoffTime: '19:00' }, evening)).toBe(false);
  });

  it('keeps today open when there is no cutoff', () => {
    expect(isSameDayBookingClosed('2026-10-01', { ...tirane, sameDayCutoffTime: null }, evening)).toBe(false);
  });

  it('closes today all day when same-day booking is switched off', () => {
    const morning = new Date('2026-10-01T05:00:00.000Z');
    expect(
      isSameDayBookingClosed('2026-10-01', { ...tirane, sameDayBookingAllowed: false, sameDayCutoffTime: null }, morning),
    ).toBe(true);
  });

  it('never affects a stay that starts on another day', () => {
    const rule = { ...tirane, sameDayBookingAllowed: false, sameDayCutoffTime: '00:00' };
    expect(isSameDayBookingClosed('2026-10-02', rule, evening)).toBe(false);
  });

  it('judges "today" on the property clock near midnight', () => {
    // 22:30 UTC on Sep 30 is already Oct 1 00:30 in Tirane, so an Oct 1 stay is a same-day stay there.
    const lateUtc = new Date('2026-09-30T22:30:00.000Z');
    expect(
      isSameDayBookingClosed('2026-10-01', { ...tirane, sameDayBookingAllowed: false, sameDayCutoffTime: null }, lateUtc),
    ).toBe(true);
  });
});
