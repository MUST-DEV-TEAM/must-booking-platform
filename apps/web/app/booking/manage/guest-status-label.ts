/** Plain words for the booking status a guest sees on the Manage booking page. */
const LABELS: Record<string, string> = {
  CONFIRMED: 'Confirmed',
  ON_REQUEST_PENDING: 'Waiting for the hotel to decide',
  DECLINED: 'Request declined',
  CANCELLED: 'Cancelled',
  PAYMENT_PENDING: 'Waiting for payment',
  PAYMENT_NOT_REQUIRED: 'Reserved, pay at the hotel',
  PAYMENT_FAILED: 'Payment not completed',
  PMS_CREATION_PENDING: 'Being confirmed',
  PMS_CONFIRMATION_PENDING: 'Being confirmed',
  INVENTORY_REVALIDATING: 'Being confirmed',
  MANUAL_REVIEW: 'Being checked by the hotel',
  PMS_UNKNOWN_RESULT: 'Being checked by the hotel',
  PMS_REJECTED: 'Not confirmed',
  AVAILABILITY_FAILED: 'Not confirmed',
};

export function guestStatusLabel(status: string): string {
  const known = LABELS[status];
  if (known) return known;
  const words = status.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
