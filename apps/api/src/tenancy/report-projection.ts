import { decimal } from '../booking/pricing-evaluator';
import { evaluateRestrictions, restrictionApplies } from '../booking/inventory-restriction-rules';
import {
  accrualMetrics,
  ageingBucket,
  cashMetrics,
  dayDistance,
  groupDay,
  moneyPerNight,
  moneyPercent,
  nightlySnapshot,
  outstanding,
  percent,
  propertyDay,
  reportMinor,
  reportRange,
  reservationMetrics,
  shiftDay,
  withinFreeCancellation,
} from './report-metrics';
import type { ReportBooking, ReportFacts, ReportPayment } from './report-facts.repository';
import {
  reportInvalid,
  type ReportCell,
  type ReportColumn,
  type ReportQuery,
  type ReportRow,
} from './report-query';

const sum = (values: readonly string[]) => decimal(values.reduce((n, v) => n + reportMinor(v), 0n));
const inRange = (date: string, q: Pick<ReportQuery, 'from' | 'to'>) =>
  date >= q.from && date <= q.to;
const knownSum = (values: readonly (number | null)[]) =>
  values.some((v) => v === null) ? null : values.reduce<number>((n, v) => n + v!, 0);
const success = (p: ReportPayment) => cashMetrics([p]).length > 0;
const column = (
  key: string,
  label: string,
  type: ReportColumn['type'] = 'text',
  money = false,
): ReportColumn => ({ key, label, type, money });
const link = (tenantId: string, propertyId: string, section: string, id?: string) =>
  `/dashboard/${tenantId}?propertyId=${propertyId}&section=${section === 'bookings' ? 'reservations' : section === 'rates' ? 'rates-pricing' : section}${id ? `&reservation=${id}` : ''}`;

/** Supply is gross local capacity. Historical physical supply and all Clock supply stay unknown. */
export function reportSupply(
  f: ReportFacts,
  q: ReportQuery,
  date: string,
  roomTypeId?: string,
  roomId?: string,
) {
  if (f.context.source !== 'LOCAL' || (q.bookingMode && q.bookingMode !== f.context.bookingMode))
    return null;
  const room = roomId ? f.rooms.find((r) => r.id === roomId) : null;
  if (roomId) return date < f.context.today ? null : room?.active ? 1 : 0;
  const selected = f.types.filter(
    (t) =>
      (!roomTypeId || t.id === roomTypeId) &&
      (!q.roomTypeId || t.id === q.roomTypeId) &&
      (!q.roomId || f.rooms.some((r) => r.id === q.roomId && r.roomTypeId === t.id)),
  );
  if (q.roomId) return reportSupply(f, q, date, roomTypeId, q.roomId);
  return knownSum(
    selected.map((t) => {
      const pool = f.stockIndex.get(`${t.id}:${date}`)?.capacity ?? 0;
      if (f.context.bookingMode === 'ROOM_TYPE_ONLY') return pool;
      if (date < f.context.today) return null;
      const physical = (f.roomsByType.get(t.id) ?? []).filter((r) => r.active).length;
      return f.context.bookingMode === 'MIXED' ? Math.min(pool, physical) : physical;
    }),
  );
}

function inventoryDay(
  f: ReportFacts,
  q: ReportQuery,
  date: string,
  roomTypeId?: string,
  roomId?: string,
) {
  const capacity = reportSupply(f, q, date, roomTypeId, roomId);
  if (capacity === null)
    return {
      availableNights: null,
      blockedNights: null,
      stopSellTypeDays: null,
      minStayTypeDays: null,
    };
  const types = f.types.filter(
    (t) =>
      (!roomTypeId || t.id === roomTypeId) &&
      (!q.roomTypeId || t.id === q.roomTypeId) &&
      (!roomId || f.rooms.some((r) => r.id === roomId && r.roomTypeId === t.id)) &&
      (!q.roomId || f.rooms.some((r) => r.id === q.roomId && r.roomTypeId === t.id)),
  );
  let blocked = 0;
  let stop: number | null = 0,
    min: number | null = 0;
  for (const t of types) {
    const cap = reportSupply(f, q, date, t.id, roomId ?? q.roomId) ?? 0;
    const blocks = f.blocks.filter(
      (b) => ['Active', 'Scheduled'].includes(b.lifecycle) && b.startsOn <= date && b.endsOn > date,
    );
    const all = blocks.some((b) => b.all || b.roomTypeIds.includes(t.id));
    const unitIds = new Set(
      blocks
        .flatMap((b) => b.roomIds)
        .filter((id) =>
          f.rooms.some(
            (r) =>
              r.id === id &&
              r.roomTypeId === t.id &&
              r.active &&
              (!roomId || r.id === roomId) &&
              (!q.roomId || r.id === q.roomId),
          ),
        ),
    );
    const unitScope = roomId ?? q.roomId;
    const activeRooms = (f.roomsByType.get(t.id) ?? []).filter(
      (r) => r.active && (!unitScope || r.id === unitScope),
    );
    for (const room of activeRooms)
      if (f.unavailableIndex.has(`${room.id}:${date}`)) unitIds.add(room.id);
    const blockedCapacity =
      f.context.bookingMode === 'ROOM_TYPE_ONLY' && !unitScope
        ? 0
        : cap - Math.min(cap, Math.max(activeRooms.length - unitIds.size, 0));
    blocked += all ? cap : blockedCapacity;
    const rules = f.restrictions.filter(
      (r) =>
        restrictionApplies(r, date) &&
        (r.scope === 'property' ||
          (r.scope === 'room_type' && r.targetIds.includes(t.id)) ||
          (r.scope === 'category' && t.categoryId && r.targetIds.includes(t.categoryId))),
    );
    const effect = evaluateRestrictions(rules, date, shiftDay(date, 1), date);
    if (effect.errors.some((e) => e.code === 'RESTRICTION_PRIORITY_CONFLICT')) {
      stop = null;
      min = null;
    } else {
      if (stop !== null && effect.errors.some((e) => e.code === 'STOP_SELL')) stop++;
      if (min !== null && effect.minimumStay !== undefined) min++;
    }
  }
  return {
    availableNights: capacity,
    blockedNights: blocked,
    stopSellTypeDays: stop,
    minStayTypeDays: min,
  };
}

function financial(
  f: ReportFacts,
  q: ReportQuery,
  rows: ReportBooking[],
  payments: ReportPayment[],
  available: number | null,
  snapshots: Map<ReportBooking, ReturnType<typeof nightlySnapshot>>,
) {
  const accrual = accrualMetrics(rows, q.from, q.to, snapshots),
    cash = cashMetrics(
      payments.filter(
        (p) =>
          (!q.currency || p.currency === q.currency) &&
          inRange(propertyDay(p.createdAt, f.context.timezone), q),
      ),
    );
  const cohort = rows.filter(
    (b) => inRange(propertyDay(b.createdAt, f.context.timezone), q) && b.status === 'CONFIRMED',
  );
  const currencies = [
    ...new Set([
      ...accrual.map((r) => r.currency),
      ...cash.map((r) => r.currency),
      ...cohort.map((b) => b.currency),
    ]),
  ].sort();
  return currencies.map((currency) => {
    const a = accrual.find((r) => r.currency === currency),
      c = cash.find((r) => r.currency === currency);
    const bookings = cohort.filter((b) => b.currency === currency),
      bookingIds = new Set(bookings.map((b) => b.id)),
      linked = payments.filter((p) => bookingIds.has(p.bookingId) && p.currency === currency);
    const net = cashMetrics(linked)[0]?.netCollected ?? '0.00';
    const gross = sum(bookings.map((b) => b.totalAmount));
    const balances = bookings.map((b) => {
      const netPaid =
        cashMetrics((f.paymentsByBooking.get(b.id) ?? []).filter((p) => p.currency === currency))[0]
          ?.netCollected ?? '0.00';
      return {
        amount: outstanding(b.totalAmount, netPaid),
        bucket: ageingBucket(b.startsOn, f.context.today),
        payAtHotel: b.paymentMethod === 'PAY_AT_HOTEL',
      };
    });
    return {
      currency,
      roomRevenue: a?.roomRevenue ?? (a ? null : '0.00'),
      mandatoryCharges: a?.mandatoryCharges ?? (a ? null : '0.00'),
      adr: a?.adr ?? null,
      revpar: moneyPerNight(a ? a.roomRevenue : '0.00', available),
      soldNights: a?.soldNights ?? 0,
      unknownBookings: a?.unknownBookings ?? 0,
      legacyNights: a?.legacyNights ?? 0,
      collected: c?.collected ?? '0.00',
      refunded: c?.refunded ?? '0.00',
      netCollected: c?.netCollected ?? '0.00',
      bookingCohortValue: gross,
      cohortNetCollected: net,
      collectionRate: moneyPercent(net, gross),
      refundToCollectionRatio: moneyPercent(c?.refunded ?? '0.00', c?.collected ?? '0.00'),
      outstanding: sum(balances.map((b) => b.amount)),
      ageing: Object.fromEntries(
        ['0-7', '8-30', '31+'].map((bucket) => [
          bucket,
          sum(balances.filter((b) => b.bucket === bucket).map((b) => b.amount)),
        ]),
      ),
      payAtHotelReceivables: sum(balances.filter((b) => b.payAtHotel).map((b) => b.amount)),
    };
  });
}

function bookingRows(
  bookings: ReportBooking[],
  q: ReportQuery,
  timezone: string,
  tenantId: string,
  propertyId: string,
  payments: ReportPayment[],
): ReportRow[] {
  return bookings
    .filter((b) =>
      q.rowBasis === 'stay'
        ? b.startsOn <= q.to && b.endsOn > q.from
        : q.rowBasis === 'arrival'
          ? inRange(b.startsOn, q)
          : q.rowBasis === 'departure'
            ? inRange(b.endsOn, q)
            : q.rowBasis === 'cancellation'
              ? b.cancelledAt !== null && inRange(propertyDay(b.cancelledAt, timezone), q)
              : q.rowBasis === 'payment'
                ? payments.some(
                    (p) => p.bookingId === b.id && inRange(propertyDay(p.createdAt, timezone), q),
                  )
                : inRange(propertyDay(b.createdAt, timezone), q),
    )
    .map((b) => ({
      id: b.id,
      reference: b.externalReference,
      status: b.status,
      createdDate: propertyDay(b.createdAt, timezone),
      arrival: b.startsOn,
      departure: b.endsOn,
      roomType: b.roomTypeName,
      room: b.roomName,
      ratePlan: b.ratePlanName,
      mealPlan: b.mealPlan,
      planBasis: b.pricingBasis,
      source: b.source ?? 'Unknown',
      paymentMethod: b.paymentMethod,
      adults: b.adults,
      children: b.children,
      nights: dayDistance(b.startsOn, b.endsOn),
      leadDays: dayDistance(propertyDay(b.createdAt, timezone), b.startsOn),
      cancelledAt: b.cancelledAt,
      cancellationLeadDays: b.cancelledAt
        ? dayDistance(propertyDay(b.cancelledAt, timezone), b.startsOn)
        : null,
      withinFreeWindow:
        b.status === 'CANCELLED'
          ? withinFreeCancellation(b.cancelledAt, b.cancellationIsFree, b.cancellationCutoffAt)
          : null,
      currency: b.currency,
      value: b.totalAmount,
      href: link(tenantId, propertyId, 'bookings', b.id),
    }));
}

const reservationColumns = [
  column('reference', 'Reservation'),
  column('status', 'Status'),
  column('createdDate', 'Created', 'date'),
  column('arrival', 'Arrival', 'date'),
  column('departure', 'Departure', 'date'),
  column('roomType', 'Room type'),
  column('room', 'Room'),
  column('ratePlan', 'Rate plan (current)'),
  column('mealPlan', 'Meal plan (current)'),
  column('planBasis', 'Plan basis (current)'),
  column('source', 'Source'),
  column('paymentMethod', 'Payment method'),
  column('adults', 'Adults', 'number'),
  column('children', 'Children', 'number'),
  column('nights', 'Stay nights', 'number'),
  column('leadDays', 'Lead days', 'number'),
  column('cancelledAt', 'Cancellation event'),
  column('cancellationLeadDays', 'Cancellation lead days', 'number'),
  column('withinFreeWindow', 'Within free window'),
  column('currency', 'Currency'),
  column('value', 'Booking value', 'money', true),
  column('href', 'Open reservation', 'link'),
];
export const reportSeriesColumns = [
  column('date', 'Period', 'date'),
  column('bookings', 'Bookings created', 'number'),
  column('arrivals', 'Scheduled arrivals', 'number'),
  column('departures', 'Scheduled departures', 'number'),
  column('soldNights', 'Sold nights', 'number'),
  column('availableNights', 'Available nights', 'number'),
  column('blockedNights', 'Blocked nights', 'number'),
  column('occupancy', 'Occupancy %', 'percent'),
  column('currency', 'Currency'),
  column('roomRevenue', 'Room revenue', 'money', true),
  column('mandatoryCharges', 'Mandatory charges', 'money', true),
  column('collected', 'Collected', 'money', true),
  column('refunded', 'Refunded', 'money', true),
  column('netCollected', 'Net collected', 'money', true),
  column('adr', 'ADR', 'money', true),
  column('revpar', 'RevPAR', 'money', true),
];

/** Build every report on the same factual cohorts and metric primitives. */
export function projectReport(
  f: ReportFacts,
  q: ReportQuery,
  tenantId: string,
  propertyId: string,
  money: boolean,
  staff: boolean,
) {
  const dates = reportRange(q.from, q.to),
    timezone = f.context.timezone;
  const filteredBookings = f.bookings.filter((b) => !q.currency || b.currency === q.currency);
  const validBookings = filteredBookings.filter((b) => b.endsOn > b.startsOn);
  const snapshots = new Map(
    validBookings.map((b) => [b, nightlySnapshot(b.nightlyRates, b.startsOn, b.endsOn)]),
  );
  const accrual = (bookings: ReportBooking[], from: string, to: string) =>
    accrualMetrics(bookings, from, to, snapshots);
  const r = reservationMetrics(validBookings, q.from, q.to, timezone);
  const cohort = validBookings.filter((b) => inRange(propertyDay(b.createdAt, timezone), q));
  const daily = r.daily.map((d) => ({ ...d, ...inventoryDay(f, q, d.date) }));
  const available = knownSum(daily.map((d) => d.availableNights)),
    sold = daily.reduce((n, d) => n + d.soldNights, 0);
  const cashPeriod = f.payments.filter(
    (p) =>
      (!q.currency || p.currency === q.currency) && inRange(propertyDay(p.createdAt, timezone), q),
  );
  let hasData = cohort.length > 0 || sold > 0 || cashPeriod.length > 0;
  const summary: Record<string, unknown> = {
    bookings: r.bookings,
    cancelled: r.cancelled,
    cancellationRate: r.cancellationRate,
    averageLengthOfStay: r.averageLengthOfStay,
    averageLeadDays: r.averageLeadDays,
    soldNights: sold,
    availableNights: available,
    occupancy: percent(sold, available),
    blockedNights: knownSum(daily.map((d) => d.blockedNights)),
    stopSellTypeDays: knownSum(daily.map((d) => d.stopSellTypeDays)),
    minStayTypeDays: knownSum(daily.map((d) => d.minStayTypeDays)),
    arrivals: daily.reduce((n, d) => n + d.arrivals, 0),
    departures: daily.reduce((n, d) => n + d.departures, 0),
    statuses: Object.fromEntries(
      [...new Set(cohort.map((b) => b.status))]
        .sort()
        .map((s) => [s, cohort.filter((b) => b.status === s).length]),
    ),
    adults: cohort.reduce((n, b) => n + b.adults, 0),
    children: cohort.reduce((n, b) => n + b.children, 0),
    sameDay: cohort.filter((b) => propertyDay(b.createdAt, timezone) === b.startsOn).length,
    advance: cohort.filter((b) => propertyDay(b.createdAt, timezone) < b.startsOn).length,
    funnel: {
      created: cohort.length,
      paymentStarted: cohort.filter((b) => b.paymentStarted).length,
      paid: cohort.filter((b) =>
        f.payments.some((p) => p.bookingId === b.id && p.kind === 'CHARGE' && success(p)),
      ).length,
      confirmed: cohort.filter((b) => b.status === 'CONFIRMED').length,
    },
    leadTimeDistribution: histogram(r.leadDays),
    lengthOfStayDistribution: histogram(r.stayNights),
    sourceMix: counts(cohort.map((b) => b.source ?? 'Unknown')),
    roomTypeMix: counts(cohort.map((b) => b.roomTypeName)),
    ratePlanMix: counts(cohort.map((b) => b.ratePlanName)),
    mealPlanMix: counts(cohort.map((b) => b.mealPlan)),
    paymentMethodMix: counts(cohort.map((b) => b.paymentMethod)),
    legacyPlanMetadata: true,
  };
  const arrivalCohort = validBookings.filter(
    (b) => inRange(b.startsOn, q) && b.startsOn <= f.context.today && b.status === 'CONFIRMED',
  );
  const observedArrivals = arrivalCohort.filter((b) => b.pmsStayStatus !== null);
  if (observedArrivals.length)
    summary.noShow = {
      count: observedArrivals.filter((b) => b.pmsStayStatus === 'no_show').length,
      eligibleObserved: observedArrivals.length,
      missingEvidence: arrivalCohort.length - observedArrivals.length,
      rate: percent(
        observedArrivals.filter((b) => b.pmsStayStatus === 'no_show').length,
        observedArrivals.length,
      ),
      basis: 'Only arrivals with stored PMS stay status; not the full hotel arrival cohort.',
    };
  const cancelledCohort = cohort.filter((b) => b.status === 'CANCELLED');
  const cancellationEvents = cancelledCohort.filter((b) => b.cancelledAt !== null);
  const freeStates = cancelledCohort.map((b) =>
    withinFreeCancellation(b.cancelledAt, b.cancellationIsFree, b.cancellationCutoffAt),
  );
  summary.cancellationAnalysis = {
    total: cancelledCohort.length,
    withEvent: cancellationEvents.length,
    missingEvent: cancelledCohort.length - cancellationEvents.length,
    averageLeadDays: cancellationEvents.length
      ? cancellationEvents.reduce(
          (n, b) => n + dayDistance(propertyDay(b.cancelledAt!, timezone), b.startsOn),
          0,
        ) / cancellationEvents.length
      : null,
    withinFreeWindow: freeStates.filter((v) => v === true).length,
    afterFreeWindow: freeStates.filter((v) => v === false).length,
    unknownWindow: freeStates.filter((v) => v === null).length,
    byRoomType: counts(cancelledCohort.map((b) => b.roomTypeName)),
    byRatePlan: counts(cancelledCohort.map((b) => b.ratePlanName)),
  };
  summary.inventorySchedules = {
    basis: 'Current saved local schedules, not historical lost demand',
    blocks: counts(
      f.blocks
        .filter(
          (b) =>
            ['Active', 'Scheduled'].includes(b.lifecycle) &&
            b.startsOn <= q.to &&
            b.endsOn > q.from,
        )
        .map((b) => b.reason ?? 'Unknown'),
    ),
    restrictions: counts(
      f.restrictions
        .filter((rule) => dates.some((date) => restrictionApplies(rule, date)))
        .map((rule) => rule.type),
    ),
  };
  if (money) summary.financial = financial(f, q, validBookings, f.payments, available, snapshots);
  const activeToday = validBookings.filter((b) => b.status === 'CONFIRMED');
  if (q.report === 'overview' || q.report === 'occupancy') {
    summary.today = {
      date: f.context.today,
      arrivals: activeToday.filter((b) => b.startsOn === f.context.today).length,
      departures: activeToday.filter((b) => b.endsOn === f.context.today).length,
      inHouse: activeToday.filter(
        (b) => b.startsOn <= f.context.today && b.endsOn > f.context.today,
      ).length,
    };
    summary.forward = [7, 14, 30, 60, 90].map((days) => {
      const forwardQ = { ...q, from: f.context.today, to: shiftDay(f.context.today, days - 1) };
      const future = accrual(validBookings, forwardQ.from, forwardQ.to);
      const futureAvailable = knownSum(
        reportRange(forwardQ.from, forwardQ.to).map((date) => reportSupply(f, forwardQ, date)),
      );
      return {
        days,
        soldNights: future.reduce((n, c) => n + c.soldNights, 0),
        availableNights: futureAvailable,
        occupancy: percent(
          future.reduce((n, c) => n + c.soldNights, 0),
          futureAvailable,
        ),
        ...(money ? { financial: future } : {}),
      };
    });
  }
  const buckets = [...new Set(dates.map((d) => groupDay(d, q.group)))];
  const series: ReportRow[] = [];
  for (const date of buckets) {
    const days = daily.filter((d) => groupDay(d.date, q.group) === date);
    const first = days[0]!.date,
      last = days.at(-1)!.date;
    const revenue = money ? accrual(validBookings, first, last) : [];
    const cash = money
      ? cashMetrics(
          cashPeriod.filter((p) =>
            inRange(propertyDay(p.createdAt, timezone), { from: first, to: last }),
          ),
        )
      : [];
    const currencies = money
      ? [...new Set([...revenue.map((a) => a.currency), ...cash.map((a) => a.currency)])].sort()
      : [];
    const base = {
      date,
      bookings: days.reduce((n, d) => n + d.bookingsCreated, 0),
      arrivals: days.reduce((n, d) => n + d.arrivals, 0),
      departures: days.reduce((n, d) => n + d.departures, 0),
      soldNights: days.reduce((n, d) => n + d.soldNights, 0),
      availableNights: knownSum(days.map((d) => d.availableNights)),
      blockedNights: knownSum(days.map((d) => d.blockedNights)),
    };
    if (!currencies.length)
      series.push({
        id: date,
        ...base,
        occupancy: percent(base.soldNights, base.availableNights),
        href: link(tenantId, propertyId, 'bookings'),
      });
    else
      for (const currency of currencies) {
        const a = revenue.find((v) => v.currency === currency),
          c = cash.find((v) => v.currency === currency);
        series.push({
          id: `${date}:${currency}`,
          ...base,
          currency,
          occupancy: percent(base.soldNights, base.availableNights),
          roomRevenue: a ? a.roomRevenue : '0.00',
          mandatoryCharges: a ? a.mandatoryCharges : '0.00',
          collected: c?.collected ?? '0.00',
          refunded: c?.refunded ?? '0.00',
          netCollected: c?.netCollected ?? '0.00',
          adr: a?.adr ?? null,
          revpar: moneyPerNight(a ? a.roomRevenue : '0.00', base.availableNights),
          href: link(tenantId, propertyId, 'bookings'),
        });
      }
  }
  let rows: ReportRow[] = bookingRows(
      filteredBookings,
      q,
      timezone,
      tenantId,
      propertyId,
      f.payments,
    ),
    columns = reservationColumns;
  if (q.report === 'overview' || q.report === 'occupancy') {
    rows = series;
    columns = [...reportSeriesColumns, column('href', 'Open bookings', 'link')];
  }
  if (q.report === 'occupancy') {
    summary.soldOutDays = daily.filter(
      (d) =>
        d.availableNights !== null && d.availableNights > 0 && d.soldNights >= d.availableNights,
    ).length;
    summary.lowAvailabilityDays = daily.filter(
      (d) =>
        d.availableNights !== null &&
        d.availableNights > 0 &&
        d.availableNights - d.soldNights <= 2,
    ).length;
    summary.forwardBasis = 'Current on-the-books, not a demand forecast';
  }
  if (q.report === 'revenue') {
    rows = cashPeriod.map((p) => ({
      id: p.id,
      date: propertyDay(p.createdAt, timezone),
      kind: p.kind,
      status: p.status,
      method: p.method ?? p.provider,
      currency: p.currency,
      amount: p.amount,
      bookingId: p.bookingId,
      href: link(tenantId, propertyId, 'bookings', p.bookingId),
    }));
    columns = [
      column('date', 'Posting date', 'date'),
      column('kind', 'Kind'),
      column('status', 'Status'),
      column('method', 'Method'),
      column('currency', 'Currency'),
      column('amount', 'Amount', 'money', true),
      column('bookingId', 'Reservation'),
      column('href', 'Open reservation', 'link'),
    ];
    summary.failedPaymentBookings = cohort.filter((b) => b.status === 'PAYMENT_FAILED').length;
    summary.failedPayments = cashPeriod.filter(
      (p) => p.kind === 'CHARGE' && !success(p) && /fail|declin|error/i.test(p.status),
    ).length;
    summary.expiredUnpaidCheckouts = cohort.filter(
      (b) =>
        b.status === 'EXPIRED' &&
        !f.payments.some((p) => p.bookingId === b.id && p.kind === 'CHARGE' && success(p)),
    ).length;
    if (money) {
      summary.refunds = cashMetrics(cashPeriod.filter((p) => p.kind === 'REFUND'));
      summary.refundCount = cashPeriod.filter((p) => p.kind === 'REFUND' && success(p)).length;
      const refundRows = cashPeriod
        .filter((p) => p.kind === 'REFUND' && success(p))
        .map((p) => {
          const charge = f.payments
            .filter(
              (c) =>
                c.bookingId === p.bookingId &&
                c.kind === 'CHARGE' &&
                success(c) &&
                c.currency === p.currency &&
                Date.parse(c.createdAt) <= Date.parse(p.createdAt),
            )
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
          return {
            id: p.id,
            currency: p.currency,
            amount: p.amount,
            postingDate: propertyDay(p.createdAt, timezone),
            daysSinceFirstCharge: charge
              ? dayDistance(
                  propertyDay(charge.createdAt, timezone),
                  propertyDay(p.createdAt, timezone),
                )
              : null,
            href: link(tenantId, propertyId, 'bookings', p.bookingId),
          };
        });
      summary.paymentMethods = [...new Set(cashPeriod.map((p) => p.method ?? p.provider))].map(
        (method) => ({
          method,
          financial: cashMetrics(cashPeriod.filter((p) => (p.method ?? p.provider) === method)),
        }),
      );
      const reconciliationRows = cohort
        .filter((b) => b.status === 'CONFIRMED')
        .map((b) => {
          const net =
            cashMetrics(
              (f.paymentsByBooking.get(b.id) ?? []).filter((p) => p.currency === b.currency),
            )[0]?.netCollected ?? '0.00';
          return {
            id: b.id,
            currency: b.currency,
            bookingValue: b.totalAmount,
            netCollected: net,
            difference: decimal(reportMinor(b.totalAmount) - reportMinor(net)),
            href: link(tenantId, propertyId, 'bookings', b.id),
          };
        });
      summary.reconciliationDifferences = reconciliationRows.filter(
        (row) => row.difference !== '0.00',
      ).length;
      if (q.detail === 'balances' || q.detail === 'reconciliation') {
        rows = reconciliationRows
          .map((row) => ({
            ...row,
            outstanding: outstanding(row.bookingValue, row.netCollected),
            ageing: ageingBucket(
              validBookings.find((b) => b.id === row.id)!.startsOn,
              f.context.today,
            ),
          }))
          .filter((row) =>
            q.detail === 'reconciliation' ? row.difference !== '0.00' : row.outstanding !== '0.00',
          );
        columns = [
          column('id', 'Reservation'),
          column('currency', 'Currency'),
          column('bookingValue', 'Booking value', 'money', true),
          column('netCollected', 'Net collected', 'money', true),
          column('difference', 'Difference', 'money', true),
          column('outstanding', 'Outstanding', 'money', true),
          column('ageing', 'Age bucket'),
          column('href', 'Open reservation', 'link'),
        ];
      }
      if (q.detail === 'refunds') {
        rows = refundRows;
        columns = [
          column('postingDate', 'Refund posting date', 'date'),
          column('currency', 'Currency'),
          column('amount', 'Refunded', 'money', true),
          column('daysSinceFirstCharge', 'Days since first charge', 'number'),
          column('href', 'Open reservation', 'link'),
        ];
      }
      if (q.detail === 'charges') {
        const charges = new Map<
          string,
          { id: string; name: string; currency: string; amount: bigint; nights: number }
        >();
        for (const b of validBookings.filter((b) => b.status === 'CONFIRMED'))
          for (const night of snapshots.get(b) ?? []) {
            if (!inRange(night.date, q)) continue;
            for (const c of night.charges) {
              const id = JSON.stringify([b.currency, c.id, c.name]);
              const entry = charges.get(id) ?? {
                id,
                name: c.name,
                currency: b.currency,
                amount: 0n,
                nights: 0,
              };
              entry.amount += reportMinor(c.amount);
              entry.nights++;
              charges.set(id, entry);
            }
          }
        rows = [...charges.values()].map((c) => ({ ...c, amount: decimal(c.amount) }));
        columns = [
          column('name', 'Recorded mandatory charge'),
          column('currency', 'Currency'),
          column('amount', 'Recognized charge', 'money', true),
          column('nights', 'Charge lines', 'number'),
        ];
        summary.chargeCoverage =
          'Only immutable v2 charge components; legacy rows do not prove zero tax.';
      }
      summary.byWeekday = Array.from({ length: 7 }, (_, i) => i + 1).map((weekday) => {
        const totals = new Map<string, { amount: bigint; unknown: boolean; soldNights: number }>();
        for (const date of dates.filter((d) => (new Date(d).getUTCDay() || 7) === weekday))
          for (const row of accrual(validBookings, date, date)) {
            const total = totals.get(row.currency) ?? { amount: 0n, unknown: false, soldNights: 0 };
            if (row.roomRevenue === null) total.unknown = true;
            else total.amount += reportMinor(row.roomRevenue);
            total.soldNights += row.soldNights;
            totals.set(row.currency, total);
          }
        return {
          weekday,
          financial: [...totals]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([currency, total]) => ({
              currency,
              roomRevenue: total.unknown ? null : decimal(total.amount),
              soldNights: total.soldNights,
              adr: total.unknown ? null : moneyPerNight(decimal(total.amount), total.soldNights),
            })),
        };
      });
      summary.breakdowns = ['roomTypeName', 'ratePlanName', 'mealPlan', 'pricingBasis'].map(
        (key) => ({
          dimension: key,
          items: [...new Set(validBookings.map((b) => String(b[key as keyof ReportBooking])))]
            .sort()
            .map((value) => ({
              value,
              financial: accrual(
                validBookings.filter((b) => b[key as keyof ReportBooking] === value),
                q.from,
                q.to,
              ),
            })),
        }),
      );
    }
  }
  if (q.report === 'accommodation' || q.report === 'pricing') {
    const dimensions =
      q.report === 'pricing'
        ? f.plans
            .filter(
              (p) =>
                (!q.ratePlanId || p.id === q.ratePlanId) &&
                (!q.currency || p.currency === q.currency),
            )
            .map((p) => ({ id: p.id, name: p.name, unit: false, plan: true }))
        : [
            ...f.types
              .filter(
                (t) =>
                  (!q.roomTypeId || t.id === q.roomTypeId) &&
                  (!q.roomId || f.rooms.some((r) => r.id === q.roomId && r.roomTypeId === t.id)),
              )
              .map((t) => ({ id: t.id, name: t.name, unit: false, plan: false })),
            ...f.rooms
              .filter(
                (r) =>
                  (!q.roomTypeId || r.roomTypeId === q.roomTypeId) &&
                  (!q.roomId || r.id === q.roomId) &&
                  (f.context.bookingMode !== 'ROOM_TYPE_ONLY' ||
                    validBookings.some((b) => b.roomId === r.id)),
              )
              .map((r) => ({ id: r.id, name: r.name, unit: true, plan: false })),
          ];
    rows = dimensions.flatMap((d) => {
      const subset = validBookings.filter((b) =>
        d.plan ? b.ratePlanId === d.id : d.unit ? b.roomId === d.id : b.roomTypeId === d.id,
      );
      const supply = d.plan
        ? available
        : knownSum(
            dates.map((date) =>
              reportSupply(f, q, date, d.unit ? undefined : d.id, d.unit ? d.id : undefined),
            ),
          );
      const recognized = accrual(subset, q.from, q.to),
        cancelled = subset.filter(
          (b) => b.status === 'CANCELLED' && inRange(propertyDay(b.createdAt, timezone), q),
        ).length;
      const curr = recognized.length
        ? recognized
        : [
            {
              currency: q.currency ?? (d.plan ? f.plans.find((p) => p.id === d.id)!.currency : ''),
              soldNights: 0,
              roomRevenue: q.currency || d.plan ? '0.00' : null,
              adr: null,
              unknownBookings: 0,
              legacyNights: 0,
              mandatoryCharges: '0.00',
            },
          ];
      return curr.map((a) => ({
        id: `${d.id}:${a.currency}`,
        name: d.name,
        level: d.plan ? 'Rate plan' : d.unit ? 'Room' : 'Room type',
        currency: a.currency || null,
        soldNights: a.soldNights,
        availableNights: supply,
        occupancy: percent(a.soldNights, supply),
        cancelled,
        bookings: subset.filter((b) => inRange(propertyDay(b.createdAt, timezone), q)).length,
        cancellationRate: percent(
          cancelled,
          subset.filter((b) => inRange(propertyDay(b.createdAt, timezone), q)).length,
        ),
        roomRevenue: a.roomRevenue,
        adr: a.adr,
        revpar: moneyPerNight(a.roomRevenue, supply),
        blockedNights: d.plan
          ? null
          : knownSum(
              dates.map(
                (date) =>
                  inventoryDay(f, q, date, d.unit ? undefined : d.id, d.unit ? d.id : undefined)
                    .blockedNights,
              ),
            ),
        href: link(tenantId, propertyId, d.plan ? 'rates' : 'accommodations'),
      }));
    });
    columns = [
      column('name', 'Accommodation / plan'),
      column('level', 'Level'),
      column('currency', 'Currency'),
      column('soldNights', 'Sold nights', 'number'),
      column('availableNights', 'Available nights', 'number'),
      column('occupancy', 'Occupancy share %', 'percent'),
      column('cancelled', 'Cancellations', 'number'),
      column('bookings', 'Bookings created', 'number'),
      column('cancellationRate', 'Cancellation rate %', 'percent'),
      column('blockedNights', 'Blocked nights', 'number'),
      column('roomRevenue', 'Room revenue', 'money', true),
      column('adr', 'ADR', 'money', true),
      column('revpar', 'RevPAR', 'money', true),
      column('href', 'Open setup', 'link'),
    ];
    if (q.report === 'pricing')
      summary.pricingHealth = f.health
        ? {
            coverage: f.health.coverage,
            issueCounts: counts(f.health.issues.map((i) => i.severity)),
            scope:
              'Property-wide current pricing horizon, independent of selected booking filters and report dates',
          }
        : null;
    summary.currencyOccupancyBasis =
      'Each currency row shows its share of sold nights; do not sum repeated supply.';
  }
  if (q.report === 'guests') {
    const staying = validBookings.filter(
      (b) => b.status === 'CONFIRMED' && b.startsOn <= q.to && b.endsOn > q.from,
    );
    const guestIds = [
      ...new Set(
        [...cohort, ...staying].map((b) => b.guestId).filter((id): id is string => id !== null),
      ),
    ];
    rows = guestIds.flatMap((id) => {
      const subset = validBookings.filter((b) => b.guestId === id),
        created = cohort.filter((b) => b.guestId === id);
      const recognized = accrual(subset, q.from, q.to);
      const currencies = [
        ...new Set([...created.map((b) => b.currency), ...recognized.map((a) => a.currency)]),
      ];
      return currencies.map((currency) => {
        const revenue = recognized.find((a) => a.currency === currency),
          stayBookings = staying.filter((b) => b.guestId === id && b.currency === currency).length;
        return {
          id: `${id}:${currency}`,
          guestId: id,
          name: subset[0]!.guestName ?? 'Guest',
          bookings: created.length,
          returning: subset.some(
            (b) =>
              b.firstGuestBookingAt !== null &&
              propertyDay(b.firstGuestBookingAt, timezone) < q.from,
          ),
          currency,
          stayBookings,
          roomRevenue: revenue ? revenue.roomRevenue : '0.00',
          averageSpend: moneyPerNight(revenue ? revenue.roomRevenue : '0.00', stayBookings),
          href: link(tenantId, propertyId, 'guests'),
        };
      });
    });
    columns = [
      column('name', 'Guest'),
      column('bookings', 'Bookings created', 'number'),
      column('stayBookings', 'Stays in period', 'number'),
      column('returning', 'Returning'),
      column('currency', 'Currency'),
      column('roomRevenue', 'Recognized room revenue', 'money', true),
      column('averageSpend', 'Room revenue per stay', 'money', true),
      column('href', 'Open guests', 'link'),
    ];
    summary.newGuests = guestIds.filter(
      (id) =>
        !validBookings
          .filter((b) => b.guestId === id)
          .some(
            (b) =>
              b.firstGuestBookingAt !== null &&
              propertyDay(b.firstGuestBookingAt, timezone) < q.from,
          ),
    ).length;
    summary.returningGuests = guestIds.length - Number(summary.newGuests);
    summary.unmatchedBookings = cohort.filter((b) => !b.guestId).length;
    summary.unmatchedStayBookings = staying.filter((b) => !b.guestId).length;
    if (money)
      summary.averageGuestRoomRevenue = [...new Set(rows.map((row) => String(row.currency)))].map(
        (currency) => {
          const subset = rows.filter(
            (row) => row.currency === currency && Number(row.stayBookings) > 0,
          );
          const amount = subset.some((row) => row.roomRevenue === null)
            ? null
            : sum(subset.map((row) => String(row.roomRevenue)));
          return { currency, guests: subset.length, amount: moneyPerNight(amount, subset.length) };
        },
      );
    summary.guestSpendBasis =
      'Room revenue is recognized by stay night for all staying guests. Booking frequency uses created date. New/returning compares first confirmed property booking with period start; unknown guest identities are excluded with coverage.';
  }
  if (q.report === 'operations') {
    const events = f.events.filter((e) => inRange(e.date, q));
    rows =
      q.detail === 'staff' && staff
        ? events.map((e) => ({
            id: e.id,
            date: e.date,
            action: e.action,
            actor: e.actor,
            targetId: e.targetId,
          }))
        : f.emails
            .filter((e) => inRange(e.date, q))
            .map((e, i) => ({
              id: `email:${i}`,
              date: e.date,
              status: e.status,
              eventType: e.eventType,
              count: e.count,
            }));
    columns =
      q.detail === 'staff'
        ? [
            column('date', 'Activity date', 'date'),
            column('action', 'Action'),
            column('actor', 'Staff user'),
            column('targetId', 'Target'),
          ]
        : [
            column('date', 'Created date', 'date'),
            column('eventType', 'Email event'),
            column('status', 'Delivery status'),
            column('count', 'Messages', 'number'),
          ];
    summary.emailStatus = Object.fromEntries(
      [...new Set(f.emails.map((e) => e.status))].map((status) => [
        status,
        f.emails
          .filter((e) => e.status === status && inRange(e.date, q))
          .reduce((n, e) => n + e.count, 0),
      ]),
    );
    if (staff) {
      summary.staffActivity = counts(events.map((e) => e.action));
      summary.staffByUser = counts(events.map((e) => e.actor ?? 'System'));
      summary.staffByDay = counts(events.map((e) => e.date));
    }
    summary.staffActivityAvailable = staff;
  }
  if (q.report === 'quality') {
    rows = [];
    const add = (b: ReportBooking, code: string, message: string) =>
      rows.push({
        id: `${b.id}:${code}`,
        code,
        reference: b.externalReference,
        message,
        href: link(tenantId, propertyId, 'bookings', b.id),
      });
    for (const b of f.bookings.filter(
      (b) =>
        inRange(propertyDay(b.createdAt, timezone), q) || (b.startsOn <= q.to && b.endsOn > q.from),
    )) {
      const linked = f.paymentsByBooking.get(b.id) ?? [];
      if (b.endsOn <= b.startsOn) add(b, 'INVALID_STAY', 'Departure is not after arrival.');
      else if (b.status === 'CONFIRMED' && !nightlySnapshot(b.nightlyRates, b.startsOn, b.endsOn))
        add(b, 'MISSING_NIGHTLY_PRICES', 'Missing or inconsistent immutable nightly prices.');
      if (
        money &&
        b.status === 'CONFIRMED' &&
        !['PAY_AT_HOTEL', 'FREE'].includes(b.paymentMethod) &&
        !linked.some((p) => p.kind === 'CHARGE' && success(p))
      )
        add(
          b,
          'NO_SUCCESSFUL_PAYMENT',
          'Confirmed online-payment booking has no successful local charge.',
        );
      if (money && linked.some((p) => p.currency !== b.currency))
        add(b, 'CURRENCY_MISMATCH', 'Linked payment currency differs from booking currency.');
      if (['PMS_UNKNOWN_RESULT', 'PMS_REJECTED', 'MANUAL_REVIEW'].includes(b.status))
        add(b, 'SYNC_REVIEW', 'Stored booking state requires review.');
    }
    columns = [
      column('code', 'Issue'),
      column('reference', 'Reservation'),
      column('message', 'Evidence'),
      column('href', 'Open reservation', 'link'),
    ];
    if (money)
      for (const payment of f.orphanPayments)
        rows.push({
          id: payment.id,
          code: 'ORPHAN_PAYMENT',
          reference: payment.id,
          message: 'Stored payment has no booking in this property.',
          href: null,
        });
    summary.issues = rows.length;
    summary.qualityBasis =
      'Current local records; missing online payment is not an error for pay-at-hotel/free reservations.';
  }
  if (q.report === 'pricing' && q.detail === 'issues') {
    rows = (f.health?.issues ?? []).map((issue) => ({
      id: issue.id,
      code: issue.code,
      severity: issue.severity,
      name: issue.name,
      scope: issue.scope,
      message: issue.message,
      href: link(tenantId, propertyId, 'rates'),
    }));
    columns = [
      column('severity', 'Severity'),
      column('code', 'Issue code'),
      column('name', 'Pricing record'),
      column('scope', 'Scope'),
      column('message', 'Evidence'),
      column('href', 'Open Rates', 'link'),
    ];
  }
  if (q.report === 'reservations' || q.report === 'guests') hasData = rows.length > 0;
  if (q.report === 'operations') hasData = rows.length > 0;
  if (q.report === 'pricing')
    hasData = f.health !== null || rows.some((row) => Number(row.soldNights) > 0);
  if (q.report === 'occupancy')
    hasData = hasData || daily.some((d) => d.availableNights !== null && d.availableNights > 0);
  if (f.context.source !== 'LOCAL') {
    summary.inventorySchedules = null;
    delete summary.mealPlanMix;
    columns = columns.filter((c) => c.key !== 'mealPlan');
    if (q.report === 'pricing') {
      rows = [];
      summary.pricingHealth = null;
      summary.pricingPerformanceBasis =
        'Provider rate-plan identity and price coverage are not available in stored records.';
    }
  }
  if (q.bookingMode && q.bookingMode !== f.context.bookingMode) {
    rows = [];
    hasData = false;
  }
  const visible = columns.filter((c) => money || !c.money);
  if (q.sort && !visible.some((c) => c.key === q.sort))
    reportInvalid('Sort must name a visible report column.');
  const sort = q.sort || visible[0]!.key,
    sortColumn = visible.find((c) => c.key === sort)!;
  rows = [...rows].sort(
    (a, b) =>
      (sortColumn.money && a.currency !== b.currency
        ? String(a.currency ?? '').localeCompare(String(b.currency ?? ''))
        : 0) ||
      compare(a[sort] ?? null, b[sort] ?? null, sortColumn.type) *
        (q.direction === 'desc' ? -1 : 1) ||
      a.id.localeCompare(b.id),
  );
  const allowed = new Set(['id', ...visible.map((c) => c.key)]);
  rows = rows.map(
    (row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key))) as ReportRow,
  );
  const seriesAllowed = new Set([
    'id',
    'href',
    ...reportSeriesColumns.filter((c) => money || !c.money).map((c) => c.key),
  ]);
  const visibleSeries = series.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => seriesAllowed.has(key)),
      ) as ReportRow,
  );
  const unknownSnapshots = validBookings.filter(
    (b) =>
      b.status === 'CONFIRMED' &&
      b.startsOn <= q.to &&
      b.endsOn > q.from &&
      !nightlySnapshot(b.nightlyRates, b.startsOn, b.endsOn),
  ).length;
  return {
    summary,
    series: visibleSeries,
    columns: visible,
    rows,
    pagination: {
      page: q.page,
      pageSize: q.pageSize,
      total: rows.length,
      pages: Math.ceil(rows.length / q.pageSize),
    },
    hasData,
    coverage: {
      unknownNightlyBookings: unknownSnapshots,
      invalidStays: filteredBookings.length - validBookings.length,
      supplyKnown: available !== null,
      legacyPriceSnapshots: true,
      currentPlanMetadata: true,
    },
  };
}
function histogram(values: number[]) {
  return counts(
    values.map((v) =>
      v < 0
        ? 'Created after arrival'
        : v === 0
          ? '0'
          : v <= 3
            ? '1-3'
            : v <= 7
              ? '4-7'
              : v <= 14
                ? '8-14'
                : v <= 30
                  ? '15-30'
                  : '31+',
    ),
  );
}
function counts(values: string[]) {
  return [...new Set(values)]
    .sort()
    .map((value) => ({ value, count: values.filter((v) => v === value).length }));
}
function compare(a: ReportCell, b: ReportCell, type: ReportColumn['type']) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (type === 'money') {
    const diff = reportMinor(String(a)) - reportMinor(String(b));
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
