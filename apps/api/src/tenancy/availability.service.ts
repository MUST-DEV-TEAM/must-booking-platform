import { bookingContactSql } from '../booking/booking-contact';
import { pricingContext, pricingFacts } from './pricing.repository';
import { evaluatePricing, pricingDay } from '../booking/pricing-evaluator';
import { InventoryStockService } from './inventory-stock.service';
import { applicableRestrictions } from './inventory-restrictions.repository';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { evaluateBookingRules, rangeViolation } from '../booking/booking-rules';
import { evaluatePropertyBookingRules } from './booking-rules-evaluation';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import {
  ClockAvailabilityService,
  type CalendarDay,
} from '../integrations/clock/clock-availability.service';

type Availability = {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  isAvailable: boolean;
  availableUnits: number;
  restrictionErrors?: Array<{ code: string; message: string }>;
};
type RoomAvailability = {
  roomId: string;
  startsOn: string;
  endsOn: string;
  isAvailable: boolean;
};
type InventoryInput = {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  availableUnits: number;
};
type RoomAvailabilityInput = {
  startsOn: string;
  endsOn: string;
  isAvailable: boolean;
};
export const BLOCK_REASONS = [
  'maintenance',
  'renovation',
  'safety_inspection',
  'deep_cleaning',
  'out_of_service',
  'owner_use',
  'house_use',
  'event',
  'other',
] as const;

type AvailabilityBlockInput = {
  startsOn: string;
  endsOn: string;
  all: boolean;
  roomTypeIds: string[];
  roomIds: string[];
  reason?: (typeof BLOCK_REASONS)[number];
  note?: string;
  reference?: string;
};
type AvailabilityBlock = AvailabilityBlockInput & {
  id: string;
  createdByEmail?: string | null;
};

export type InventoryBookedUnitsInput = {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  units: number;
};
export type RoomBookedInput = {
  roomId: string;
  startsOn: string;
  endsOn: string;
};

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockAvailabilityService) private readonly clockAvailability: ClockAvailabilityService,
    @Inject(InventoryStockService) private readonly stock: InventoryStockService,
  ) {}

  evaluateRules(tenantId: string, propertyId: string, query: unknown) {
    return evaluatePropertyBookingRules(
      this.database,
      async (input) => {
        const connection = await this.connections.activePmsConnectionCredentials(
          tenantId,
          propertyId,
        );
        if (connection?.provider === 'CLOCK_PMS') {
          const calendar = await this.getCalendar(tenantId, propertyId, {
            roomTypeId: input.roomTypeId,
            month: input.startsOn.slice(0, 7),
            adultCount: input.adults,
            childrenCount: input.children,
          });
          const result = await this.clockAvailability.isAvailableForBooking(tenantId, propertyId, {
            ...input,
            adultCount: input.adults,
            childrenCount: input.children,
          });
          if (!result.ok) throw new Error(result.error.message);
          return {
            availableUnits: result.value ? 1 : 0,
            minimumStay: calendar.days.find((day) => day.date === input.startsOn)?.minStay,
          };
        }
        if (input.roomId) {
          const roomAvailable = (
            await this.getRoomAvailability(tenantId, propertyId, input.roomId, input)
          ).isAvailable;
          const poolAvailable =
            input.bookingMode !== 'MIXED' ||
            (await this.getAvailability(tenantId, propertyId, input)).availableUnits > 0;
          return { availableUnits: roomAvailable && poolAvailable ? 1 : 0 };
        }
        return {
          availableUnits: (await this.getAvailability(tenantId, propertyId, input)).availableUnits,
        };
      },
      tenantId,
      propertyId,
      query,
    );
  }

  async getAvailability(
    tenantId: string,
    propertyId: string,
    query: unknown,
  ): Promise<Availability> {
    const input = this.input(query);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await this.requireRoomType(tx, tenantId, propertyId, input.roomTypeId);
      if (roomType.status !== 'PUBLISHED')
        return {
          roomTypeId: input.roomTypeId,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          availableUnits: 0,
          isAvailable: false,
        };
      const rows = await tx.$queryRaw<Array<{ availableUnits: number | null }>>`
        WITH requested_nights AS (
          SELECT generate_series(
            ${input.startsOn}::date,
            ${input.endsOn}::date - 1,
            INTERVAL '1 day'
          )::date AS stays_on
        )
        SELECT CASE
          WHEN EXISTS (
            SELECT 1
            FROM availability_blocks ab
            WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = ${tenantId}::uuid
              AND ab.property_id = ${propertyId}::uuid
              AND ab.starts_on < ${input.endsOn}::date
              AND ab.ends_on > ${input.startsOn}::date
              AND (
                ab.blocks_all
                OR EXISTS (
                  SELECT 1
                  FROM availability_block_room_types abrt
                  WHERE abrt.tenant_id = ab.tenant_id
                    AND abrt.property_id = ab.property_id
                    AND abrt.block_id = ab.id
                    AND abrt.room_type_id = ${input.roomTypeId}::uuid
                )
              )
          ) THEN 0
          ELSE COALESCE(MIN(
            COALESCE(inventory_units.available_units, 0) - COALESCE(inventory_units.booked_units, 0)
          ), 0)::integer
        END::integer AS "availableUnits"
        FROM requested_nights
        LEFT JOIN inventory_units
          ON inventory_units.tenant_id = ${tenantId}::uuid
          AND inventory_units.property_id = ${propertyId}::uuid
          AND inventory_units.room_type_id = ${input.roomTypeId}::uuid
          AND inventory_units.stays_on = requested_nights.stays_on
      `;
      const restrictions = await this.restrictionCheck(
        tx,
        tenantId,
        propertyId,
        input.roomTypeId,
        input,
      );
      const availableUnits = restrictions.valid ? (rows[0]?.availableUnits ?? 0) : 0;
      return {
        roomTypeId: input.roomTypeId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        availableUnits,
        isAvailable: availableUnits > 0,
        ...(restrictions.errors.length ? { restrictionErrors: restrictions.errors } : {}),
      };
    });
  }

  /**
   * Per-day availability for a whole month, for the walk-in booking
   * calendar's disabled-dates display — one query for the month rather
   * than one round trip per day. roomTypeId is always required (mirrors
   * getAvailability); roomId narrows to a single room's own availability
   * when the property is in individual-room mode.
   */
  async getCalendar(
    tenantId: string,
    propertyId: string,
    query: {
      roomTypeId: string;
      roomId?: string;
      month: string;
      adultCount?: number;
      childrenCount?: number;
      roomCount?: number;
    },
  ): Promise<{ days: CalendarDay[] }> {
    const { start, end } = this.monthRange(query.month);
    // Individual-room availability is always a local concept (room_availability/
    // bookings), regardless of PMS connection — only the room-type-level day
    // query is Clock-aware, matching QuoteService.price()'s same scope cut.
    if (!query.roomId) {
      const connection = await this.connections.activePmsConnectionCredentials(
        tenantId,
        propertyId,
      );
      if (connection?.provider === 'CLOCK_PMS') {
        const calendar = await this.clockAvailability.getAvailabilityCalendar(
          tenantId,
          propertyId,
          {
            roomTypeId: query.roomTypeId,
            month: query.month,
            adultCount: query.adultCount,
            childrenCount: query.childrenCount,
            roomCount: query.roomCount,
          },
        );
        if (!calendar.ok) throw new BadRequestException(calendar.error.message);
        return { days: calendar.value };
      }
    }
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRoomType(tx, tenantId, propertyId, query.roomTypeId);
      if (query.roomId) {
        await this.requireIndividualRoomMode(tx, tenantId, propertyId);
        await this.requireRoom(tx, tenantId, propertyId, query.roomId);
        const days = await tx.$queryRaw<Array<{ date: string; isAvailable: boolean }>>`
          WITH month_days AS (
            SELECT generate_series(${start}::date, ${end}::date - INTERVAL '1 day', INTERVAL '1 day')::date AS stays_on
          )
          SELECT month_days.stays_on::text AS date,
            NOT EXISTS (
              SELECT 1 FROM room_availability ra
              WHERE ra.tenant_id = ${tenantId}::uuid AND ra.property_id = ${propertyId}::uuid
                AND ra.room_id = ${query.roomId}::uuid AND ra.stays_on = month_days.stays_on
                AND ra.is_available = false
            )
            AND EXISTS (
              SELECT 1 FROM rooms r
              WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid
                AND r.id = ${query.roomId}::uuid AND r.is_active = true
            )
            AND NOT EXISTS (
              SELECT 1 FROM bookings b
              WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
                AND b.room_id = ${query.roomId}::uuid
                AND b.starts_on <= month_days.stays_on AND b.ends_on > month_days.stays_on
                AND b.status IN (
                  'PAYMENT_PENDING'::"BookingStatus", 'PAYMENT_NOT_REQUIRED'::"BookingStatus",
                  'PMS_CREATION_PENDING'::"BookingStatus", 'PMS_CONFIRMATION_PENDING'::"BookingStatus",
                  'CONFIRMED'::"BookingStatus", 'PAYMENT_FAILED'::"BookingStatus",
                  'PMS_UNKNOWN_RESULT'::"BookingStatus", 'PMS_REJECTED'::"BookingStatus",
                  'MANUAL_REVIEW'::"BookingStatus"
                )
            )
            AND NOT EXISTS (
              SELECT 1 FROM availability_blocks ab
              WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = ${tenantId}::uuid AND ab.property_id = ${propertyId}::uuid
                AND ab.starts_on <= month_days.stays_on AND ab.ends_on > month_days.stays_on
                AND (
                  ab.blocks_all
                  OR EXISTS (
                    SELECT 1 FROM availability_block_rooms abr
                    WHERE abr.tenant_id = ab.tenant_id AND abr.property_id = ab.property_id
                      AND abr.block_id = ab.id AND abr.room_id = ${query.roomId}::uuid
                  )
                  OR EXISTS (
                    SELECT 1 FROM availability_block_room_types abrt
                    JOIN rooms r ON r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid
                      AND r.id = ${query.roomId}::uuid
                    WHERE abrt.tenant_id = ab.tenant_id AND abrt.property_id = ab.property_id
                      AND abrt.block_id = ab.id AND abrt.room_type_id = r.room_type_id
                  )
                )
            ) AS "isAvailable"
          FROM month_days
          ORDER BY month_days.stays_on
        `;
        return {
          days: await this.restrictionCalendarDays(
            tx,
            tenantId,
            propertyId,
            query.roomTypeId,
            days,
          ),
        };
      }

      const days = await tx.$queryRaw<Array<{ date: string; isAvailable: boolean }>>`
        WITH month_days AS (
          SELECT generate_series(${start}::date, ${end}::date - INTERVAL '1 day', INTERVAL '1 day')::date AS stays_on
        )
        SELECT month_days.stays_on::text AS date,
          (CASE WHEN EXISTS (
            SELECT 1 FROM availability_blocks ab
            WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = ${tenantId}::uuid AND ab.property_id = ${propertyId}::uuid
              AND ab.starts_on <= month_days.stays_on AND ab.ends_on > month_days.stays_on
              AND (
                ab.blocks_all
                OR EXISTS (
                  SELECT 1 FROM availability_block_room_types abrt
                  WHERE abrt.tenant_id = ab.tenant_id AND abrt.property_id = ab.property_id
                    AND abrt.block_id = ab.id AND abrt.room_type_id = ${query.roomTypeId}::uuid
                )
              )
          ) THEN false
          ELSE COALESCE(inventory_units.available_units, 0) - COALESCE(inventory_units.booked_units, 0) > 0
          END) AS "isAvailable"
        FROM month_days
        LEFT JOIN inventory_units
          ON inventory_units.tenant_id = ${tenantId}::uuid
          AND inventory_units.property_id = ${propertyId}::uuid
          AND inventory_units.room_type_id = ${query.roomTypeId}::uuid
          AND inventory_units.stays_on = month_days.stays_on
        ORDER BY month_days.stays_on
      `;
      return {
        days: await this.restrictionCalendarDays(tx, tenantId, propertyId, query.roomTypeId, days),
      };
    });
  }

  private async restrictionCheck(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    range: { startsOn: string; endsOn: string },
  ) {
    const restrictions = await applicableRestrictions(tx, tenantId, propertyId, roomTypeId);
    return restrictions.length
      ? evaluateBookingRules({
          ...range,
          channel: 'staff',
          policy: { timezone: restrictions[0].timezone },
          restrictions,
        })
      : { valid: true, errors: [] };
  }
  private async roomRestrictionCheck(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    range: RoomBookedInput,
  ) {
    const rooms = await tx.$queryRaw<
      Array<{ roomTypeId: string }>
    >`SELECT room_type_id AS "roomTypeId" FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${range.roomId}::uuid`;
    if (!rooms[0]) return { valid: false, errors: [] };
    return this.restrictionCheck(tx, tenantId, propertyId, rooms[0].roomTypeId, range);
  }
  private async restrictionCalendarDays(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    days: Array<{ date: string; isAvailable: boolean }>,
  ) {
    const restrictions = await applicableRestrictions(tx, tenantId, propertyId, roomTypeId);
    const pricingContextData = await pricingContext(tx, tenantId, propertyId);
    const facts =
      pricingContextData.source === 'LOCAL' ? await pricingFacts(tx, tenantId, propertyId) : null;
    const fallback = facts?.plans.find((p) => p.isFallback);
    return days.map((day) => {
      const next = new Date(`${day.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const evaluation = evaluateBookingRules({
        channel: 'staff',
        startsOn: day.date,
        endsOn: next.toISOString().slice(0, 10),
        restrictions,
        policy: { timezone: restrictions[0]?.timezone },
      });
      // A day cell has no selected departure. Keep length/departure messages as metadata;
      // only night-sale/arrival closures change its coverage status. Full stays use evaluateRules.
      const closed = evaluation.errors.some((error) =>
        ['STOP_SELL', 'CLOSED_TO_ARRIVAL', 'RESTRICTION_PRIORITY_CONFLICT'].includes(error.code),
      );
      return {
        ...localCalendarDay({ ...day, isAvailable: day.isAvailable && !closed }),
        ...(restrictions.length ? { restrictionErrors: evaluation.errors } : {}),
        ...(facts && fallback
          ? {
              pricing: evaluatePricing(facts, {
                ratePlanId: fallback.id,
                roomTypeId,
                startsOn: day.date,
                endsOn: pricingDay(day.date, 1),
                adults: 1,
                children: 0,
                channel: 'staff',
                today: pricingContextData.today,
              }),
            }
          : {}),
      };
    });
  }

  private monthRange(month: string): { start: string; end: string } {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('month must be YYYY-MM.');
    const [year, monthNumber] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year!, monthNumber! - 1, 1));
    const end = new Date(Date.UTC(year!, monthNumber!, 1));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }

  async setInventory(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<void> {
    await this.stock.apply(tenantId, propertyId, actorUserId, body, randomUUID());
  }

  async getRoomAvailability(
    tenantId: string,
    propertyId: string,
    roomId: string,
    query: unknown,
  ): Promise<RoomAvailability> {
    const input = this.rangeInput(query);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireIndividualRoomMode(tx, tenantId, propertyId);
      await this.requireRoom(tx, tenantId, propertyId, roomId);
      const restrictions = await this.roomRestrictionCheck(tx, tenantId, propertyId, {
        roomId,
        ...input,
      });
      return {
        roomId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        isAvailable:
          restrictions.valid &&
          (await this.roomIsAvailable(tx, tenantId, propertyId, { roomId, ...input })),
      };
    });
  }

  async setRoomAvailability(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<void> {
    const input = this.roomAvailabilityInput(body);
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireIndividualRoomMode(tx, tenantId, propertyId);
      await this.requireRoom(tx, tenantId, propertyId, roomId);
      await tx.$executeRaw`
        INSERT INTO room_availability (tenant_id, property_id, room_id, stays_on, is_available)
        SELECT
          ${tenantId}::uuid,
          ${propertyId}::uuid,
          ${roomId}::uuid,
          requested_nights.stays_on::date,
          ${input.isAvailable}
        FROM generate_series(
          ${input.startsOn}::date,
          ${input.endsOn}::date - 1,
          INTERVAL '1 day'
        ) AS requested_nights(stays_on)
        ON CONFLICT (tenant_id, property_id, room_id, stays_on)
        DO UPDATE SET is_available = EXCLUDED.is_available, updated_at = CURRENT_TIMESTAMP
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_availability.set',
        targetType: 'room',
        targetId: roomId,
        details: input,
      });
    });
  }

  async createAvailabilityBlock(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<AvailabilityBlock> {
    const input = this.availabilityBlockInput(body);
    const id = randomUUID();
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const properties = await tx.$queryRaw<Array<{ timezone: string | null }>>`
        SELECT timezone FROM properties WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid FOR UPDATE
      `;
      if (!properties[0]) throw new NotFoundException('Property was not found.');
      const external = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT pc.id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS'`;
      if (external.length) throw new ForbiddenException('Clock inventory is read-only.');
      const rangeRules = evaluateBookingRules({
        channel: 'block',
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        policy: properties[0],
      });
      if (!rangeRules.valid) throw new BadRequestException(rangeRules.errors[0]);
      if (input.roomIds.length > 0) await this.requireIndividualRoomMode(tx, tenantId, propertyId);
      for (const roomTypeId of input.roomTypeIds)
        await this.requireRoomType(tx, tenantId, propertyId, roomTypeId);
      for (const roomId of input.roomIds) await this.requireRoom(tx, tenantId, propertyId, roomId);

      // A block never cancels or moves a reservation: if one is in the way, stop and say which.
      const conflicts = await tx.$queryRaw<
        Array<{
          id: string;
          externalReference: string;
          startsOn: string;
          endsOn: string;
          guestName: string | null;
          roomName: string | null;
        }>
      >`
        SELECT b.id, b.external_reference AS "externalReference", b.starts_on::text AS "startsOn",
          b.ends_on::text AS "endsOn",
          NULLIF(TRIM(CONCAT_WS(' ', ${bookingContactSql.firstName}, ${bookingContactSql.lastName})), '') AS "guestName",
          r.name AS "roomName"
        FROM bookings b
        LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.id = b.room_id
        WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
          AND b.starts_on < ${input.endsOn}::date AND b.ends_on > ${input.startsOn}::date
          AND b.status NOT IN ('CANCELLED', 'EXPIRED', 'DRAFT', 'QUOTED')
          AND (
            ${input.all}
            OR b.room_type_id = ANY(${input.roomTypeIds}::uuid[])
            OR b.room_id = ANY(${input.roomIds}::uuid[])
          )
        ORDER BY b.starts_on
        LIMIT 20
      `;
      const conflictRules = evaluateBookingRules({
        channel: 'block',
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        policy: properties[0],
        conflicts: conflicts.map((conflict) => ({ ...conflict, kind: 'booking' as const })),
      });
      const conflict = conflictRules.errors.find(
        (error) => error.code === 'BLOCK_RESERVATION_CONFLICT',
      );
      if (conflict) throw new ConflictException({ ...conflict, conflicts });

      await tx.$executeRaw`
        INSERT INTO availability_blocks (id, tenant_id, property_id, starts_on, ends_on, blocks_all,
          reason, note, reference, created_by_user_id)
        VALUES (
          ${id}::uuid,
          ${tenantId}::uuid,
          ${propertyId}::uuid,
          ${input.startsOn}::date,
          ${input.endsOn}::date,
          ${input.all},
          ${input.reason ?? null},
          ${input.note ?? null},
          ${input.reference ?? null},
          ${actorUserId}::uuid
        )
      `;
      for (const roomTypeId of input.roomTypeIds)
        await tx.$executeRaw`
          INSERT INTO availability_block_room_types (tenant_id, property_id, block_id, room_type_id)
          VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${id}::uuid, ${roomTypeId}::uuid)
        `;
      for (const roomId of input.roomIds)
        await tx.$executeRaw`
          INSERT INTO availability_block_rooms (tenant_id, property_id, block_id, room_id)
          VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${id}::uuid, ${roomId}::uuid)
        `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'availability_blocks.create',
        targetType: 'availability_block',
        targetId: id,
        details: input,
      });
    });
    return { id, ...input };
  }

  listAvailabilityBlocks(tenantId: string, propertyId: string): Promise<AvailabilityBlock[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<AvailabilityBlock[]>`
        SELECT ab.id, ab.starts_on::text AS "startsOn", ab.ends_on::text AS "endsOn",
          ab.blocks_all AS "all", ab.reason, ab.note, ab.reference, ab.inventory_reference AS "inventoryReference", ab.version, ab.lifecycle, u.email AS "createdByEmail",
          COALESCE(ARRAY_AGG(DISTINCT abrt.room_type_id::text) FILTER (WHERE abrt.room_type_id IS NOT NULL), ARRAY[]::text[]) AS "roomTypeIds",
          COALESCE(ARRAY_AGG(DISTINCT abr.room_id::text) FILTER (WHERE abr.room_id IS NOT NULL), ARRAY[]::text[]) AS "roomIds"
        FROM availability_blocks ab
        LEFT JOIN availability_block_room_types abrt
          ON abrt.tenant_id = ab.tenant_id AND abrt.property_id = ab.property_id AND abrt.block_id = ab.id
        LEFT JOIN availability_block_rooms abr
          ON abr.tenant_id = ab.tenant_id AND abr.property_id = ab.property_id AND abr.block_id = ab.id
        LEFT JOIN users u ON u.id = ab.created_by_user_id
        WHERE ab.tenant_id = ${tenantId}::uuid AND ab.property_id = ${propertyId}::uuid AND ab.lifecycle IN ('Active','Scheduled')
        GROUP BY ab.id, u.email
        ORDER BY ab.starts_on ASC, ab.created_at ASC, ab.id ASC
      `,
    );
  }

  async removeAvailabilityBlock(
    tenantId: string,
    propertyId: string,
    availabilityBlockId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
      const external = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT pc.id FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=${tenantId}::uuid AND pc.property_id=${propertyId}::uuid AND pc.enabled AND pc.kind='PMS' AND c.provider='CLOCK_PMS'`;
      if (external.length) throw new ForbiddenException('Clock inventory is read-only.');
      const removed = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM availability_blocks
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND id = ${availabilityBlockId}::uuid AND inventory_reference IS NULL
        RETURNING id
      `;
      if (!removed[0]) throw new NotFoundException('Availability block not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'availability_blocks.remove',
        targetType: 'availability_block',
        targetId: availabilityBlockId,
      });
    });
  }

  async reserveBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: InventoryBookedUnitsInput,
  ): Promise<boolean> {
    await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
    const rules = await this.restrictionCheck(tx, tenantId, propertyId, input.roomTypeId, input);
    if (!rules.valid) return false;
    return this.adjustBookedUnits(tx, tenantId, propertyId, input, 1);
  }

  async lockBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
    const inventoryLockKey = `${tenantId}:${propertyId}:${roomTypeId}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${inventoryLockKey}, 0))
    `;
  }

  async reserveRoom(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: RoomBookedInput,
  ): Promise<boolean> {
    const reservation = this.roomBookedInput(input);
    await this.lockRoom(tx, tenantId, propertyId, reservation.roomId);
    const rules = await this.roomRestrictionCheck(tx, tenantId, propertyId, reservation);
    return rules.valid && this.roomIsAvailable(tx, tenantId, propertyId, reservation);
  }

  async lockRoom(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
    const roomLockKey = `${tenantId}:${propertyId}:${roomId}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${roomLockKey}, 0))
    `;
  }

  /** Uses creation's stock/room checks. Preview changes are rolled back to the savepoint;
   * the outer property lock keeps the release/claim invisible and serial with creation. */
  async amendStayInventory(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: {
      bookingId: string;
      roomTypeId: string;
      roomId: string | null;
      oldStartsOn: string;
      oldEndsOn: string;
      startsOn: string;
      endsOn: string;
    },
    apply = false,
    reasons?: string[],
  ): Promise<boolean> {
    await tx.$executeRawUnsafe('SAVEPOINT booking_amend_inventory');
    // Assigned rooms are held by the booking row, exactly as in creation.
    const pooled = !input.roomId;
    if (pooled) {
      await this.releaseBookedUnits(tx, tenantId, propertyId, {
        roomTypeId: input.roomTypeId,
        startsOn: input.oldStartsOn,
        endsOn: input.oldEndsOn,
        units: 1,
      });
    }
    let available = pooled
      ? await this.reserveBookedUnits(tx, tenantId, propertyId, { ...input, units: 1 })
      : !!input.roomId;
    if (available && input.roomId) {
      await this.lockRoom(tx, tenantId, propertyId, input.roomId);
      available = await this.roomIsAvailable(
        tx,
        tenantId,
        propertyId,
        { ...input, roomId: input.roomId },
        input.bookingId,
        reasons,
      );
    }
    if (!available && reasons && reasons.length === 0) {
      const blocked =
        pooled && (await this.roomTypeIsBlocked(tx, tenantId, propertyId, input.roomTypeId, input));
      reasons.push(
        blocked
          ? 'Blocked: a manual block overlaps these dates.'
          : 'Booked or unavailable: the same accommodation has no inventory for these dates.',
      );
    }
    if (!apply || !available)
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT booking_amend_inventory');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT booking_amend_inventory');
    return available;
  }

  async releaseBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: InventoryBookedUnitsInput,
  ): Promise<void> {
    const released = await this.adjustBookedUnits(tx, tenantId, propertyId, input, -1);
    if (!released) throw new BadRequestException('Cannot release inventory that is not booked.');
  }

  private input(query: unknown): Pick<InventoryInput, 'roomTypeId' | 'startsOn' | 'endsOn'> {
    const value = (query ?? {}) as Record<string, unknown>;
    const roomTypeId = typeof value.roomTypeId === 'string' ? value.roomTypeId : '';
    if (!roomTypeId) throw new BadRequestException('roomTypeId is required.');
    return { roomTypeId, ...this.rangeInput(value) };
  }

  private rangeInput(query: unknown): Pick<InventoryInput, 'startsOn' | 'endsOn'> {
    const value = (query ?? {}) as Record<string, unknown>;
    const startsOn = this.date(value.startsOn, 'startsOn');
    const endsOn = this.date(value.endsOn, 'endsOn');
    const invalidRange = rangeViolation(startsOn, endsOn);
    if (invalidRange) throw new BadRequestException(invalidRange);
    return { startsOn, endsOn };
  }

  private roomAvailabilityInput(body: unknown): RoomAvailabilityInput {
    const input = this.rangeInput(body);
    const value = (body ?? {}) as Record<string, unknown>;
    if (typeof value.isAvailable !== 'boolean')
      throw new BadRequestException('isAvailable must be a boolean.');
    return { ...input, isAvailable: value.isAvailable };
  }

  private availabilityBlockInput(body: unknown): AvailabilityBlockInput {
    const range = this.rangeInput(body);
    const value = (body ?? {}) as Record<string, unknown>;
    const all = value.all === undefined ? false : value.all;
    if (typeof all !== 'boolean') throw new BadRequestException('all must be a boolean.');
    const roomTypeIds = this.targetIds(value.roomTypeIds, 'roomTypeIds');
    const roomIds = this.targetIds(value.roomIds, 'roomIds');
    if (!all && roomTypeIds.length === 0 && roomIds.length === 0)
      throw new BadRequestException('At least one availability-block target is required.');
    const reason = value.reason;
    if (
      reason !== undefined &&
      !(typeof reason === 'string' && (BLOCK_REASONS as readonly string[]).includes(reason))
    )
      throw new BadRequestException(`reason must be one of ${BLOCK_REASONS.join(', ')}.`);
    const text = (field: 'note' | 'reference', max: number): string | undefined => {
      const raw = value[field];
      if (raw === undefined || raw === null || raw === '') return undefined;
      if (typeof raw !== 'string' || raw.trim().length > max)
        throw new BadRequestException(`${field} must be text of up to ${max} characters.`);
      return raw.trim();
    };
    return {
      ...range,
      all,
      roomTypeIds,
      roomIds,
      ...(reason ? { reason: reason as (typeof BLOCK_REASONS)[number] } : {}),
      ...(text('note', 500) ? { note: text('note', 500) } : {}),
      ...(text('reference', 80) ? { reference: text('reference', 80) } : {}),
    };
  }

  private targetIds(value: unknown, field: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id))
      throw new BadRequestException(`${field} must be an array of IDs.`);
    if (new Set(value).size !== value.length)
      throw new BadRequestException(`${field} must not contain duplicate IDs.`);
    return value;
  }

  private async stockManagedInClock(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ managed: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM property_integration_connections pic
        JOIN integration_connections c ON c.tenant_id = pic.tenant_id AND c.id = pic.connection_id
        WHERE pic.tenant_id = ${tenantId}::uuid AND pic.property_id = ${propertyId}::uuid
          AND pic.kind = 'PMS' AND pic.enabled = true AND c.provider = 'CLOCK_PMS'
      ) AS managed
    `;
    return rows[0]?.managed === true;
  }

  private async adjustBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: InventoryBookedUnitsInput,
    direction: 1 | -1,
  ): Promise<boolean> {
    const adjustment = this.bookedUnitsInput(input);
    if (direction === 1) {
      const typeRows = await tx.$queryRaw<Array<{ isPublished: boolean }>>`
        SELECT status = 'PUBLISHED'::"RoomTypeStatus" AS "isPublished"
        FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND id = ${adjustment.roomTypeId}::uuid
      `;
      if (!typeRows[0]?.isPublished) return false;
    }
    await this.lockBookedUnits(tx, tenantId, propertyId, adjustment.roomTypeId);
    if (
      direction === 1 &&
      (await this.roomTypeIsBlocked(tx, tenantId, propertyId, adjustment.roomTypeId, adjustment))
    )
      return false;

    const rows = await tx.$queryRaw<
      Array<{ staysOn: Date; availableUnits: number; bookedUnits: number }>
    >`
      SELECT stays_on AS "staysOn", available_units AS "availableUnits", booked_units AS "bookedUnits"
      FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid
        AND property_id = ${propertyId}::uuid
        AND room_type_id = ${adjustment.roomTypeId}::uuid
        AND stays_on >= ${adjustment.startsOn}::date
        AND stays_on < ${adjustment.endsOn}::date
      FOR UPDATE
    `;

    // A Clock-connected hotel never keeps local stock (Clock owns it), so there is nothing to
    // reserve or release here; Clock's own availability is confirmed before the booking is made.
    if (rows.length === 0 && (await this.stockManagedInClock(tx, tenantId, propertyId)))
      return true;

    const expectedNights = this.nightCount(adjustment.startsOn, adjustment.endsOn);
    const canAdjust =
      rows.length === expectedNights &&
      rows.every(({ availableUnits, bookedUnits }) =>
        direction === 1
          ? bookedUnits + adjustment.units <= availableUnits
          : bookedUnits - adjustment.units >= 0,
      );
    if (!canAdjust) return false;

    await tx.$executeRaw`
      UPDATE inventory_units
      SET booked_units = booked_units + ${direction * adjustment.units}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND property_id = ${propertyId}::uuid
        AND room_type_id = ${adjustment.roomTypeId}::uuid
        AND stays_on >= ${adjustment.startsOn}::date
        AND stays_on < ${adjustment.endsOn}::date
    `;
    return true;
  }

  private bookedUnitsInput(input: InventoryBookedUnitsInput): InventoryBookedUnitsInput {
    const range = this.input(input);
    if (!Number.isInteger(input.units) || input.units < 1)
      throw new BadRequestException('units must be a positive integer.');
    return { ...range, units: input.units };
  }

  private roomBookedInput(input: RoomBookedInput): RoomBookedInput {
    if (!input.roomId) throw new BadRequestException('roomId is required.');
    return { roomId: input.roomId, ...this.rangeInput(input) };
  }

  async unavailableRoomsForMove(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    query: { roomIds: string[]; startsOn: string; endsOn: string; excludeBookingId: string },
  ): Promise<string[]> {
    const unavailable: string[] = [];
    for (const roomId of query.roomIds) {
      if (
        !(await this.roomIsAvailable(
          tx,
          tenantId,
          propertyId,
          { roomId, startsOn: query.startsOn, endsOn: query.endsOn },
          query.excludeBookingId,
        ))
      )
        unavailable.push(roomId);
    }
    return unavailable;
  }

  private async roomIsAvailable(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: RoomBookedInput,
    excludeBookingId?: string,
    reasons?: string[],
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<
      Array<{ active: boolean; closed: boolean; booked: boolean; blocked: boolean }>
    >`
      SELECT
        EXISTS (
          SELECT 1 FROM rooms r
          WHERE r.tenant_id = ${tenantId}::uuid
            AND r.property_id = ${propertyId}::uuid
            AND r.id = ${input.roomId}::uuid
            AND r.is_active = true
        ) AS active
        , EXISTS (
          SELECT 1
          FROM room_availability
          WHERE tenant_id = ${tenantId}::uuid
            AND property_id = ${propertyId}::uuid
            AND room_id = ${input.roomId}::uuid
            AND stays_on >= ${input.startsOn}::date
            AND stays_on < ${input.endsOn}::date
            AND is_available = false
        ) AS closed
        , EXISTS (
          SELECT 1
          FROM bookings
          WHERE tenant_id = ${tenantId}::uuid
            AND property_id = ${propertyId}::uuid
            AND room_id = ${input.roomId}::uuid
            AND (${excludeBookingId ?? null}::uuid IS NULL OR id <> ${excludeBookingId ?? null}::uuid)
            AND starts_on < ${input.endsOn}::date
            AND ends_on > ${input.startsOn}::date
            AND status IN (
              'PAYMENT_PENDING'::"BookingStatus",
              'PAYMENT_NOT_REQUIRED'::"BookingStatus",
              'PMS_CREATION_PENDING'::"BookingStatus",
              'PMS_CONFIRMATION_PENDING'::"BookingStatus",
              'CONFIRMED'::"BookingStatus",
              'PAYMENT_FAILED'::"BookingStatus",
              'PMS_UNKNOWN_RESULT'::"BookingStatus",
              'PMS_REJECTED'::"BookingStatus",
              'MANUAL_REVIEW'::"BookingStatus"
            )
        ) AS booked
        , EXISTS (
          SELECT 1
          FROM availability_blocks ab
          WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = ${tenantId}::uuid
            AND ab.property_id = ${propertyId}::uuid
            AND ab.starts_on < ${input.endsOn}::date
            AND ab.ends_on > ${input.startsOn}::date
            AND (
              ab.blocks_all
              OR EXISTS (
                SELECT 1
                FROM availability_block_rooms abr
                WHERE abr.tenant_id = ab.tenant_id
                  AND abr.property_id = ab.property_id
                  AND abr.block_id = ab.id
                  AND abr.room_id = ${input.roomId}::uuid
              )
              OR EXISTS (
                SELECT 1
                FROM availability_block_room_types abrt
                JOIN rooms r
                  ON r.tenant_id = ${tenantId}::uuid
                  AND r.property_id = ${propertyId}::uuid
                  AND r.id = ${input.roomId}::uuid
                WHERE abrt.tenant_id = ab.tenant_id
                  AND abrt.property_id = ab.property_id
                  AND abrt.block_id = ab.id
                  AND abrt.room_type_id = r.room_type_id
              )
            )
        ) AS blocked
    `;
    const row = rows[0];
    if (row && reasons) {
      if (!row.active) reasons.push('Closed: this room is inactive.');
      if (row.closed || row.blocked) reasons.push('Blocked: a manual block overlaps these dates.');
      if (row.booked) reasons.push('Booked: another reservation overlaps these dates.');
    }
    return !!row && row.active && !row.closed && !row.booked && !row.blocked;
  }

  private async roomTypeIsBlocked(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    range: Pick<RoomBookedInput, 'startsOn' | 'endsOn'>,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ isBlocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM availability_blocks ab
        WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = ${tenantId}::uuid
          AND ab.property_id = ${propertyId}::uuid
          AND ab.starts_on < ${range.endsOn}::date
          AND ab.ends_on > ${range.startsOn}::date
          AND (
            ab.blocks_all
            OR EXISTS (
              SELECT 1
              FROM availability_block_room_types abrt
              WHERE abrt.tenant_id = ab.tenant_id
                AND abrt.property_id = ab.property_id
                AND abrt.block_id = ab.id
                AND abrt.room_type_id = ${roomTypeId}::uuid
            )
          )
      ) AS "isBlocked"
    `;
    return rows[0]?.isBlocked ?? false;
  }

  private nightCount(startsOn: string, endsOn: string): number {
    return (Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`)) / 86_400_000;
  }

  private date(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    return value;
  }

  private async requireRoomType(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<{ id: string; status: string }> {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status::text AS status FROM room_types
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Room type not found.');
    return rows[0];
  }

  async assertBookableSelection(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    roomId?: string,
  ) {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await this.requireRoomType(tx, tenantId, propertyId, roomTypeId);
      if (roomType.status !== 'PUBLISHED') throw new NotFoundException('Room type not found.');
      if (roomId) {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM rooms WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND id = ${roomId}::uuid AND room_type_id = ${roomTypeId}::uuid AND is_active = true
        `;
        if (!rows[0]) throw new NotFoundException('Room not found.');
      }
    });
  }

  private async requireRoom(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rooms
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Room not found.');
  }

  private async requireIndividualRoomMode(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ bookingMode: string }>>`
      SELECT booking_mode AS "bookingMode" FROM properties WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Property not found.');
    if (rows[0].bookingMode === 'ROOM_TYPE_ONLY')
      throw new BadRequestException(
        'Room-level availability is only available for individual-room properties.',
      );
  }
}

/** Local inventory cannot say why a day is closed, only that it is. */
function localCalendarDay(day: { date: string; isAvailable: boolean }): CalendarDay {
  return { ...day, status: day.isAvailable ? 'available' : 'unavailable' };
}
