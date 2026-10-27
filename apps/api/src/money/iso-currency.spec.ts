import { describe, expect, it } from 'vitest';

import { isoCurrency } from './iso-currency';

describe('isoCurrency', () => {
  it('accepts real currencies in any case, with spaces', () => {
    expect(isoCurrency('EUR')).toBe('EUR');
    expect(isoCurrency(' all ')).toBe('ALL');
    expect(isoCurrency('usd')).toBe('USD');
  });

  it('refuses codes that are not real currencies', () => {
    expect(isoCurrency('EUO')).toBeNull();
    expect(isoCurrency('XYZ')).toBeNull();
    expect(isoCurrency('EURO')).toBeNull();
    expect(isoCurrency('')).toBeNull();
    expect(isoCurrency(null)).toBeNull();
    expect(isoCurrency(978)).toBeNull();
  });
});
