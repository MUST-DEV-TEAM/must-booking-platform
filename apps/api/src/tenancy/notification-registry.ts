/** Only real producers belong here; unregistered types never reach an inbox. */
export const NOTIFICATION_CATEGORIES = [
  'Reservations',
  'Payments',
  'Providers',
  'Emails',
  'System',
] as const;
export const NOTIFICATION_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const NOTIFICATION_REGISTRY = {
  CANCELLATION_REQUESTED: {
    title: 'Cancellation needs approval',
    description: 'Review the policy and refund evidence before deciding.',
    category: 'Reservations',
    priority: 'High',
    capability: 'requests.review',
  },
  EMAIL_DELIVERY_FAILED: {
    title: 'Hotel email sending needs attention',
    description: 'Review the sending configuration and the linked delivery outcome.',
    category: 'Emails',
    priority: 'High',
    capability: 'settings.manage',
  },
  BOOKING_CREATED: {
    title: 'Booking created',
    description: 'A new reservation was made.',
    category: 'Reservations',
    priority: 'Low',
    capability: 'bookings.view',
  },
  BOOKING_NEEDS_ATTENTION: {
    title: 'Booking needs attention',
    description: 'Review the linked reservation and its open issues.',
    category: 'Reservations',
    priority: 'High',
    capability: 'bookings.view',
  },
  PAYMENT_REFUNDED: {
    title: 'Payment refunded',
    description: 'A refund was recorded.',
    category: 'Payments',
    priority: 'Medium',
    capability: 'payments.view',
  },
  CLOCK_RIGHT_MISSING: {
    title: 'A Clock permission is missing',
    description:
      'Clock is not allowing something MUST needs. Open System health to see which right to ask Clock for.',
    category: 'Providers',
    priority: 'High',
    capability: 'settings.manage',
  },
  STAFF_SEAT_CAP_REACHED: {
    title: 'Staff seat cap reached',
    description: 'The staff limit of the plan was reached.',
    category: 'System',
    priority: 'High',
    capability: 'staff.view',
  },
} as const;
export type NotificationType = keyof typeof NOTIFICATION_REGISTRY;
export const NOTIFICATION_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Role breadth never admits an unregistered type. */
export function registeredNotificationTypes(
  capabilities: readonly string[],
  ownerOrAdmin = false,
): NotificationType[] {
  return (Object.keys(NOTIFICATION_REGISTRY) as NotificationType[]).filter(
    (type) => ownerOrAdmin || capabilities.includes(NOTIFICATION_REGISTRY[type].capability),
  );
}
