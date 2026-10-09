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
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';

type RoomType = {
  id: string;
  name: string;
  description: string | null;
  amenitiesIntro: string | null;
  mainImageUrl: string | null;
  galleryImageUrls: string[];
  maxOccupancy: number;
  roomCount: number;
};
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
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) => tx.$queryRaw<RoomType[]>`
        SELECT rt.id, rt.name, rt.description, rt.amenities_intro AS "amenitiesIntro", rt.main_image_url AS "mainImageUrl",
          rt.gallery_image_urls AS "galleryImageUrls", rt.max_occupancy AS "maxOccupancy",
          count(r.id)::int AS "roomCount"
        FROM room_types rt
        LEFT JOIN rooms r ON r.tenant_id = rt.tenant_id AND r.room_type_id = rt.id
        WHERE rt.tenant_id = ${tenantId}::uuid AND rt.property_id = ${propertyId}::uuid
        GROUP BY rt.id
        ORDER BY rt.created_at
      `,
    );
  }

  async create(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomType> {
    const input = this.input(body, true);
    const id = randomUUID();
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<RoomType[]>`
          INSERT INTO room_types (
            id, tenant_id, property_id, name, description, amenities_intro, main_image_url, gallery_image_urls, max_occupancy
          )
          VALUES (
            ${id}::uuid,
            ${tenantId}::uuid,
            ${propertyId}::uuid,
            ${input.name},
            ${input.description},
            ${input.amenitiesIntro},
            ${input.mainImageUrl ?? null},
            ${input.galleryImageUrls ?? []}::varchar(2000)[],
            ${input.maxOccupancy}
          )
          RETURNING id, name, description, amenities_intro AS "amenitiesIntro", main_image_url AS "mainImageUrl",
            gallery_image_urls AS "galleryImageUrls", max_occupancy AS "maxOccupancy"
        `;
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room_type.created',
          targetType: 'room_type',
          targetId: id,
        });
        return rows[0];
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
    const input = this.input(body, false);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<RoomType[]>`
          UPDATE room_types
          SET
            name = ${input.name},
            description = ${input.description},
            amenities_intro = ${input.amenitiesIntro},
            main_image_url = CASE WHEN ${input.mainImageUrlProvided} THEN ${input.mainImageUrl ?? null} ELSE main_image_url END,
            gallery_image_urls = CASE WHEN ${input.galleryImageUrlsProvided} THEN ${input.galleryImageUrls ?? []}::varchar(2000)[] ELSE gallery_image_urls END,
            max_occupancy = ${input.maxOccupancy},
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
          RETURNING id, name, description, amenities_intro AS "amenitiesIntro", main_image_url AS "mainImageUrl",
            gallery_image_urls AS "galleryImageUrls", max_occupancy AS "maxOccupancy"
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
        return rows[0];
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
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          DELETE FROM room_types
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
          RETURNING id
        `;
        if (!rows[0]) throw new NotFoundException('Room type not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room_type.deleted',
          targetType: 'room_type',
          targetId: roomTypeId,
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

      const extension = input.contentType.split('/')[1];
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
    const head = await fetch(this.storage.publicUrl(rows[0].objectKey), {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!head?.ok)
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
      const extension = input.contentType.split('/')[1];
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
          SELECT COUNT(*)::int AS count FROM room_type_images
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND object_key = ${rows[0].objectKey}
        `;
        if (usage[0].count > 0)
          throw new ConflictException(
            'This photo is used by a room type. Remove it from the room type first.',
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
    const rows = await tx.$queryRaw<
      Array<{ objectKey: string | null; sourceUrl: string | null; isPrimary: boolean }>
    >`
      SELECT object_key AS "objectKey", source_url AS "sourceUrl", is_primary AS "isPrimary"
      FROM room_type_images
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
      ORDER BY is_primary DESC, sort_order, created_at, id
    `;
    const primary = rows.find((row) => row.isPrimary) ?? rows[0];
    const mainImageUrl = primary
      ? (primary.sourceUrl ?? this.storage.publicUrl(primary.objectKey!))
      : null;
    const galleryImageUrls = rows
      .filter((row) => row !== primary)
      .map((row) => row.sourceUrl ?? this.storage.publicUrl(row.objectKey!));
    await tx.$executeRaw`
      UPDATE room_types
      SET main_image_url = ${mainImageUrl},
          gallery_image_urls = ${galleryImageUrls}::varchar(2000)[],
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomTypeId}::uuid
    `;
  }

  private input(
    body: unknown,
    creating: boolean,
  ): {
    name: string;
    description: string | null;
    amenitiesIntro: string | null;
    mainImageUrl: string | null | undefined;
    galleryImageUrls: string[] | undefined;
    mainImageUrlProvided: boolean;
    galleryImageUrlsProvided: boolean;
    maxOccupancy: number;
  } {
    const v = (body ?? {}) as Record<string, unknown>;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const description =
      typeof v.description === 'string' && v.description.trim() ? v.description.trim() : null;
    const amenitiesIntro =
      typeof v.amenitiesIntro === 'string' && v.amenitiesIntro.trim()
        ? v.amenitiesIntro.trim()
        : null;
    const mainImageUrlProvided =
      creating || Object.prototype.hasOwnProperty.call(v, 'mainImageUrl');
    const galleryImageUrlsProvided =
      creating || Object.prototype.hasOwnProperty.call(v, 'galleryImageUrls');
    const mainImageUrl = mainImageUrlProvided
      ? this.imageUrl(v.mainImageUrl, 'mainImageUrl')
      : undefined;
    const galleryImageUrls = galleryImageUrlsProvided
      ? this.galleryImageUrls(v.galleryImageUrls)
      : undefined;
    const maxOccupancy = typeof v.maxOccupancy === 'number' ? v.maxOccupancy : NaN;
    if (!name) throw new BadRequestException('name is required.');
    if (name.length > 200) throw new BadRequestException('name must be at most 200 characters.');
    if (!Number.isInteger(maxOccupancy) || maxOccupancy <= 0)
      throw new BadRequestException('maxOccupancy must be a positive integer.');
    return {
      name,
      description,
      amenitiesIntro,
      mainImageUrl,
      galleryImageUrls,
      mainImageUrlProvided,
      galleryImageUrlsProvided,
      maxOccupancy,
    };
  }

  private galleryImageUrls(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value))
      throw new BadRequestException('galleryImageUrls must be an array of image URLs.');
    if (value.length > 12)
      throw new BadRequestException('galleryImageUrls must contain at most 12 URLs.');
    const urls = value.map((url) => this.imageUrl(url, 'galleryImageUrls'));
    if (urls.some((url) => url === null))
      throw new BadRequestException('galleryImageUrls must contain image URLs.');
    if (new Set(urls).size !== urls.length)
      throw new BadRequestException('galleryImageUrls must not contain duplicates.');
    return urls as string[];
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
