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

describe('summarize', () => {
  it('totals per currency and counts bookings that need action', async () => {
    const { summarize } = await import('./payment-status');
    const result = summarize([
      booking({ paidAmount: '250.00' }),
      booking({ status: 'CANCELLED', paidAmount: '100.00', refundedAmount: '40.00' }),
      booking({ paymentMethod: 'PAY_AT_HOTEL' }),
      booking({ total: { amount: '80.00', currency: 'USD' }, paidAmount: '80.00' }),
    ]);
    expect(result.byCurrency).toEqual([
      {
        currency: 'EUR',
        collected: '350.00',
        refunded: '40.00',
        net: '310.00',
        outstanding: '250.00',
      },
      { currency: 'USD', collected: '80.00', refunded: '0.00', net: '80.00', outstanding: '0.00' },
    ]);
    expect(result.needsAction).toBe(1);
  });

  it('is empty for no bookings', async () => {
    const { summarize } = await import('./payment-status');
    expect(summarize([])).toEqual({ byCurrency: [], needsAction: 0 });
  });
});

describe('paymentsCsv', () => {
  it('writes one header row and one row per booking with the payment status', async () => {
    const { paymentsCsv } = await import('./payment-status');
    const csv = paymentsCsv([
      booking({
        externalReference: 'EBR-1',
        guestFirstName: 'Ada',
        guestLastName: 'Lovelace',
        guestEmail: 'ada@example.test',
        paidAmount: '250.00',
      }),
    ]).split('\r\n');
    expect(csv).toHaveLength(2);
    expect(csv[0].startsWith('Reference,Guest,Email')).toBe(true);
    expect(csv[1]).toContain('EBR-1,Ada Lovelace,ada@example.test');
    expect(csv[1]).toContain('Paid,PokPay,EUR,250.00,250.00,0.00,0.00');
  });

  it('quotes commas and quotes inside a cell', async () => {
    const { paymentsCsv } = await import('./payment-status');
    const csv = paymentsCsv([booking({ guestFirstName: 'Smith,', guestLastName: '"Bob"' })]);
    expect(csv).toContain('"Smith, ""Bob"""');
  });

  it('defuses a cell that a spreadsheet would run as a formula', async () => {
    const { paymentsCsv } = await import('./payment-status');
    const csv = paymentsCsv([
      booking({
        externalReference: '=1+1',
        guestFirstName: '',
        guestLastName: '@SUM(A1)',
        guestEmail: '+x@evil.test',
      }),
    ]);
    const row = csv.split('\r\n')[1];
    expect(row.startsWith("'=1+1,'@SUM(A1),'+x@evil.test,")).toBe(true);
  });
});

describe('refundPreview', () => {
  const booking = (overrides: Partial<Reservation> = {}) =>
    ({
      total: { amount: '250.00', currency: 'EUR' },
      paidAmount: '250.00',
      refundedAmount: '50.00',
      ...overrides,
    }) as Reservation;

  it('takes a percentage of what is left, not of the original payment', async () => {
    const { refundPreview } = await import('./payment-status');
    expect(refundPreview(booking(), 'percentage', '', '50')).toBe('100.00');
    expect(refundPreview(booking({ refundedAmount: '0.00' }), 'percentage', '', '50')).toBe(
      '125.00',
    );
    expect(refundPreview(booking(), 'percentage', '', '100')).toBe('200.00');
  });

  it('rounds to the cent like the server does', async () => {
    const { refundPreview } = await import('./payment-status');
    expect(
      refundPreview(
        booking({ paidAmount: '100.00', refundedAmount: '0.00' }),
        'percentage',
        '',
        '33.33',
      ),
    ).toBe('33.33');
    expect(
      refundPreview(
        booking({ paidAmount: '0.05', refundedAmount: '0.00' }),
        'percentage',
        '',
        '50',
      ),
    ).toBe('0.03');
  });

  it('shows a typed amount capped at what is left, and the whole balance when blank', async () => {
    const { refundPreview } = await import('./payment-status');
    expect(refundPreview(booking(), 'fixed', '30', '')).toBe('30.00');
    expect(refundPreview(booking(), 'fixed', '999', '')).toBe('200.00');
    expect(refundPreview(booking(), 'fixed', '', '')).toBe('200.00');
  });

  it('shows nothing for input that cannot be refunded', async () => {
    const { refundPreview } = await import('./payment-status');
    expect(refundPreview(booking(), 'fixed', 'abc', '')).toBeNull();
    expect(refundPreview(booking(), 'fixed', '0', '')).toBeNull();
    expect(refundPreview(booking(), 'percentage', '', '')).toBeNull();
    expect(refundPreview(booking(), 'percentage', '', '0')).toBeNull();
    expect(refundPreview(booking(), 'percentage', '', '101')).toBeNull();
    expect(refundPreview(booking({ refundedAmount: '250.00' }), 'fixed', '', '')).toBeNull();
  });
});
