import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@must/domain-contracts';

import type {
  PrePaymentAvailabilityCheck,
  PrePaymentStay,
} from '../../booking/pre-payment-availability';
import { ClockAvailabilityService } from './clock-availability.service';

/**
 * Clock's pre-payment check. Specific rooms are checked against Clock's reservations in one
 * read for the stay. Unassigned rooms are checked per room type and occupancy with an
 * uncached `/rates_availability` call, and Clock must report at least as many free units as
 * the stay asks for of that type. The 20-minute availability cache Clock requires for
 * browsing is bypassed only here, at the moment of payment.
 */
@Injectable()
export class ClockPrePaymentAvailability implements PrePaymentAvailabilityCheck {
  constructor(
    @Inject(ClockAvailabilityService) private readonly availability: ClockAvailabilityService,
  ) {}

  async confirmAvailable(
    context: { tenantId: string; propertyId: string },
    stay: PrePaymentStay,
  ): Promise<Result<void>> {
    const single = stay.rooms.length === 1;

    const roomIds = stay.rooms.flatMap((room) => (room.roomId ? [room.roomId] : []));
    if (roomIds.length > 0) {
      const taken = await this.availability.unavailableRoomsForBooking(
        context.tenantId,
        context.propertyId,
        { roomIds, startsOn: stay.startsOn, endsOn: stay.endsOn },
      );
      if (!taken.ok) return unconfirmed(taken.error.retryable);
      if (taken.value.length > 0)
        return unavailable(
          single
            ? 'The selected room is no longer available for the requested stay.'
            : 'A selected room is no longer available for the requested stay.',
        );
    }

    const roomsPerType = new Map<string, number>();
    for (const room of stay.rooms)
      roomsPerType.set(room.roomTypeId, (roomsPerType.get(room.roomTypeId) ?? 0) + 1);
    const checked = new Set<string>();
    for (const room of stay.rooms) {
      if (room.roomId) continue;
      const key = `${room.roomTypeId}:${room.adults}:${room.children}`;
      if (checked.has(key)) continue;
      checked.add(key);
      const result = await this.availability.getAvailability(
        context.tenantId,
        context.propertyId,
        {
          roomTypeId: room.roomTypeId,
          startsOn: stay.startsOn,
          endsOn: stay.endsOn,
          adultCount: room.adults,
          childrenCount: room.children,
        },
        { skipCache: true },
      );
      if (!result.ok) return unconfirmed(result.error.retryable);
      if (
        !result.value.isAvailable ||
        result.value.availableUnits < roomsPerType.get(room.roomTypeId)!
      )
        return unavailable(
          single
            ? 'Inventory is no longer available for the requested stay.'
            : 'One or more requested rooms are no longer available for the requested stay.',
        );
    }
    return { ok: true, value: undefined };
  }
}

function unavailable(message: string): Result<never> {
  return { ok: false, error: { code: 'AVAILABILITY_FAILED', message, retryable: false } };
}

function unconfirmed(retryable: boolean): Result<never> {
  return {
    ok: false,
    error: {
      code: 'AVAILABILITY_FAILED',
      message: 'Live Clock availability could not be confirmed. Please try again.',
      retryable,
    },
  };
}
