import { describe, expect, it } from 'vitest';

import { daysSince, deviationFromMarket, worked } from './exchange-rate-guidance';

describe('exchange-rate guidance', () => {
  it('measures the distance from the market, and says nothing when it cannot', () => {
    expect(deviationFromMarket('100', 100)).toBe(0);
    expect(deviationFromMarket('200', 100)).toBeCloseTo(1);
    expect(deviationFromMarket('110', 100)).toBeCloseTo(0.1);
    expect(deviationFromMarket('abc', 100)).toBeNull();
    expect(deviationFromMarket('0', 100)).toBeNull();
    expect(deviationFromMarket('100', undefined)).toBeNull();
  });

  it('shows the worked example the hotel thinks in, which exposes a reversed direction', () => {
    expect(worked('100', 'ALL', 'EUR')).toBe('100 ALL ≈ 1 EUR');
    // The Empire mistake: typing 200 means 100 lek is only half a euro.
    expect(worked('200', 'ALL', 'EUR')).toBe('100 ALL ≈ 0.5 EUR');
    expect(worked('108,5', 'ALL', 'GBP')).toBe('100 ALL ≈ 0.9217 GBP');
    expect(worked('', 'ALL', 'EUR')).toBeNull();
  });

  it('counts whole days since a change', () => {
    const now = Date.parse('2026-10-29T12:00:00Z');
    expect(daysSince('2026-10-28T12:00:00Z', now)).toBe(1);
    expect(daysSince('2026-08-01T00:00:00Z', now)).toBe(89);
    expect(daysSince('not a date', now)).toBe(0);
  });
});
