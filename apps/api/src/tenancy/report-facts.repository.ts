import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantTransaction } from './tenant-database.service';
import { pricingContext, pricingFacts } from './pricing.repository';
import { pricingHealth } from './pricing-health';
import type { ReportQuery } from './report-query';
import { comparisonRange, shiftDay } from './report-metrics';
import { inventoryBlockRows } from './inventory-blocks.service';
import { restrictionRows } from './inventory-restrictions.repository';

export const REPORT_LIMITS = { bookings: 25000, payments: 50000, stock: 200000, events: 50000 };
export function checkReportCap(rows: readonly unknown[], cap: number) {
  if (rows.length > cap)
    throw new UnprocessableEntityException({
      code: 'REPORT_DATA_LIMIT',
      message:
        'This report exceeds its data limit. Choose a narrower date range or room-type filter.',
    });
}
export type ReportBooking = {
  id: string;
  externalReference: string;
  status: string;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  roomTypeId: string;
  roomTypeName: string;
  roomId: string | null;
  roomName: string | null;
  ratePlanId: string;
  ratePlanName: string;
  currency: string;
  totalAmount: string;
  nightlyRates: unknown;
  source: string | null;
  paymentMethod: string;
  guestId: string | null;
  guestName: string | null;
  adults: number;
  children: number;
  pmsStayStatus: string | null;
  mealPlan: string;
  pricingBasis: string;
  cancelledAt: string | null;
  cancellationIsFree: boolean | null;
  cancellationCutoffAt: string | null;
  paymentStarted: boolean;
  firstGuestBookingAt: string | null;
};
export type ReportPayment = {
  id: string;
  bookingId: string;
  kind: string;
  status: string;
  amount: string;
  currency: string;
  method: string | null;
  provider: string;
  createdAt: string;
};
export type ReportEvent = {
  id: string;
  action: string;
  actor: string | null;
  date: string;
  targetId: string;
};

/** Scoped, bounded facts. No provider calls and no price recalculation. */
export async function reportFacts(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
  q: ReportQuery,
  staff: boolean,
) {
  const context = await pricingContext(tx, tenantId, propertyId);
  const compared = q.comparison === 'none' ? null : comparisonRange(q.from, q.to, q.comparison);
  const windows = [
    { from: q.from, to: q.to },
    ...(compared ? [compared] : []),
    ...(['overview', 'occupancy'].includes(q.report)
      ? [{ from: context.today, to: shiftDay(context.today, 89) }]
      : []),
  ];
  const types = await tx.$queryRaw<
    Array<{ id: string; name: string; status: string; categoryId: string | null }>
  >`
    SELECT id,name,status::text,category_id AS "categoryId" FROM room_types WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY name,id`;
  const rooms = await tx.$queryRaw<
    Array<{ id: string; name: string; roomTypeId: string; active: boolean }>
  >`
    SELECT id,name,room_type_id AS "roomTypeId",is_active AS active FROM rooms WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY name,id`;
  const plans = await tx.$queryRaw<Array<{ id: string; name: string; currency: string }>>`
    SELECT id,name,currency FROM rate_plans WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid ORDER BY name,id`;
  if (
    (q.roomTypeId && !types.some((t) => t.id === q.roomTypeId)) ||
    (q.roomId &&
      !rooms.some((r) => r.id === q.roomId && (!q.roomTypeId || r.roomTypeId === q.roomTypeId))) ||
    (q.ratePlanId && !plans.some((p) => p.id === q.ratePlanId))
  )
    throw new NotFoundException('Report target not found in this property.');
  const filters = Prisma.sql`
    ${q.roomTypeId ? Prisma.sql`AND b.room_type_id=${q.roomTypeId}::uuid` : Prisma.empty}
    ${q.roomId ? Prisma.sql`AND b.room_id=${q.roomId}::uuid` : Prisma.empty}
    ${q.ratePlanId ? Prisma.sql`AND b.rate_plan_id=${q.ratePlanId}::uuid` : Prisma.empty}
    ${q.status ? Prisma.sql`AND b.status::text=${q.status}` : Prisma.empty}
    ${q.paymentMethod ? Prisma.sql`AND b.payment_method::text=${q.paymentMethod}` : Prisma.empty}
    ${q.source ? Prisma.sql`AND COALESCE(b.source,'UNKNOWN')=${q.source}` : Prisma.empty}
    ${q.currency ? Prisma.sql`AND (rp.currency=${q.currency} OR EXISTS (SELECT 1 FROM payments currency_payment WHERE currency_payment.tenant_id=${tenantId}::uuid AND currency_payment.property_id=${propertyId}::uuid AND currency_payment.booking_id=b.id AND currency_payment.currency=${q.currency}))` : Prisma.empty}
    ${q.bookingMode ? Prisma.sql`AND ${context.bookingMode}=${q.bookingMode}` : Prisma.empty}`;
  const candidates = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT b.id FROM bookings b
    JOIN rate_plans rp ON rp.tenant_id=${tenantId}::uuid AND rp.property_id=${propertyId}::uuid AND rp.id=b.rate_plan_id
    WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid ${filters}
      AND (${Prisma.join(
        windows.map(
          (w) => Prisma.sql`(
        (b.created_at>=(${w.from}::date::timestamp AT TIME ZONE ${context.timezone}) AND b.created_at<((${w.to}::date+1)::timestamp AT TIME ZONE ${context.timezone}))
        OR (b.starts_on<=${w.to}::date AND b.ends_on>=${w.from}::date)
        OR EXISTS(SELECT 1 FROM audit_logs a WHERE a.tenant_id=${tenantId}::uuid AND a.property_id=${propertyId}::uuid AND a.target_type='booking' AND a.target_id=b.id::text AND a.action='booking.cancelled' AND a.created_at>=(${w.from}::date::timestamp AT TIME ZONE ${context.timezone}) AND a.created_at<((${w.to}::date+1)::timestamp AT TIME ZONE ${context.timezone}))
        OR EXISTS(SELECT 1 FROM payments p WHERE p.tenant_id=${tenantId}::uuid AND p.property_id=${propertyId}::uuid AND p.booking_id=b.id AND p.created_at>=(${w.from}::date::timestamp AT TIME ZONE ${context.timezone}) AND p.created_at<((${w.to}::date+1)::timestamp AT TIME ZONE ${context.timezone})))`,
        ),
        ' OR ',
      )})
    ORDER BY b.created_at,b.id LIMIT ${REPORT_LIMITS.bookings + 1}`);
  checkReportCap(candidates, REPORT_LIMITS.bookings);
  const ids = candidates.map((b) => b.id);
  const bookings = await tx.$queryRaw<ReportBooking[]>(Prisma.sql`
    SELECT b.id,b.external_reference AS "externalReference",b.status::text,b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",b.created_at::text AS "createdAt",
      b.room_type_id AS "roomTypeId",rt.name AS "roomTypeName",b.room_id AS "roomId",r.name AS "roomName",b.rate_plan_id AS "ratePlanId",rp.name AS "ratePlanName",
      rp.currency,b.total_amount::text AS "totalAmount",b.nightly_rates AS "nightlyRates",b.source,b.payment_method::text AS "paymentMethod",b.guest_id AS "guestId",
      NULLIF(BTRIM(CONCAT_WS(' ',g.first_name,g.last_name)),'') AS "guestName",b.adults,b.children,b.pms_stay_status AS "pmsStayStatus",rp.meal_plan AS "mealPlan",rp.pricing_basis AS "pricingBasis",
      cancelled."cancelledAt",
      b.cancellation_is_free AS "cancellationIsFree",b.cancellation_cutoff_at::text AS "cancellationCutoffAt",
      (started.booking_id IS NOT NULL) AS "paymentStarted",
      history."firstGuestBookingAt"
    FROM bookings b
    JOIN room_types rt ON rt.tenant_id=${tenantId}::uuid AND rt.property_id=${propertyId}::uuid AND rt.id=b.room_type_id
    JOIN rate_plans rp ON rp.tenant_id=${tenantId}::uuid AND rp.property_id=${propertyId}::uuid AND rp.id=b.rate_plan_id
    LEFT JOIN rooms r ON r.tenant_id=${tenantId}::uuid AND r.property_id=${propertyId}::uuid AND r.id=b.room_id
    LEFT JOIN guests g ON g.tenant_id=${tenantId}::uuid AND g.id=b.guest_id
    LEFT JOIN (SELECT target_id,min(created_at)::text AS "cancelledAt" FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_type='booking' AND action='booking.cancelled' GROUP BY target_id) cancelled ON cancelled.target_id=b.id::text
    LEFT JOIN (SELECT DISTINCT booking_id FROM payment_provider_sessions WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid) started ON started.booking_id=b.id
    LEFT JOIN (SELECT guest_id,min(created_at)::text AS "firstGuestBookingAt" FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND guest_id IS NOT NULL AND status='CONFIRMED' GROUP BY guest_id) history ON history.guest_id=b.guest_id
    WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=ANY(${ids}::uuid[])
    ORDER BY b.created_at,b.id`);
  const payments = ids.length
    ? await tx.$queryRaw<ReportPayment[]>`
    SELECT id,booking_id AS "bookingId",kind::text,status,amount::text,currency,method,provider,created_at::text AS "createdAt"
    FROM payments WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=ANY(${ids}::uuid[])
    ORDER BY created_at,id LIMIT ${REPORT_LIMITS.payments + 1}`
    : [];
  checkReportCap(payments, REPORT_LIMITS.payments);
  const paymentsByBooking = new Map<string, ReportPayment[]>();
  for (const payment of payments) {
    const values = paymentsByBooking.get(payment.bookingId) ?? [];
    values.push(payment);
    paymentsByBooking.set(payment.bookingId, values);
  }
  const orphanPayments =
    q.report === 'quality'
      ? await tx.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM payments p LEFT JOIN bookings b ON b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid AND b.id=p.booking_id
    WHERE p.tenant_id=${tenantId}::uuid AND p.property_id=${propertyId}::uuid AND b.id IS NULL
      AND (${Prisma.join(
        windows.map(
          (w) =>
            Prisma.sql`p.created_at>=(${w.from}::date::timestamp AT TIME ZONE ${context.timezone}) AND p.created_at<((${w.to}::date+1)::timestamp AT TIME ZONE ${context.timezone})`,
        ),
        ' OR ',
      )})
    LIMIT ${REPORT_LIMITS.payments + 1}`
      : [];
  checkReportCap(orphanPayments, REPORT_LIMITS.payments);
  const stock = await tx.$queryRaw<
    Array<{ roomTypeId: string; date: string; capacity: number; held: number }>
  >`
    SELECT room_type_id AS "roomTypeId",stays_on::text AS date,available_units AS capacity,booked_units AS held
    FROM inventory_units WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
      AND (${Prisma.join(
        windows.map((w) => Prisma.sql`stays_on BETWEEN ${w.from}::date AND ${w.to}::date`),
        ' OR ',
      )})
      ${q.roomTypeId ? Prisma.sql`AND room_type_id=${q.roomTypeId}::uuid` : Prisma.empty}
    ORDER BY stays_on,room_type_id LIMIT ${REPORT_LIMITS.stock + 1}`;
  checkReportCap(stock, REPORT_LIMITS.stock);
  const unavailable =
    context.source === 'LOCAL'
      ? await tx.$queryRaw<Array<{ roomId: string; date: string }>>`
    SELECT ra.room_id AS "roomId",ra.stays_on::text AS date FROM room_availability ra
    JOIN rooms r ON r.tenant_id=${tenantId}::uuid AND r.property_id=${propertyId}::uuid AND r.id=ra.room_id AND r.is_active
    WHERE ra.tenant_id=${tenantId}::uuid AND ra.property_id=${propertyId}::uuid AND NOT ra.is_available AND ra.stays_on>=${context.today}::date
      AND (${Prisma.join(
        windows.map((w) => Prisma.sql`ra.stays_on BETWEEN ${w.from}::date AND ${w.to}::date`),
        ' OR ',
      )})
      ${q.roomTypeId ? Prisma.sql`AND r.room_type_id=${q.roomTypeId}::uuid` : Prisma.empty}
      ${q.roomId ? Prisma.sql`AND r.id=${q.roomId}::uuid` : Prisma.empty}
    LIMIT ${REPORT_LIMITS.stock + 1}`
      : [];
  checkReportCap(unavailable, REPORT_LIMITS.stock);
  const unavailableIndex = new Set(unavailable.map((row) => `${row.roomId}:${row.date}`));
  const blocks =
    context.source === 'LOCAL' ? await inventoryBlockRows(tx, tenantId, propertyId) : [];
  const restrictions =
    context.source === 'LOCAL' ? await restrictionRows(tx, tenantId, propertyId) : [];
  let health: ReturnType<typeof pricingHealth> | null = null;
  if (q.report === 'pricing' && context.source === 'LOCAL')
    health = pricingHealth(
      await pricingFacts(tx, tenantId, propertyId),
      types,
      context.today,
      context.advanceBookingDays,
    );
  const events =
    q.report === 'operations' && staff
      ? await tx.$queryRaw<ReportEvent[]>`
    SELECT id,action,actor_user_id AS actor,(created_at AT TIME ZONE ${context.timezone})::date::text AS date,target_id AS "targetId"
    FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
      AND (${Prisma.join(
        windows.map(
          (w) =>
            Prisma.sql`(created_at>=(${w.from}::date::timestamp AT TIME ZONE ${context.timezone}) AND created_at<((${w.to}::date+1)::timestamp AT TIME ZONE ${context.timezone}))`,
        ),
        ' OR ',
      )})
    ORDER BY created_at,id LIMIT ${REPORT_LIMITS.events + 1}`
      : [];
  checkReportCap(events, REPORT_LIMITS.events);
  const emails =
    q.report === 'operations'
      ? await tx.$queryRaw<
          Array<{ date: string; status: string; eventType: string; count: number }>
        >`
    SELECT (created_at AT TIME ZONE ${context.timezone})::date::text AS date,status::text,event_type AS "eventType",count(*)::int AS count
    FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
      AND (${Prisma.join(
        windows.map(
          (w) =>
            Prisma.sql`(created_at>=(${w.from}::date::timestamp AT TIME ZONE ${context.timezone}) AND created_at<((${w.to}::date+1)::timestamp AT TIME ZONE ${context.timezone}))`,
        ),
        ' OR ',
      )})
    GROUP BY 1,2,3 ORDER BY 1,2,3`
      : [];
  const stockIndex = new Map(stock.map((row) => [`${row.roomTypeId}:${row.date}`, row]));
  const roomsByType = new Map(types.map((t) => [t.id, rooms.filter((r) => r.roomTypeId === t.id)]));
  return {
    context,
    types,
    rooms,
    plans,
    bookings,
    payments,
    paymentsByBooking,
    orphanPayments,
    stock,
    unavailableIndex,
    stockIndex,
    roomsByType,
    blocks,
    restrictions,
    health,
    events,
    emails,
  };
}
export type ReportFacts = Awaited<ReturnType<typeof reportFacts>>;
