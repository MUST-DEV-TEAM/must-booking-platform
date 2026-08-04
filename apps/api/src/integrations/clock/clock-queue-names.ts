// Source brief section 26 / Appendix A: the named Clock job queues, plus a
// dead-letter queue for jobs that exhaust their retries. Priority is a plain
// BullMQ job priority (lower number = processed first) reflecting the
// brief's documented order: booking confirm/cancel first, then webhook
// hydration, then availability/operational sync, then reconciliation, then
// full catalog sync/reports last.
export const CLOCK_QUEUE_NAMES = [
  'clock.critical.commands',
  'clock.webhooks',
  'clock.booking.sync',
  'clock.financial.sync',
  'clock.reconciliation',
  'clock.catalog.sync',
] as const;

export type ClockQueueName = (typeof CLOCK_QUEUE_NAMES)[number];

export const CLOCK_DEAD_LETTER_QUEUE_NAME = 'clock.dead-letter';

export const CLOCK_QUEUE_PRIORITY: Record<ClockQueueName, number> = {
  'clock.critical.commands': 1, // booking confirm/cancel — Task 10
  'clock.webhooks': 2, // webhook hydration — Task 11
  'clock.booking.sync': 3, // operational booking sync
  'clock.financial.sync': 3, // operational financial sync — same tier as booking sync
  'clock.reconciliation': 4,
  'clock.catalog.sync': 5, // full catalog sync/reports — lowest priority
};
