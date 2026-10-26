import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { link, lstat, mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import sharp from 'sharp';
import type { StorageProvider } from './storage.provider';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const keyPattern = new RegExp(
  `^(?:room-types/${uuid}/${uuid}/${uuid}|library/${uuid}/${uuid})/${uuid}\\.(?:jpeg|jpg|png|webp)$`,
  'i',
);

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly uploadExtension = 'webp';
  private processing = false;

  async createPresignedUpload(command: {
    key: string;
    contentType: string;
    contentLength: number;
  }) {
    this.validateKey(command.key);
    if (!PHOTO_CONTENT_TYPES.includes(command.contentType))
      throw new BadRequestException('Only JPEG, PNG and WebP photos are allowed.');
    if (
      !Number.isInteger(command.contentLength) ||
      command.contentLength <= 0 ||
      command.contentLength > MAX_PHOTO_BYTES
    )
      throw new BadRequestException('Photos must be between 1 byte and 10 MB.');
    const [, tenantId, propertyId] = command.key.split('/');
    // Same-origin PUT preserves the existing browser contract and sends the staff session cookie.
    return {
      uploadUrl: `/api/tenants/${tenantId}/properties/${propertyId}/photo-uploads?key=${encodeURIComponent(command.key)}`,
    };
  }

  async uploadObject(key: string, data: Uint8Array, contentType: string): Promise<void> {
    this.validateKey(key);
    if (data.byteLength === 0 || data.byteLength > MAX_PHOTO_BYTES)
      throw new BadRequestException('Photos must be between 1 byte and 10 MB.');
    const bytes = Buffer.from(data);
    const actualType = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? 'image/jpeg'
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : null;
    if (!actualType || actualType !== contentType)
      throw new BadRequestException('Photo bytes must match a JPEG, PNG or WebP content type.');
    if (!key.endsWith('.webp'))
      throw new BadRequestException('New local photos must use a WebP key.');
    // One decode at a time on the small host; reject excess work rather than queueing buffers.
    if (this.processing) throw new ConflictException('Another photo is processing. Try again.');
    this.processing = true;
    try {
      let optimized: Buffer;
      try {
        optimized = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' })
          .rotate()
          .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80, effort: 3 })
          .toBuffer();
      } catch {
        throw new BadRequestException('Photo is corrupt, unsupported, or exceeds 40 megapixels.');
      }
      const path = await this.safePath(key, true);
      // Publish the complete file atomically, without replacing an immutable URL.
      const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, optimized, { flag: 'wx', mode: 0o644 });
        await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'EEXIST')
            throw new ConflictException('This photo was already uploaded.');
          throw error;
        });
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    } finally {
      this.processing = false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const path = await this.safePath(key);
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async objectExists(key: string): Promise<boolean> {
    const path = await this.safePath(key);
    return lstat(path).then(
      (stat) => stat.isFile() && stat.size > 0,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      },
    );
  }

  publicUrl(key: string): string {
    this.validateKey(key);
    const base = new URL(this.env('LOCAL_STORAGE_PUBLIC_BASE_URL'));
    if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash)
      throw new Error('LOCAL_STORAGE_PUBLIC_BASE_URL must be an http(s) base URL.');
    return `${base.href.replace(/\/$/, '')}/${key}`;
  }

  private validateKey(key: string): void {
    if (!keyPattern.test(key)) throw new BadRequestException('Invalid photo object key.');
  }

  private async safePath(key: string, create = false): Promise<string> {
    this.validateKey(key);
    const root = resolve(this.env('LOCAL_STORAGE_DIR'));
    const path = resolve(root, key);
    if (!path.startsWith(`${root}${sep}`)) throw new BadRequestException('Invalid photo path.');
    if (create) await mkdir(root, { recursive: true });
    let current = root;
    for (const part of ['', ...key.split('/').slice(0, -1)]) {
      current = join(current, part);
      if (create)
        await mkdir(current).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
      const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (!create && error.code === 'ENOENT') return null;
        throw error;
      });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
        throw new BadRequestException('Photo directories must not be symlinks.');
    }
    return join(dirname(path), key.split('/').at(-1)!);
  }

  private env(name: 'LOCAL_STORAGE_DIR' | 'LOCAL_STORAGE_PUBLIC_BASE_URL'): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be configured before using local storage.`);
    return value;
  }
}
