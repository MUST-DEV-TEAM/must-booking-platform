import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

const AMENITY_ICONS = ['WIFI', 'BREAKFAST', 'POOL', 'PARKING', 'AIR_CONDITIONING', 'BEACH'] as const;
type AmenityIcon = (typeof AMENITY_ICONS)[number];
type Amenity = { id: string; name: string; icon: AmenityIcon | null };

@Injectable()
export class AmenitiesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  list(tenantId: string, propertyId: string): Promise<Amenity[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) => tx.$queryRaw<Amenity[]>`
        SELECT id, name, icon::text AS icon FROM amenities
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        ORDER BY name
      `,
    );
  }

  async create(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<Amenity> {
    const input = this.input(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<Amenity[]>`
          INSERT INTO amenities (id, tenant_id, property_id, name, icon)
          VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${input.name}, ${input.icon}::"AmenityIcon")
          RETURNING id, name, icon::text AS icon
        `;
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'amenity.created',
          targetType: 'amenity',
          targetId: id,
        });
        return rows[0];
      } catch (error: unknown) {
        if (this.isUniqueViolation(error))
          throw new ConflictException(
            'An amenity with this name already exists for this property.',
          );
        throw error;
      }
    });
  }

  async remove(
    tenantId: string,
    propertyId: string,
    amenityId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          DELETE FROM amenities
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${amenityId}::uuid
          RETURNING id
        `;
        if (!rows[0]) throw new NotFoundException('Amenity not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'amenity.deleted',
          targetType: 'amenity',
          targetId: amenityId,
        });
      } catch (error: unknown) {
        if (this.isForeignKeyViolation(error))
          throw new ConflictException('Cannot delete an amenity that is assigned to a room type.');
        throw error;
      }
    });
  }

  async listRoomTypeAmenities(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<Amenity[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRoomType(tx, tenantId, propertyId, roomTypeId);
      return tx.$queryRaw<Amenity[]>`
        SELECT amenities.id, amenities.name, amenities.icon::text AS icon
        FROM room_type_amenities
        INNER JOIN amenities
          ON amenities.tenant_id = room_type_amenities.tenant_id
          AND amenities.property_id = room_type_amenities.property_id
          AND amenities.id = room_type_amenities.amenity_id
        WHERE room_type_amenities.tenant_id = ${tenantId}::uuid
          AND room_type_amenities.property_id = ${propertyId}::uuid
          AND room_type_amenities.room_type_id = ${roomTypeId}::uuid
        ORDER BY amenities.name
      `;
    });
  }

  async setRoomTypeAmenities(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<Amenity[]> {
    const amenityIds = this.amenityIds(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.requireRoomType(tx, tenantId, propertyId, roomTypeId);
      if (amenityIds.length > 0) {
        const existing = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM amenities
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND id = ANY(${amenityIds}::uuid[])
        `;
        if (existing.length !== amenityIds.length)
          throw new NotFoundException('Amenity not found.');
      }
      await tx.$executeRaw`
        DELETE FROM room_type_amenities
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
      `;
      for (const amenityId of amenityIds) {
        await tx.$executeRaw`
          INSERT INTO room_type_amenities (tenant_id, property_id, room_type_id, amenity_id)
          VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${amenityId}::uuid)
        `;
      }
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_type.amenities_updated',
        targetType: 'room_type',
        targetId: roomTypeId,
      });
      return this.listRoomTypeAmenitiesInTransaction(tx, tenantId, propertyId, roomTypeId);
    });
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

  private listRoomTypeAmenitiesInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<Amenity[]> {
    return tx.$queryRaw<Amenity[]>`
      SELECT amenities.id, amenities.name, amenities.icon::text AS icon
      FROM room_type_amenities
      INNER JOIN amenities
        ON amenities.tenant_id = room_type_amenities.tenant_id
        AND amenities.property_id = room_type_amenities.property_id
        AND amenities.id = room_type_amenities.amenity_id
      WHERE room_type_amenities.tenant_id = ${tenantId}::uuid
        AND room_type_amenities.property_id = ${propertyId}::uuid
        AND room_type_amenities.room_type_id = ${roomTypeId}::uuid
      ORDER BY amenities.name
    `;
  }

  private input(body: unknown): { name: string; icon: AmenityIcon | null } {
    const value = (body ?? {}) as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!name) throw new BadRequestException('name is required.');
    if (name.length > 100) throw new BadRequestException('name must be at most 100 characters.');
    const icon = value.icon === undefined || value.icon === null || value.icon === '' ? null : value.icon;
    if (icon !== null && (!AMENITY_ICONS.includes(icon as AmenityIcon)))
      throw new BadRequestException(`icon must be one of: ${AMENITY_ICONS.join(', ')}.`);
    return { name, icon: icon as AmenityIcon | null };
  }

  private amenityIds(body: unknown): string[] {
    const value = (body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(value.amenityIds) || !value.amenityIds.every((id) => typeof id === 'string'))
      throw new BadRequestException('amenityIds must be an array of amenity IDs.');
    const amenityIds = value.amenityIds as string[];
    if (new Set(amenityIds).size !== amenityIds.length)
      throw new BadRequestException('amenityIds must not contain duplicates.');
    return amenityIds;
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
