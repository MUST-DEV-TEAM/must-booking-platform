import { describe, expect, it } from 'vitest';

import { convertAmount, crossRate, formatMoney } from './money';

describe('money', () => {
  it('shows an amount in its own currency and never throws on an unknown code', () => {
    expect(formatMoney('12.5', 'EUR')).toContain('12.50');
    expect(formatMoney('12000', 'ALL')).toContain('12,000');
    expect(formatMoney('5', 'XXQ')).toContain('5');
  });

  it('converts through the common base and rounds to cents', () => {
    // One euro buys 100 lek and 1.25 dollars.
    const rates = { ALL: 100, USD: 1.25 };
    expect(crossRate(rates, 'EUR', 'ALL', 'EUR')).toBeCloseTo(0.01);
    expect(crossRate(rates, 'EUR', 'USD', 'ALL')).toBeCloseTo(80);
    expect(crossRate(rates, 'EUR', 'EUR', 'EUR')).toBe(1);
    expect(crossRate(rates, 'EUR', 'GBP', 'EUR')).toBeNull();
    expect(convertAmount('5000', 0.01)).toBe('50.00');
    expect(convertAmount('33.333', 0.3)).toBe('10.00');
  });
});

it('preserves a report amount above the safe integer range without losing its cents', () => {
  expect(formatMoney('9007199254740993.99', 'EUR')).toBe('\u20ac9,007,199,254,740,993.99');
});
