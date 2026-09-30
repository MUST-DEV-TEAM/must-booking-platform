import { describe, expect, it } from 'vitest';
import {
  isHiddenFromPayments,
  matchesFilter,
  matchesSearch,
  needsAction,
  outstandingAmount,
  paymentStatus,
  sortNewestFirst,
} from './payment-status';
import type { Reservation } from './reservations';

function booking(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'b1',
    status: 'CONFIRMED',
    paymentMethod: 'POKPAY',
    total: { amount: '250.00', currency: 'EUR' },
    paidAmount: '0.00',
    refundedAmount: '0.00',
    ...overrides,
  } as Reservation;
}

describe('paymentStatus reads the booking status together with the money', () => {
  it.each([
    [{ paidAmount: '250.00' }, 'Paid'],
    [{ paidAmount: '100.00' }, 'Partially paid'],
    [{ paymentMethod: 'PAY_AT_HOTEL' }, 'Due at hotel'],
    [{ status: 'PAYMENT_PENDING' }, 'Awaiting payment'],
    [{ paidAmount: '250.00', refundedAmount: '50.00' }, 'Partially refunded'],
    [{ paidAmount: '250.00', refundedAmount: '250.00' }, 'Refunded'],
  ])('live booking %j reads %s', (overrides, label) => {
    expect(paymentStatus(booking(overrides)).label).toBe(label);
  });

  it.each([
    [{ status: 'CANCELLED', paidAmount: '250.00' }, 'Refund due'],
    [{ status: 'CANCELLED', paymentMethod: 'PAY_AT_HOTEL' }, 'Nothing paid'],
    [{ status: 'CANCELLED', paidAmount: '250.00', refundedAmount: '100.00' }, 'Partially refunded'],
    [{ status: 'CANCELLED', paidAmount: '250.00', refundedAmount: '250.00' }, 'Refunded'],
    [{ status: 'PAYMENT_FAILED' }, 'Nothing paid'],
  ])('dead booking %j reads %s, never Paid or Due at hotel', (overrides, label) => {
    const status = paymentStatus(booking(overrides));
    expect(status.label).toBe(label);
    expect(['Paid', 'Due at hotel', 'Partially paid']).not.toContain(status.label);
  });
});

describe('outstandingAmount', () => {
  it('is what a live booking still owes', () => {
    expect(outstandingAmount(booking({ paidAmount: '100.00' }))).toBe('150.00');
    expect(outstandingAmount(booking({ paidAmount: '250.00' }))).toBe('0.00');
  });

  it('is zero for a cancelled booking and never goes negative', () => {
    expect(outstandingAmount(booking({ status: 'CANCELLED' }))).toBe('0.00');
    expect(outstandingAmount(booking({ paidAmount: '300.00' }))).toBe('0.00');
  });

  it('is not increased by a goodwill refund on a live booking', () => {
    expect(outstandingAmount(booking({ paidAmount: '250.00', refundedAmount: '50.00' }))).toBe(
      '0.00',
    );
  });
});

describe('needsAction and filters', () => {
  it('flags money held against a cancelled booking, and stuck bookings', () => {
    expect(needsAction(booking({ status: 'CANCELLED', paidAmount: '250.00' }))).toBe(true);
    expect(
      needsAction(booking({ status: 'CANCELLED', paidAmount: '250.00', refundedAmount: '250.00' })),
    ).toBe(false);
    expect(needsAction(booking({ status: 'MANUAL_REVIEW' }))).toBe(true);
    expect(needsAction(booking({ paidAmount: '250.00' }))).toBe(false);
  });

  it('puts each booking in the right tabs', () => {
    const cancelledHeld = booking({ status: 'CANCELLED', paidAmount: '250.00' });
    expect(matchesFilter(cancelledHeld, 'needs-action')).toBe(true);
    expect(matchesFilter(cancelledHeld, 'cancelled')).toBe(true);
    expect(matchesFilter(cancelledHeld, 'paid')).toBe(false);
    expect(matchesFilter(cancelledHeld, 'outstanding')).toBe(false);

    const dueAtHotel = booking({ paymentMethod: 'PAY_AT_HOTEL' });
    expect(matchesFilter(dueAtHotel, 'outstanding')).toBe(true);
    expect(matchesFilter(dueAtHotel, 'paid')).toBe(false);

    const paid = booking({ paidAmount: '250.00' });
    expect(matchesFilter(paid, 'paid')).toBe(true);
    expect(matchesFilter(paid, 'refunded')).toBe(false);

    expect(
      matchesFilter(booking({ paidAmount: '250.00', refundedAmount: '10.00' }), 'refunded'),
    ).toBe(true);
    expect(matchesFilter(paid, 'all')).toBe(true);
  });

  it('hides bookings that never reached payment', () => {
    expect(isHiddenFromPayments(booking({ status: 'DRAFT' }))).toBe(true);
    expect(isHiddenFromPayments(booking({ status: 'DRAFT', paidAmount: '10.00' }))).toBe(false);
    expect(isHiddenFromPayments(booking({ status: 'CANCELLED' }))).toBe(false);
  });
});

describe('search and sort', () => {
  const ada = booking({
    id: 'b-ada',
    externalReference: 'EBR-260930-2258-9WDC',
    guestFirstName: 'Ada',
    guestLastName: 'Lovelace',
    guestEmail: 'ada@example.test',
  });

  it.each(['9wdc', 'ebr-260930', 'ada love', 'EXAMPLE.TEST', 'b-ada'])('finds by %s', (query) => {
    expect(matchesSearch(ada, query)).toBe(true);
  });

  it('does not match unrelated text, and an empty query matches everything', () => {
    expect(matchesSearch(ada, 'grace')).toBe(false);
    expect(matchesSearch(ada, '  ')).toBe(true);
  });

  it('sorts newest first and keeps the order when timestamps are missing', () => {
    const older = booking({ id: 'older', createdAt: '2026-09-28T10:00:00Z' });
    const newer = booking({ id: 'newer', createdAt: '2026-09-30T10:00:00Z' });
    expect(sortNewestFirst([older, newer]).map((b) => b.id)).toEqual(['newer', 'older']);
    const a = booking({ id: 'a' });
    const b = booking({ id: 'b' });
    expect(sortNewestFirst([a, b]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
