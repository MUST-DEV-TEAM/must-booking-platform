import { pricingContext, pricingFacts } from './pricing.repository';
import { pricingHealth } from './pricing-health';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import {
  roomTypeImagePresentation,
  type RoomTypeImageProjectionRow,
} from './room-type-image-projection';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.provider';
import { resolveEffectiveHouseRules } from './effective-house-rules';

type RoomType = {
  id: string;
  name: string;
  description: string | null;
  amenitiesIntro: string | null;
  rules: string | null;
  effectiveRules?: string | null;
  rulesSource?: 'room-type' | null;
  mainImageUrl: string | null;
  galleryImageUrls: string[];
  maxOccupancy: number;
  roomCount: number;
  status: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  categoryId: string | null;
  categoryName: string | null;
  readiness?: RoomTypeReadiness;
};
type ReadinessKey =
  | 'basicInfo'
  | 'occupancy'
  | 'rateRule'
  | 'rooms'
  | 'availabilitySource'
  | 'photos'
  | 'inventoryConflict';
type RoomTypeReadiness = {
  checks: Array<{ key: ReadinessKey; label: string; complete: boolean; fixLabel: string }>;
  completeCount: number;
  missingCount: number;
  isComplete: boolean;
  firstFix: { key: ReadinessKey; label: string } | null;
};
type RoomTypeReadinessRow = {
  hasBasicInfo: boolean;
  hasOccupancy: boolean;
  hasRateRule: boolean;
  hasRooms: boolean;
  hasAvailabilitySource: boolean;
  hasPhotos: boolean;
  hasInventoryConflict: boolean;
};
type RoomTypeListRow = RoomType & RoomTypeReadinessRow;
type RoomTypeImage = {
  id: string;
  url: string;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
};
type ImageUpload = { id: string; uploadUrl: string; publicUrl: string };
type LibraryImage = {
  id: string;
  url: string;
  originalName: string | null;
  createdAt: Date;
  usageCount: number;
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// One main photo plus up to 20 more.
const MAX_ROOM_TYPE_IMAGES = 21;

@Injectable()
export class RoomTypesService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  list(tenantId: string, propertyId: string): Promise<RoomType[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomTypes = await tx.$queryRaw<RoomTypeListRow[]>`
        SELECT rt.id, rt.name, rt.description, rt.amenities_intro AS "amenitiesIntro", rt.rules,
          rt.max_occupancy AS "maxOccupancy", rt.status::text AS status,
          rt.category_id AS "categoryId", category.name AS "categoryName", count(r.id)::int AS "roomCount",
          (NULLIF(BTRIM(rt.name), '') IS NOT NULL AND NULLIF(BTRIM(rt.description), '') IS NOT NULL) AS "hasBasicInfo",
          (rt.max_occupancy > 0) AS "hasOccupancy",
          EXISTS (SELECT 1 FROM rate_rules rr WHERE rr.tenant_id = rt.tenant_id
            AND rr.property_id = rt.property_id AND rr.room_type_id = rt.id) AS "hasRateRule",
          EXISTS (SELECT 1 FROM rooms rr WHERE rr.tenant_id = rt.tenant_id
            AND rr.property_id = rt.property_id AND rr.room_type_id = rt.id) AS "hasRooms",
          (NOT EXISTS (
            SELECT 1 FROM property_integration_connections pic
            JOIN integration_connections c ON c.tenant_id = pic.tenant_id AND c.id = pic.connection_id
            WHERE pic.tenant_id = rt.tenant_id AND pic.property_id = rt.property_id
              AND pic.enabled = true AND c.kind = 'PMS' AND c.status = 'CONNECTED'
          ) OR EXISTS (
            SELECT 1 FROM clock_catalog_mappings cm
            JOIN property_integration_connections pic ON pic.tenant_id = cm.tenant_id
              AND pic.property_id = cm.property_id AND pic.connection_id = cm.connection_id AND pic.enabled = true
            JOIN integration_connections c ON c.tenant_id = cm.tenant_id AND c.id = cm.connection_id
            WHERE cm.tenant_id = rt.tenant_id AND cm.property_id = rt.property_id
              AND cm.entity_type = 'ROOM_TYPE' AND cm.local_entity_id = rt.id
              AND cm.sync_status = 'CONFIRMED' AND c.kind = 'PMS' AND c.provider = 'CLOCK_PMS' AND c.status = 'CONNECTED'
          )) AS "hasAvailabilitySource",
          EXISTS (SELECT 1 FROM room_type_images image WHERE image.tenant_id = rt.tenant_id
            AND image.property_id = rt.property_id AND image.room_type_id = rt.id) AS "hasPhotos",
          (EXISTS (
            SELECT 1 FROM clock_catalog_mappings cm
            JOIN property_integration_connections pic ON pic.tenant_id = cm.tenant_id
              AND pic.property_id = cm.property_id AND pic.connection_id = cm.connection_id AND pic.enabled = true
            JOIN integration_connections c ON c.tenant_id = cm.tenant_id AND c.id = cm.connection_id
            WHERE cm.tenant_id = rt.tenant_id AND cm.property_id = rt.property_id
              AND cm.entity_type = 'ROOM_TYPE' AND cm.local_entity_id = rt.id
              AND cm.sync_status = 'CONFIRMED' AND c.kind = 'PMS' AND c.provider = 'CLOCK_PMS' AND c.status = 'CONNECTED'
            GROUP BY cm.local_entity_id HAVING COUNT(*) > 1
          ) OR EXISTS (
            SELECT 1 FROM clock_catalog_mappings cm
            JOIN rooms mapped_room ON mapped_room.tenant_id = cm.tenant_id
              AND mapped_room.property_id = cm.property_id AND mapped_room.id = cm.local_entity_id
            JOIN property_integration_connections pic ON pic.tenant_id = cm.tenant_id
              AND pic.property_id = cm.property_id AND pic.connection_id = cm.connection_id AND pic.enabled = true
            JOIN integration_connections c ON c.tenant_id = cm.tenant_id AND c.id = cm.connection_id
            WHERE cm.tenant_id = rt.tenant_id AND cm.property_id = rt.property_id
              AND cm.entity_type = 'ROOM' AND mapped_room.room_type_id = rt.id
              AND cm.sync_status = 'CONFIRMED' AND c.kind = 'PMS' AND c.provider = 'CLOCK_PMS' AND c.status = 'CONNECTED'
            GROUP BY cm.local_entity_id HAVING COUNT(*) > 1
          )) AS "hasInventoryConflict"
        FROM room_types rt
        LEFT JOIN rooms r ON r.tenant_id = rt.tenant_id AND r.room_type_id = rt.id
        LEFT JOIN room_categories category ON category.tenant_id = rt.tenant_id
          AND category.property_id = rt.property_id AND category.id = rt.category_id
        WHERE rt.tenant_id = ${tenantId}::uuid AND rt.property_id = ${propertyId}::uuid
        GROUP BY rt.id, category.name
        ORDER BY rt.created_at
      `;
      const images = await this.roomTypeImageRows(tx, tenantId, propertyId);
      const imagesByRoomType = new Map<string, RoomTypeImageProjectionRow[]>();
      for (const image of images) {
        const roomTypeImages = imagesByRoomType.get(image.roomTypeId) ?? [];
        roomTypeImages.push(image);
        imagesByRoomType.set(image.roomTypeId, roomTypeImages);
      }
      const pricing = await pricingContext(tx, tenantId, propertyId);
      const priceReadiness = pricing.readOnly
        ? null
        : pricingHealth(
            await pricingFacts(tx, tenantId, propertyId),
            roomTypes,
            pricing.today,
            pricing.advanceBookingDays,
          ).readiness;
      return roomTypes.map((roomType) => {
        const readiness = this.readiness({
          ...roomType,
          hasRateRule: priceReadiness ? priceReadiness[roomType.id] === true : roomType.hasRateRule,
        });
        const houseRules = resolveEffectiveHouseRules(null, roomType.rules);
        return {
          ...roomType,
          rules: houseRules.effectiveRules,
          effectiveRules: houseRules.effectiveRules,
          rulesSource: houseRules.effectiveRules ? 'room-type' : null,
          readiness,
          ...roomTypeImagePresentation(imagesByRoomType.get(roomType.id) ?? [], (key) =>
            this.storage.publicUrl(key),
          ),
        };
      });
    });
  }

  async create(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomType> {
    const input = this.input(body);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        if (input.categoryId)
          await this.requireCategory(tx, tenantId, propertyId, input.categoryId);
        const rows = await tx.$queryRaw<RoomType[]>`
          INSERT INTO room_types (
            id, tenant_id, property_id, name, description, amenities_intro, rules, main_image_url, gallery_image_urls, max_occupancy, category_id
          )
          VALUES (
            ${id}::uuid,
            ${tenantId}::uuid,
            ${propertyId}::uuid,
            ${input.name},
            ${input.description},
            ${input.amenitiesIntro},
            ${input.rules},
            NULL,
            ARRAY[]::varchar(2000)[],
            ${input.maxOccupancy},
            ${input.categoryId ?? null}::uuid
          )
          RETURNING id, name, description, amenities_intro AS "amenitiesIntro", rules, main_image_url AS "mainImageUrl",
            gallery_image_urls AS "galleryImageUrls", max_occupancy AS "maxOccupancy", status::text AS status,
            category_id AS "categoryId", NULL::text AS "categoryName"
        `;
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room_type.created',
          targetType: 'room_type',
          targetId: id,
        });
        const images = await this.roomTypeImageRows(tx, tenantId, propertyId, id);
        const houseRules = resolveEffectiveHouseRules(null, rows[0].rules);
        return {
          ...rows[0],
          rules: houseRules.effectiveRules,
          effectiveRules: houseRules.effectiveRules,
          rulesSource: houseRules.effectiveRules ? 'room-type' : null,
          ...roomTypeImagePresentation(images, (key) => this.storage.publicUrl(key)),
        };
      } catch (error: unknown) {
        if (this.isUniqueViolation(error))
          throw new ConflictException(
            'A room type with this name already exists for this property.',
          );
        throw error;
      }
    });
  }

  async update(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomType> {
    const input = this.input(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        if (input.categoryId)
          await this.requireCategory(tx, tenantId, propertyId, input.categoryId);
        const currentRows = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT status::text AS status FROM room_types
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
        `;
        if (!currentRows[0]) throw new NotFoundException('Room type not found.');
        const rows = await tx.$queryRaw<RoomType[]>`
          UPDATE room_types
          SET
            name = ${input.name},
            description = ${input.description},
            amenities_intro = ${input.amenitiesIntro},
            rules = CASE WHEN ${input.hasRules} THEN ${input.rules} ELSE rules END,
            max_occupancy = ${input.maxOccupancy},
            category_id = CASE WHEN ${input.categoryId !== undefined} THEN ${input.categoryId ?? null}::uuid ELSE category_id END,
            status = COALESCE(${input.status ?? null}::"RoomTypeStatus", status),
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
          RETURNING id, name, description, amenities_intro AS "amenitiesIntro", rules, main_image_url AS "mainImageUrl",
            gallery_image_urls AS "galleryImageUrls", max_occupancy AS "maxOccupancy", status::text AS status,
            category_id AS "categoryId", NULL::text AS "categoryName"
        `;
        if (!rows[0]) throw new NotFoundException('Room type not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room_type.updated',
          targetType: 'room_type',
          targetId: roomTypeId,
        });
        if (input.status && input.status !== currentRows[0].status) {
          await this.audit.recordInTransaction(tx, {
            tenantId,
            propertyId,
            actorUserId,
            action: 'room_type.status_changed',
            targetType: 'room_type',
            targetId: roomTypeId,
            details: { from: currentRows[0].status, to: input.status },
          });
        }
        const images = await this.roomTypeImageRows(tx, tenantId, propertyId, roomTypeId);
        const houseRules = resolveEffectiveHouseRules(null, rows[0].rules);
        return {
          ...rows[0],
          rules: houseRules.effectiveRules,
          effectiveRules: houseRules.effectiveRules,
          rulesSource: houseRules.effectiveRules ? 'room-type' : null,
          ...roomTypeImagePresentation(images, (key) => this.storage.publicUrl(key)),
        };
      } catch (error: unknown) {
        if (this.isUniqueViolation(error))
          throw new ConflictException(
            'A room type with this name already exists for this property.',
          );
        throw error;
      }
    });
  }

  async remove(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
          DELETE FROM room_types
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
          RETURNING id, name
        `;
        if (!rows[0]) throw new NotFoundException('Room type not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room_type.deleted',
          targetType: 'room_type',
          targetId: roomTypeId,
          details: { targetName: rows[0].name },
        });
      } catch (error: unknown) {
        if (this.isForeignKeyViolation(error))
          throw new ConflictException(
            'Cannot delete a room type that still has rooms, rate rules, or images.',
          );
        throw error;
      }
    });
  }

  async createImageUpload(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<ImageUpload> {
    const input = this.imageInput(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
        FOR UPDATE
      `;
      if (!roomType[0]) throw new NotFoundException('Room type not found.');

      const countRows = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
      `;
      if (countRows[0].count >= MAX_ROOM_TYPE_IMAGES)
        throw new BadRequestException(
          `A room type can have at most ${MAX_ROOM_TYPE_IMAGES} photos.`,
        );
      const orderRows = await tx.$queryRaw<Array<{ nextOrder: number }>>`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS "nextOrder" FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
      `;

      const extension = this.storage.uploadExtension ?? input.contentType.split('/')[1];
      const objectKey = `room-types/${tenantId}/${propertyId}/${roomTypeId}/${randomUUID()}.${extension}`;
      const { uploadUrl } = await this.storage.createPresignedUpload({
        key: objectKey,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });

      await tx.$executeRaw`
        INSERT INTO property_library_images (tenant_id, property_id, object_key, confirmed_at)
        VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${objectKey}, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, property_id, object_key) DO NOTHING
      `;
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO room_type_images (id, tenant_id, property_id, room_type_id, object_key, sort_order, is_primary)
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${objectKey}, ${orderRows[0].nextOrder}, ${countRows[0].count === 0}
        )
      `;
      await this.syncImageFields(tx, tenantId, propertyId, roomTypeId);
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_type_image.created',
        targetType: 'room_type_image',
        targetId: id,
        details: { roomTypeId },
      });

      return { id, uploadUrl, publicUrl: this.storage.publicUrl(objectKey) };
    });
  }

  listImages(tenantId: string, propertyId: string, roomTypeId: string): Promise<RoomTypeImage[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          objectKey: string | null;
          sourceUrl: string | null;
          sortOrder: number;
          isPrimary: boolean;
          createdAt: Date;
        }>
      >`
        SELECT id, object_key AS "objectKey", source_url AS "sourceUrl", sort_order AS "sortOrder",
          is_primary AS "isPrimary", created_at AS "createdAt"
        FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
        ORDER BY sort_order, created_at, id
      `;
      return rows.map((row) => ({
        id: row.id,
        url: row.sourceUrl ?? this.storage.publicUrl(row.objectKey!),
        sortOrder: row.sortOrder,
        isPrimary: row.isPrimary,
        createdAt: row.createdAt,
      }));
    });
  }

  async createImageFromUrl(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomTypeImage> {
    const value = (body ?? {}) as Record<string, unknown>;
    const url = this.imageUrl(value.url, 'url');
    if (!url) throw new BadRequestException('url is required.');

    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
        FOR UPDATE
      `;
      if (!roomType[0]) throw new NotFoundException('Room type not found.');
      const duplicateRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid AND source_url = ${url}
      `;
      if (duplicateRows[0])
        throw new ConflictException('This photo URL is already in the gallery.');
      const orderRows = await tx.$queryRaw<Array<{ count: number; nextOrder: number }>>`
        SELECT COUNT(*)::int AS count, COALESCE(MAX(sort_order), -1) + 1 AS "nextOrder"
        FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
      `;
      if (orderRows[0].count >= MAX_ROOM_TYPE_IMAGES)
        throw new BadRequestException(
          `A room type can have at most ${MAX_ROOM_TYPE_IMAGES} photos.`,
        );

      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO room_type_images (id, tenant_id, property_id, room_type_id, source_url, sort_order, is_primary)
        VALUES (
          ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${url}, ${orderRows[0].nextOrder}, ${orderRows[0].count === 0}
        )
      `;
      await this.syncImageFields(tx, tenantId, propertyId, roomTypeId);
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_type_image.created_from_url',
        targetType: 'room_type_image',
        targetId: id,
        details: { roomTypeId },
      });
      return {
        id,
        url,
        sortOrder: orderRows[0].nextOrder,
        isPrimary: orderRows[0].count === 0,
        createdAt: new Date(),
      };
    });
  }

  async reorderImages(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<void> {
    const value = (body ?? {}) as Record<string, unknown>;
    const imageIds = value.imageIds;
    if (
      !Array.isArray(imageIds) ||
      imageIds.length > MAX_ROOM_TYPE_IMAGES ||
      imageIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set(imageIds).size !== imageIds.length
    )
      throw new BadRequestException('imageIds must be a unique ordered list of photo IDs.');

    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const currentRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
        ORDER BY sort_order, created_at, id
        FOR UPDATE
      `;
      const currentIds = currentRows.map((row) => row.id);
      if (currentIds.length !== imageIds.length || currentIds.some((id) => !imageIds.includes(id)))
        throw new BadRequestException('imageIds must include every photo for this room type.');

      for (const [sortOrder, id] of imageIds.entries()) {
        await tx.$executeRaw`
          UPDATE room_type_images SET sort_order = ${sortOrder}
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND room_type_id = ${roomTypeId}::uuid AND id = ${id}::uuid
        `;
      }
      await this.syncImageFields(tx, tenantId, propertyId, roomTypeId);
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_type_images.reordered',
        targetType: 'room_type',
        targetId: roomTypeId,
      });
    });
  }

  async setPrimaryImage(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<void> {
    const value = (body ?? {}) as Record<string, unknown>;
    const imageId = value.imageId;
    if (typeof imageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(imageId))
      throw new BadRequestException('imageId must be a photo ID.');

    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
        FOR UPDATE
      `;
      if (!roomType[0]) throw new NotFoundException('Room type not found.');
      const selected = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid AND id = ${imageId}::uuid
      `;
      if (!selected[0]) throw new NotFoundException('Room photo not found.');

      await tx.$executeRaw`
        UPDATE room_type_images SET is_primary = false
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid AND is_primary = true
      `;
      await tx.$executeRaw`
        UPDATE room_type_images SET is_primary = true
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid AND id = ${imageId}::uuid
      `;
      await this.syncImageFields(tx, tenantId, propertyId, roomTypeId);
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_type_image.primary_changed',
        targetType: 'room_type_image',
        targetId: imageId,
        details: { roomTypeId },
      });
    });
  }

  async removeImage(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    imageId: string,
    actorUserId: string,
  ): Promise<void> {
    const rows = await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM room_types
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
          FOR UPDATE
        `;
      const found = await tx.$queryRaw<Array<{ objectKey: string | null }>>`
        SELECT object_key AS "objectKey" FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid AND id = ${imageId}::uuid
        FOR UPDATE
        `;
      if (!found[0]?.objectKey) return { found: found[0], deleteObject: false };
      // The property library owns stored objects; only an unlisted, unshared file is deleted.
      const shared = await tx.$queryRaw<Array<{ shared: boolean }>>`
        SELECT (
          EXISTS (
            SELECT 1 FROM property_library_images
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
              AND object_key = ${found[0].objectKey}
          ) OR EXISTS (
            SELECT 1 FROM room_type_images
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
              AND object_key = ${found[0].objectKey} AND id <> ${imageId}::uuid
          )
        ) AS shared
      `;
      return { found: found[0], deleteObject: !shared[0].shared };
    });
    if (!rows.found) throw new NotFoundException('Room photo not found.');
    if (rows.deleteObject && rows.found.objectKey)
      await this.storage.deleteObject(rows.found.objectKey);

    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
        FOR UPDATE
      `;
      const deleted = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid AND id = ${imageId}::uuid
        RETURNING id
      `;
      if (!deleted[0]) throw new NotFoundException('Room photo not found.');
      const remaining = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
        ORDER BY sort_order, created_at, id
      `;
      const currentPrimary = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid AND is_primary = true
      `;
      if (!currentPrimary[0] && remaining[0])
        await tx.$executeRaw`
          UPDATE room_type_images SET is_primary = true
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND room_type_id = ${roomTypeId}::uuid AND id = ${remaining[0].id}::uuid
        `;
      for (const [sortOrder, row] of remaining.entries()) {
        await tx.$executeRaw`
          UPDATE room_type_images SET sort_order = ${sortOrder}
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND room_type_id = ${roomTypeId}::uuid AND id = ${row.id}::uuid
        `;
      }
      await this.syncImageFields(tx, tenantId, propertyId, roomTypeId);
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_type_image.deleted',
        targetType: 'room_type_image',
        targetId: imageId,
        details: { roomTypeId },
      });
    });
  }

  async listLibrary(tenantId: string, propertyId: string): Promise<LibraryImage[]> {
    const { images, abandonedKeys } = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        // Two-phase upload: a row that was never confirmed is an abandoned upload.
        const abandoned = await tx.$queryRaw<Array<{ objectKey: string }>>`
        DELETE FROM property_library_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND confirmed_at IS NULL AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
        RETURNING object_key AS "objectKey"
      `;
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            objectKey: string;
            originalName: string | null;
            createdAt: Date;
            usageCount: number;
          }>
        >`
        SELECT l.id, l.object_key AS "objectKey", l.original_name AS "originalName",
          l.created_at AS "createdAt",
          (SELECT COUNT(*)::int FROM room_type_images i
            WHERE i.tenant_id = l.tenant_id AND i.property_id = l.property_id
              AND i.object_key = l.object_key)
          + (SELECT COUNT(*)::int FROM room_images i
            WHERE i.tenant_id = l.tenant_id AND i.property_id = l.property_id
              AND i.object_key = l.object_key) AS "usageCount"
        FROM property_library_images l
        WHERE l.tenant_id = ${tenantId}::uuid AND l.property_id = ${propertyId}::uuid
          AND l.confirmed_at IS NOT NULL
        ORDER BY l.created_at DESC, l.id
      `;
        return {
          images: rows.map((row) => ({
            id: row.id,
            url: this.storage.publicUrl(row.objectKey),
            originalName: row.originalName,
            createdAt: row.createdAt,
            usageCount: row.usageCount,
          })),
          abandonedKeys: abandoned.map((row) => row.objectKey),
        };
      },
    );
    // Best effort: a failed delete only leaves an unreferenced object behind.
    await Promise.allSettled(abandonedKeys.map((key) => this.storage.deleteObject(key)));
    return images;
  }

  /** Second phase of a library upload: verify the file really reached storage, then publish it. */
  async confirmLibraryUpload(tenantId: string, propertyId: string, imageId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(imageId)) throw new NotFoundException('Library photo not found.');
    const rows = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<Array<{ objectKey: string; confirmedAt: Date | null }>>`
        SELECT object_key AS "objectKey", confirmed_at AS "confirmedAt"
        FROM property_library_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${imageId}::uuid
      `,
    );
    if (!rows[0]) throw new NotFoundException('Library photo not found.');
    if (rows[0].confirmedAt) return;
    const exists = this.storage.objectExists
      ? await this.storage.objectExists(rows[0].objectKey)
      : await fetch(this.storage.publicUrl(rows[0].objectKey), {
          method: 'HEAD',
          signal: AbortSignal.timeout(10_000),
        })
          .then((response) => response.ok)
          .catch(() => false);
    if (!exists)
      throw new ConflictException('The uploaded file was not found in storage. Upload it again.');
    await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$executeRaw`
        UPDATE property_library_images SET confirmed_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND id = ${imageId}::uuid AND confirmed_at IS NULL
      `,
    );
  }

  async createLibraryUpload(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<ImageUpload> {
    const input = this.imageInput(body);
    const rawName = ((body ?? {}) as Record<string, unknown>).name;
    const originalName =
      typeof rawName === 'string' && rawName.trim() ? rawName.trim().slice(0, 255) : null;
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const extension = this.storage.uploadExtension ?? input.contentType.split('/')[1];
      const objectKey = `library/${tenantId}/${propertyId}/${randomUUID()}.${extension}`;
      const { uploadUrl } = await this.storage.createPresignedUpload({
        key: objectKey,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO property_library_images (id, tenant_id, property_id, object_key, original_name)
        VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${objectKey}, ${originalName})
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'property_library_image.created',
        targetType: 'property_library_image',
        targetId: id,
      });
      return { id, uploadUrl, publicUrl: this.storage.publicUrl(objectKey) };
    });
  }

  async removeLibraryImage(
    tenantId: string,
    propertyId: string,
    imageId: string,
    actorUserId: string,
  ): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(imageId)) throw new NotFoundException('Library photo not found.');
    const objectKey = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ objectKey: string }>>`
          SELECT object_key AS "objectKey" FROM property_library_images
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${imageId}::uuid
          FOR UPDATE
        `;
        if (!rows[0]) throw new NotFoundException('Library photo not found.');
        const usage = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT (
            (SELECT COUNT(*)::int FROM room_type_images
              WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
                AND object_key = ${rows[0].objectKey})
            + (SELECT COUNT(*)::int FROM room_images
              WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
                AND object_key = ${rows[0].objectKey})
          ) AS count
        `;
        if (usage[0].count > 0)
          throw new ConflictException(
            'This photo is used by a room or room type. Remove it from every gallery first.',
          );
        await tx.$executeRaw`
          DELETE FROM property_library_images
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${imageId}::uuid
        `;
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'property_library_image.deleted',
          targetType: 'property_library_image',
          targetId: imageId,
        });
        return rows[0].objectKey;
      },
    );
    await this.storage.deleteObject(objectKey);
  }

  async attachLibraryImages(
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<{ added: number }> {
    const value = (body ?? {}) as Record<string, unknown>;
    const libraryImageIds = value.libraryImageIds;
    if (
      !Array.isArray(libraryImageIds) ||
      !libraryImageIds.length ||
      libraryImageIds.length > MAX_ROOM_TYPE_IMAGES ||
      libraryImageIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set(libraryImageIds).size !== libraryImageIds.length
    )
      throw new BadRequestException('libraryImageIds must be a unique list of library photo IDs.');
    const ids = libraryImageIds as string[];
    const asPrimary = value.asPrimary === true;
    if (asPrimary && ids.length !== 1)
      throw new BadRequestException('asPrimary requires exactly one library photo.');

    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const roomType = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_types
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
        FOR UPDATE
      `;
      if (!roomType[0]) throw new NotFoundException('Room type not found.');
      const library = await tx.$queryRaw<Array<{ id: string; objectKey: string }>>`
        SELECT id, object_key AS "objectKey" FROM property_library_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND id = ANY(${ids}::uuid[]) AND confirmed_at IS NOT NULL
        FOR SHARE
      `;
      if (library.length !== ids.length)
        throw new NotFoundException('One or more library photos were not found.');
      const existing = await tx.$queryRaw<Array<{ id: string; objectKey: string | null }>>`
        SELECT id, object_key AS "objectKey" FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
      `;
      const attached = new Map(existing.map((row) => [row.objectKey, row.id]));
      const orderRows = await tx.$queryRaw<Array<{ nextOrder: number }>>`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS "nextOrder" FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
      `;
      const byId = new Map(library.map((row) => [row.id, row]));
      const fresh = ids.map((id) => byId.get(id)!).filter((row) => !attached.has(row.objectKey));
      if (existing.length + fresh.length > MAX_ROOM_TYPE_IMAGES)
        throw new BadRequestException(
          `A room type can have at most ${MAX_ROOM_TYPE_IMAGES} photos.`,
        );
      let nextOrder = orderRows[0].nextOrder;
      for (const [index, row] of fresh.entries()) {
        const id = randomUUID();
        await tx.$executeRaw`
          INSERT INTO room_type_images (id, tenant_id, property_id, room_type_id, object_key, sort_order, is_primary)
          VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
            ${row.objectKey}, ${nextOrder}, ${existing.length === 0 && index === 0})
        `;
        nextOrder += 1;
        attached.set(row.objectKey, id);
      }
      if (asPrimary) {
        const primaryId = attached.get(byId.get(ids[0])!.objectKey);
        await tx.$executeRaw`
          UPDATE room_type_images SET is_primary = (id = ${primaryId}::uuid)
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
        `;
      }
      await this.syncImageFields(tx, tenantId, propertyId, roomTypeId);
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_type_images.attached_from_library',
        targetType: 'room_type',
        targetId: roomTypeId,
        details: { added: fresh.length },
      });
      return { added: fresh.length };
    });
  }

  private async syncImageFields(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId: string,
  ): Promise<void> {
    const rows = await this.roomTypeImageRows(tx, tenantId, propertyId, roomTypeId);
    const { mainImageUrl, galleryImageUrls } = roomTypeImagePresentation(rows, (key) =>
      this.storage.publicUrl(key),
    );
    await tx.$executeRaw`
      UPDATE room_types
      SET main_image_url = ${mainImageUrl},
          gallery_image_urls = ${galleryImageUrls}::varchar(2000)[],
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
    `;
  }

  private roomTypeImageRows(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomTypeId?: string,
  ): Promise<Array<RoomTypeImageProjectionRow & { roomTypeId: string }>> {
    if (roomTypeId)
      return tx.$queryRaw<Array<RoomTypeImageProjectionRow & { roomTypeId: string }>>`
        SELECT room_type_id AS "roomTypeId", source_url AS "sourceUrl", object_key AS "objectKey",
          sort_order AS "sortOrder", is_primary AS "isPrimary", created_at AS "createdAt", id
        FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_type_id = ${roomTypeId}::uuid
        ORDER BY sort_order, created_at, id
      `;
    return tx.$queryRaw<Array<RoomTypeImageProjectionRow & { roomTypeId: string }>>`
      SELECT room_type_id AS "roomTypeId", source_url AS "sourceUrl", object_key AS "objectKey",
        sort_order AS "sortOrder", is_primary AS "isPrimary", created_at AS "createdAt", id
      FROM room_type_images
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
      ORDER BY room_type_id, sort_order, created_at, id
    `;
  }

  private input(body: unknown): {
    name: string;
    description: string | null;
    amenitiesIntro: string | null;
    rules: string | null;
    hasRules: boolean;
    maxOccupancy: number;
    categoryId?: string | null;
    status?: 'DRAFT' | 'PUBLISHED' | 'HIDDEN';
  } {
    const v = (body ?? {}) as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(v, 'mainImageUrl') ||
      Object.prototype.hasOwnProperty.call(v, 'galleryImageUrls')
    )
      throw new BadRequestException(
        'Manage room type photos through the photos.manage image routes.',
      );
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const description =
      typeof v.description === 'string' && v.description.trim() ? v.description.trim() : null;
    const amenitiesIntro =
      typeof v.amenitiesIntro === 'string' && v.amenitiesIntro.trim()
        ? v.amenitiesIntro.trim()
        : null;
    const hasRules = Object.prototype.hasOwnProperty.call(v, 'rules');
    if (hasRules && v.rules !== null && typeof v.rules !== 'string')
      throw new BadRequestException('rules must be a string or null.');
    const rules = typeof v.rules === 'string' && v.rules.trim() ? v.rules.trim() : null;
    const maxOccupancy = typeof v.maxOccupancy === 'number' ? v.maxOccupancy : NaN;
    const categoryId = Object.prototype.hasOwnProperty.call(v, 'categoryId')
      ? v.categoryId === null
        ? null
        : typeof v.categoryId === 'string' && /^[0-9a-f-]{36}$/i.test(v.categoryId)
          ? v.categoryId
          : undefined
      : undefined;
    if (Object.prototype.hasOwnProperty.call(v, 'categoryId') && categoryId === undefined)
      throw new BadRequestException('categoryId must be a category ID or null.');
    const status = v.status;
    if (status !== undefined && status !== 'DRAFT' && status !== 'PUBLISHED' && status !== 'HIDDEN')
      throw new BadRequestException('status must be DRAFT, PUBLISHED, or HIDDEN.');
    if (!name) throw new BadRequestException('name is required.');
    if (name.length > 200) throw new BadRequestException('name must be at most 200 characters.');
    if (!Number.isInteger(maxOccupancy) || maxOccupancy <= 0)
      throw new BadRequestException('maxOccupancy must be a positive integer.');
    return {
      name,
      description,
      amenitiesIntro,
      rules,
      hasRules,
      maxOccupancy,
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(status ? { status } : {}),
    };
  }

  private readiness(row: RoomTypeReadinessRow): RoomTypeReadiness {
    const checks: RoomTypeReadiness['checks'] = [
      {
        key: 'basicInfo',
        label: 'Basic information',
        complete: row.hasBasicInfo,
        fixLabel: 'Add details',
      },
      {
        key: 'occupancy',
        label: 'Occupancy set',
        complete: row.hasOccupancy,
        fixLabel: 'Set occupancy',
      },
      {
        key: 'rateRule',
        label: 'Rate rule',
        complete: row.hasRateRule,
        fixLabel: 'Add a rate rule',
      },
      { key: 'rooms', label: 'Rooms exist', complete: row.hasRooms, fixLabel: 'Add a room' },
      {
        key: 'availabilitySource',
        label: 'Availability source selected',
        complete: row.hasAvailabilitySource,
        fixLabel: 'Connect or map inventory',
      },
      { key: 'photos', label: 'Photos added', complete: row.hasPhotos, fixLabel: 'Add photos' },
      {
        key: 'inventoryConflict',
        label: 'Inventory source conflict',
        complete: !row.hasInventoryConflict,
        fixLabel: 'Review Clock mappings',
      },
    ];
    const incomplete = checks.filter((check) => !check.complete);
    return {
      checks,
      completeCount: checks.length - incomplete.length,
      missingCount: incomplete.length,
      isComplete: incomplete.length === 0,
      firstFix: incomplete[0] ? { key: incomplete[0].key, label: incomplete[0].fixLabel } : null,
    };
  }

  private async requireCategory(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    categoryId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_categories WHERE tenant_id = ${tenantId}::uuid
        AND property_id = ${propertyId}::uuid AND id = ${categoryId}::uuid
    `;
    if (!rows[0]) throw new NotFoundException('Room category not found.');
  }

  private imageUrl(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new BadRequestException(`${field} must be an image URL.`);
    const url = value.trim();
    if (!url) return null;
    if (url.length > 2000)
      throw new BadRequestException(`${field} must be at most 2,000 characters.`);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
        throw new Error('Unsupported URL');
    } catch {
      throw new BadRequestException(`${field} must be an http(s) URL.`);
    }
    return url;
  }

  private imageInput(body: unknown): { contentType: AllowedImageType; contentLength: number } {
    const v = (body ?? {}) as Record<string, unknown>;
    const contentType = typeof v.contentType === 'string' ? v.contentType : '';
    const contentLength = typeof v.contentLength === 'number' ? v.contentLength : NaN;
    if (!ALLOWED_IMAGE_TYPES.includes(contentType as AllowedImageType))
      throw new BadRequestException('contentType must be image/jpeg, image/png, or image/webp.');
    if (!Number.isInteger(contentLength) || contentLength <= 0 || contentLength > MAX_IMAGE_BYTES)
      throw new BadRequestException(
        `contentLength must be a positive integer up to ${MAX_IMAGE_BYTES} bytes.`,
      );
    return { contentType: contentType as AllowedImageType, contentLength };
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
