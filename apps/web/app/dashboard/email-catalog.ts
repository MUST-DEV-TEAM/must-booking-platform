/**
 * What the Emails screens say about each email, in plain words: which stage of the stay it belongs to, when it is
 * sent, whether it is always sent, and which wording (template) it uses. The notification settings and the wording
 * live on the server; this only describes them to the person reading the page.
 */

export type GuestEmailItem = {
  /** The notification this email belongs to. */
  topic: string;
  title: string;
  /** The wording(s) it uses: a booking confirmation has one for "paid online" and one for "pay at the hotel". */
  templates: ReadonlyArray<{ key: string; label: string }>;
  /** Booking and payment emails are always sent: guests need them. Only the others can be switched off. */
  required: boolean;
  /** When it is sent; `days` is the saved timing for emails that have one. */
  when: (days: number | null) => string;
};

export type GuestJourney = {
  id: 'booking' | 'payments' | 'stay';
  title: string;
  description: string;
  items: ReadonlyArray<GuestEmailItem>;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const GUEST_JOURNEYS: ReadonlyArray<GuestJourney> = [
  {
    id: 'booking',
    title: 'Booking',
    description: 'What guests receive when a booking is made, changed or cancelled.',
    items: [
      {
        topic: 'new_booking',
        title: 'Booking confirmation',
        templates: [
          { key: 'booking_confirmed', label: 'Paid online' },
          { key: 'booking_confirmed_pay_at_hotel', label: 'Pay at the hotel' },
        ],
        required: true,
        when: () => 'When a booking is confirmed',
      },
      {
        topic: 'booking_changed',
        title: 'Booking changed',
        templates: [{ key: 'booking_changed', label: 'Booking changed' }],
        required: false,
        when: () => 'When a booking is changed',
      },
      {
        topic: 'booking_cancelled',
        title: 'Booking cancelled',
        templates: [{ key: 'booking_cancelled', label: 'Booking cancelled' }],
        required: true,
        when: () => 'When a booking is cancelled',
      },
      {
        topic: 'cancellation_request_received',
        title: 'Cancellation request received',
        templates: [
          { key: 'cancellation_request_received', label: 'Cancellation request received' },
        ],
        required: true,
        when: () => 'When a guest asks online to cancel',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments',
    description: 'What guests receive about paying for their stay and about refunds.',
    items: [
      {
        topic: 'payment_pending',
        title: 'Payment link',
        templates: [{ key: 'payment_pending', label: 'Payment link' }],
        required: true,
        when: () => 'When staff send a payment link',
      },
      {
        topic: 'payment_reminder',
        title: 'Payment reminder',
        templates: [{ key: 'payment_reminder', label: 'Payment reminder' }],
        required: true,
        when: (days) =>
          days === null
            ? 'After a payment link was sent and not paid'
            : `${plural(days, 'day', 'days')} after the payment link was sent`,
      },
      {
        topic: 'payment_link_expiring',
        title: 'Payment link expiring',
        templates: [{ key: 'payment_link_expiring', label: 'Payment link expiring' }],
        required: true,
        when: () => 'When an unpaid online booking is about to be released',
      },
      {
        topic: 'payment_received',
        title: 'Payment received',
        templates: [{ key: 'payment_received', label: 'Payment received' }],
        required: true,
        when: () => 'When a payment is recorded',
      },
      {
        topic: 'payment_not_completed',
        title: 'Payment not completed',
        templates: [{ key: 'payment_not_completed', label: 'Payment not completed' }],
        required: true,
        when: () => 'When an online payment is not completed in time',
      },
      {
        topic: 'refund_processed',
        title: 'Refund',
        templates: [{ key: 'refund_processed', label: 'Refund' }],
        required: true,
        when: () => 'When a refund is made',
      },
    ],
  },
  {
    id: 'stay',
    title: 'Stay',
    description: 'Messages around the stay itself. Each can be switched off.',
    items: [
      {
        topic: 'pre_arrival',
        title: 'Pre-arrival reminder',
        templates: [{ key: 'pre_arrival', label: 'Pre-arrival reminder' }],
        required: false,
        when: (days) =>
          days === null ? 'Before check-in' : `${plural(days, 'day', 'days')} before check-in`,
      },
      {
        topic: 'check_in_day',
        title: 'Check-in day message',
        templates: [{ key: 'check_in_day', label: 'Check-in day message' }],
        required: false,
        when: () => 'An hour after the guest is checked in',
      },
      {
        topic: 'post_stay',
        title: 'Post-stay thank-you',
        templates: [{ key: 'post_stay', label: 'Post-stay thank-you' }],
        required: false,
        when: (days) =>
          days === null ? 'After check-out' : `${plural(days, 'day', 'days')} after check-out`,
      },
      {
        topic: 'no_show_notice',
        title: 'No-show notice',
        templates: [{ key: 'no_show_notice', label: 'No-show notice' }],
        required: false,
        when: () => 'When staff mark a guest as a no-show',
      },
    ],
  },
];

/** The staff wording that belongs to each notification. */
export const STAFF_TEMPLATE_BY_TOPIC: Readonly<Record<string, string>> = {
  new_booking: 'staff_new_booking',
  booking_changed: 'staff_booking_changed',
  booking_cancelled: 'staff_booking_cancelled',
  payment_received: 'staff_payment_received',
  payment_not_completed: 'staff_payment_failed',
  refund_processed: 'staff_refund_processed',
  owner_alerts: 'owner_alerts',
  owner_daily_summary: 'owner_daily_summary',
  owner_weekly_summary: 'owner_weekly_summary',
};

/** When each staff notification is sent. */
export const STAFF_WHEN: Readonly<Record<string, string>> = {
  new_booking: 'When a booking is made',
  booking_changed: 'When a booking is changed',
  booking_cancelled: 'When a booking is cancelled',
  payment_received: 'When a payment is recorded',
  payment_not_completed: 'When an online payment is not completed in time',
  refund_processed: 'When a refund is made',
  owner_daily_summary: 'Every morning, hotel time',
  owner_weekly_summary: 'Monday morning',
  owner_alerts: 'Within minutes of a problem',
};

/** Who receives a staff notification when the hotel has not chosen a list. */
export const STAFF_DEFAULT_RECIPIENTS: Readonly<Record<string, string>> = {
  new_booking: 'The staff member assigned to the booking, or the owners',
  booking_changed: 'The staff member assigned to the booking, or the owners',
  booking_cancelled: 'The staff member assigned to the booking, or the owners',
  payment_received: 'The staff member assigned to the booking, or the owners',
  payment_not_completed: 'The staff member assigned to the booking, or the owners',
  refund_processed: 'The owners',
  owner_daily_summary: 'The owners',
  owner_weekly_summary: 'The owners',
  owner_alerts: 'The owners',
};

/** Wordings the hotel does not edit here: one never sends, two are account emails sent by the platform. */
export const HIDDEN_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  'payment_failed',
  'staff_invitation',
  'staff_account_created',
]);

/** A notification that must always have someone to receive it. */
export const ALWAYS_NEEDS_RECIPIENT: ReadonlySet<string> = new Set(['owner_alerts']);
