import { describe, expect, it } from 'vitest';

import { resolveBookingOccupancy, validBookingOccupancy } from './booking-occupancy';

describe('booking occupancy', () => {
  it('defaults to one adult and no children', () => {
    expect(resolveBookingOccupancy({})).toEqual({ adults: 1, children: 0, guestCount: 1 });
  });

  it('keeps legacy guestCount callers compatible when new fields are absent', () => {
    expect(resolveBookingOccupancy({ guestCount: 3 })).toEqual({
      adults: 3,
      children: 0,
      guestCount: 3,
    });
  });

  it('derives guestCount from adults and children when supplied', () => {
    expect(resolveBookingOccupancy({ adults: 2, children: 3, guestCount: 99 })).toEqual({
      adults: 2,
      children: 3,
      guestCount: 5,
    });
  });

  it.each([
    { adults: 0, children: 0 },
    { adults: 1.5, children: 0 },
    { adults: 1, children: -1 },
    { adults: 1, children: 1.5 },
    { guestCount: 0 },
  ])('rejects invalid occupancy: %s', (input) => {
    expect(validBookingOccupancy(input)).toBe(false);
  });
});
