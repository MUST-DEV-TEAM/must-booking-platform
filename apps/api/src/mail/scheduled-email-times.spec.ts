import { describe, expect, it } from 'vitest';

import { hourOf } from './scheduled-email.service';

describe('hourOf (G-81)', () => {
  it('reads the hour of a saved time', () => {
    expect(hourOf('07:00')).toBe(7);
    expect(hourOf('09:45')).toBe(9);
    expect(hourOf('00:00')).toBe(0);
    expect(hourOf('23:59')).toBe(23);
  });

  it('gives nothing for an empty or invalid time, so the fixed hour stays', () => {
    expect(hourOf(null)).toBeNull();
    expect(hourOf(undefined)).toBeNull();
    expect(hourOf('')).toBeNull();
    expect(hourOf('24:00')).toBeNull();
    expect(hourOf('9:00')).toBeNull();
    expect(hourOf('09:60')).toBeNull();
  });
});
