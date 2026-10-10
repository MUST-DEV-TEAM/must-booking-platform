import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/**
 * Imports a folder of room photos through the same HTTP API the dashboard uses
 * (library upload -> verify -> attach to room type), so authorization, auditing and
 * validation are identical to a manual upload. Nothing here touches the database or
 * object storage directly.
 *
 * Layout: <dir>/<Room folder>/<photos> are attached to the mapped room type (first photo
 * in name order becomes the main image of a room that has no photos yet). Loose files in
 * <dir> that are not copies of a folder photo go into the library only.
 *
 * Dry run (default) only reads local files and the public catalog and prints the plan:
 *   tsx scripts/import-room-photos.ts --dir <path> --tenant <id> --property <id>
 * Real run (prompts nothing; review the dry run first):
 *   IMPORT_EMAIL=... IMPORT_PASSWORD=... tsx scripts/import-room-photos.ts ... --apply
 *
 * Safe to re-run: photos already in the library (same file name) are not uploaded again and
 * photos already attached to a room are skipped.
 */

// Local folder name -> live room type name. Names are compared case-insensitively with
// whitespace collapsed. Several folders may point at one room type.
const FOLDER_TO_ROOM_TYPE: Record<string, string> = {
  'Deluxe Suite': 'Deluxe Suite Sea View',
  'Deluxe Suite with Jacuzzi': 'Deluxe Room - Jackuzzi: Garden Entrance',
  'Duplex Suite': 'Duplex Suite: Garden Entrance',
  'Executive Suite': 'Executive Suite Sea View',
  'Junior Suite': 'Junior Suite Sea View',
  'Standard Double Room with Mountain View': 'Standard Double Mountain View',
  'Standard Double Room with Side Sea View': 'Standard Double Side Sea View',
  'Standard Double Room with Pool Sea View & Balcony': 'Standard Double Pool & Sea View',
  'Standard Double Room with Pool View': 'Standard Double pool sea view no balcony',
  'Standard Double Room with Garden Sea View & Balcony': 'Standard Double Garden Sea View',
  'Standard Double Room with Garden Sea View': 'Standard Double garden sea view no balcony',
  'Standard Twin Room with Mountain View': 'Standard Double/Twin room',
  'Twin Room with Mountain View': 'Standard Double/Twin room',
  // Owner assumption 2026-09-30 (Milestone 23): confirm before the real run.
  'Standard Double Room with Direct Pool Access': 'Standard Double room with direct pool entrance',
  'Standard Double Room with Direct Pool Access & Balcony':
    'Standard Double room with direct pool entrance',
  'Standard Double Room With Garden & Sea View': 'Standard Double room',
};

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_ROOM_TYPE = 21;

type LocalPhoto = { name: string; path: string; hash: string; size: number; contentType: string };
type RoomType = { id: string; name: string };

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
const naturalOrder = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function scan(path: string): LocalPhoto {
  const contentType = IMAGE_TYPES[extname(path).toLowerCase()];
  const data = readFileSync(path);
  return {
    name: path.split(/[\\/]/).pop()!,
    path,
    hash: createHash('sha256').update(data).digest('hex'),
    size: data.length,
    contentType,
  };
}

function readLocal(dir: string) {
  const folders = new Map<string, LocalPhoto[]>();
  const loose: LocalPhoto[] = [];
  const skipped: string[] = [];
  for (const entry of readdirSync(dir).sort(naturalOrder)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const photos: LocalPhoto[] = [];
      for (const file of readdirSync(path).sort(naturalOrder)) {
        if (IMAGE_TYPES[extname(file).toLowerCase()]) photos.push(scan(join(path, file)));
        else skipped.push(join(entry, file));
      }
      folders.set(entry, photos);
    } else if (IMAGE_TYPES[extname(entry).toLowerCase()]) {
      loose.push(scan(path));
    } else {
      skipped.push(entry);
    }
  }
  return { folders, loose, skipped };
}

async function catalogRoomTypes(base: string, tenant: string, property: string) {
  const startsOn = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const endsOn = new Date(Date.now() + 32 * 86_400_000).toISOString().slice(0, 10);
  const response = await fetch(
    `${base}/api/tenants/${tenant}/properties/${property}/public/catalog?startsOn=${startsOn}&endsOn=${endsOn}`,
  );
  if (!response.ok) throw new Error(`Public catalog request failed (${response.status}).`);
  return ((await response.json()) as { roomTypes: RoomType[] }).roomTypes;
}

class Api {
  private cookie = '';
  constructor(
    private readonly base: string,
    private readonly tenant: string,
    private readonly property: string,
  ) {}

  async login(email: string, password: string) {
    const response = await fetch(`${this.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error(`Login failed (${response.status}).`);
    const session = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .find((value) => value.startsWith('must_session='));
    if (!session) throw new Error('Login did not return a session cookie.');
    this.cookie = session;
  }

  private url(path: string) {
    return `${this.base}/api/tenants/${this.tenant}/properties/${this.property}/${path}`;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        cookie: this.cookie,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(
        `${init.method ?? 'GET'} ${path} -> ${response.status} ${body?.message ?? ''}`,
      );
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }
}

async function main() {
  const dir = flag('dir');
  const tenant = flag('tenant');
  const property = flag('property');
  const base = (flag('base') ?? 'https://booking.must.al').replace(/\/$/, '');
  const apply = process.argv.includes('--apply');
  if (!dir || !tenant || !property)
    throw new Error(
      'Usage: import-room-photos --dir <path> --tenant <id> --property <id> [--apply]',
    );

  const { folders, loose: allLoose, skipped } = readLocal(dir);
  // Optional --exclude <file>: one file name per line (e.g. from the contact sheet) to leave out.
  const excludeFile = flag('exclude');
  const excluded = new Set(
    excludeFile
      ? readFileSync(excludeFile, 'utf-8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [],
  );
  const loose = allLoose.filter((photo) => !excluded.has(photo.name));
  const api = new Api(base, tenant, property);
  let roomTypes: RoomType[];
  if (apply) {
    const email = process.env.IMPORT_EMAIL;
    const password = process.env.IMPORT_PASSWORD;
    if (!email || !password)
      throw new Error('IMPORT_EMAIL and IMPORT_PASSWORD are required for --apply.');
    await api.login(email, password);
    roomTypes = await api.request<RoomType[]>('room-types');
  } else {
    roomTypes = await catalogRoomTypes(base, tenant, property);
  }
  const byName = new Map(roomTypes.map((roomType) => [normalize(roomType.name), roomType]));

  // --- Plan -------------------------------------------------------------------------
  const folderHashes = new Set<string>();
  const plan = new Map<string, { roomType: RoomType; photos: LocalPhoto[] }>();
  const problems: string[] = [];
  for (const [folder, photos] of folders) {
    const target = FOLDER_TO_ROOM_TYPE[folder];
    const roomType = target ? byName.get(normalize(target)) : undefined;
    if (!target) problems.push(`Folder "${folder}" has no mapping.`);
    else if (!roomType)
      problems.push(`Folder "${folder}" -> room type "${target}" does not exist.`);
    for (const photo of photos) {
      folderHashes.add(photo.hash);
      if (photo.size > MAX_BYTES) problems.push(`${folder}/${photo.name} exceeds 10 MB.`);
    }
    if (!roomType) continue;
    const entry = plan.get(roomType.id) ?? { roomType, photos: [] };
    for (const photo of photos)
      if (!entry.photos.some((existing) => existing.hash === photo.hash)) entry.photos.push(photo);
    plan.set(roomType.id, entry);
  }
  for (const { roomType, photos } of plan.values())
    if (photos.length > MAX_PER_ROOM_TYPE)
      problems.push(
        `"${roomType.name}" would get ${photos.length} photos (max ${MAX_PER_ROOM_TYPE}).`,
      );
  const looseOnly: LocalPhoto[] = [];
  const seenLoose = new Set<string>();
  for (const photo of loose) {
    if (folderHashes.has(photo.hash) || seenLoose.has(photo.hash)) continue;
    seenLoose.add(photo.hash);
    looseOnly.push(photo);
  }
  const uniqueFolderPhotos = new Set(
    [...plan.values()].flatMap((entry) => entry.photos.map((p) => p.hash)),
  );

  console.log(`${apply ? 'APPLY' : 'DRY RUN'} against ${base}\n`);
  for (const { roomType, photos } of plan.values()) {
    console.log(`${roomType.name}  (${photos.length} photos)`);
    photos.forEach((photo, index) =>
      console.log(`   ${index === 0 ? '* main' : '      '}  ${photo.name}`),
    );
  }
  const covered = new Set(plan.keys());
  const uncovered = roomTypes.filter((roomType) => !covered.has(roomType.id));
  console.log(
    `\nRoom types with no photos in this import: ${uncovered.map((r) => r.name).join('; ') || 'none'}`,
  );
  console.log(`Unique folder photos: ${uniqueFolderPhotos.size}`);
  console.log(`Loose photos (library only, not copies of folder photos): ${looseOnly.length}`);
  if (skipped.length) console.log(`Ignored non-image files: ${skipped.join(', ')}`);
  if (problems.length) {
    console.log(`\nPROBLEMS (fix before applying):\n - ${problems.join('\n - ')}`);
    if (apply) process.exitCode = 1;
  }
  if (!apply || problems.length) {
    if (!apply) console.log('\nNothing was changed. Re-run with --apply to import.');
    return;
  }

  // --- Apply ------------------------------------------------------------------------
  const library =
    await api.request<Array<{ id: string; originalName: string | null }>>('image-library');
  const libraryIdByName = new Map(
    library.filter((image) => image.originalName).map((image) => [image.originalName!, image.id]),
  );
  const libraryIdByHash = new Map<string, string>();
  let uploaded = 0;
  const ensureInLibrary = async (photo: LocalPhoto): Promise<string> => {
    const known = libraryIdByHash.get(photo.hash) ?? libraryIdByName.get(photo.name);
    if (known) {
      libraryIdByHash.set(photo.hash, known);
      return known;
    }
    const authorization = await api.request<{ id: string; uploadUrl: string }>('image-library', {
      method: 'POST',
      body: JSON.stringify({
        contentType: photo.contentType,
        contentLength: photo.size,
        name: photo.name,
      }),
    });
    const put = await fetch(authorization.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': photo.contentType },
      body: readFileSync(photo.path),
    });
    if (!put.ok) {
      await api
        .request(`image-library/${authorization.id}`, { method: 'DELETE' })
        .catch(() => undefined);
      throw new Error(`Upload of ${photo.name} failed (${put.status}).`);
    }
    await api.request(`image-library/${authorization.id}/confirm`, { method: 'POST' });
    libraryIdByHash.set(photo.hash, authorization.id);
    uploaded += 1;
    console.log(`  uploaded ${photo.name}`);
    return authorization.id;
  };

  for (const { roomType, photos } of plan.values()) {
    const ids: string[] = [];
    for (const photo of photos) ids.push(await ensureInLibrary(photo));
    const result = await api.request<{ added: number }>(
      `room-types/${roomType.id}/images/from-library`,
      {
        method: 'POST',
        body: JSON.stringify({ libraryImageIds: ids }),
      },
    );
    console.log(
      `${roomType.name}: ${result.added} attached, ${ids.length - result.added} already there`,
    );
  }
  for (const photo of looseOnly) await ensureInLibrary(photo);
  console.log(`\nDone. ${uploaded} file(s) uploaded.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
