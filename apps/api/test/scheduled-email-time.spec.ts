import { describe, expect, it } from 'vitest';

import { addDays, localNow } from '../src/mail/scheduled-email.service';

describe('scheduled email local time', () => {
  it('reads the date and hour in the property time zone', () => {
    const now = new Date('2030-12-31T23:30:00Z');
    expect(localNow(now, 'Europe/Tirane')).toEqual({ date: '2031-01-01', hour: 0 });
    expect(localNow(now, 'America/New_York')).toEqual({ date: '2030-12-31', hour: 18 });
  });

  it('falls back to UTC for a missing or unknown time zone', () => {
    const now = new Date('2030-05-10T08:15:00Z');
    expect(localNow(now, null)).toEqual({ date: '2030-05-10', hour: 8 });
    expect(localNow(now, 'Not/AZone')).toEqual({ date: '2030-05-10', hour: 8 });
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2030-12-30', 3)).toBe('2031-01-02');
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28');
  });
});
