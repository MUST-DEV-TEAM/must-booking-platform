import type { Reservation } from './reservations';

export type PaymentBadgeState = 'pending' | 'paid' | 'refunded' | 'unpaid';

export type PaymentStatus = {
  label: string;
  state: PaymentBadgeState;
};

export type PaymentFilter =
  'all' | 'needs-action' | 'outstanding' | 'paid' | 'refunded' | 'cancelled';

// A booking in one of these states will never be a stay: any money still held
// against it is the hotel's to return (or to keep by policy), not a live payment.
const DEAD_STATUSES = new Set([
  'CANCELLED',
  'PAYMENT_FAILED',
  'PMS_REJECTED',
  'AVAILABILITY_FAILED',
]);

// Statuses that need a person to look at the booking whatever the money says.
const ATTENTION_STATUSES = new Set([
  'PAYMENT_FAILED',
  'PMS_REJECTED',
  'PMS_UNKNOWN_RESULT',
  'MANUAL_REVIEW',
]);

// Bookings that never reached payment are not payment activity.
const HIDDEN_STATUSES = new Set(['DRAFT', 'QUOTED', 'INVENTORY_REVALIDATING']);

export function minorUnits(amount: string | undefined): bigint {
  const [whole, fraction = ''] = (amount ?? '0').split('.');
  return BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
}

export function money(minor: bigint): string {
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, '0')}`;
}

export function isDead(booking: Pick<Reservation, 'status'>): boolean {
  return DEAD_STATUSES.has(booking.status);
}

export function isHiddenFromPayments(
  booking: Pick<Reservation, 'status' | 'paidAmount' | 'refundedAmount'>,
): boolean {
  return (
    HIDDEN_STATUSES.has(booking.status) &&
    minorUnits(booking.paidAmount) === 0n &&
    minorUnits(booking.refundedAmount) === 0n
  );
}

export function hasRefundableBalance(
  booking: Pick<Reservation, 'paidAmount' | 'refundedAmount'>,
): boolean {
  return minorUnits(booking.paidAmount) > minorUnits(booking.refundedAmount);
}

export function remainingRefundable(
  booking: Pick<Reservation, 'paidAmount' | 'refundedAmount' | 'total'>,
) {
  const remaining = minorUnits(booking.paidAmount) - minorUnits(booking.refundedAmount);
  return { amount: money(remaining > 0n ? remaining : 0n), currency: booking.total.currency };
}

/** Still to collect. Only a live booking owes money; refunds never create a debt. */
export function outstandingAmount(
  booking: Pick<Reservation, 'status' | 'paidAmount' | 'total'>,
): string {
  if (isDead(booking)) return '0.00';
  const due = minorUnits(booking.total.amount) - minorUnits(booking.paidAmount);
  return money(due > 0n ? due : 0n);
}

/**
 * The payment state, read together with the booking's own status. A cancelled
 * booking never reads as "Paid" or "Due at hotel": it reads as a refund that is
 * due, a refund that was made, or nothing having been paid at all.
 */
export function paymentStatus(
  booking: Pick<
    Reservation,
    'status' | 'paymentMethod' | 'total' | 'paidAmount' | 'refundedAmount'
  >,
): PaymentStatus {
  const paid = minorUnits(booking.paidAmount);
  const refunded = minorUnits(booking.refundedAmount);
  const total = minorUnits(booking.total.amount);

  if (refunded > 0n) {
    return refunded >= paid
      ? { label: 'Refunded', state: 'refunded' }
      : { label: 'Partially refunded', state: 'refunded' };
  }
  if (isDead(booking)) {
    return paid > 0n
      ? { label: 'Refund due', state: 'pending' }
      : { label: 'Nothing paid', state: 'unpaid' };
  }
  if (paid >= total && paid > 0n) return { label: 'Paid', state: 'paid' };
  if (paid > 0n) return { label: 'Partially paid', state: 'paid' };
  return booking.paymentMethod === 'PAY_AT_HOTEL'
    ? { label: 'Due at hotel', state: 'unpaid' }
    : { label: 'Awaiting payment', state: 'pending' };
}

/** Money is held against a booking that will not happen, or the booking is stuck. */
export function needsAction(
  booking: Pick<Reservation, 'status' | 'paidAmount' | 'refundedAmount'>,
): boolean {
  if (ATTENTION_STATUSES.has(booking.status)) return true;
  return isDead(booking) && hasRefundableBalance(booking);
}

export function matchesFilter(
  booking: Pick<Reservation, 'status' | 'total' | 'paidAmount' | 'refundedAmount'>,
  filter: PaymentFilter,
): boolean {
  const paid = minorUnits(booking.paidAmount);
  const refunded = minorUnits(booking.refundedAmount);
  switch (filter) {
    case 'all':
      return true;
    case 'needs-action':
      return needsAction(booking);
    case 'outstanding':
      return minorUnits(outstandingAmount(booking)) > 0n;
    case 'paid':
      return (
        !isDead(booking) &&
        paid > 0n &&
        refunded === 0n &&
        minorUnits(outstandingAmount(booking)) === 0n
      );
    case 'refunded':
      return refunded > 0n;
    case 'cancelled':
      return booking.status === 'CANCELLED';
  }
}

export function matchesSearch(
  booking: Pick<
    Reservation,
    'externalReference' | 'guestFirstName' | 'guestLastName' | 'guestEmail' | 'id'
  >,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    booking.externalReference,
    booking.guestFirstName,
    booking.guestLastName,
    [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' '),
    booking.guestEmail,
    booking.id,
  ].some((value) => value?.toLocaleLowerCase().includes(needle));
}

export function paymentMethodLabel(method: string | undefined): string {
  switch (method) {
    case 'PAY_AT_HOTEL':
      return 'Pay at hotel';
    case 'POKPAY':
      return 'PokPay';
    case 'STRIPE_CHECKOUT':
      return 'Stripe';
    default:
      return method ? method.toLocaleLowerCase().replaceAll('_', ' ') : '';
  }
}

/** Newest first; bookings without a timestamp keep their relative order. */
export function sortNewestFirst<T extends Pick<Reservation, 'createdAt'>>(bookings: T[]): T[] {
  return [...bookings].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

export type PaymentSummary = {
  currency: string;
  collected: string;
  refunded: string;
  net: string;
  outstanding: string;
};

/** Totals per currency, so two currencies are never added together. */
export function summarize(
  bookings: Array<Pick<Reservation, 'status' | 'total' | 'paidAmount' | 'refundedAmount'>>,
): { byCurrency: PaymentSummary[]; needsAction: number } {
  const totals = new Map<string, { collected: bigint; refunded: bigint; outstanding: bigint }>();
  for (const booking of bookings) {
    const entry = totals.get(booking.total.currency) ?? {
      collected: 0n,
      refunded: 0n,
      outstanding: 0n,
    };
    entry.collected += minorUnits(booking.paidAmount);
    entry.refunded += minorUnits(booking.refundedAmount);
    entry.outstanding += minorUnits(outstandingAmount(booking));
    totals.set(booking.total.currency, entry);
  }
  return {
    byCurrency: [...totals.entries()].map(([currency, entry]) => ({
      currency,
      collected: money(entry.collected),
      refunded: money(entry.refunded),
      net: money(entry.collected - entry.refunded),
      outstanding: money(entry.outstanding),
    })),
    needsAction: bookings.filter((booking) => needsAction(booking)).length,
  };
}

// Guest names and references are free text. A cell that starts with one of these
// would be run as a formula by a spreadsheet, so it is defused with a leading quote.
function csvCell(value: string | null | undefined): string {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function paymentsCsv(bookings: Reservation[]): string {
  const header = [
    'Reference',
    'Guest',
    'Email',
    'Arrival',
    'Departure',
    'Room type',
    'Booking status',
    'Payment status',
    'Method',
    'Currency',
    'Total',
    'Paid',
    'Refunded',
    'Outstanding',
    'Created',
  ];
  const rows = bookings.map((booking) =>
    [
      booking.externalReference,
      [booking.guestFirstName, booking.guestLastName].filter(Boolean).join(' '),
      booking.guestEmail,
      booking.startsOn,
      booking.endsOn,
      booking.roomTypeName,
      booking.status,
      paymentStatus(booking).label,
      paymentMethodLabel(booking.paymentMethod),
      booking.total.currency,
      booking.total.amount,
      booking.paidAmount,
      booking.refundedAmount,
      outstandingAmount(booking),
      booking.createdAt,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.map(csvCell).join(','), ...rows].join('\r\n');
}
