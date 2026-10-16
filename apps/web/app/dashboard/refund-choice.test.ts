import { describe, expect, it } from 'vitest';

import { refundAmountText, refundChoiceError, refundRequestBody, noRefund } from './refund-choice';

const booking = {
  paidAmount: '220.00',
  refundedAmount: '20.00',
  total: { amount: '220.00', currency: 'EUR' },
};

describe('refund choice', () => {
  it('sends nothing when no refund is chosen', () => {
    expect(refundRequestBody(noRefund, booking)).toBeNull();
    expect(refundAmountText(noRefund, booking)).toBeNull();
  });

  it('refunds everything that is left for a full refund', () => {
    const choice = { ...noRefund, mode: 'full' as const };
    expect(refundAmountText(choice, booking)).toBe('200.00');
    expect(refundRequestBody(choice, booking)).toEqual({ amount: { amount: '200.00', currency: 'EUR' } });
  });

  it('refunds a percentage of what is left and checks the range', () => {
    const half = { ...noRefund, mode: 'percentage' as const, percentage: '50' };
    expect(refundAmountText(half, booking)).toBe('100.00');
    expect(refundRequestBody(half, booking)).toEqual({ percentage: 50 });
    expect(refundChoiceError(half, booking)).toBeNull();
    expect(refundChoiceError({ ...half, percentage: '0' }, booking)).toMatch(/1 to 100/);
    expect(refundChoiceError({ ...half, percentage: '' }, booking)).toMatch(/1 to 100/);
  });

  it('refunds a fixed amount and refuses more than what is left', () => {
    const fixed = { ...noRefund, mode: 'fixed' as const, amount: '75.50' };
    expect(refundRequestBody(fixed, booking)).toEqual({ amount: { amount: '75.50', currency: 'EUR' } });
    expect(refundChoiceError(fixed, booking)).toBeNull();
    expect(refundChoiceError({ ...fixed, amount: '500' }, booking)).toMatch(/most that can be refunded/);
    expect(refundChoiceError({ ...fixed, amount: '' }, booking)).toMatch(/Enter the amount/);
  });
});
