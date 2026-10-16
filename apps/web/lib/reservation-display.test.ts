import { describe, expect, it } from 'vitest';

import {
  balanceDue,
  bookingStatusDisplay,
  nightsBetween,
  paymentDisplay,
  sourceDisplay,
} from './reservation-display';

const base = { status: 'CONFIRMED', paymentMethod: 'POKPAY', total: '200.00', paid: '0', refunded: '0' };

describe('paymentDisplay', () => {
  it('is Paid when the total is covered', () => {
    expect(paymentDisplay({ ...base, paid: '200.00' }).label).toBe('Paid');
  });
  it('is Deposit paid when only part is paid', () => {
    expect(paymentDisplay({ ...base, paid: '60.00' }).label).toBe('Deposit paid');
  });
  it('is Refunded when everything paid was returned, Partly refunded otherwise', () => {
    expect(paymentDisplay({ ...base, paid: '200.00', refunded: '200.00' }).label).toBe('Refunded');
    expect(paymentDisplay({ ...base, paid: '200.00', refunded: '50.00' }).label).toBe(
      'Partly refunded',
    );
  });
  it('is Pay at hotel for an unpaid pay-at-hotel booking and Pending while online payment is awaited', () => {
    expect(paymentDisplay({ ...base, paymentMethod: 'PAY_AT_HOTEL' }).label).toBe('Pay at hotel');
    expect(paymentDisplay({ ...base, status: 'PAYMENT_PENDING' }).label).toBe('Pending');
  });
  it('is Failed for a failed payment and No payment due for a free booking', () => {
    expect(paymentDisplay({ ...base, status: 'PAYMENT_FAILED' }).label).toBe('Failed');
    expect(paymentDisplay({ ...base, paymentMethod: 'FREE', total: '0' }).label).toBe(
      'No payment due',
    );
  });
  it('compares in cents so 0.1 + 0.2 style sums do not flip Paid', () => {
    expect(paymentDisplay({ ...base, total: '0.30', paid: '0.30' }).label).toBe('Paid');
  });
});

describe('balanceDue', () => {
  it('subtracts the net amount paid and never goes below zero', () => {
    expect(balanceDue({ total: '200.00', paid: '60.00', refunded: '0' })).toBe(140);
    expect(balanceDue({ total: '200.00', paid: '260.00', refunded: '0' })).toBe(0);
  });
});

describe('bookingStatusDisplay', () => {
  it('names known statuses and falls back to readable text for unknown ones', () => {
    expect(bookingStatusDisplay('MANUAL_REVIEW').label).toBe('Needs review');
    expect(bookingStatusDisplay('SOMETHING_NEW').label).toBe('Something new');
  });
});

describe('sourceDisplay and nightsBetween', () => {
  it('shows nothing for bookings with no recorded source', () => {
    expect(sourceDisplay(null)).toBeNull();
    expect(sourceDisplay('DIRECT')).toBe('Direct');
    expect(sourceDisplay('WEBSITE')).toBe('Website');
  });
  it('counts nights by calendar day across a month end', () => {
    expect(nightsBetween('2026-10-30', '2026-11-02')).toBe(3);
  });
});
