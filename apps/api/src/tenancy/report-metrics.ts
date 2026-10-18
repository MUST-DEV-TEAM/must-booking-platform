import { decimal, roundMinor } from '../booking/pricing-evaluator';

// Aggregates can exceed a single NUMERIC(12,2) row; retain exact integer cents.
function minor(value: string): bigint {
  if (!/^-?\d{1,40}(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid report money.');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return value.startsWith('-') ? -cents : cents;
}

export type MetricDefinition = {
  key: string;
  label: string;
  formula: string;
  dateBasis: string;
  money: boolean;
  currencyBasis: string;
  source: string;
  limitations: string;
};

const definition = (
  key: string,
  label: string,
  formula: string,
  dateBasis: string,
  money: boolean,
  source: string,
  limitations = '',
): MetricDefinition => ({
  key,
  label,
  formula,
  dateBasis,
  money,
  source,
  limitations,
  currencyBasis: money
    ? 'One stored ISO currency per figure; no conversion or cross-currency sum'
    : 'Not monetary',
});

/** Executable catalog used by every Reports definition projection. */
export const REPORT_METRICS: readonly MetricDefinition[] = [
  definition(
    'bookings',
    'Bookings created',
    'Count reservation-room records created in the period',
    'Property-local created date',
    false,
    'bookings.created_at',
    'Multi-room orders count each room record.',
  ),
  definition(
    'soldNights',
    'Sold room nights',
    'One current CONFIRMED booking-room per stay night',
    'Stay night; departure exclusive',
    false,
    'bookings.status, starts_on, ends_on',
    'Current on-the-books state, not a historical status snapshot.',
  ),
  definition(
    'availableNights',
    'Available room nights',
    'Sum known date-specific gross local room supply',
    'Stay night',
    false,
    'inventory_units or date-effective physical supply',
    'Clock and unknown historical physical supply: Unknown. Blocks stay in gross supply; no authoritative out-of-order classification.',
  ),
  definition(
    'blockedNights',
    'Blocked room nights',
    'Distinct capacity-night union affected by saved local blocks',
    'Stay night',
    false,
    'availability_blocks and scoped targets',
    'Current block state; not lost demand or historical out-of-service evidence.',
  ),
  definition(
    'occupancy',
    'Occupancy',
    'Sold room nights / available room nights × 100',
    'Stay night',
    false,
    'Confirmed bookings and known local supply',
    'Zero or unknown denominator: n/a. Clock supply: Unknown.',
  ),
  definition(
    'roomRevenue',
    'Booked room revenue',
    'Sum immutable nightly amounts minus all mandatory charge components',
    'Recognized stay night',
    true,
    'bookings.nightly_rates for current CONFIRMED bookings',
    'Tax-exclusive; legacy amount-only snapshots treated as tax-exclusive. Missing snapshots: Unknown; never reprice.',
  ),
  definition(
    'charges',
    'Mandatory charges',
    'Sum recorded kind=charge nightly components',
    'Recognized stay night',
    true,
    'bookings.nightly_rates.components',
    'Names are recorded labels, not a VAT/tourist-tax classification.',
  ),
  definition(
    'adr',
    'ADR',
    'Tax-exclusive room revenue / matching-currency sold room nights',
    'Stay night',
    true,
    'Immutable nightly snapshots and confirmed stays',
    'Per currency. Half away from zero to cents; unknown revenue or zero denominator: n/a.',
  ),
  definition(
    'revpar',
    'RevPAR',
    'Tax-exclusive room revenue / available room nights',
    'Stay night',
    true,
    'Immutable nightly snapshots and known supply',
    'Per currency; use that currency’s sold-night share of occupancy for the Occupancy × ADR identity. Never divide a partial unknown revenue sum. Clock denominator: Unknown.',
  ),
  definition(
    'trevpar',
    'TRevPAR',
    'Classified total revenue / available room nights',
    'Stay night',
    true,
    'Classified room and ancillary revenue',
    'Hidden without classified ancillary revenue evidence; mandatory charges alone do not establish ancillary revenue.',
  ),
  definition(
    'collected',
    'Collected',
    'Sum successful CHARGE rows (PAID or succeeded)',
    'Property-local ledger posting date',
    true,
    'payments.kind, status, amount, currency, created_at',
    'Posting time is not independently verified gateway settlement time.',
  ),
  definition(
    'refunded',
    'Refunded',
    'Sum successfully posted REFUND rows (REFUNDED, PAID or succeeded)',
    'Property-local refund ledger posting date',
    true,
    'payments.kind, status, amount, currency, created_at',
    'Failed/pending refunds excluded; provider processed timestamp not stored separately.',
  ),
  definition(
    'netCollected',
    'Net collected',
    'Collected − refunded',
    'Property-local ledger posting date',
    true,
    'Successful payment/refund ledger',
    'One currency per figure; negative net is valid.',
  ),
  definition(
    'outstanding',
    'Outstanding',
    'max(Booking gross − matching-currency net collected, 0)',
    'Booking cohort; ageing from arrival',
    true,
    'Booking total and successful linked ledger',
    'Currency mismatch excluded and reported, never converted.',
  ),
  definition(
    'collectionRate',
    'Collection rate',
    'Matching-currency net collected / gross booking value × 100',
    'Same booking cohort, not unrelated period cash/accrual',
    true,
    'Booking totals and successful linked ledger',
    'Null for zero/unknown denominator; monetary division uses integer arithmetic.',
  ),
  definition(
    'alos',
    'Average length of stay',
    'Full stay nights / reservation-room records',
    'Created booking cohort unless explicitly stated',
    false,
    'bookings.starts_on, ends_on',
    'Not clipped to the report window.',
  ),
  definition(
    'leadTime',
    'Booking lead time',
    'Arrival date − property-local creation date',
    'Created booking cohort',
    false,
    'bookings.starts_on, created_at',
    'Negative values retained for data-quality review.',
  ),
  definition(
    'cancellationRate',
    'Cancellation rate',
    'Currently cancelled / bookings created in selected period × 100',
    'Created booking cohort',
    false,
    'bookings.status, created_at',
    'Not cancellation-event count divided by an unrelated cohort.',
  ),
  definition(
    'cancellationLeadTime',
    'Cancellation lead time',
    'Arrival date − property-local actual cancellation date',
    'Cancellation event date',
    false,
    'booking.cancelled audit and booking arrival',
    'Missing event time: Unknown; updated_at is not a cancellation timestamp.',
  ),
  definition(
    'freeCancellation',
    'Cancellation within free window',
    'Actual cancellation instant <= snapshotted cutoff, or explicit unconditional free policy',
    'Cancellation event instant',
    false,
    'cancellation_is_free, cancellation_cutoff_at, cancellation audit',
    'Missing policy/time: Unknown. Never apply current policy retroactively.',
  ),
  definition(
    'noShowRate',
    'No-show rate',
    'Explicit no-shows / eligible arrival-cohort bookings × 100',
    'Arrival date',
    false,
    'Stored explicit PMS no-show evidence',
    'Hidden without normalized/stored evidence; elapsed arrival does not imply no-show.',
  ),
  definition(
    'pickup',
    'Pickup',
    'Current eligible OTB − eligible OTB at historical cutoff',
    'Same future stay window, two as-of instants',
    false,
    'Complete immutable reservation snapshots',
    'Hidden until historical status/date amendments can be reconstructed.',
  ),
  definition(
    'pace',
    'Pace',
    'Current OTB − comparable prior-period OTB at same lead time',
    'Comparable stay windows and equal lead time',
    false,
    'Complete immutable reservation snapshots',
    'Missing prior evidence: no data, not zero.',
  ),
  definition(
    'arrivals',
    'Arrivals',
    'Confirmed reservation-room records starting on date',
    'Arrival date',
    false,
    'bookings.starts_on, status',
    'Scheduled arrivals; does not assert actual check-in.',
  ),
  definition(
    'departures',
    'Departures',
    'Confirmed reservation-room records ending on date',
    'Departure date',
    false,
    'bookings.ends_on, status',
    'Scheduled departures; does not assert actual check-out.',
  ),
  definition(
    'inHouse',
    'Scheduled in-house',
    'Confirmed arrival <= date < departure',
    'Stay date',
    false,
    'bookings.starts_on, ends_on, status',
    'Date-based scheduled occupancy, not actual stay-status evidence.',
  ),
];

export function isoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(instant.valueOf()) && instant.toISOString().slice(0, 10) === value;
}

export function shiftDay(day: string, offset: number): string {
  if (!isoDay(day) || !Number.isInteger(offset)) throw new Error('Invalid calendar day.');
  return new Date(Date.parse(day) + offset * 86400000).toISOString().slice(0, 10);
}

/** Calendar arithmetic, deliberately independent of 23/25-hour DST days. */
export function dayDistance(from: string, to: string): number {
  if (!isoDay(from) || !isoDay(to)) throw new Error('Invalid calendar day.');
  return (Date.parse(to) - Date.parse(from)) / 86400000;
}

export function propertyDay(instant: Date | string, timezone: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.valueOf())) throw new Error('Invalid instant.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function reportRange(from: string, to: string): string[] {
  const span = dayDistance(from, to);
  if (span < 0 || span >= 366) throw new Error('Choose a range of 1 to 366 days.');
  return Array.from({ length: span + 1 }, (_, i) => shiftDay(from, i));
}

export function groupDay(day: string, group: 'day' | 'week' | 'month'): string {
  if (!isoDay(day)) throw new Error('Invalid calendar day.');
  if (group === 'month') return `${day.slice(0, 7)}-01`;
  return group === 'week' ? shiftDay(day, -((new Date(day).getUTCDay() + 6) % 7)) : day;
}

export function comparisonRange(from: string, to: string, comparison: 'previous' | 'year') {
  const days = reportRange(from, to).length;
  const priorYear = (day: string) => {
    const candidate = `${Number(day.slice(0, 4)) - 1}${day.slice(4)}`;
    return isoDay(candidate) ? candidate : `${candidate.slice(0, 8)}28`;
  };
  return comparison === 'previous'
    ? { from: shiftDay(from, -days), to: shiftDay(from, -1) }
    : { from: priorYear(from), to: priorYear(to) };
}

export function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator === null ||
    denominator === null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0
    ? null
    : numerator / denominator;
}
export function percent(numerator: number | null, denominator: number | null): number | null {
  const value = ratio(numerator, denominator);
  return value === null ? null : value * 100;
}
export function moneyPerNight(amount: string | null, nights: number | null): string | null {
  if (amount === null || nights === null || !Number.isSafeInteger(nights) || nights <= 0)
    return null;
  return decimal(roundMinor(minor(amount), BigInt(nights)));
}
export function moneyPercent(numerator: string | null, denominator: string | null): string | null {
  if (numerator === null || denominator === null || minor(denominator) <= 0n) return null;
  return decimal(roundMinor(minor(numerator) * 10000n, minor(denominator)));
}
export function outstanding(gross: string, netCollected: string): string {
  const due = minor(gross) - minor(netCollected);
  return decimal(due > 0n ? due : 0n);
}
export function ageingBucket(arrival: string, today: string): '0-7' | '8-30' | '31+' {
  const age = Math.max(dayDistance(arrival, today), 0);
  return age <= 7 ? '0-7' : age <= 30 ? '8-30' : '31+';
}
export function snapshotDelta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}
export function withinFreeCancellation(
  cancelledAt: string | null,
  unconditionalFree: boolean | null,
  cutoffAt: string | null,
): boolean | null {
  if (!cancelledAt || !Number.isFinite(Date.parse(cancelledAt))) return null;
  if (unconditionalFree === false) return false;
  if (cutoffAt !== null) {
    if (!Number.isFinite(Date.parse(cutoffAt))) return null;
    return Date.parse(cancelledAt) <= Date.parse(cutoffAt);
  }
  return unconditionalFree === true ? true : null;
}

type SnapshotNight = {
  date: string;
  roomAmount: string;
  charges: { id: string; name: string; amount: string }[];
  legacy: boolean;
};
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const amount = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{1,10}(?:\.\d{1,2})?$/.test(v);

/** Read signed booking snapshots only; malformed or incomplete evidence stays unknown. */
export function nightlySnapshot(
  value: unknown,
  startsOn: string,
  endsOn: string,
): SnapshotNight[] | null {
  if (!isoDay(startsOn) || !isoDay(endsOn)) return null;
  const nights = dayDistance(startsOn, endsOn);
  if (nights <= 0 || !Array.isArray(value) || value.length !== nights) return null;
  const found = new Map<string, SnapshotNight>();
  for (const row of value) {
    if (
      !object(row) ||
      typeof row.date !== 'string' ||
      !isoDay(row.date) ||
      row.date < startsOn ||
      row.date >= endsOn ||
      found.has(row.date) ||
      !amount(row.amount)
    )
      return null;
    const charges: SnapshotNight['charges'] = [];
    let room = minor(row.amount);
    if (row.components !== undefined) {
      if (!Array.isArray(row.components) || row.components.length === 0) return null;
      let total = 0n;
      for (const c of row.components) {
        if (
          !object(c) ||
          typeof c.kind !== 'string' ||
          !['base', 'plan', 'rule', 'charge'].includes(c.kind) ||
          typeof c.amount !== 'string' ||
          !/^-?\d{1,10}(?:\.\d{1,2})?$/.test(c.amount)
        )
          return null;
        total += minor(c.amount);
        if (c.kind === 'charge') {
          if (typeof c.id !== 'string' || typeof c.name !== 'string' || minor(c.amount) < 0n)
            return null;
          room -= minor(c.amount);
          charges.push({ id: c.id, name: c.name, amount: decimal(minor(c.amount)) });
        }
      }
      if (total !== minor(row.amount) || room < 0n) return null;
    }
    found.set(row.date, {
      date: row.date,
      roomAmount: decimal(room),
      charges,
      legacy: row.components === undefined,
    });
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type LedgerMetricRow = { kind: string; status: string; amount: string; currency: string };
/** Shared success semantics for cash/report projections; never mix currencies. */
export function cashMetrics(rows: readonly LedgerMetricRow[]) {
  const sums = new Map<string, { collected: bigint; refunded: bigint }>();
  for (const row of rows) {
    const charge = row.kind === 'CHARGE' && ['PAID', 'succeeded'].includes(row.status);
    const refund = row.kind === 'REFUND' && ['REFUNDED', 'PAID', 'succeeded'].includes(row.status);
    if (!charge && !refund) continue;
    if (!/^[A-Z]{3}$/.test(row.currency) || minor(row.amount) < 0n)
      throw new Error('Invalid ledger metric row.');
    const total = sums.get(row.currency) ?? { collected: 0n, refunded: 0n };
    if (charge) total.collected += minor(row.amount);
    else total.refunded += minor(row.amount);
    sums.set(row.currency, total);
  }
  return [...sums]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({
      currency,
      collected: decimal(total.collected),
      refunded: decimal(total.refunded),
      netCollected: decimal(total.collected - total.refunded),
    }));
}

export type ReservationMetricRow = {
  status: string;
  startsOn: string;
  endsOn: string;
  createdAt: string;
};

/** Cohort counters and scheduled stays share the same end-exclusive date semantics. */
export function reservationMetrics(
  rows: readonly ReservationMetricRow[],
  from: string,
  to: string,
  timezone: string,
) {
  const dates = reportRange(from, to);
  const cohort = rows.filter((r) => {
    const created = propertyDay(r.createdAt, timezone);
    return created >= from && created <= to;
  });
  const nights = cohort.map((r) => dayDistance(r.startsOn, r.endsOn));
  if (nights.some((n) => n <= 0)) throw new Error('Invalid reservation stay.');
  const leadDays = cohort.map((r) => dayDistance(propertyDay(r.createdAt, timezone), r.startsOn));
  const confirmed = rows.filter((r) => r.status === 'CONFIRMED');
  const cancelled = cohort.filter((r) => r.status === 'CANCELLED').length;
  return {
    bookings: cohort.length,
    cancelled,
    cancellationRate: percent(cancelled, cohort.length),
    averageLengthOfStay: ratio(
      nights.reduce((sum, n) => sum + n, 0),
      cohort.length,
    ),
    averageLeadDays: ratio(
      leadDays.reduce((sum, n) => sum + n, 0),
      cohort.length,
    ),
    leadDays,
    stayNights: nights,
    daily: dates.map((date) => ({
      date,
      bookingsCreated: cohort.filter((r) => propertyDay(r.createdAt, timezone) === date).length,
      arrivals: confirmed.filter((r) => r.startsOn === date).length,
      departures: confirmed.filter((r) => r.endsOn === date).length,
      soldNights: confirmed.filter((r) => r.startsOn <= date && r.endsOn > date).length,
    })),
  };
}

export type RevenueMetricRow = ReservationMetricRow & { currency: string; nightlyRates: unknown };

/** Snapshot-only accrual; unknown bookings poison their currency total, never become zero revenue. */
export function accrualMetrics(rows: readonly RevenueMetricRow[], from: string, to: string) {
  reportRange(from, to);
  const currencies = new Map<
    string,
    {
      room: bigint;
      charges: bigint;
      soldNights: number;
      unknownBookings: number;
      legacyNights: number;
    }
  >();
  for (const row of rows) {
    if (row.status !== 'CONFIRMED' || row.endsOn <= from || row.startsOn > to) continue;
    if (!/^[A-Z]{3}$/.test(row.currency)) throw new Error('Invalid revenue currency.');
    const total = currencies.get(row.currency) ?? {
      room: 0n,
      charges: 0n,
      soldNights: 0,
      unknownBookings: 0,
      legacyNights: 0,
    };
    const overlapFrom = row.startsOn > from ? row.startsOn : from;
    const exclusiveTo = row.endsOn < shiftDay(to, 1) ? row.endsOn : shiftDay(to, 1);
    total.soldNights += dayDistance(overlapFrom, exclusiveTo);
    const snapshot = nightlySnapshot(row.nightlyRates, row.startsOn, row.endsOn);
    if (snapshot === null) total.unknownBookings++;
    else
      for (const night of snapshot) {
        if (night.date < from || night.date > to) continue;
        total.room += minor(night.roomAmount);
        total.charges += night.charges.reduce((sum, c) => sum + minor(c.amount), 0n);
        if (night.legacy) total.legacyNights++;
      }
    currencies.set(row.currency, total);
  }
  return [...currencies]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({
      currency,
      roomRevenue: total.unknownBookings ? null : decimal(total.room),
      mandatoryCharges: total.unknownBookings ? null : decimal(total.charges),
      soldNights: total.soldNights,
      unknownBookings: total.unknownBookings,
      legacyNights: total.legacyNights,
      adr: total.unknownBookings ? null : moneyPerNight(decimal(total.room), total.soldNights),
    }));
}
