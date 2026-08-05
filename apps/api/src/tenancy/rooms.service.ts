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

type Room = { id: string; name: string };
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
        SELECT id, name
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
        SELECT r.id, r.name, r.room_type_id AS "roomTypeId", rt.name AS "roomTypeName"
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
    const name = this.name(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
      `;
      if (!roomType[0]) throw new NotFoundException('Room type not found.');
      try {
        const rows = await tx.$queryRaw<Room[]>`
          INSERT INTO rooms (id, tenant_id, property_id, room_type_id, name)
          VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${name})
          RETURNING id, name
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
    const name = this.name(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<Room[]>`
          UPDATE rooms
          SET name = ${name}, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
          RETURNING id, name
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
    });
  }

  private name(body: unknown): string {
    const v = (body ?? {}) as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    if (!name) throw new BadRequestException('name is required.');
    if (name.length > 200) throw new BadRequestException('name must be at most 200 characters.');
    return name;
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
}
