// Clock's documented stay statuses (Clock Academy, "Booking statuses",
// checked 2026-10-09): Expected, Checked-In, Checked-Out, No Show and
// Cancelled. The API spells them as below. MUST models only confirmed vs
// cancelled; the raw value is kept on bookings.pms_stay_status.
export const KNOWN_CLOCK_BOOKING_STATUSES = [
  'expected',
  'checked_in',
  'checked_out',
  'no_show',
  'canceled',
] as const;

export type KnownClockBookingStatus = (typeof KNOWN_CLOCK_BOOKING_STATUSES)[number];

export function isKnownClockBookingStatus(status: string): status is KnownClockBookingStatus {
  return (KNOWN_CLOCK_BOOKING_STATUSES as readonly string[]).includes(status);
}

/** The local status a Clock status maps to, or null for a status Clock has
 * not documented. A null must never be guessed into CONFIRMED or CANCELLED. */
export function localStatusForClockStatus(status: string): 'CONFIRMED' | 'CANCELLED' | null {
  if (!isKnownClockBookingStatus(status)) return null;
  return status === 'canceled' ? 'CANCELLED' : 'CONFIRMED';
}
