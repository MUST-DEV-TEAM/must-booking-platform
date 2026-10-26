/**
 * The one place that decides how a reservation's booking state, payment state and source are
 * named and coloured in the dashboard. Reservations, Booking detail, Calendar, Guests and the
 * Overview must all use these so a label never means two things (Milestone 24, gaps G18 and G97).
 */

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'secondary';
export type Display = { label: string; tone: BadgeTone };

const bookingStatus: Record<string, Display> = {
  DRAFT: { label: 'Draft', tone: 'muted' },
  QUOTED: { label: 'Quoted', tone: 'muted' },
  INVENTORY_REVALIDATING: { label: 'Checking availability', tone: 'info' },
  PAYMENT_PENDING: { label: 'Awaiting payment', tone: 'warning' },
  PAYMENT_NOT_REQUIRED: { label: 'Confirming', tone: 'info' },
  PMS_CREATION_PENDING: { label: 'Confirming', tone: 'info' },
  PMS_CONFIRMATION_PENDING: { label: 'Confirming', tone: 'info' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  AVAILABILITY_FAILED: { label: 'Availability failed', tone: 'danger' },
  PAYMENT_FAILED: { label: 'Payment failed', tone: 'danger' },
  PMS_UNKNOWN_RESULT: { label: 'Result unknown', tone: 'warning' },
  PMS_REJECTED: { label: 'Rejected by PMS', tone: 'danger' },
  MANUAL_REVIEW: { label: 'Needs review', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'muted' },
};

function titleCase(value: string): string {
  const text = value.toLocaleLowerCase().replaceAll('_', ' ');
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function bookingStatusDisplay(status: string): Display {
  return bookingStatus[status] ?? { label: titleCase(status), tone: 'muted' };
}

/** Statuses that need staff attention, mirroring the API's `bookingNeedsAttention`. */
export const ATTENTION_STATUSES = [
  'MANUAL_REVIEW',
  'PAYMENT_FAILED',
  'AVAILABILITY_FAILED',
  'PMS_REJECTED',
  'PMS_UNKNOWN_RESULT',
] as const;

export type PaymentInput = {
  status: string;
  paymentMethod: string;
  total: string;
  paid: string;
  refunded: string;
};

export const NO_BOOKING_BALANCE = 'No balance - booking was not created';
export function bookingWasNotCreated(status: string): boolean {
  return ['AVAILABILITY_FAILED', 'PAYMENT_FAILED', 'PMS_REJECTED'].includes(status);
}

const cents = (amount: string): number => Math.round(Number(amount) * 100);

/**
 * Payment state shown next to a reservation. Derived only from the booking's own totals, so it
 * is the same wherever it appears:
 *  - refunded: money was returned (all or part of what was paid)
 *  - paid: paid in full; deposit paid: some of the total is paid
 *  - failed: the last payment attempt failed
 *  - no payment due: a free booking
 *  - pay at hotel: nothing is due online, the guest settles at the property
 *  - pending: an online payment is still expected; unpaid: nothing paid and none in progress
 */
export function paymentDisplay(input: PaymentInput): Display {
  const total = cents(input.total);
  const paid = cents(input.paid);
  const refunded = cents(input.refunded);
  if (bookingWasNotCreated(input.status) && paid <= refunded)
    return { label: NO_BOOKING_BALANCE, tone: 'muted' };
  if (bookingWasNotCreated(input.status) && paid > refunded)
    return { label: 'Refund due', tone: 'warning' };
  if (refunded > 0) {
    return paid > 0 && refunded >= paid
      ? { label: 'Refunded', tone: 'warning' }
      : { label: 'Partly refunded', tone: 'warning' };
  }
  if (['CANCELLED', 'EXPIRED'].includes(input.status) && paid === 0)
    return { label: 'No payment due', tone: 'muted' };
  if (input.status === 'PAYMENT_FAILED') return { label: 'Failed', tone: 'danger' };
  if (total > 0 && paid >= total) return { label: 'Paid', tone: 'success' };
  if (paid > 0) return { label: 'Deposit paid', tone: 'info' };
  if (total === 0 || input.paymentMethod === 'FREE')
    return { label: 'No payment due', tone: 'muted' };
  if (input.paymentMethod === 'PAY_AT_HOTEL') return { label: 'Pay at hotel', tone: 'secondary' };
  if (input.status === 'PAYMENT_PENDING') return { label: 'Pending', tone: 'warning' };
  return { label: 'Unpaid', tone: 'warning' };
}

/** Money still to collect; a refund does not create a new guest debt. Matches Payments. */
export function balanceDue(
  input: Pick<PaymentInput, 'total' | 'paid' | 'refunded'> & { status?: string },
): number {
  if (
    input.status &&
    (bookingWasNotCreated(input.status) || ['CANCELLED', 'EXPIRED'].includes(input.status))
  )
    return 0;
  return Math.max(0, cents(input.total) - cents(input.paid)) / 100;
}

const sourceLabels: Record<string, string> = { DIRECT: 'Direct', WEBSITE: 'Website' };

/** `null` for bookings created before the source was recorded. */
export function sourceDisplay(source: string | null | undefined): string | null {
  return source ? (sourceLabels[source] ?? titleCase(source)) : null;
}

/** Nights between two ISO dates (YYYY-MM-DD), by calendar day. */
export function nightsBetween(startsOn: string, endsOn: string): number {
  const [sy, sm, sd] = startsOn.split('-').map(Number);
  const [ey, em, ed] = endsOn.split('-').map(Number);
  const start = Date.UTC(sy!, sm! - 1, sd!);
  const end = Date.UTC(ey!, em! - 1, ed!);
  return Math.max(0, Math.round((end - start) / 86_400_000));
}
