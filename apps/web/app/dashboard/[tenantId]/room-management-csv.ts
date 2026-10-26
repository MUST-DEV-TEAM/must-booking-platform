import type { RoomManagementData, RoomType } from './room-management-types';

export type AccommodationCsvKind = 'room-types' | 'rooms';
export type AccommodationCsvRow = Record<string, string>;

const roomTypeHeaders = [
  'id',
  'name',
  'description',
  'amenitiesIntro',
  'rules',
  'maxOccupancy',
  'status',
  'categoryId',
];
const roomHeaders = [
  'id',
  'roomTypeId',
  'roomTypeName',
  'name',
  'title',
  'roomSize',
  'rules',
  'description',
  'floor',
  'viewType',
  'isActive',
];

/** Builds an editable, stable-ID CSV export for the selected accommodation rows. */
export function accommodationCsv(
  kind: AccommodationCsvKind,
  items: Array<
    RoomType | { room: RoomManagementData['rooms'][string][number]; roomType: RoomType }
  >,
): string {
  const headers = kind === 'room-types' ? roomTypeHeaders : roomHeaders;
  const rows = items.map((item) => {
    if (kind === 'room-types') {
      const roomType = item as RoomType;
      return [
        roomType.id,
        roomType.name,
        roomType.description ?? '',
        roomType.amenitiesIntro ?? '',
        roomType.rules ?? '',
        String(roomType.maxOccupancy),
        roomType.status,
        roomType.categoryId ?? '',
      ];
    }
    const { room, roomType } = item as {
      room: RoomManagementData['rooms'][string][number];
      roomType: RoomType;
    };
    return [
      room.id,
      roomType.id,
      roomType.name,
      room.name,
      room.title ?? '',
      room.roomSize ?? '',
      room.rules ?? '',
      room.description ?? '',
      room.floor === null ? '' : String(room.floor),
      room.viewType ?? '',
      String(room.isActive),
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Parses RFC 4180-style CSV and checks that the selected import has its required columns. */
export function parseAccommodationCsv(
  kind: AccommodationCsvKind,
  contents: string,
): AccommodationCsvRow[] {
  const records = parseRecords(contents.replace(/^\uFEFF/, ''));
  const nonBlank = records.filter((record) => record.some((cell) => cell.trim() !== ''));
  if (nonBlank.length < 2)
    throw new Error('The CSV must include a header and at least one data row.');
  const headers = nonBlank[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error('Every CSV column needs a header.');
  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length)
    throw new Error('CSV column headers must be unique.');
  const required = kind === 'room-types' ? ['name', 'maxoccupancy'] : ['name'];
  const missing = required.filter((header) => !normalizedHeaders.includes(header));
  if (
    kind === 'rooms' &&
    !normalizedHeaders.includes('roomtypeid') &&
    !normalizedHeaders.includes('roomtypename')
  )
    missing.push('roomTypeId or roomTypeName');
  if (missing.length)
    throw new Error(
      `Missing required CSV column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`,
    );
  return nonBlank
    .slice(1)
    .map((record) =>
      Object.fromEntries(
        headers.map((header, index) => [
          header[0].toLowerCase() + header.slice(1),
          record[index] ?? '',
        ]),
      ),
    );
}

function csvCell(value: string): string {
  const safe = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function parseRecords(contents: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      if (cell) throw new Error('Unexpected quote in CSV value.');
      quoted = true;
    } else if (character === ',') {
      record.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && contents[index + 1] === '\n') index += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted value.');
  if (cell || record.length) {
    record.push(cell);
    records.push(record);
  }
  return records;
}
