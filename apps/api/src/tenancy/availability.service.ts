import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

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

export type InventoryBookedUnitsInput = {
  roomTypeId: string;
  startsOn: string;
  endsOn: string;
  units: number;
};

@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
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
        SELECT MIN(
          COALESCE(inventory_units.available_units, 0) - COALESCE(inventory_units.booked_units, 0)
        )::integer AS "availableUnits"
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
      const rows = await tx.$queryRaw<Array<{ isAvailable: boolean | null }>>`
        WITH requested_nights AS (
          SELECT generate_series(
            ${input.startsOn}::date,
            ${input.endsOn}::date - 1,
            INTERVAL '1 day'
          )::date AS stays_on
        )
        SELECT bool_and(COALESCE(room_availability.is_available, true)) AS "isAvailable"
        FROM requested_nights
        LEFT JOIN room_availability
          ON room_availability.tenant_id = ${tenantId}::uuid
          AND room_availability.property_id = ${propertyId}::uuid
          AND room_availability.room_id = ${roomId}::uuid
          AND room_availability.stays_on = requested_nights.stays_on
      `;
      return {
        roomId,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        isAvailable: rows[0]?.isAvailable ?? false,
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

  private async adjustBookedUnits(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    input: InventoryBookedUnitsInput,
    direction: 1 | -1,
  ): Promise<boolean> {
    const adjustment = this.bookedUnitsInput(input);
    await this.lockBookedUnits(tx, tenantId, propertyId, adjustment.roomTypeId);

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
