import { applicableRestrictions } from './inventory-restrictions.repository';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  CHECK_IN_PAST_MESSAGE,
  effectiveMinimumStay,
  evaluateBookingRules,
  propertyClock,
  rangeViolation,
  type BookingRulePolicy,
  type RuleConflict,
} from '../booking/booking-rules';
import { isClockManagedProperty } from '../booking/clock-managed-property';
import type { TenantDatabaseService } from './tenant-database.service';

type AvailabilityCheck = (input: {
  bookingMode: string;
  roomTypeId: string;
  roomId?: string;
  startsOn: string;
  endsOn: string;
  adults: number;
  children: number;
}) => Promise<{ availableUnits: number; minimumStay?: number }>;

/** Loads scoped facts; all policy decisions remain in booking-rules.ts. */
export async function evaluatePropertyBookingRules(
  database: TenantDatabaseService,
  checkAvailability: AvailabilityCheck,
  tenantId: string,
  propertyId: string,
  query: unknown,
) {
  const value = (query ?? {}) as Record<string, unknown>;
  const channel = value.channel ?? 'staff';
  if (channel !== 'staff' && channel !== 'guest')
    throw new BadRequestException('Choose staff or guest channel.');
  const startsOn = typeof value.startsOn === 'string' ? value.startsOn : '';
  const endsOn = typeof value.endsOn === 'string' ? value.endsOn : '';
  const roomId = typeof value.roomId === 'string' ? value.roomId : '';
  let roomTypeId = typeof value.roomTypeId === 'string' ? value.roomTypeId : '';
  for (const id of [roomId, roomTypeId])
    if (id && !/^[0-9a-f-]{36}$/i.test(id))
      throw new BadRequestException('A valid room or room type ID is required.');
  const adults = value.adults === undefined ? 1 : Number(value.adults);
  const children = value.children === undefined ? 0 : Number(value.children);
  if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0)
    throw new BadRequestException('Adults and children must be valid guest counts.');
  const hasRange = Boolean(startsOn || endsOn);
  const context = await database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
    const policies = await tx.$queryRaw<Array<BookingRulePolicy & { bookingMode: string }>>`
      SELECT timezone, min_stay_nights AS "minStayNights", max_stay_nights AS "maxStayNights",
        advance_booking_days AS "advanceBookingDays", same_day_booking_allowed AS "sameDayBookingAllowed",
        same_day_cutoff_time AS "sameDayCutoffTime",max_guests_per_booking AS "maxGuestsPerBooking",max_rooms_per_booking AS "maxRoomsPerBooking", booking_mode::text AS "bookingMode"
      FROM properties WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    if (!policies[0]) throw new NotFoundException('Property was not found.');
    let roomActive: boolean | undefined;
    if (roomId) {
      const rooms = await tx.$queryRaw<Array<{ roomTypeId: string; isActive: boolean }>>`
        SELECT room_type_id AS "roomTypeId", is_active AS "isActive" FROM rooms
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
      `;
      if (!rooms[0] || (roomTypeId && roomTypeId !== rooms[0].roomTypeId))
        throw new NotFoundException('Room was not found for this room type.');
      roomTypeId = rooms[0].roomTypeId;
      roomActive = rooms[0].isActive;
    }
    let roomType: { status: string; maxOccupancy?: number } | undefined;
    if (roomTypeId) {
      const types = await tx.$queryRaw<Array<{ status: string; maxOccupancy: number }>>`
        SELECT status::text AS status, max_occupancy AS "maxOccupancy" FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
      `;
      if (!types[0]) throw new NotFoundException('Room type was not found.');
      // Clock has no room-type capacity; its rates enforce guest limits when priced.
      roomType = (await isClockManagedProperty(tx, tenantId, propertyId))
        ? { ...types[0], maxOccupancy: undefined }
        : types[0];
    }
    let reservations: RuleConflict[] = [];
    let blocks: RuleConflict[] = [];
    if (hasRange && !rangeViolation(startsOn, endsOn) && roomTypeId) {
      reservations = await tx.$queryRaw<RuleConflict[]>`
        SELECT starts_on::text AS "startsOn", ends_on::text AS "endsOn", 'booking'::text AS kind
        FROM bookings WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND starts_on < ${endsOn}::date AND ends_on > ${startsOn}::date
          AND status NOT IN ('CANCELLED', 'EXPIRED', 'DRAFT', 'QUOTED')
          AND ((${roomId || null}::uuid IS NOT NULL AND room_id = ${roomId || null}::uuid)
            OR (${roomId || null}::uuid IS NULL AND room_type_id = ${roomTypeId}::uuid))
      `;
      blocks = await tx.$queryRaw<RuleConflict[]>`
        SELECT ab.starts_on::text AS "startsOn", ab.ends_on::text AS "endsOn", 'block'::text AS kind
        FROM availability_blocks ab WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = ${tenantId}::uuid AND ab.property_id = ${propertyId}::uuid
          AND ab.starts_on < ${endsOn}::date AND ab.ends_on > ${startsOn}::date
          AND (ab.blocks_all OR EXISTS (SELECT 1 FROM availability_block_room_types t
            WHERE t.tenant_id = ab.tenant_id AND t.property_id = ab.property_id AND t.block_id = ab.id AND t.room_type_id = ${roomTypeId}::uuid)
            OR EXISTS (SELECT 1 FROM availability_block_rooms r WHERE r.tenant_id = ab.tenant_id
              AND r.property_id = ab.property_id AND r.block_id = ab.id AND r.room_id = ${roomId || null}::uuid))
      `;
    }
    const restrictions =
      roomTypeId && hasRange
        ? await applicableRestrictions(tx, tenantId, propertyId, roomTypeId)
        : [];
    return { policy: policies[0], roomType, roomActive, reservations, blocks, restrictions };
  });
  const today = propertyClock(context.policy.timezone).date;
  const disabledDates: string[] = [];
  const from = typeof value.from === 'string' ? value.from : '';
  const to = typeof value.to === 'string' ? value.to : '';
  if (from && to && !rangeViolation(from, to)) {
    for (
      let date = new Date(`${from}T00:00:00Z`), count = 0;
      date.toISOString().slice(0, 10) < to && count < 92;
      date.setUTCDate(date.getUTCDate() + 1), count += 1
    ) {
      const day = date.toISOString().slice(0, 10);
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 1);
      if (
        evaluateBookingRules({
          channel: 'block',
          startsOn: day,
          endsOn: next.toISOString().slice(0, 10),
          policy: context.policy,
        }).errors.some((error) => error.code === 'BLOCK_IN_PAST')
      )
        disabledDates.push(day);
    }
  }
  const empty: ReturnType<typeof evaluateBookingRules> = { valid: false, errors: [] };
  const facts = {
    startsOn,
    endsOn,
    policy: context.policy,
    adults,
    children,
    maxOccupancy: context.roomType?.maxOccupancy,
    roomTypeStatus: context.roomType?.status,
    roomActive: context.roomActive,
    restrictions: context.restrictions,
  };
  const bookingConflicts = [...context.blocks, ...(roomId ? context.reservations : [])];
  let booking = hasRange
    ? evaluateBookingRules({ ...facts, channel, conflicts: bookingConflicts })
    : empty;
  let block = hasRange
    ? evaluateBookingRules({ ...facts, channel: 'block', conflicts: context.reservations })
    : empty;
  if (hasRange && roomId && context.policy.bookingMode === 'ROOM_TYPE_ONLY') {
    const error = {
      code: 'ROOM_ID_NOT_ALLOWED',
      message: 'This property uses room-type inventory; individual-room actions are unavailable.',
    };
    booking = { valid: false, errors: [...booking.errors, error] };
    block = { valid: false, errors: [...block.errors, error] };
  }
  if (booking.valid && roomTypeId) {
    try {
      const available = await checkAvailability({
        bookingMode: context.policy.bookingMode,
        roomTypeId,
        ...(roomId ? { roomId } : {}),
        startsOn,
        endsOn,
        adults,
        children,
      });
      context.policy.minStayNights = effectiveMinimumStay(
        context.policy.minStayNights,
        available.minimumStay,
      );
      booking = evaluateBookingRules({
        ...facts,
        channel,
        availableUnits: available.availableUnits,
        conflicts: bookingConflicts,
      });
    } catch (error) {
      booking = {
        valid: false,
        errors: [
          {
            code: 'AVAILABILITY_UNVERIFIED',
            message: error instanceof Error ? error.message : 'Availability could not be verified.',
          },
        ],
      };
    }
  }
  return {
    today,
    pastDateMessage: CHECK_IN_PAST_MESSAGE,
    minStayNights: booking.effectiveMinStayNights ?? context.policy.minStayNights ?? null,
    maxStayNights: booking.effectiveMaxStayNights ?? context.policy.maxStayNights ?? null,
    disabledDates,
    booking,
    block,
  };
}
