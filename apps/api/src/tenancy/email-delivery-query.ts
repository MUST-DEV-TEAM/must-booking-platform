import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const STATUSES = ['QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED'];
const FILTERS: Record<string, string[]> = {
  all: STATUSES,
  problems: ['FAILED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED'],
  queued: ['QUEUED'],
  bounced: ['BOUNCED'],
  complained: ['COMPLAINED'],
};
const SORTS: Record<string, Prisma.Sql> = {
  created: Prisma.sql`em.created_at`,
  label: Prisma.sql`em.event_type`,
  recipient: Prisma.sql`em.recipient_email`,
  status: Prisma.sql`em.status::text`,
  subject: Prisma.sql`em.subject`,
  attempts: Prisma.sql`em.attempt_count`,
  booking: Prisma.sql`COALESCE(b.order_reference,b.external_reference,'')`,
};
function text(value: unknown, max: number, name: string) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > max)
    throw new BadRequestException(`Invalid ${name}.`);
  return value.trim();
}
function date(value: unknown) {
  const v = text(value, 10, 'delivery date');
  if (
    v &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      v.startsWith('0000-') ||
      Number.isNaN(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v)
  )
    throw new BadRequestException('Use a valid YYYY-MM-DD delivery date.');
  return v || null;
}
/** One validated, parameterized filter for the delivery directory and its audited exports. */
export function emailDeliveryQuery(query: Record<string, unknown>, observedAt?: Date) {
  const anchor = observedAt
    ? Prisma.sql`${observedAt}::timestamptz`
    : Prisma.sql`transaction_timestamp()`;
  const filter = text(query.filter, 20, 'delivery filter') || 'all';
  const status = text(query.status, 20, 'delivery status');
  if (!FILTERS[filter] || (status && !STATUSES.includes(status)))
    throw new BadRequestException('Unknown email delivery status or filter.');
  const statuses = status ? FILTERS[filter].filter((s) => s === status) : FILTERS[filter];
  const topic = text(query.topic, 100, 'delivery topic');
  const recipient = text(query.recipient, 320, 'recipient').toLowerCase();
  const search = text(query.search, 200, 'delivery search').toLowerCase();
  const from = date(query.from),
    to = date(query.to);
  if (from && to && (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 365))
    throw new BadRequestException('Choose an ordered date range of at most 366 days.');
  const hours = query.hours === undefined || query.hours === '' ? null : Number(query.hours);
  if (hours !== null && ![24, 168].includes(hours))
    throw new BadRequestException('Use a 24 or 168 hour window.');
  const sort = text(query.sort, 20, 'delivery sort') || 'created';
  const direction = text(query.direction, 4, 'delivery sort direction') || 'desc';
  if (!SORTS[sort] || !['asc', 'desc'].includes(direction))
    throw new BadRequestException('Invalid delivery sort.');
  return {
    filter,
    status,
    topic,
    recipient,
    search,
    from,
    to,
    hours,
    sort,
    direction,
    where: Prisma.sql`em.created_at<=${anchor} AND em.status::text=ANY(${statuses}::text[])
      AND (${topic}='' OR em.event_type=${topic})
      AND (${recipient}='' OR strpos(lower(em.recipient_email),${recipient})>0)
      AND (${search}='' OR strpos(lower(concat_ws(' ',em.subject,em.recipient_email,em.event_type,b.order_reference,b.external_reference)),${search})>0)
      AND (${hours}::int IS NULL OR em.created_at>=${anchor}-make_interval(hours=>${hours}::int))
      AND (${from}::date IS NULL OR (em.created_at AT TIME ZONE p.timezone)::date>=${from}::date)
      AND (${to}::date IS NULL OR (em.created_at AT TIME ZONE p.timezone)::date<=${to}::date)`,
    order: Prisma.sql`${SORTS[sort]} ${direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`},em.id ${direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`}`,
  };
}
