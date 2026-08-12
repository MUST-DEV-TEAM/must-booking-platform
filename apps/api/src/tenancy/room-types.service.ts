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
type RoomTypeImage = { id: string; url: string; createdAt: Date };
type ImageUpload = { id: string; uploadUrl: string; publicUrl: string };

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
    const input = this.input(body);
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
            ${input.mainImageUrl},
            ${input.galleryImageUrls}::varchar(2000)[],
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
    const input = this.input(body);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      try {
        const rows = await tx.$queryRaw<RoomType[]>`
          UPDATE room_types
          SET
            name = ${input.name},
            description = ${input.description},
            amenities_intro = ${input.amenitiesIntro},
            main_image_url = ${input.mainImageUrl},
            gallery_image_urls = ${input.galleryImageUrls}::varchar(2000)[],
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
      `;
      if (!roomType[0]) throw new NotFoundException('Room type not found.');

      const extension = input.contentType.split('/')[1];
      const objectKey = `room-types/${tenantId}/${propertyId}/${roomTypeId}/${randomUUID()}.${extension}`;
      const { uploadUrl } = await this.storage.createPresignedUpload({
        key: objectKey,
        contentType: input.contentType,
        contentLength: input.contentLength,
      });

      const id = randomUUID();
      await tx.$executeRaw`
        INSERT INTO room_type_images (id, tenant_id, property_id, room_type_id, object_key)
        VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${objectKey})
      `;
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
      const rows = await tx.$queryRaw<Array<{ id: string; objectKey: string; createdAt: Date }>>`
        SELECT id, object_key AS "objectKey", created_at AS "createdAt"
        FROM room_type_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND room_type_id = ${roomTypeId}::uuid
        ORDER BY created_at
      `;
      return rows.map((row) => ({
        id: row.id,
        url: this.storage.publicUrl(row.objectKey),
        createdAt: row.createdAt,
      }));
    });
  }

  private input(body: unknown): {
    name: string;
    description: string | null;
    amenitiesIntro: string | null;
    mainImageUrl: string | null;
    galleryImageUrls: string[];
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
    const mainImageUrl = this.imageUrl(v.mainImageUrl, 'mainImageUrl');
    const galleryImageUrls = this.galleryImageUrls(v.galleryImageUrls);
    const maxOccupancy = typeof v.maxOccupancy === 'number' ? v.maxOccupancy : NaN;
    if (!name) throw new BadRequestException('name is required.');
    if (name.length > 200) throw new BadRequestException('name must be at most 200 characters.');
    if (!Number.isInteger(maxOccupancy) || maxOccupancy <= 0)
      throw new BadRequestException('maxOccupancy must be a positive integer.');
    return { name, description, amenitiesIntro, mainImageUrl, galleryImageUrls, maxOccupancy };
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
