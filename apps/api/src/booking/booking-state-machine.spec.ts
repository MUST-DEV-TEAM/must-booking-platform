import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@must/domain-contracts';

import { BOOKING_STATUS_TRANSITIONS, BookingStateMachine } from './booking-state-machine';

describe('BookingStateMachine', () => {
  const stateMachine = new BookingStateMachine();
  const adrTransitions: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
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

  it('matches every ADR-0014 transition, including terminal and recovery states', () => {
    expect(BOOKING_STATUS_TRANSITIONS).toEqual(adrTransitions);
  });

  it('allows every ADR-0014 transition', () => {
    for (const from of Object.values(BookingStatus)) {
      for (const to of adrTransitions[from]) {
        expect(stateMachine.canTransition(from, to)).toBe(true);
        expect(stateMachine.transition(from, to)).toBe(to);
      }
    }
  });

  it('rejects every transition not permitted by ADR-0014', () => {
    for (const from of Object.values(BookingStatus)) {
      for (const to of Object.values(BookingStatus)) {
        if (adrTransitions[from].includes(to)) continue;
        expect(stateMachine.canTransition(from, to)).toBe(false);
        expect(() => stateMachine.transition(from, to)).toThrow(
          `Invalid booking status transition: ${from} -> ${to}.`,
        );
      }
    }
  });
});
