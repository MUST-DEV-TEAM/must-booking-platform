import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from './audit-log.service';
import { roomImagePresentation, type RoomImageProjectionRow } from './room-image-projection';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../storage/storage.provider';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ROOM_IMAGES = 21;

type Room = {
  id: string;
  name: string;
  title: string | null;
  roomSize: string | null;
  rules: string | null;
  description: string | null;
  floor: number | null;
  viewType: string | null;
  isActive: boolean;
  images?: Array<{ id: string; url: string; sortOrder: number; isPrimary: boolean }>;
  photoSource?: 'room' | 'room_type' | 'none';
};
type RoomWithType = Room & { roomTypeId: string; roomTypeName: string };
type RoomImage = RoomImageProjectionRow & { url: string };
type ImageUpload = { id: string; uploadUrl: string; publicUrl: string };

@Injectable()
export class RoomsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  list(tenantId: string, propertyId: string, roomTypeId: string): Promise<Room[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rooms = await tx.$queryRaw<Array<Room & { roomTypeId: string }>>`
        SELECT id, room_type_id AS "roomTypeId", name, title, room_size AS "roomSize", rules, description, floor, view_type AS "viewType", is_active AS "isActive"
        FROM rooms
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
        ORDER BY created_at
      `;
      return this.withRoomImages(tx, tenantId, propertyId, rooms);
    });
  }

  /** Every room across every room type — the walk-in booking form's "All"
   * room-type option needs a flat list to pick an individual room from,
   * unlike list() above which is scoped to one room type at a time. */
  listAll(tenantId: string, propertyId: string): Promise<RoomWithType[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rooms = await tx.$queryRaw<RoomWithType[]>`
        SELECT r.id, r.name, r.title, r.room_size AS "roomSize", r.rules, r.description, r.floor, r.view_type AS "viewType", r.is_active AS "isActive", r.room_type_id AS "roomTypeId",
          rt.name AS "roomTypeName"
        FROM rooms r
        JOIN room_types rt ON rt.tenant_id = r.tenant_id AND rt.id = r.room_type_id
        WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid
        ORDER BY rt.name, r.name
      `;
      return this.withRoomImages(tx, tenantId, propertyId, rooms);
    });
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
          INSERT INTO rooms (id, tenant_id, property_id, room_type_id, name, title, room_size, rules, description, floor, view_type, is_active)
          VALUES (
            ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
            ${input.name}, ${input.title}, ${input.roomSize}, ${input.rules}, ${input.description}, ${input.floor}, ${input.viewType}, COALESCE(${input.isActive ?? null}, true)
          )
          RETURNING id, name, title, room_size AS "roomSize", rules, description, floor, view_type AS "viewType", is_active AS "isActive"
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
        const currentRows = await tx.$queryRaw<Array<{ isActive: boolean }>>`
          SELECT is_active AS "isActive" FROM rooms
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
        `;
        const rows = await tx.$queryRaw<Room[]>`
          UPDATE rooms
          SET name = ${input.name}, title = ${input.title}, room_size = ${input.roomSize}, rules = ${input.rules}, description = ${input.description},
            floor = ${input.floor}, view_type = ${input.viewType},
            is_active = COALESCE(${input.isActive ?? null}, is_active),
            updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
          RETURNING id, name, title, room_size AS "roomSize", rules, description, floor, view_type AS "viewType", is_active AS "isActive"
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
        if (
          currentRows[0] &&
          input.isActive !== null &&
          input.isActive !== currentRows[0].isActive
        ) {
          await this.audit.recordInTransaction(tx, {
            tenantId,
            propertyId,
            actorUserId,
            action: 'room.active_changed',
            targetType: 'room',
            targetId: roomId,
            details: { from: currentRows[0].isActive, to: input.isActive },
          });
        }
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
        const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
          DELETE FROM rooms
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
          RETURNING id, name
        `;
        if (!rows[0]) throw new NotFoundException('Room not found.');
        await this.audit.recordInTransaction(tx, {
          tenantId,
          propertyId,
          actorUserId,
          action: 'room.deleted',
          targetType: 'room',
          targetId: roomId,
          details: { targetName: rows[0].name },
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

  listImages(tenantId: string, propertyId: string, roomId: string): Promise<RoomImage[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.lockRoom(tx, tenantId, propertyId, roomId);
      const rows = await this.roomImageRows(tx, tenantId, propertyId, roomId);
      return rows.map((row) => ({
        ...row,
        url: row.sourceUrl ?? this.storage.publicUrl(row.objectKey!),
      }));
    });
  }

  async createImageUpload(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<ImageUpload> {
    const input = this.imageInput(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.lockRoom(tx, tenantId, propertyId, roomId);
      const countRows = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
      `;
      if (countRows[0].count >= MAX_ROOM_IMAGES)
        throw new BadRequestException(`A room can have at most ${MAX_ROOM_IMAGES} photos.`);
      const orderRows = await tx.$queryRaw<Array<{ nextOrder: number }>>`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS "nextOrder" FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
      `;
      const extension = input.contentType.split('/')[1];
      const objectKey = `rooms/${tenantId}/${propertyId}/${roomId}/${randomUUID()}.${extension}`;
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
        INSERT INTO room_images (id, tenant_id, property_id, room_id, object_key, sort_order, is_primary)
        VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomId}::uuid,
          ${objectKey}, ${orderRows[0].nextOrder}, ${countRows[0].count === 0})
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_image.created',
        targetType: 'room_image',
        targetId: id,
        details: { roomId },
      });
      return { id, uploadUrl, publicUrl: this.storage.publicUrl(objectKey) };
    });
  }

  async createImageFromUrl(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<RoomImage> {
    const value = (body ?? {}) as Record<string, unknown>;
    const url = this.imageUrl(value.url, 'url');
    if (!url) throw new BadRequestException('url is required.');
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.lockRoom(tx, tenantId, propertyId, roomId);
      const duplicateRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_id = ${roomId}::uuid AND source_url = ${url}
      `;
      if (duplicateRows[0])
        throw new ConflictException('This photo URL is already in the room gallery.');
      const orderRows = await tx.$queryRaw<Array<{ count: number; nextOrder: number }>>`
        SELECT COUNT(*)::int AS count, COALESCE(MAX(sort_order), -1) + 1 AS "nextOrder"
        FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
      `;
      if (orderRows[0].count >= MAX_ROOM_IMAGES)
        throw new BadRequestException(`A room can have at most ${MAX_ROOM_IMAGES} photos.`);
      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO room_images (id, tenant_id, property_id, room_id, source_url, sort_order, is_primary)
        VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomId}::uuid,
          ${url}, ${orderRows[0].nextOrder}, ${orderRows[0].count === 0})
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_image.created_from_url',
        targetType: 'room_image',
        targetId: id,
        details: { roomId },
      });
      return {
        id,
        sourceUrl: url,
        objectKey: null,
        url,
        sortOrder: orderRows[0].nextOrder,
        isPrimary: orderRows[0].count === 0,
        createdAt: new Date(),
      };
    });
  }

  async attachLibraryImages(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<{ added: number }> {
    const value = (body ?? {}) as Record<string, unknown>;
    const libraryImageIds = value.libraryImageIds;
    if (
      !Array.isArray(libraryImageIds) ||
      !libraryImageIds.length ||
      libraryImageIds.length > MAX_ROOM_IMAGES ||
      libraryImageIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set(libraryImageIds).size !== libraryImageIds.length
    )
      throw new BadRequestException('libraryImageIds must be a unique list of library photo IDs.');
    const ids = libraryImageIds as string[];
    const asPrimary = value.asPrimary === true;
    if (asPrimary && ids.length !== 1)
      throw new BadRequestException('asPrimary requires exactly one library photo.');

    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.lockRoom(tx, tenantId, propertyId, roomId);
      const library = await tx.$queryRaw<Array<{ id: string; objectKey: string }>>`
        SELECT id, object_key AS "objectKey" FROM property_library_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND id = ANY(${ids}::uuid[]) AND confirmed_at IS NOT NULL
        FOR SHARE
      `;
      if (library.length !== ids.length)
        throw new NotFoundException('One or more library photos were not found.');
      const existing = await tx.$queryRaw<Array<{ id: string; objectKey: string | null }>>`
        SELECT id, object_key AS "objectKey" FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
      `;
      const attached = new Map(existing.map((row) => [row.objectKey, row.id]));
      const orderRows = await tx.$queryRaw<Array<{ nextOrder: number }>>`
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS "nextOrder" FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
      `;
      const byId = new Map(library.map((row) => [row.id, row]));
      const fresh = ids.map((id) => byId.get(id)!).filter((row) => !attached.has(row.objectKey));
      if (existing.length + fresh.length > MAX_ROOM_IMAGES)
        throw new BadRequestException(`A room can have at most ${MAX_ROOM_IMAGES} photos.`);
      let nextOrder = orderRows[0].nextOrder;
      for (const [index, row] of fresh.entries()) {
        const id = randomUUID();
        await tx.$executeRaw`
          INSERT INTO room_images (id, tenant_id, property_id, room_id, object_key, sort_order, is_primary)
          VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomId}::uuid,
            ${row.objectKey}, ${nextOrder}, ${existing.length === 0 && index === 0})
        `;
        nextOrder += 1;
        attached.set(row.objectKey, id);
      }
      if (asPrimary) {
        const primaryId = attached.get(byId.get(ids[0])!.objectKey);
        await tx.$executeRaw`
          UPDATE room_images SET is_primary = (id = ${primaryId}::uuid)
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
        `;
      }
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_images.attached_from_library',
        targetType: 'room',
        targetId: roomId,
        details: { added: fresh.length },
      });
      return { added: fresh.length };
    });
  }

  async reorderImages(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<void> {
    const imageIds = (body as Record<string, unknown> | null)?.imageIds;
    if (
      !Array.isArray(imageIds) ||
      imageIds.length > MAX_ROOM_IMAGES ||
      imageIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set(imageIds).size !== imageIds.length
    )
      throw new BadRequestException('imageIds must be a unique ordered list of photo IDs.');
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.lockRoom(tx, tenantId, propertyId, roomId);
      const currentRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
        ORDER BY sort_order, created_at, id FOR UPDATE
      `;
      const currentIds = currentRows.map((row) => row.id);
      if (currentIds.length !== imageIds.length || currentIds.some((id) => !imageIds.includes(id)))
        throw new BadRequestException('imageIds must include every photo for this room.');
      for (const [sortOrder, id] of imageIds.entries())
        await tx.$executeRaw`
          UPDATE room_images SET sort_order = ${sortOrder}
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND room_id = ${roomId}::uuid AND id = ${id}::uuid
        `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_images.reordered',
        targetType: 'room',
        targetId: roomId,
      });
    });
  }

  async setPrimaryImage(
    tenantId: string,
    propertyId: string,
    roomId: string,
    actorUserId: string,
    body: unknown,
  ): Promise<void> {
    const imageId = (body as Record<string, unknown> | null)?.imageId;
    if (typeof imageId !== 'string' || !/^[0-9a-f-]{36}$/i.test(imageId))
      throw new BadRequestException('imageId must be a photo ID.');
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.lockRoom(tx, tenantId, propertyId, roomId);
      const selected = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_images WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_id = ${roomId}::uuid AND id = ${imageId}::uuid
      `;
      if (!selected[0]) throw new NotFoundException('Room photo not found.');
      await tx.$executeRaw`
        UPDATE room_images SET is_primary = (id = ${imageId}::uuid)
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
      `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_image.primary_changed',
        targetType: 'room_image',
        targetId: imageId,
        details: { roomId },
      });
    });
  }

  async removeImage(
    tenantId: string,
    propertyId: string,
    roomId: string,
    imageId: string,
    actorUserId: string,
  ): Promise<void> {
    const result = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        await this.lockRoom(tx, tenantId, propertyId, roomId);
        const found = await tx.$queryRaw<Array<{ objectKey: string | null }>>`
        SELECT object_key AS "objectKey" FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_id = ${roomId}::uuid AND id = ${imageId}::uuid FOR UPDATE
      `;
        if (!found[0]) throw new NotFoundException('Room photo not found.');
        if (!found[0].objectKey) return { objectKey: null, deleteObject: false };
        const shared = await tx.$queryRaw<Array<{ shared: boolean }>>`
        SELECT (
          EXISTS (SELECT 1 FROM property_library_images
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND object_key = ${found[0].objectKey})
          OR EXISTS (SELECT 1 FROM room_type_images
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND object_key = ${found[0].objectKey})
          OR EXISTS (SELECT 1 FROM room_images
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
              AND object_key = ${found[0].objectKey} AND id <> ${imageId}::uuid)
        ) AS shared
      `;
        return { objectKey: found[0].objectKey, deleteObject: !shared[0].shared };
      },
    );
    if (result.deleteObject && result.objectKey) await this.storage.deleteObject(result.objectKey);

    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await this.lockRoom(tx, tenantId, propertyId, roomId);
      const deleted = await tx.$queryRaw<Array<{ id: string }>>`
        DELETE FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_id = ${roomId}::uuid AND id = ${imageId}::uuid
        RETURNING id
      `;
      if (!deleted[0]) throw new NotFoundException('Room photo not found.');
      const remaining = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
        ORDER BY sort_order, created_at, id
      `;
      const primary = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM room_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND room_id = ${roomId}::uuid AND is_primary = true
      `;
      if (!primary[0] && remaining[0])
        await tx.$executeRaw`
          UPDATE room_images SET is_primary = true
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND room_id = ${roomId}::uuid AND id = ${remaining[0].id}::uuid
        `;
      for (const [sortOrder, row] of remaining.entries())
        await tx.$executeRaw`
          UPDATE room_images SET sort_order = ${sortOrder}
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND room_id = ${roomId}::uuid AND id = ${row.id}::uuid
        `;
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'room_image.deleted',
        targetType: 'room_image',
        targetId: imageId,
        details: { roomId },
      });
    });
  }

  private async lockRoom(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rooms
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND id = ${roomId}::uuid
      FOR UPDATE
    `;
    if (!rows[0]) throw new NotFoundException('Room not found.');
    return rows[0];
  }

  private roomImageRows(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    roomId: string,
  ): Promise<RoomImageProjectionRow[]> {
    return tx.$queryRaw<RoomImageProjectionRow[]>`
      SELECT id, source_url AS "sourceUrl", object_key AS "objectKey", sort_order AS "sortOrder",
        is_primary AS "isPrimary", created_at AS "createdAt"
      FROM room_images
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_id = ${roomId}::uuid
      ORDER BY sort_order, created_at, id
    `;
  }

  private async withRoomImages<T extends Room & { roomTypeId: string }>(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
    rooms: T[],
  ): Promise<
    Array<
      T & { images: NonNullable<Room['images']>; photoSource: NonNullable<Room['photoSource']> }
    >
  > {
    if (!rooms.length) return [];
    const ids = rooms.map((room) => room.id);
    const imageRows = await tx.$queryRaw<
      Array<RoomImageProjectionRow & { roomId: string; collection: 'room' | 'room_type' }>
    >`
      SELECT images.room_id AS "roomId", 'room'::text AS collection, images.id,
        images.source_url AS "sourceUrl", images.object_key AS "objectKey",
        images.sort_order AS "sortOrder", images.is_primary AS "isPrimary", images.created_at AS "createdAt"
      FROM room_images images
      WHERE images.tenant_id = ${tenantId}::uuid AND images.property_id = ${propertyId}::uuid
        AND images.room_id = ANY(${ids}::uuid[])
      UNION ALL
      SELECT rooms.id AS "roomId", 'room_type'::text AS collection, images.id,
        images.source_url AS "sourceUrl", images.object_key AS "objectKey",
        images.sort_order AS "sortOrder", images.is_primary AS "isPrimary", images.created_at AS "createdAt"
      FROM rooms
      JOIN room_type_images images ON images.tenant_id = rooms.tenant_id AND images.property_id = rooms.property_id
        AND images.room_type_id = rooms.room_type_id
      WHERE rooms.tenant_id = ${tenantId}::uuid AND rooms.property_id = ${propertyId}::uuid
        AND rooms.id = ANY(${ids}::uuid[])
      ORDER BY "roomId", "sortOrder", "createdAt", id
    `;
    const roomImages = new Map<string, RoomImageProjectionRow[]>();
    const roomTypeImages = new Map<string, RoomImageProjectionRow[]>();
    for (const { roomId, collection, ...image } of imageRows) {
      const map = collection === 'room' ? roomImages : roomTypeImages;
      map.set(roomId, [...(map.get(roomId) ?? []), image]);
    }
    return rooms.map((room) => ({
      ...room,
      ...roomImagePresentation(
        roomImages.get(room.id) ?? [],
        roomTypeImages.get(room.id) ?? [],
        (key) => this.storage.publicUrl(key),
      ),
    }));
  }

  private imageInput(body: unknown): { contentType: AllowedImageType; contentLength: number } {
    const value = (body ?? {}) as Record<string, unknown>;
    const contentType = value.contentType;
    if (!ALLOWED_IMAGE_TYPES.includes(contentType as AllowedImageType))
      throw new BadRequestException('contentType must be JPEG, PNG, or WebP.');
    const contentLength = value.contentLength;
    if (
      typeof contentLength !== 'number' ||
      !Number.isInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAX_IMAGE_BYTES
    )
      throw new BadRequestException('contentLength must be between 1 byte and 10 MB.');
    return { contentType: contentType as AllowedImageType, contentLength };
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

  private input(body: unknown): {
    name: string;
    title: string | null;
    roomSize: string | null;
    rules: string | null;
    description: string | null;
    floor: number | null;
    viewType: string | null;
    isActive: boolean | null;
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
    if (v.isActive !== undefined && typeof v.isActive !== 'boolean')
      throw new BadRequestException('isActive must be a boolean.');
    if (viewType && viewType.length > 100)
      throw new BadRequestException('viewType must be at most 100 characters.');
    return {
      name,
      title,
      roomSize,
      rules,
      description,
      floor,
      viewType,
      isActive: v.isActive ?? null,
    };
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
