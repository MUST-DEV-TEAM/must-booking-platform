/**
 * What is wrong with a reservation that needs staff follow-up, in staff words. One reservation
 * is one queue item; its status decides the issue, group, priority and the suggested next step.
 */

export type AttentionGroup = 'bookings' | 'payments';
export type AttentionPriority = 'urgent' | 'review';

export type AttentionIssue = {
  title: string;
  group: AttentionGroup;
  priority: AttentionPriority;
  /** Why it was flagged, in one sentence. */
  reason: string;
  /** What the staff member should do next. */
  nextStep: string;
};

const issues: Record<string, AttentionIssue> = {
  PAYMENT_FAILED: {
    title: 'Payment failed',
    group: 'payments',
    priority: 'urgent',
    reason: 'The online payment for this reservation did not go through.',
    nextStep:
      'Contact the guest for another payment method, or cancel the reservation if they do not respond.',
  },
  PMS_UNKNOWN_RESULT: {
    title: 'Provider result unknown',
    group: 'bookings',
    priority: 'urgent',
    reason: 'The hotel system did not confirm whether this reservation was created.',
    nextStep:
      'Check the reservation in the hotel system before retrying, so the room is not booked twice.',
  },
  PMS_REJECTED: {
    title: 'Rejected by the hotel system',
    group: 'bookings',
    priority: 'urgent',
    reason: 'The hotel system refused this reservation.',
    nextStep:
      'Open the reservation, check availability and rates, then rebook or contact the guest.',
  },
  MANUAL_REVIEW: {
    title: 'Reservation awaiting review',
    group: 'bookings',
    priority: 'review',
    reason: 'The reservation was held for a person to check before it is confirmed.',
    nextStep: 'Review the reservation details and payment status before confirming the booking.',
  },
  AVAILABILITY_FAILED: {
    title: 'Availability failed',
    group: 'bookings',
    priority: 'review',
    reason: 'The room was no longer available when the reservation was finalised.',
    nextStep: 'Offer the guest another room or dates, or cancel the reservation.',
  },
};

const fallback: AttentionIssue = {
  title: 'Needs review',
  group: 'bookings',
  priority: 'review',
  reason: 'This reservation is in a state that needs a person to check it.',
  nextStep: 'Open the reservation and review it.',
};

export function attentionIssue(status: string): AttentionIssue {
  return issues[status] ?? fallback;
}

export const PRIORITY_RANK: Record<AttentionPriority, number> = { urgent: 0, review: 1 };
