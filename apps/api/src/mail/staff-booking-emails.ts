/**
 * Staff are emailed about cancellations and changes only for bookings made through MUST (the hotel's website,
 * or staff in the dashboard). A reservation imported from the PMS (reference CLOCK-…) may come from
 * Booking.com, Expedia or the front desk; the channel or the PMS already tells the hotel, so ours was a
 * second email about the same thing (Empire, 2026-11-27). The in-app notification is not affected.
 */
export function isImportedPmsBooking(externalReference: string): boolean {
  return externalReference.startsWith('CLOCK-');
}
