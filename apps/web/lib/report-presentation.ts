import { formatMoney } from './money';
import type { ReportCell, ReportColumn, ReportQuery, ReportRow } from './report-types';
export const reportLabel = (key: string) =>
  ({
    roomRevenue: 'Booked room revenue',
    netCollected: 'Net collected',
    expectedOnArrival: 'Expected on arrival',
    financial: 'Revenue and cash by currency',
    averageLengthOfStay: 'Average stay (nights)',
    averageLeadDays: 'Average lead time (days)',
    statuses: 'Reservation status',
    sourceMix: 'Booking source',
    mealPlanMix: 'Meal plan (current)',
    ratePlanMix: 'Rate plan (current)',
    planBasisMix: 'Plan basis (current)',
    forward: 'On the books ahead',
    noShow: 'Stored no-show evidence',
    inventorySchedules: 'Saved Inventory schedules',
    chargeCoverage: 'Recorded charge coverage',
    breakdowns: 'Revenue breakdowns',
    staffActivity: 'Activity by action',
    staffByUser: 'Activity by staff member',
    staffByDay: 'Activity by day',
    paymentMethods: 'Cash by payment method',
    today: 'Scheduled today',
    occupancy: 'Occupancy %',
    cancellationRate: 'Cancellation rate %',
    roomTypeName: 'Room type',
    ratePlanName: 'Rate plan',
    pricingBasis: 'Pricing basis',
  })[key] ??
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (s) => s.toUpperCase());
export function reportValue(
  value: unknown,
  type?: ReportColumn['type'],
  currency?: string,
): string {
  if (value === null || value === undefined) return 'Unknown';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (type === 'money') return currency ? formatMoney(String(value), currency) : String(value);
  if (type === 'percent') return `${typeof value === 'number' ? value.toFixed(1) : String(value)}%`;
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(2);
  return String(value);
}
export function reportSearch(q: ReportQuery) {
  return new URLSearchParams(
    Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
export function reportPreset(today: string, preset: string) {
  const d = new Date(today + 'T12:00:00Z');
  const shift = (n: number) => {
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + n);
    return next.toISOString().slice(0, 10);
  };
  return {
    from:
      preset === 'today'
        ? today
        : preset === 'week'
          ? shift(-6)
          : preset === 'month'
            ? today.slice(0, 8) + '01'
            : shift(-29),
    to: today,
  };
}
/** Money series stay separate; repeated non-money counts are deduplicated by period. */
export function reportChartData(rows: ReportRow[], column: ReportColumn) {
  const groups = new Map<string, Map<string, ReportCell>>();
  for (const row of rows) {
    const key = column.money ? String(row.currency ?? 'Currency not recorded') : column.label;
    const values = groups.get(key) ?? new Map<string, ReportCell>();
    values.set(String(row.date), row[column.key] ?? null);
    groups.set(key, values);
  }
  const dates = [...new Set(rows.map((r) => String(r.date)))];
  return {
    dates,
    series: [...groups].map(([name, values]) => ({
      name,
      values: dates.map((date) => values.get(date) ?? null),
    })),
  };
}
export class ReportRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reference?: string,
  ) {
    super(message);
  }
}
export async function reportRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init });
  if (!response.ok) {
    let body: { message?: unknown } = {};
    try {
      body = await response.json();
    } catch {
      /* preserve status/reference */
    }
    throw new ReportRequestError(
      response.status === 403
        ? 'Reports permission or additional access is required.'
        : typeof body.message === 'string'
          ? body.message
          : 'Unable to load this report.',
      response.status,
      response.headers.get('x-request-id') ?? undefined,
    );
  }
  return response.json() as Promise<T>;
}
