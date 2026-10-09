/**
 * The notifications a property can route (email plan Step 1). Each topic has an
 * optional guest email and an optional staff email; `guest` / `staff` say which
 * exist. Later steps add topics here (owner summary, pre-arrival, post-stay).
 */
export const NOTIFICATION_TOPICS = {
  new_booking: { label: 'New booking', guest: true, staff: true },
  booking_cancelled: { label: 'Booking cancelled', guest: true, staff: true },
  refund_processed: { label: 'Refund processed', guest: true, staff: false },
} as const;

export type NotificationTopic = keyof typeof NOTIFICATION_TOPICS;

export function isNotificationTopic(value: string): value is NotificationTopic {
  return Object.hasOwn(NOTIFICATION_TOPICS, value);
}
