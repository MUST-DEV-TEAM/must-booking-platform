import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { ClockAvailabilityService } from '../integrations/clock/clock-availability.service';

type Availability = {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  isAvailable: boolean;
  availableUnits: number;
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
type AvailabilityBlockInput = {
  startsOn: string;
  endsOn: string;
  all: boolean;
  roomTypeIds: string[];
  roomIds: string[];
};
type AvailabilityBlock = AvailabilityBlockInput & { id: string };

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
  ) {}

  async getAvailability(
    tenantId: string,
    propertyId: string,
    query: unknown,
  ): Promise<Availability> {
    const input = this.input(query);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRoomType(tx, tenantId, propertyId, input.roomTypeId);
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
            WHERE ab.tenant_id = ${tenantId}::uuid
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
      const availableUnits = rows[0]?.availableUnits ?? 0;
      return {
        roomTypeId: input.roomTypeId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        availableUnits,
        isAvailable: availableUnits > 0,
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
    query: { roomTypeId: string; roomId?: string; month: string },
  ): Promise<{ days: Array<{ date: string; isAvailable: boolean }> }> {
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
          { roomTypeId: query.roomTypeId, month: query.month },
        );
        if (!calendar.ok) throw new BadRequestException(calendar.error.message);
        return { days: calendar.value };
      }
    }
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRoomType(tx, tenantId, propertyId, query.roomTypeId);
      if (query.roomId) {
        await this.requireIndividualRoomMode(tx, propertyId);
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
              WHERE ab.tenant_id = ${tenantId}::uuid AND ab.property_id = ${propertyId}::uuid
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
        return { days };
      }

      const days = await tx.$queryRaw<Array<{ date: string; isAvailable: boolean }>>`
        WITH month_days AS (
          SELECT generate_series(${start}::date, ${end}::date - INTERVAL '1 day', INTERVAL '1 day')::date AS stays_on
        )
        SELECT month_days.stays_on::text AS date,
          (CASE WHEN EXISTS (
            SELECT 1 FROM availability_blocks ab
            WHERE ab.tenant_id = ${tenantId}::uuid AND ab.property_id = ${propertyId}::uuid
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
      return { days };
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
    const input = this.inventoryInput(body);
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRoomType(tx, tenantId, propertyId, input.roomTypeId);
      await tx.$executeRaw`
        INSERT INTO inventory_units (tenant_id, property_id, room_type_id, stays_on, available_units)
        SELECT
          ${tenantId}::uuid,
          ${propertyId}::uuid,
          ${input.roomTypeId}::uuid,
          requested_nights.stays_on::date,
          ${input.availableUnits}
        FROM generate_series(
          ${input.startsOn}::date,
          ${input.endsOn}::date - 1,
          INTERVAL '1 day'
        ) AS requested_nights(stays_on)
        ON CONFLICT (tenant_id, property_id, room_type_id, stays_on)
        DO UPDATE SET available_units = EXCLUDED.available_units, updated_at = CURRENT_TIMESTAMP
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'inventory_units.set',
        targetType: 'room_type',
        targetId: input.roomTypeId,
      });
    });
  }

  async getRoomAvailability(
    tenantId: string,
    propertyId: string,
    roomId: string,
    query: unknown,
  ): Promise<RoomAvailability> {
    const input = this.rangeInput(query);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireIndividualRoomMode(tx, propertyId);
      await this.requireRoom(tx, tenantId, propertyId, roomId);
      return {
        roomId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        isAvailable: await this.roomIsAvailable(tx, tenantId, propertyId, { roomId, ...input }),
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
      await this.requireIndividualRoomMode(tx, propertyId);
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
      if (input.roomIds.length > 0) await this.requireIndividualRoomMode(tx, propertyId);
      for (const roomTypeId of input.roomTypeIds)
        await this.requireRoomType(tx, tenantId, propertyId, roomTypeId);
      for (const roomId of input.roomIds) await this.requireRoom(tx, tenantId, propertyId, roomId);

      await tx.$executeRaw`
        INSERT INTO availability_blocks (id, tenant_id, property_id, starts_on, ends_on, blocks_all)
        VALUES (
          ${id}::uuid,
          ${tenantId}::uuid,
          ${propertyId}::uuid,
          ${input.startsOn}::date,
          ${input.endsOn}::date,
          ${input.all}
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

  async reserveBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: InventoryBookedUnitsInput,
  ): Promise<boolean> {
    return this.adjustBookedUnits(tx, tenantId, propertyId, input, 1);
  }

  async lockBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<void> {
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
    return this.roomIsAvailable(tx, tenantId, propertyId, reservation);
  }

  async lockRoom(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomId: string,
  ): Promise<void> {
    const roomLockKey = `${tenantId}:${propertyId}:${roomId}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${roomLockKey}, 0))
    `;
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
    if (endsOn <= startsOn) throw new BadRequestException('endsOn must be after startsOn.');
    return { startsOn, endsOn };
  }

  private inventoryInput(body: unknown): InventoryInput {
    const input = this.input(body);
    const value = (body ?? {}) as Record<string, unknown>;
    const availableUnits = typeof value.availableUnits === 'number' ? value.availableUnits : NaN;
    if (!Number.isInteger(availableUnits) || availableUnits < 0)
      throw new BadRequestException('availableUnits must be a non-negative integer.');
    return { ...input, availableUnits };
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
    return { ...range, all, roomTypeIds, roomIds };
  }

  private targetIds(value: unknown, field: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !id))
      throw new BadRequestException(`${field} must be an array of IDs.`);
    if (new Set(value).size !== value.length)
      throw new BadRequestException(`${field} must not contain duplicate IDs.`);
    return value;
  }

  private async adjustBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: InventoryBookedUnitsInput,
    direction: 1 | -1,
  ): Promise<boolean> {
    const adjustment = this.bookedUnitsInput(input);
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

  private async roomIsAvailable(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: RoomBookedInput,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ isAvailable: boolean }>>`
      SELECT
        NOT EXISTS (
          SELECT 1
          FROM room_availability
          WHERE tenant_id = ${tenantId}::uuid
            AND property_id = ${propertyId}::uuid
            AND room_id = ${input.roomId}::uuid
            AND stays_on >= ${input.startsOn}::date
            AND stays_on < ${input.endsOn}::date
            AND is_available = false
        )
        AND NOT EXISTS (
          SELECT 1
          FROM bookings
          WHERE tenant_id = ${tenantId}::uuid
            AND property_id = ${propertyId}::uuid
            AND room_id = ${input.roomId}::uuid
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
        )
        AND NOT EXISTS (
          SELECT 1
          FROM availability_blocks ab
          WHERE ab.tenant_id = ${tenantId}::uuid
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
        ) AS "isAvailable"
    `;
    return rows[0]?.isAvailable ?? false;
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
        WHERE ab.tenant_id = ${tenantId}::uuid
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
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_types
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Room type not found.');
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

  private async requireIndividualRoomMode(tx: TenantTransaction, propertyId: string) {
    const rows = await tx.$queryRaw<Array<{ bookingMode: string }>>`
      SELECT booking_mode AS "bookingMode" FROM properties WHERE id = ${propertyId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Property not found.');
    if (rows[0].bookingMode === 'ROOM_TYPE_ONLY')
      throw new BadRequestException(
        'Room-level availability is only available for individual-room properties.',
      );
  }
}
