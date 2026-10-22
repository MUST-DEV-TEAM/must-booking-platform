import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  ConflictException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { R2StorageProvider } from './r2-storage.provider';
import type { StorageProvider } from './storage.provider';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const valid = new RegExp(
  String.raw`^server-v1/(?:rooms|room-types|library)/(${uuid})/(${uuid})/(?:${uuid}/)?${uuid}\.(?:jpeg|png|webp)$`,
  'i',
);
type Intent = {
  id: string;
  objectKey: string;
  contentType: string;
  contentLength: number;
  uploadedAt: Date | null;
};
@Injectable()
export class ServerStorageProvider implements StorageProvider {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(R2StorageProvider) private readonly legacy: R2StorageProvider,
  ) {}
  newObjectKey(key: string) {
    return 'server-v1/' + key;
  }
  private scope(key: string) {
    if (typeof key !== 'string') throw new BadRequestException('Invalid media key.');
    const m = valid.exec(key);
    if (!m) throw new BadRequestException('Invalid media key.');
    return { tenantId: m[1], propertyId: m[2] };
  }
  private path(key: string) {
    this.scope(key);
    const configured = process.env.MEDIA_ROOT?.trim();
    if (!configured || !isAbsolute(configured))
      throw new Error('MEDIA_ROOT must be an absolute persistent directory.');
    const root = resolve(configured),
      path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new BadRequestException('Invalid media path.');
    return path;
  }
  private base() {
    const base = process.env.MEDIA_PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (!base) throw new Error('MEDIA_PUBLIC_BASE_URL must be configured.');
    return base;
  }
  async createPresignedUpload(command: {
    key: string;
    contentType: string;
    contentLength: number;
  }) {
    const scope = this.scope(command.key);
    this.path(command.key);
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(command.contentType) ||
      !Number.isInteger(command.contentLength) ||
      command.contentLength < 1 ||
      command.contentLength > 10485760
    )
      throw new BadRequestException('Use a JPEG, PNG or WebP image up to 10 MB.');
    const token = randomBytes(32).toString('base64url'),
      hash = createHash('sha256').update(token).digest('hex');
    await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$executeRaw`INSERT INTO server_media_uploads(tenant_id,property_id,token_hash,object_key,content_type,content_length,expires_at) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${hash},${command.key},${command.contentType},${command.contentLength},now()+interval '5 minutes')`,
    );
    return { uploadUrl: `${this.base()}/upload/${scope.tenantId}/${scope.propertyId}/${token}` };
  }
  async upload(
    scope: { tenantId: string; propertyId: string },
    token: string,
    contentType: string | undefined,
    stream: AsyncIterable<Buffer>,
  ) {
    if (
      !/^[a-zA-Z0-9_-]{43}$/.test(token) ||
      ![scope.tenantId, scope.propertyId].every((v) => /^[0-9a-f-]{36}$/i.test(v))
    )
      throw new NotFoundException();
    const hash = createHash('sha256').update(token).digest('hex');
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Intent[]
        >`SELECT id,object_key AS "objectKey",content_type AS "contentType",content_length AS "contentLength",uploaded_at AS "uploadedAt" FROM server_media_uploads WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND token_hash=${hash} AND expires_at>now()`,
    );
    const intent = rows[0];
    if (!intent) throw new NotFoundException('Upload authorization expired.');
    if (intent.uploadedAt) throw new ConflictException('This upload was already completed.');
    if (contentType?.split(';')[0] !== intent.contentType)
      throw new BadRequestException('Image type does not match the upload.');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > intent.contentLength || size > 10485760) throw new PayloadTooLargeException();
      chunks.push(chunk);
    }
    if (size !== intent.contentLength)
      throw new BadRequestException('Image size does not match the upload.');
    let output: Buffer;
    try {
      const image = sharp(Buffer.concat(chunks), { limitInputPixels: 40000000, animated: false });
      const metadata = await image.metadata();
      if (metadata.format !== intent.contentType.slice(6)) throw Error('format');
      output = await image.rotate().toFormat(metadata.format).toBuffer();
    } catch {
      throw new BadRequestException(
        'The image could not be decoded. Use a valid JPEG, PNG or WebP.',
      );
    }
    const file = this.path(intent.objectKey);
    await mkdir(resolve(file, '..'), { recursive: true });
    try {
      await writeFile(file, output, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new ConflictException('This upload already exists.');
      throw error;
    }
    await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$executeRaw`UPDATE server_media_uploads SET uploaded_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${intent.id}::uuid`,
    );
  }
  async image(key: string) {
    const scope = this.scope(key);
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{ contentType: string }>
        >`SELECT content_type AS "contentType" FROM server_media_uploads WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND object_key=${key} AND uploaded_at IS NOT NULL`,
    );
    if (!rows[0]) throw new NotFoundException();
    try {
      return { data: await readFile(this.path(key)), contentType: rows[0].contentType };
    } catch {
      throw new NotFoundException();
    }
  }
  async deleteObject(key: string) {
    if (!key.startsWith('server-v1/')) return this.legacy.deleteObject(key);
    try {
      await unlink(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  publicUrl(key: string) {
    return key.startsWith('server-v1/')
      ? `${this.base()}/image?key=${encodeURIComponent(key)}`
      : this.legacy.publicUrl(key);
  }
}
