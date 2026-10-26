import type { ReportFacts } from './report-facts.repository';
import type { ReportQuery } from './report-query';
import { reportSupply } from './report-projection';
import { nightlySnapshot, reportMinor, shiftDay, dayDistance } from './report-metrics';
import type { TenantTransaction } from './tenant-database.service';
import { decimal } from '../booking/pricing-evaluator';

export type OtbDay = {
  date: string;
  sold: number;
  available: number | null;
  revenue: { currency: string; sold: number; minor: string | null }[];
};
/** One observation of confirmed immutable nightly evidence, with the shared gross-supply formula. */
export function otbObservation(f: ReportFacts, q: ReportQuery): OtbDay[] {
  const days = new Map<string, OtbDay>();
  for (let date = q.from; date <= q.to; date = shiftDay(date, 1))
    days.set(date, { date, sold: 0, available: reportSupply(f, q, date), revenue: [] });
  for (const booking of f.bookings.filter((b) => b.status === 'CONFIRMED')) {
    const nights = nightlySnapshot(booking.nightlyRates, booking.startsOn, booking.endsOn);
    const prices = new Map(nights?.map((n) => [n.date, n.roomAmount]) ?? []);
    for (const day of days.values())
      if (booking.startsOn <= day.date && booking.endsOn > day.date) {
        day.sold++;
        let c = day.revenue.find((c) => c.currency === booking.currency);
        if (!c) {
          c = { currency: booking.currency, sold: 0, minor: '0' };
          day.revenue.push(c);
        }
        c.sold++;
        const price = prices.get(day.date);
        c.minor =
          c.minor === null || price === undefined
            ? null
            : String(BigInt(c.minor) + reportMinor(price));
      }
  }
  return [...days.values()];
}
export const priorYear = (day: string) => {
  const year = Number(day.slice(0, 4)) - 1;
  const raw = `${year}${day.slice(4)}`;
  return raw.endsWith('02-29') && dayDistance(`${year}-02-01`, `${year}-03-01`) === 28
    ? `${year}-02-28`
    : raw;
};
export type HistoryDay = {
  snapshotDate: string;
  stayDate: string;
  sold: number;
  available: number | null;
  currency: string | null;
  minor: string | null;
  currencySold: number | null;
  source: string;
  timezone: string;
  capturedAt: string;
};
/** Complete comparable daily observations only; missing history never becomes zero. */
export function compareOtb(
  rows: HistoryDay[],
  currentDate: string,
  previousDate: string,
  from: string,
  to: string,
  source: string,
  timezone: string,
  year = false,
  money = true,
) {
  const aggregate = (snapshot: string, old: boolean) => {
    let sold = 0,
      available: number | null = 0;
    const revenue = new Map<string, bigint | null>();
    let capturedAt = '';
    const dates = new Set<string>();
    for (let date = from; date <= to; date = shiftDay(date, 1))
      dates.add(old && year ? shiftDay(previousDate, dayDistance(currentDate, date)) : date);
    for (const date of dates) {
      const day = rows.filter(
        (r) =>
          r.snapshotDate === snapshot &&
          r.stayDate === date &&
          r.source === source &&
          r.timezone === timezone,
      );
      if (!day.length) return null;
      sold += day[0]!.sold;
      available =
        available === null || day[0]!.available === null ? null : available + day[0]!.available;
      capturedAt = day[0]!.capturedAt;
      if (money)
        for (const row of day)
          if (row.currency) {
            const previous = revenue.get(row.currency);
            revenue.set(
              row.currency,
              row.minor === null || previous === null ? null : (previous ?? 0n) + BigInt(row.minor),
            );
          }
    }
    return { sold, available, revenue, capturedAt };
  };
  const current = aggregate(currentDate, false),
    previous = aggregate(previousDate, true);
  if (!current || !previous)
    return { status: 'No history yet' as const, snapshotDate: previousDate };
  return {
    status: 'Available' as const,
    snapshotDate: previousDate,
    currentAsOf: current.capturedAt,
    previousCapturedAt: previous.capturedAt,
    sold: current.sold,
    previousSold: previous.sold,
    change: current.sold - previous.sold,
    available: current.available,
    previousAvailable: previous.available,
    ...(money
      ? {
          revenue: [...new Set([...current.revenue.keys(), ...previous.revenue.keys()])]
            .sort()
            .map((currency) => {
              const a = current.revenue.get(currency),
                b = previous.revenue.get(currency);
              return {
                currency,
                current: a === null ? null : decimal(a ?? 0n),
                previous: b === null ? null : decimal(b ?? 0n),
                change: a === null || b === null ? null : decimal((a ?? 0n) - (b ?? 0n)),
              };
            }),
        }
      : {}),
  };
}
export async function otbHistory(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
  q: ReportQuery,
  today: string,
  source: string,
  timezone: string,
  money: boolean,
  facts: ReportFacts,
) {
  if (!['overview', 'occupancy'].includes(q.report)) return undefined;
  if (
    q.roomTypeId ||
    q.roomId ||
    q.ratePlanId ||
    q.status ||
    q.paymentMethod ||
    q.source ||
    q.bookingMode ||
    q.currency
  )
    return {
      status: 'No history yet',
      basis: 'Only unfiltered property-wide daily observations are captured.',
    };
  const from = q.from < today ? today : q.from,
    to = q.to;
  if (from > to || dayDistance(today, to) > 364)
    return {
      status: 'No history yet',
      basis: 'Choose future stay dates within the captured 365-day horizon.',
    };
  const dates = [today, ...[1, 7, 14, 30].map((n) => shiftDay(today, -n)), priorYear(today)];
  const rows = await tx.$queryRaw<HistoryDay[]>`
 SELECT d.snapshot_date::text AS "snapshotDate",d.stay_date::text AS "stayDate",d.sold,d.available,r.currency,r.room_revenue_minor::text AS minor,r.sold AS "currencySold",s.source,s.timezone,s.captured_at::text AS "capturedAt"
 FROM report_otb_days d JOIN report_otb_snapshots s USING(tenant_id,property_id,snapshot_date)
 LEFT JOIN report_otb_revenue r USING(tenant_id,property_id,snapshot_date,stay_date)
 WHERE d.tenant_id=${tenantId}::uuid AND d.property_id=${propertyId}::uuid AND d.snapshot_date=ANY(${dates}::date[])`;
  const time = await tx.$queryRaw<
    Array<{ at: string }>
  >`SELECT transaction_timestamp()::text AS at`;
  const current = otbObservation(facts, { ...q, from, to });
  const live: HistoryDay[] = current.flatMap<HistoryDay>((day) =>
    day.revenue.length
      ? day.revenue.map((r) => ({
          snapshotDate: today,
          stayDate: day.date,
          sold: day.sold,
          available: day.available,
          currency: r.currency,
          minor: r.minor,
          currencySold: r.sold,
          source,
          timezone,
          capturedAt: time[0]!.at,
        }))
      : [
          {
            snapshotDate: today,
            stayDate: day.date,
            sold: day.sold,
            available: day.available,
            currency: null,
            minor: null,
            currencySold: null,
            source,
            timezone,
            capturedAt: time[0]!.at,
          },
        ],
  );
  const evidence = [...rows.filter((r) => r.snapshotDate !== today), ...live];
  return {
    basis:
      'Live current stored facts versus actual daily captured on-the-books history; no reconstruction',
    from,
    to,
    pickup: [1, 7, 14, 30].map((days) => ({
      days,
      ...compareOtb(
        evidence,
        today,
        shiftDay(today, -days),
        from,
        to,
        source,
        timezone,
        false,
        money,
      ),
    })),
    pace: {
      comparison: 'Same lead distance, year earlier; leap day clamped',
      ...compareOtb(evidence, today, priorYear(today), from, to, source, timezone, true, money),
    },
  };
}
