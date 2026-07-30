import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus } from '@must/domain-contracts';

export const BOOKING_STATUS_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> =
  {
    [BookingStatus.DRAFT]: [BookingStatus.QUOTED, BookingStatus.CANCELLED, BookingStatus.EXPIRED],
    [BookingStatus.QUOTED]: [
      BookingStatus.INVENTORY_REVALIDATING,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
    ],
    [BookingStatus.INVENTORY_REVALIDATING]: [
      BookingStatus.PAYMENT_PENDING,
      BookingStatus.PAYMENT_NOT_REQUIRED,
      BookingStatus.AVAILABILITY_FAILED,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
    ],
    [BookingStatus.PAYMENT_PENDING]: [
      BookingStatus.PMS_CREATION_PENDING,
      BookingStatus.PAYMENT_FAILED,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
    ],
    [BookingStatus.PAYMENT_NOT_REQUIRED]: [
      BookingStatus.PMS_CREATION_PENDING,
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
    ],
    [BookingStatus.PMS_CREATION_PENDING]: [
      BookingStatus.PMS_CONFIRMATION_PENDING,
      BookingStatus.AVAILABILITY_FAILED,
      BookingStatus.PMS_UNKNOWN_RESULT,
      BookingStatus.PMS_REJECTED,
      BookingStatus.MANUAL_REVIEW,
      BookingStatus.CANCELLED,
    ],
    [BookingStatus.PMS_CONFIRMATION_PENDING]: [
      BookingStatus.CONFIRMED,
      BookingStatus.PMS_UNKNOWN_RESULT,
      BookingStatus.PMS_REJECTED,
      BookingStatus.MANUAL_REVIEW,
      BookingStatus.CANCELLED,
    ],
    [BookingStatus.CONFIRMED]: [BookingStatus.CANCELLED],
    [BookingStatus.AVAILABILITY_FAILED]: [],
    [BookingStatus.PAYMENT_FAILED]: [],
    [BookingStatus.PMS_UNKNOWN_RESULT]: [
      BookingStatus.CONFIRMED,
      BookingStatus.PMS_REJECTED,
      BookingStatus.MANUAL_REVIEW,
      BookingStatus.CANCELLED,
    ],
    [BookingStatus.PMS_REJECTED]: [BookingStatus.CANCELLED, BookingStatus.MANUAL_REVIEW],
    [BookingStatus.MANUAL_REVIEW]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
    [BookingStatus.CANCELLED]: [],
    [BookingStatus.EXPIRED]: [],
  };

@Injectable()
export class BookingStateMachine {
  canTransition(from: BookingStatus, to: BookingStatus): boolean {
    return BOOKING_STATUS_TRANSITIONS[from].includes(to);
  }

  transition(from: BookingStatus, to: BookingStatus): BookingStatus {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(`Invalid booking status transition: ${from} -> ${to}.`);
    }

    return to;
  }
}
