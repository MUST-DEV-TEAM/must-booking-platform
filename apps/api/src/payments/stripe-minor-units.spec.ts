import { describe, expect, it } from 'vitest';

import { fromStripeMinorUnits, stripeDecimals, toStripeMinorUnits } from './stripe-minor-units';

describe('Stripe minor units', () => {
  it('knows how many decimals each currency has', () => {
    expect(stripeDecimals('eur')).toBe(2);
    expect(stripeDecimals('JPY')).toBe(0);
    expect(stripeDecimals('kwd')).toBe(3);
    expect(stripeDecimals('ALL')).toBe(2);
  });

  it('converts our two-decimal amounts to what Stripe expects', () => {
    expect(toStripeMinorUnits('400.00', 'EUR')).toBe(40000n);
    expect(toStripeMinorUnits('0.05', 'EUR')).toBe(5n);
    expect(toStripeMinorUnits('5000.00', 'JPY')).toBe(5000n);
    expect(toStripeMinorUnits('5000', 'JPY')).toBe(5000n);
    expect(toStripeMinorUnits('1.50', 'KWD')).toBe(1500n);
    expect(toStripeMinorUnits('12.345', 'EUR')).toBe(1235n);
  });

  it('converts a Stripe amount back to our two-decimal string', () => {
    expect(fromStripeMinorUnits(1285, 'EUR')).toBe('12.85');
    expect(fromStripeMinorUnits(5, 'EUR')).toBe('0.05');
    expect(fromStripeMinorUnits(5000, 'JPY')).toBe('5000.00');
    expect(fromStripeMinorUnits(1500, 'KWD')).toBe('1.50');
  });
});
