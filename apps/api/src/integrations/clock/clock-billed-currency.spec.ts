import { describe, expect, it } from 'vitest';

import { billedCurrency } from './clock-booking-hydration.service';

describe('billedCurrency', () => {
  it('returns the upper-case code Clock bills in', () => {
    expect(billedCurrency({ currency: 'all' })).toBe('ALL');
    expect(billedCurrency({ currency: ' EUR ' })).toBe('EUR');
  });

  it('never assumes a currency when it is missing or malformed', () => {
    expect(billedCurrency(null)).toBeNull();
    expect(billedCurrency({})).toBeNull();
    expect(billedCurrency({ currency: '' })).toBeNull();
    expect(billedCurrency({ currency: 'EURO' })).toBeNull();
  });
});
