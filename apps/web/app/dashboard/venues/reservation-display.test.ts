import { describe, expect, it } from 'vitest';

import {
  addDays,
  dateInZone,
  dayLabel,
  instantAt,
  minutesOf,
  nextActions,
  timeInZone,
} from './reservation-display';

describe('reservation display helpers', () => {
  it('offers the next steps for each state', () => {
    expect(nextActions('confirmed').map((a) => a.status)).toEqual([
      'seated',
      'no_show',
      'cancelled',
    ]);
    expect(nextActions('seated').map((a) => a.status)).toEqual(['completed']);
    expect(nextActions('pending_payment', true).map((a) => a.status)).toEqual(['cancelled']);
    expect(nextActions('completed')).toEqual([]);
    expect(nextActions('cancelled')).toEqual([]);
  });

  it('works with dates and times in the restaurant zone', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayLabel('2026-11-06')).toBe('Fri 6 Nov');
    expect(minutesOf('19:30')).toBe(1170);
    // 23:30 UTC is already the next day in Tirane (UTC+1 in winter).
    const late = new Date('2026-11-06T23:30:00Z');
    expect(dateInZone('Europe/Tirane', late)).toBe('2026-11-07');
    expect(timeInZone(late, 'Europe/Tirane')).toBe('00:30');
  });

  it('turns a local date and minute into the right instant', () => {
    expect(instantAt('2026-11-06', 19 * 60, 'Europe/Tirane').toISOString()).toBe(
      '2026-11-06T18:00:00.000Z',
    );
    expect(instantAt('2026-07-06', 19 * 60, 'Europe/Tirane').toISOString()).toBe(
      '2026-07-06T17:00:00.000Z',
    );
  });
});
