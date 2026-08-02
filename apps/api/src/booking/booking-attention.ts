import { BookingStatus } from '@must/domain-contracts';

export const BOOKING_NEEDS_ATTENTION_STATUSES = [
  BookingStatus.MANUAL_REVIEW,
  BookingStatus.PAYMENT_FAILED,
  BookingStatus.AVAILABILITY_FAILED,
  BookingStatus.PMS_REJECTED,
  BookingStatus.PMS_UNKNOWN_RESULT,
] as const;

export function bookingNeedsAttention(status: BookingStatus): boolean {
  return BOOKING_NEEDS_ATTENTION_STATUSES.includes(
    status as (typeof BOOKING_NEEDS_ATTENTION_STATUSES)[number],
  );
}
