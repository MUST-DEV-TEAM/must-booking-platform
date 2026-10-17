import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService } from './tenant-database.service';

export type RoomCategory = {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  storefrontVisible: boolean;
  roomCount: number;
};

@Injectable()
export class RoomCategoriesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  list(tenantId: string, propertyId: string): Promise<RoomCategory[]> {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<RoomCategory[]>`
        SELECT c.id, c.name, c.description, c.sort_order AS "sortOrder",
          c.storefront_visible AS "storefrontVisible", COUNT(rt.id)::int AS "roomCount"
        FROM room_categories c
        LEFT JOIN room_types rt ON rt.tenant_id = c.tenant_id
          AND rt.property_id = c.property_id AND rt.category_id = c.id
        WHERE c.tenant_id = ${tenantId}::uuid AND c.property_id = ${propertyId}::uuid
        GROUP BY c.id
        ORDER BY c.sort_order, c.name
      `,
    );
  }

  async create(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomCategory> {
    const input = this.input(body, false);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const orderRows = await tx.$queryRaw<Array<{ nextOrder: number }>>`
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS "nextOrder"
          FROM room_categories WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        `;
        const rows = await tx.$queryRaw<RoomCategory[]>`
          INSERT INTO room_categories (id, tenant_id, property_id, name, description, sort_order, storefront_visible)
          VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${input.name}, ${input.description},
            ${input.sortOrder ?? orderRows[0].nextOrder}, ${input.storefrontVisible ?? true})
          RETURNING id, name, description, sort_order AS "sortOrder",
            storefront_visible AS "storefrontVisible", 0::int AS "roomCount"
        `;
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room_category.created',
          targetType: 'room_category',
          targetId: id,
        });
        return rows[0];
      } catch (error: unknown) {
        this.throwUniqueConflict(error);
        throw error;
      }
    });
  }

  async update(
    tenantId: string,
    propertyId: string,
    categoryId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomCategory> {
    const input = this.input(body, true);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<RoomCategory[]>`
          UPDATE room_categories SET
            name = COALESCE(${input.name ?? null}, name),
            description = CASE WHEN ${input.descriptionProvided} THEN ${input.description ?? null} ELSE description END,
            sort_order = COALESCE(${input.sortOrder ?? null}, sort_order),
            storefront_visible = COALESCE(${input.storefrontVisible ?? null}, storefront_visible),
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${categoryId}::uuid
          RETURNING id, name, description, sort_order AS "sortOrder",
            storefront_visible AS "storefrontVisible",
            (SELECT COUNT(*)::int FROM room_types rt WHERE rt.tenant_id = ${tenantId}::uuid
              AND rt.property_id = ${propertyId}::uuid AND rt.category_id = room_categories.id) AS "roomCount"
        `;
        if (!rows[0]) throw new NotFoundException('Room category not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room_category.updated',
          targetType: 'room_category',
          targetId: categoryId,
        });
        return rows[0];
      } catch (error: unknown) {
        this.throwUniqueConflict(error);
        throw error;
      }
    });
  }

  async remove(
    tenantId: string,
    propertyId: string,
    categoryId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRaw`
        UPDATE room_types SET category_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND category_id = ${categoryId}::uuid
      `;
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM room_categories WHERE tenant_id = ${tenantId}::uuid
          AND property_id = ${propertyId}::uuid AND id = ${categoryId}::uuid RETURNING id
      `;
      if (!rows[0]) throw new NotFoundException('Room category not found.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_category.deleted',
        targetType: 'room_category',
        targetId: categoryId,
      });
    });
  }

  async reorder(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<void> {
    const categoryIds = (body as { categoryIds?: unknown } | null)?.categoryIds;
    if (
      !Array.isArray(categoryIds) ||
      categoryIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set(categoryIds).size !== categoryIds.length
    )
      throw new BadRequestException('categoryIds must be a unique ordered list of category IDs.');

    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const current = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_categories WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        ORDER BY sort_order, name
      `;
      if (
        current.length !== categoryIds.length ||
        current.some((category) => !categoryIds.includes(category.id))
      )
        throw new BadRequestException('categoryIds must include every category for this property.');
      for (const [sortOrder, id] of categoryIds.entries()) {
        await tx.$executeRaw`
          UPDATE room_categories SET sort_order = ${sortOrder}, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${id}::uuid
        `;
      }
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_category.reordered',
        targetType: 'room_category',
        targetId: propertyId,
      });
    });
  }

  private input(
    body: unknown,
    partial: boolean,
  ): {
    name?: string;
    description?: string | null;
    descriptionProvided: boolean;
    sortOrder?: number;
    storefrontVisible?: boolean;
  } {
    const value = (body ?? {}) as Record<string, unknown>;
    const name =
      value.name === undefined
        ? undefined
        : typeof value.name === 'string'
          ? value.name.trim()
          : '';
    const descriptionProvided = Object.prototype.hasOwnProperty.call(value, 'description');
    const description = descriptionProvided
      ? typeof value.description === 'string' && value.description.trim()
        ? value.description.trim()
        : null
      : undefined;
    const sortOrder = value.sortOrder === undefined ? undefined : value.sortOrder;
    const storefrontVisible =
      value.storefrontVisible === undefined ? undefined : value.storefrontVisible;
    if ((!partial && !name) || (name !== undefined && (!name || name.length > 200)))
      throw new BadRequestException('name is required and must be at most 200 characters.');
    if (sortOrder !== undefined && (!Number.isInteger(sortOrder) || (sortOrder as number) < 0))
      throw new BadRequestException('sortOrder must be a non-negative integer.');
    if (storefrontVisible !== undefined && typeof storefrontVisible !== 'boolean')
      throw new BadRequestException('storefrontVisible must be a boolean.');
    if (description !== undefined && typeof description === 'string' && description.length > 2000)
      throw new BadRequestException('description must be at most 2,000 characters.');
    return {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      descriptionProvided,
      ...(sortOrder !== undefined ? { sortOrder: sortOrder as number } : {}),
      ...(storefrontVisible !== undefined
        ? { storefrontVisible: storefrontVisible as boolean }
        : {}),
    };
  }

  private throwUniqueConflict(error: unknown): void {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    )
      throw new ConflictException('A category with this name already exists for this property.');
  }
}
