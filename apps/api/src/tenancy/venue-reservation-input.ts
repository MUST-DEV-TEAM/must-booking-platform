import { BadRequestException } from '@nestjs/common';

export const STAFF_SOURCES = [
  'phone',
  'walk_in',
  'whatsapp',
  'instagram',
  'facebook',
  'viber',
  'messenger',
  'email',
  'hotel_reception',
  'google',
  'tripadvisor',
  'other',
] as const;
export type StaffSource = (typeof STAFF_SOURCES)[number];
export const SETTABLE_STATUSES = [
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];
const LIST_STATUSES = [
  'pending_payment',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 62;

function record(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new BadRequestException('A JSON object is required.');
  return raw as Record<string, unknown>;
}

function dateOnly(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException(`${label} must look like 2026-11-06.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new BadRequestException(`${label} is not a real date.`);
  return value;
}

function time(value: unknown): string {
  if (typeof value !== 'string' || !TIME.test(value))
    throw new BadRequestException('Time must look like 19:30.');
  return value;
}

function whole(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new BadRequestException(`${label} must be a whole number from ${min} to ${max}.`);
  return value;
}

function optionalText(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException(`${label} must be text.`);
  const trimmed = value.trim();
  if (trimmed.length > max)
    throw new BadRequestException(`${label} must be at most ${max} characters.`);
  return trimmed === '' ? null : trimmed;
}

function name(value: unknown): string {
  const text = optionalText(value, 'Guest name', 200);
  if (!text) throw new BadRequestException('Guest name is required.');
  return text;
}

function email(value: unknown): string | null {
  const text = optionalText(value, 'Email', 320);
  if (text && !EMAIL.test(text))
    throw new BadRequestException('Email is not a valid email address.');
  return text ? text.toLowerCase() : null;
}

function uuidOrNull(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value))
    throw new BadRequestException(`${label} must be a valid id.`);
  return value.toLowerCase();
}

export type ReservationCreate = {
  date: string;
  time: string;
  partySize: number;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  notes: string | null;
  source: StaffSource;
  tableId: string | null;
  durationMinutes: number | null;
};

export function parseReservationCreate(raw: unknown): ReservationCreate {
  const body = record(raw);
  const source = body.source === undefined ? 'other' : body.source;
  if (typeof source !== 'string' || !STAFF_SOURCES.includes(source as StaffSource))
    throw new BadRequestException(`Source must be one of ${STAFF_SOURCES.join(', ')}.`);
  return {
    date: dateOnly(body.date, 'Date'),
    time: time(body.time),
    partySize: whole(body.partySize, 'Party size', 1, 500),
    guestName: name(body.guestName),
    guestPhone: optionalText(body.guestPhone, 'Phone', 50),
    guestEmail: email(body.guestEmail),
    notes: optionalText(body.notes, 'Notes', 1000),
    source: source as StaffSource,
    tableId: uuidOrNull(body.tableId, 'Table'),
    durationMinutes:
      body.durationMinutes === undefined || body.durationMinutes === null
        ? null
        : whole(body.durationMinutes, 'Time at the table', 30, 480),
  };
}

export type ReservationUpdate = Partial<
  Pick<
    ReservationCreate,
    'date' | 'time' | 'partySize' | 'guestName' | 'tableId' | 'durationMinutes'
  > & {
    guestPhone: string | null;
    guestEmail: string | null;
    notes: string | null;
  }
>;

/** Only the fields present are returned; an empty phone, email or note clears it. */
export function parseReservationUpdate(raw: unknown): ReservationUpdate {
  const body = record(raw);
  const update: ReservationUpdate = {};
  if ('date' in body) update.date = dateOnly(body.date, 'Date');
  if ('time' in body) update.time = time(body.time);
  if ('partySize' in body) update.partySize = whole(body.partySize, 'Party size', 1, 500);
  if ('guestName' in body) update.guestName = name(body.guestName);
  if ('guestPhone' in body) update.guestPhone = optionalText(body.guestPhone, 'Phone', 50);
  if ('guestEmail' in body) update.guestEmail = email(body.guestEmail);
  if ('notes' in body) update.notes = optionalText(body.notes, 'Notes', 1000);
  if ('tableId' in body) update.tableId = uuidOrNull(body.tableId, 'Table');
  if ('durationMinutes' in body)
    update.durationMinutes = whole(body.durationMinutes, 'Time at the table', 30, 480);
  if (Object.keys(update).length === 0) throw new BadRequestException('Nothing to update.');
  return update;
}

export function parseStatusChange(raw: unknown): { status: SettableStatus; note: string | null } {
  const body = record(raw);
  if (typeof body.status !== 'string' || !SETTABLE_STATUSES.includes(body.status as SettableStatus))
    throw new BadRequestException(`Status must be one of ${SETTABLE_STATUSES.join(', ')}.`);
  return { status: body.status as SettableStatus, note: optionalText(body.note, 'Note', 500) };
}

export type ListQuery = {
  from: string;
  to: string;
  statuses: string[] | null;
  q: string | null;
  limit: number;
  offset?: number;
  sort?: 'startsAt' | 'guestName' | 'partySize' | 'status' | 'table';
  order?: 'asc' | 'desc';
};

export function parseListQuery(query: Record<string, unknown>): ListQuery {
  const from = dateOnly(query.from, 'From');
  const to = query.to === undefined ? from : dateOnly(query.to, 'To');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0) throw new BadRequestException('The end date cannot be before the start date.');
  if (days > MAX_RANGE_DAYS)
    throw new BadRequestException(`Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
  let statuses: string[] | null = null;
  if (typeof query.status === 'string' && query.status !== '') {
    statuses = query.status.split(',').map((s) => s.trim());
    if (statuses.some((s) => !(LIST_STATUSES as readonly string[]).includes(s)))
      throw new BadRequestException('Unknown status.');
  }
  const q = typeof query.q === 'string' && query.q.trim() ? query.q.trim().slice(0, 100) : null;
  const limit = query.limit === undefined ? 300 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new BadRequestException('The limit must be from 1 to 500.');
  const offset =
    query.offset === undefined ? undefined : whole(Number(query.offset), 'Offset', 0, 1000000);
  const sort = query.sort;
  if (
    sort !== undefined &&
    !['startsAt', 'guestName', 'partySize', 'status', 'table'].includes(String(sort))
  )
    throw new BadRequestException('Choose a supported sort field.');
  const order = query.order;
  if (order !== undefined && order !== 'asc' && order !== 'desc')
    throw new BadRequestException('Order must be asc or desc.');
  return {
    from,
    to,
    statuses,
    q,
    limit,
    ...(offset === undefined ? {} : { offset }),
    ...(sort === undefined ? {} : { sort: sort as ListQuery['sort'] }),
    ...(order === undefined ? {} : { order: order as ListQuery['order'] }),
  };
}

export type AvailabilityQuery = {
  date: string;
  partySize: number;
  channel: 'staff' | 'online';
  areaId: string | null;
  durationMinutes?: number;
  time?: string;
};

export function parseAvailabilityQuery(query: Record<string, unknown>): AvailabilityQuery {
  const channel = query.channel === undefined ? 'staff' : query.channel;
  if (channel !== 'staff' && channel !== 'online')
    throw new BadRequestException('Channel must be staff or online.');
  const partySize = Number(query.partySize);
  return {
    date: dateOnly(query.date, 'Date'),
    partySize: whole(Number.isFinite(partySize) ? partySize : NaN, 'Party size', 1, 500),
    channel,
    areaId: uuidOrNull(query.areaId, 'Area'),
    ...(query.durationMinutes === undefined
      ? {}
      : { durationMinutes: whole(Number(query.durationMinutes), 'Time at the table', 30, 480) }),
    ...(query.time === undefined ? {} : { time: time(query.time) }),
  };
}

/** A floor interval is end-exclusive; an instant retains the existing `at` contract. */
export function parseFloorQuery(
  query: Record<string, unknown>,
  now = new Date(),
): { at: Date; to: Date | null } {
  const instant = (value: unknown, field: string) => {
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ||
      Number.isNaN(Date.parse(value))
    )
      throw new BadRequestException(`${field} must be a date and time with a time zone.`);
    return new Date(value);
  };
  if (query.from !== undefined || query.to !== undefined) {
    if (query.at !== undefined)
      throw new BadRequestException('Choose either at or a from/to period.');
    const from = instant(query.from, 'from');
    const to = instant(query.to, 'to');
    if (to <= from || to.getTime() - from.getTime() > 48 * 3600000)
      throw new BadRequestException(
        'Choose a period longer than zero and no longer than 48 hours.',
      );
    return { at: from, to };
  }
  return { at: query.at === undefined ? now : instant(query.at, 'at'), to: null };
}
