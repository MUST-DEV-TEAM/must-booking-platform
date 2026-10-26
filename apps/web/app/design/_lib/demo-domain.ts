export type DemoStatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'pine';

export const bookingStatusMeta = {
  DRAFT: { label: 'Draft', tone: 'muted' },
  QUOTED: { label: 'Quoted', tone: 'muted' },
  INVENTORY_REVALIDATING: { label: 'Inventory check', tone: 'warning' },
  PAYMENT_PENDING: { label: 'Payment pending', tone: 'warning' },
  PAYMENT_NOT_REQUIRED: { label: 'No payment due', tone: 'muted' },
  PMS_CREATION_PENDING: { label: 'PMS send pending', tone: 'warning' },
  PMS_CONFIRMATION_PENDING: { label: 'PMS confirmation', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  AVAILABILITY_FAILED: { label: 'Availability failed', tone: 'danger' },
  PAYMENT_FAILED: { label: 'Payment failed', tone: 'danger' },
  PMS_UNKNOWN_RESULT: { label: 'Unknown PMS result', tone: 'warning' },
  PMS_REJECTED: { label: 'PMS rejected', tone: 'danger' },
  MANUAL_REVIEW: { label: 'Manual review', tone: 'warning' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'muted' },
} as const satisfies Record<string, { label: string; tone: DemoStatusTone }>;

export type BookingStatusCode = keyof typeof bookingStatusMeta;

export const bookingStatusOptions = Object.entries(bookingStatusMeta).map(([value, meta]) => ({
  value: value as BookingStatusCode,
  label: meta.label,
  tone: meta.tone,
}));

export const paymentStatusMeta = {
  Paid: { tone: 'success' },
  'Payment pending': { tone: 'warning' },
  Failed: { tone: 'danger' },
  Refunded: { tone: 'warning' },
  'Partially refunded': { tone: 'warning' },
  'Pay at hotel': { tone: 'muted' },
  'No payment due': { tone: 'muted' },
  Unpaid: { tone: 'warning' },
} as const satisfies Record<string, { tone: DemoStatusTone }>;

export type PaymentStatusLabel = keyof typeof paymentStatusMeta;

export const paymentStatusOptions = Object.keys(paymentStatusMeta) as PaymentStatusLabel[];

export const demoHotelOptions = [
  'Empire Beach Resort',
  'Marina Bay Hotel',
  'Old Town Suites',
] as const;

export const demoBookingSourceOptions = ['Website', 'Staff booking', 'Walk-in'] as const;
