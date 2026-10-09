/**
 * The notifications a property can route (email plan Steps 1-2). Each topic has an
 * optional guest email and an optional staff email; `guest` / `staff` say which
 * exist. `defaultStaff` is who gets the staff email until the property saves its
 * own list. `daysOffset` marks scheduled topics whose timing the property can set.
 */
export const NOTIFICATION_TOPICS = {
  new_booking: {
    label: 'New booking',
    guest: true,
    staff: true,
    defaultStaff: 'assigned-or-owners',
  },
  booking_cancelled: {
    label: 'Booking cancelled',
    guest: true,
    staff: true,
    defaultStaff: 'assigned-or-owners',
  },
  refund_processed: {
    label: 'Refund processed',
    guest: true,
    staff: true,
    defaultStaff: 'owners',
  },
  pre_arrival: {
    label: 'Pre-arrival reminder',
    guest: true,
    staff: false,
    daysOffset: { default: 3, min: 1, max: 30, label: 'Days before check-in' },
  },
  owner_daily_summary: {
    label: 'Daily summary',
    guest: false,
    staff: true,
    defaultStaff: 'owners',
  },
  /** Bookings that need attention and Clock sync problems, sent within minutes. */
  owner_alerts: {
    label: 'Problem alerts',
    guest: false,
    staff: true,
    defaultStaff: 'owners',
  },
} as const satisfies Record<
  string,
  {
    label: string;
    guest: boolean;
    staff: boolean;
    defaultStaff?: 'assigned-or-owners' | 'owners';
    daysOffset?: { default: number; min: number; max: number; label: string };
  }
>;

export type NotificationTopic = keyof typeof NOTIFICATION_TOPICS;

export function isNotificationTopic(value: string): value is NotificationTopic {
  return Object.hasOwn(NOTIFICATION_TOPICS, value);
}

export function topicDaysOffset(topic: NotificationTopic) {
  const definition = NOTIFICATION_TOPICS[topic];
  return 'daysOffset' in definition ? definition.daysOffset : null;
}
