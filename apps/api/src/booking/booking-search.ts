import { BadRequestException } from '@nestjs/common';
import { BookingStatus } from '@must/domain-contracts';

/**
 * Query parsing and SQL building for the dashboard Reservations list (Milestone 24, B01).
 * Values never reach the SQL text: every user-supplied value becomes a numbered parameter, and
 * only fixed fragments defined in this file are concatenated.
 */

export const BOOKING_VIEWS = [
  'all',
  'arriving_today',
  'in_house',
  'departing_today',
  'upcoming',
  'needs_attention',
  'unpaid',
  'cancelled',
] as const;
export type BookingView = (typeof BOOKING_VIEWS)[number];

export const PAYMENT_FILTERS = [
  'paid',
  'deposit',
  'unpaid',
  'pay_at_hotel',
  'refunded',
  'failed',
  'none',
] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

const DATE_TYPES = ['arrival', 'departure', 'stay', 'created'] as const;
type DateType = (typeof DATE_TYPES)[number];
const SORTS = ['stay', 'created', 'total', 'guest'] as const;
type SortKey = (typeof SORTS)[number];
const SOURCES = ['DIRECT', 'WEBSITE', 'UNKNOWN'] as const;
type SourceFilter = (typeof SOURCES)[number];

export type BookingSearchQuery = {
  view: BookingView;
  search: string;
  statuses: BookingStatus[];
  payment: PaymentFilter | null;
  source: SourceFilter | null;
  dateType: DateType;
  from: string | null;
  to: string | null;
  sort: SortKey;
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

/** Statuses that hold or use a room (the same set as the overview's occupying statuses). */
export const LIVE_STATUSES = [
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.PAYMENT_NOT_REQUIRED,
  BookingStatus.PMS_CREATION_PENDING,
  BookingStatus.PMS_CONFIRMATION_PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.PMS_UNKNOWN_RESULT,
  BookingStatus.MANUAL_REVIEW,
] as const;

const ATTENTION_STATUSES = [
  BookingStatus.MANUAL_REVIEW,
  BookingStatus.PAYMENT_FAILED,
  BookingStatus.AVAILABILITY_FAILED,
  BookingStatus.PMS_REJECTED,
  BookingStatus.PMS_UNKNOWN_RESULT,
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function one(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined || value === '') return undefined;
  if (!(allowed as readonly string[]).includes(value))
    throw new BadRequestException(`${name} must be one of: ${allowed.join(', ')}.`);
  return value as T;
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

export function parseBookingSearchQuery(raw: Record<string, unknown>): BookingSearchQuery {
  const from = one(raw.from) || null;
  const to = one(raw.to) || null;
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value !== null && !isRealDate(value))
      throw new BadRequestException(`${name} must be a valid date in YYYY-MM-DD format.`);
  }
  if (from && to && from > to) throw new BadRequestException('from must not be after to.');

  const statusText = one(raw.status);
  const statuses = statusText
    ? statusText.split(',').map((value) => {
        const status = Object.values(BookingStatus).find((candidate) => candidate === value);
        if (!status) throw new BadRequestException(`Unknown booking status "${value}".`);
        return status;
      })
    : [];

  const page = Number(one(raw.page) ?? 1);
  const pageSize = Number(one(raw.pageSize) ?? 25);
  if (!Number.isInteger(page) || page < 1) throw new BadRequestException('page must be 1 or more.');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new BadRequestException('pageSize must be between 1 and 100.');

  const search = (one(raw.search) ?? '').trim();
  if (search.length > 100) throw new BadRequestException('search must be at most 100 characters.');

  return {
    view: oneOf(one(raw.view), BOOKING_VIEWS, 'view') ?? 'all',
    search,
    statuses,
    payment: oneOf(one(raw.payment), PAYMENT_FILTERS, 'payment') ?? null,
    source: oneOf(one(raw.source), SOURCES, 'source') ?? null,
    dateType: oneOf(one(raw.dateType), DATE_TYPES, 'dateType') ?? 'stay',
    from,
    to,
    sort: oneOf(one(raw.sort), SORTS, 'sort') ?? 'stay',
    direction: oneOf(one(raw.direction), ['asc', 'desc'] as const, 'direction') ?? 'desc',
    page,
    pageSize,
  };
}

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

/**
 * Fragments that depend on the inner query's computed columns: `today` (the property's local
 * date), `paid`, `refunded` and `payment_state` (same rules as the web app's paymentDisplay).
 */
export const PAYMENT_STATE_SQL = `CASE
  WHEN x.refunded > 0 THEN 'refunded'
  WHEN x.status = 'PAYMENT_FAILED' THEN 'failed'
  WHEN x.total_amount > 0 AND x.paid >= x.total_amount THEN 'paid'
  WHEN x.paid > 0 THEN 'deposit'
  WHEN x.total_amount = 0 OR x.payment_method = 'FREE' THEN 'none'
  WHEN x.payment_method = 'PAY_AT_HOTEL' THEN 'pay_at_hotel'
  ELSE 'unpaid'
END`;

const LIVE_SQL = `x.status IN (${quoted(LIVE_STATUSES)})`;

export const VIEW_SQL: Record<BookingView, string> = {
  all: 'TRUE',
  arriving_today: `x.status = 'CONFIRMED' AND x.starts_on = x.today`,
  in_house: `x.status = 'CONFIRMED' AND x.starts_on <= x.today AND x.ends_on > x.today`,
  departing_today: `x.status = 'CONFIRMED' AND x.ends_on = x.today`,
  upcoming: `${LIVE_SQL} AND x.starts_on > x.today`,
  needs_attention: `x.attention_open AND x.status IN (${quoted(ATTENTION_STATUSES)})`,
  unpaid: `${LIVE_SQL} AND x.payment_state IN ('unpaid', 'deposit')`,
  cancelled: `x.status IN ('CANCELLED', 'EXPIRED')`,
};

export type BuiltSearch = { where: string; orderBy: string; params: unknown[] };

/** Builds the WHERE and ORDER BY. `$1` is the tenant and `$2` the property, so these params start at `$3`. */
export function buildBookingSearch(query: BookingSearchQuery, firstParam = 2): BuiltSearch {
  const params: unknown[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return `$${firstParam + params.length}`;
  };
  const clauses: string[] = [VIEW_SQL[query.view]];

  if (query.search) {
    const pattern = `%${query.search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const p = next(pattern);
    clauses.push(
      `(concat_ws(' ', x.guest_first_name, x.guest_last_name) ILIKE ${p}
        OR x.guest_email ILIKE ${p} OR x.guest_phone ILIKE ${p}
        OR x.external_reference ILIKE ${p} OR COALESCE(x.order_reference, '') ILIKE ${p})`,
    );
  }
  if (query.statuses.length > 0) {
    clauses.push(`x.status = ANY(${next(query.statuses)}::"BookingStatus"[])`);
  }
  if (query.payment) clauses.push(`x.payment_state = ${next(query.payment)}`);
  if (query.source === 'UNKNOWN') clauses.push('x.source IS NULL');
  else if (query.source) clauses.push(`x.source = ${next(query.source)}`);

  const column = {
    arrival: 'x.starts_on',
    departure: 'x.ends_on',
    created: '(x.created_at AT TIME ZONE x.tz)::date',
    stay: null,
  }[query.dateType];
  if (query.dateType === 'stay') {
    // A stay overlaps the range when it starts on or before `to` and ends after `from`.
    if (query.to) clauses.push(`x.starts_on <= ${next(query.to)}::date`);
    if (query.from) clauses.push(`x.ends_on > ${next(query.from)}::date`);
  } else {
    if (query.from) clauses.push(`${column} >= ${next(query.from)}::date`);
    if (query.to) clauses.push(`${column} <= ${next(query.to)}::date`);
  }

  const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
  const sortColumn = {
    stay: 'x.starts_on',
    created: 'x.created_at',
    total: 'x.total_amount',
    guest: `lower(concat_ws(' ', x.guest_last_name, x.guest_first_name))`,
  }[query.sort];

  return {
    where: clauses.map((clause) => `(${clause})`).join(' AND '),
    orderBy: `${sortColumn} ${direction}, x.created_at DESC, x.id DESC`,
    params,
  };
}
