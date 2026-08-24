import { describe, expect, it } from 'vitest';

import { percentageRefundMinorUnits } from './payment-refund.service';

describe('percentage refund calculation', () => {
  it('calculates against the original charge in minor units and rounds to cents', () => {
    expect(percentageRefundMinorUnits('100.00', 25)).toBe(2500n);
    expect(percentageRefundMinorUnits('99.99', 33.33)).toBe(3333n);
    expect(percentageRefundMinorUnits('180.00', 100)).toBe(18000n);
  });

  it('rejects percentages outside the supported range', () => {
    expect(percentageRefundMinorUnits('100.00', 0)).toBeNull();
    expect(percentageRefundMinorUnits('100.00', 100.01)).toBeNull();
  });
});
