import { describe, expect, it } from 'vitest';
import { occupancyFromRates } from './clock-rate-occupancy';

describe('occupancyFromRates', () => {
  it('uses the largest adults + children any rate allows', () => {
    expect(
      occupancyFromRates([
        { maxAdults: 2, maxChildren: 1 },
        { maxAdults: 3, maxChildren: 0 },
      ]),
    ).toBe(3);
  });

  it('counts a missing children cap as zero', () => {
    expect(occupancyFromRates([{ maxAdults: 3, maxChildren: null }])).toBe(3);
  });

  it('returns null when it cannot be known', () => {
    expect(occupancyFromRates([])).toBeNull();
    expect(
      occupancyFromRates([
        { maxAdults: 2, maxChildren: 0 },
        { maxAdults: null, maxChildren: null },
      ]),
    ).toBeNull();
  });
});
