import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { TenantDatabaseService } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';

type Room = {
  id: string;
  name: string;
  title: string | null;
  roomSize: string | null;
  rules: string | null;
  description: string | null;
  floor: number | null;
  viewType: string | null;
};
type RoomWithType = Room & { roomTypeId: string; roomTypeName: string };

@Injectable()
export class RoomsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  list(tenantId: string, propertyId: string, roomTypeId: string): Promise<Room[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) => tx.$queryRaw<Room[]>`
        SELECT id, name, title, room_size AS "roomSize", rules, description, floor, view_type AS "viewType"
        FROM rooms
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
        ORDER BY created_at
      `,
    );
  }

  /** Every room across every room type — the walk-in booking form's "All"
   * room-type option needs a flat list to pick an individual room from,
   * unlike list() above which is scoped to one room type at a time. */
  listAll(tenantId: string, propertyId: string): Promise<RoomWithType[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) => tx.$queryRaw<RoomWithType[]>`
        SELECT r.id, r.name, r.title, r.room_size AS "roomSize", r.rules, r.description, r.floor, r.view_type AS "viewType", r.room_type_id AS "roomTypeId",
          rt.name AS "roomTypeName"
        FROM rooms r
        JOIN room_types rt ON rt.tenant_id = r.tenant_id AND rt.id = r.room_type_id
        WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid
        ORDER BY rt.name, r.name
      `,
    );
  }

  async create(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<Room> {
    const input = this.input(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
      `;
      if (!roomType[0]) throw new NotFoundException('Room type not found.');
      try {
        const rows = await tx.$queryRaw<Room[]>`
          INSERT INTO rooms (id, tenant_id, property_id, room_type_id, name, title, room_size, rules, description, floor, view_type)
          VALUES (
            ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
            ${input.name}, ${input.title}, ${input.roomSize}, ${input.rules}, ${input.description}, ${input.floor}, ${input.viewType}
          )
          RETURNING id, name, title, room_size AS "roomSize", rules, description, floor, view_type AS "viewType"
        `;
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room.created',
          targetType: 'room',
          targetId: id,
        });
        return rows[0];
      } catch (error: unknown) {
        if (this.isUniqueViolation(error))
          throw new ConflictException('A room with this name already exists for this property.');
        throw error;
      }
    });
  }

  async update(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<Room> {
    const input = this.input(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<Room[]>`
          UPDATE rooms
          SET name = ${input.name}, title = ${input.title}, room_size = ${input.roomSize}, rules = ${input.rules}, description = ${input.description},
            floor = ${input.floor}, view_type = ${input.viewType},
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
          RETURNING id, name, title, room_size AS "roomSize", rules, description, floor, view_type AS "viewType"
        `;
        if (!rows[0]) throw new NotFoundException('Room not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room.updated',
          targetType: 'room',
          targetId: roomId,
        });
        return rows[0];
      } catch (error: unknown) {
        if (this.isUniqueViolation(error))
          throw new ConflictException('A room with this name already exists for this property.');
        throw error;
      }
    });
  }

  async remove(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          DELETE FROM rooms
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
          RETURNING id
        `;
        if (!rows[0]) throw new NotFoundException('Room not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room.deleted',
          targetType: 'room',
          targetId: roomId,
        });
      } catch (error: unknown) {
        if (this.isForeignKeyViolation(error))
          throw new ConflictException(
            'Cannot delete a room with assigned amenities or other dependent records.',
          );
        throw error;
      }
    });
  }

  private input(body: unknown): {
    name: string;
    title: string | null;
    roomSize: string | null;
    rules: string | null;
    description: string | null;
    floor: number | null;
    viewType: string | null;
  } {
    const v = (body ?? {}) as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    if (!name) throw new BadRequestException('name is required.');
    if (name.length > 200) throw new BadRequestException('name must be at most 200 characters.');
    const title = typeof v.title === 'string' && v.title.trim() ? v.title.trim() : null;
    if (title && title.length > 200)
      throw new BadRequestException('title must be at most 200 characters.');
    const roomSize = typeof v.roomSize === 'string' && v.roomSize.trim() ? v.roomSize.trim() : null;
    if (roomSize && roomSize.length > 50)
      throw new BadRequestException('roomSize must be at most 50 characters.');
    const rules = typeof v.rules === 'string' && v.rules.trim() ? v.rules.trim() : null;
    const description =
      typeof v.description === 'string' && v.description.trim() ? v.description.trim() : null;
    const floor = this.floor(v.floor);
    const viewType = typeof v.viewType === 'string' && v.viewType.trim() ? v.viewType.trim() : null;
    if (viewType && viewType.length > 100)
      throw new BadRequestException('viewType must be at most 100 characters.');
    return { name, title, roomSize, rules, description, floor, viewType };
  }

  private floor(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < -10 || value > 200)
      throw new BadRequestException('floor must be an integer between -10 and 200.');
    return value;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    );
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23503'
    );
  }
}
