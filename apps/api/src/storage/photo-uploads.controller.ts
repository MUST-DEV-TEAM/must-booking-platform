import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  PayloadTooLargeException,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.provider';
import { MAX_PHOTO_BYTES, PHOTO_CONTENT_TYPES } from './local-storage.provider';
import { TenantScoped } from '../tenancy/tenant-context.decorator';
import { RequiresCapability } from '../tenancy/capabilities.decorator';
import { RequiresVerifiedEmail } from '../auth/requires-verified-email.decorator';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';

@Controller('tenants/:tenantId/properties/:propertyId/photo-uploads')
export class PhotoUploadsController {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
  ) {}

  @Put()
  @HttpCode(204)
  @TenantScoped({ propertyParam: 'propertyId' })
  @RequiresCapability('photos.manage')
  @RequiresVerifiedEmail()
  async upload(
    @Query('key') key: string,
    @Req()
    request: IncomingMessage & {
      tenantContext: { tenantId: string; propertyId: string };
    },
  ): Promise<void> {
    if (!this.storage.uploadObject) throw new NotFoundException('Local uploads are disabled.');
    const contentType = request.headers['content-type'] ?? '';
    if (!PHOTO_CONTENT_TYPES.includes(contentType))
      throw new BadRequestException('Only JPEG, PNG and WebP photos are allowed.');
    if (Number(request.headers['content-length']) > MAX_PHOTO_BYTES) {
      request.resume();
      throw new PayloadTooLargeException('Photos must be at most 10 MB.');
    }
    const { tenantId, propertyId } = request.tenantContext;
    const parts = typeof key === 'string' ? key.split('/') : [];
    if (
      !['room-types', 'library'].includes(parts[0]) ||
      parts[1] !== tenantId ||
      parts[2] !== propertyId
    )
      throw new NotFoundException('Photo upload not found.');
    const reserved = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) => tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM property_library_images
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND object_key = ${key}
    `,
    );
    if (!reserved[0]) throw new NotFoundException('Photo upload not found.');
    // Read outside a transaction: slow uploads must not hold a DB connection/row lock.
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      if (length > MAX_PHOTO_BYTES) {
        request.resume();
        throw new PayloadTooLargeException('Photos must be at most 10 MB.');
      }
      chunks.push(bytes);
    }
    // Recheck and lock through writing so deletion cannot race with a late upload.
    await this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM property_library_images
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND object_key = ${key}
        FOR UPDATE
      `;
        if (!rows[0]) throw new NotFoundException('Photo upload not found.');
        await this.storage.uploadObject!(key, Buffer.concat(chunks), contentType);
      },
      { timeoutMs: 15_000 },
    );
  }
}
