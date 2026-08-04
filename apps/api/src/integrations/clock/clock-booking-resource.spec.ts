import { describe, expect, it } from 'vitest';

import { isClockBookingResource } from './clock-booking.service';

describe('isClockBookingResource (Task 12: schema_mismatch detection)', () => {
  it('accepts a well-formed Clock booking resource', () => {
    expect(isClockBookingResource({ id: 123, lock_version: 1, status: 'expected' })).toBe(true);
  });

  it('rejects a response missing lock_version', () => {
    expect(isClockBookingResource({ id: 123, status: 'expected' })).toBe(false);
  });

  it('rejects a response with the wrong type for id', () => {
    expect(isClockBookingResource({ id: '123', lock_version: 1, status: 'expected' })).toBe(false);
  });

  it('rejects null and non-object values without throwing', () => {
    expect(isClockBookingResource(null)).toBe(false);
    expect(isClockBookingResource(undefined)).toBe(false);
    expect(isClockBookingResource('a string')).toBe(false);
    expect(isClockBookingResource(42)).toBe(false);
  });

  it('rejects an empty object', () => {
    expect(isClockBookingResource({})).toBe(false);
  });
});
