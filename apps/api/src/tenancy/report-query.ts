import { BadRequestException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { reportRange, shiftDay } from './report-metrics';

export const reportKinds = [
  'overview',
  'reservations',
  'revenue',
  'occupancy',
  'accommodation',
  'guests',
  'pricing',
  'operations',
  'quality',
] as const;
export type ReportKind = (typeof reportKinds)[number];
export type ReportQuery = {
  report: ReportKind;
  from: string;
  to: string;
  comparison: 'none' | 'previous' | 'year';
  group: 'day' | 'week' | 'month';
  page: number;
  pageSize: number;
  sort: string;
  direction: 'asc' | 'desc';
  rowBasis: 'created' | 'stay' | 'arrival' | 'departure' | 'cancellation' | 'payment';
  detail:
    | 'default'
    | 'balances'
    | 'reconciliation'
    | 'charges'
    | 'refunds'
    | 'issues'
    | 'emails'
    | 'staff';
  roomTypeId?: string;
  roomId?: string;
  ratePlanId?: string;
  status?: string;
  paymentMethod?: string;
  source?: string;
  bookingMode?: string;
  currency?: string;
};
export function reportInvalid(message: string): never {
  throw new BadRequestException({ code: 'REPORT_INVALID', message });
}
export function reportObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    reportInvalid('Expected a report configuration object.');
  return value as Record<string, unknown>;
}
export function parseReportQuery(value: unknown, today: string): ReportQuery {
  const v = reportObject(value ?? {});
  const keys = [
    'report',
    'from',
    'to',
    'comparison',
    'group',
    'page',
    'pageSize',
    'sort',
    'direction',
    'rowBasis',
    'detail',
    'roomTypeId',
    'roomId',
    'ratePlanId',
    'status',
    'paymentMethod',
    'source',
    'bookingMode',
    'currency',
  ];
  if (Object.keys(v).some((k) => !keys.includes(k))) reportInvalid('Unknown report filter.');
  const choice = <T extends string>(
    key: string,
    values: readonly T[],
    fallback?: T,
  ): T | undefined => {
    const raw = v[key] ?? fallback;
    if (raw === undefined || raw === '') return fallback;
    if (typeof raw !== 'string' || !values.includes(raw as T)) reportInvalid(`Invalid ${key}.`);
    return raw as T;
  };
  const str = (key: string, fallback: string) => {
    if (v[key] === undefined) return fallback;
    if (typeof v[key] !== 'string') reportInvalid(`Invalid ${key}.`);
    return v[key] as string;
  };
  const int = (key: string, fallback: number, max: number) => {
    const raw = v[key] ?? fallback;
    if ((typeof raw !== 'number' && typeof raw !== 'string') || !/^\d+$/.test(String(raw)))
      reportInvalid(`Invalid ${key}.`);
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) reportInvalid(`Invalid ${key}.`);
    return n;
  };
  const to = str('to', today),
    from = str('from', shiftDay(toIsValid(to) ? to : today, -29));
  try {
    reportRange(from, to);
  } catch {
    reportInvalid('Choose valid dates covering 1 to 366 days.');
  }
  const result: ReportQuery = {
    report: choice('report', reportKinds, 'overview')!,
    from,
    to,
    comparison: choice('comparison', ['none', 'previous', 'year'], 'none')!,
    group: choice('group', ['day', 'week', 'month'], 'day')!,
    page: int('page', 1, 1000000),
    pageSize: int('pageSize', 25, 100),
    sort: str('sort', ''),
    direction: choice('direction', ['asc', 'desc'], 'asc')!,
    rowBasis: choice(
      'rowBasis',
      ['created', 'stay', 'arrival', 'departure', 'cancellation', 'payment'],
      'created',
    )!,
    detail: choice(
      'detail',
      ['default', 'balances', 'reconciliation', 'charges', 'refunds', 'issues', 'emails', 'staff'],
      'default',
    )!,
  };
  if (
    result.detail !== 'default' &&
    !(
      {
        revenue: ['balances', 'reconciliation', 'charges', 'refunds'],
        pricing: ['issues'],
        operations: ['emails', 'staff'],
      } as Record<string, string[]>
    )[result.report]?.includes(result.detail)
  )
    reportInvalid('This detail table is not available for the selected report.');
  if (result.sort.length > 60 || (result.sort && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(result.sort)))
    reportInvalid('Invalid sort field.');
  for (const key of ['roomTypeId', 'roomId', 'ratePlanId'] as const) {
    if (v[key] === undefined || v[key] === '') continue;
    if (
      typeof v[key] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        v[key] as string,
      )
    )
      reportInvalid(`Invalid ${key}.`);
    result[key] = (v[key] as string).toLowerCase();
  }
  result.status = choice('status', Object.values(BookingStatus));
  result.paymentMethod = choice('paymentMethod', [
    'STRIPE_CHECKOUT',
    'POKPAY',
    'PAY_AT_HOTEL',
    'FREE',
  ]);
  result.source = choice('source', ['DIRECT', 'WEBSITE', 'UNKNOWN']);
  result.bookingMode = choice('bookingMode', ['ROOM_TYPE_ONLY', 'INDIVIDUAL_ROOM_ONLY', 'MIXED']);
  if (v.currency !== undefined && v.currency !== '') {
    if (typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency))
      reportInvalid('Invalid currency.');
    result.currency = v.currency;
  }
  if (
    (result.report === 'operations' ||
      (result.report === 'pricing' && result.detail === 'issues')) &&
    [
      'roomTypeId',
      'roomId',
      'ratePlanId',
      'status',
      'paymentMethod',
      'source',
      'bookingMode',
      'currency',
    ].some((key) => result[key as keyof ReportQuery] !== undefined)
  )
    reportInvalid('This table supports date and grouping filters only. Clear reservation filters.');
  return result;
}
function toIsValid(day: string) {
  try {
    return reportRange(day, day).length === 1;
  } catch {
    return false;
  }
}

export type ReportCell = string | number | boolean | null;
export type ReportRow = { id: string; [key: string]: ReportCell };
export type ReportColumn = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'percent' | 'date' | 'link';
  money?: boolean;
};
