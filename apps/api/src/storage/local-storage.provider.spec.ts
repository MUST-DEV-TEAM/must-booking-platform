import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageProvider, MAX_PHOTO_BYTES } from './local-storage.provider';

const tenant = '11111111-1111-4111-8111-111111111111';
const property = '22222222-2222-4222-8222-222222222222';
const room = '33333333-3333-4333-8333-333333333333';
const key = `room-types/${tenant}/${property}/${room}/44444444-4444-4444-8444-444444444444.webp`;

describe('LocalStorageProvider', () => {
  let directory: string;
  let storage: LocalStorageProvider;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'must-photos-'));
    vi.stubEnv('LOCAL_STORAGE_DIR', directory);
    vi.stubEnv('LOCAL_STORAGE_PUBLIC_BASE_URL', 'https://booking.example.test/photos');
    storage = new LocalStorageProvider();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it.each(['jpeg', 'png', 'webp'] as const)(
    'writes a decoded, optimized WebP from %s and deletes it idempotently',
    async (format) => {
      const data = await sharp({
        create: { width: 3000, height: 1500, channels: 3, background: '#447788' },
      })
        [format]()
        .toBuffer();
      await storage.uploadObject(key, data, `image/${format}`);
      const saved = await readFile(join(directory, key));
      const metadata = await sharp(saved).metadata();
      expect(metadata).toMatchObject({ format: 'webp', width: 2000, height: 1000 });
      expect(metadata.exif).toBeUndefined();
      expect(saved.length).toBeLessThan(data.length);
      expect(await storage.objectExists(key)).toBe(true);
      expect(storage.publicUrl(key)).toBe(`https://booking.example.test/photos/${key}`);
      await expect(storage.uploadObject(key, data, `image/${format}`)).rejects.toThrow(
        'already uploaded',
      );
      await storage.deleteObject(key);
      await storage.deleteObject(key);
      expect(await storage.objectExists(key)).toBe(false);
    },
  );

  it('preserves the PUT contract and existing property-library namespace', async () => {
    const libraryKey = `library/${tenant}/${property}/44444444-4444-4444-8444-444444444444.webp`;
    const { uploadUrl } = await storage.createPresignedUpload({
      key: libraryKey,
      contentType: 'image/png',
      contentLength: 100,
    });
    const url = new URL(uploadUrl, 'https://booking.example.test');
    expect(url.pathname).toBe(`/api/tenants/${tenant}/properties/${property}/photo-uploads`);
    expect(url.searchParams.get('key')).toBe(libraryKey);
    const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: 'white' } })
      .png()
      .toBuffer();
    await storage.uploadObject(libraryKey, png, 'image/png');
    expect(await sharp(await readFile(join(directory, libraryKey))).metadata()).toMatchObject({
      width: 12,
      height: 8,
    });
  });

  it.each([
    '../escape.webp',
    '/absolute.webp',
    'room-types/../../escape.webp',
    key.replace('room-types/', 'room-types\\'),
    key.replace('.webp', '%2f..%2f.webp'),
  ])('rejects traversal or malformed keys: %s', async (badKey) => {
    await expect(storage.deleteObject(badKey)).rejects.toThrow('Invalid photo object key');
    await expect(storage.uploadObject(badKey, Buffer.from('bad'), 'image/png')).rejects.toThrow(
      'Invalid photo object key',
    );
    expect(() => storage.publicUrl(badKey)).toThrow('Invalid photo object key');
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects fake headers, disallowed magic bytes and corrupt images before writing', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } })
      .png()
      .toBuffer();
    for (const [data, type] of [
      [png, 'image/jpeg'],
      [Buffer.from('GIF89a'), 'image/png'],
      [Buffer.from('<svg/>'), 'image/webp'],
      [png.subarray(0, 16), 'image/png'],
    ] as const) {
      await expect(storage.uploadObject(key, data, type)).rejects.toThrow();
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it('rejects actual bytes above 10 MB and an empty body, independently of declared size', async () => {
    await expect(
      storage.uploadObject(key, Buffer.alloc(MAX_PHOTO_BYTES + 1), 'image/png'),
    ).rejects.toThrow('10 MB');
    await expect(storage.uploadObject(key, Buffer.alloc(0), 'image/png')).rejects.toThrow('10 MB');
    await expect(
      storage.createPresignedUpload({ key, contentType: 'image/svg+xml', contentLength: 100 }),
    ).rejects.toThrow('Only JPEG');
    await expect(
      storage.createPresignedUpload({
        key,
        contentType: 'image/png',
        contentLength: MAX_PHOTO_BYTES + 1,
      }),
    ).rejects.toThrow('10 MB');
    expect(await readdir(directory)).toEqual([]);
  });
});
