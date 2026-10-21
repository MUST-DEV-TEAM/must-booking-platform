import { BOOKING_CONTACT_SQL, bookingContactSql } from './booking-contact';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { BookingPaymentMethod, BookingStatus } from '@must/domain-contracts';

import { pricingContext } from '../tenancy/pricing.repository';
import { scheduledStayMetrics, type ReservationMetricRow } from '../tenancy/report-metrics';
import { checkReportCap, REPORT_LIMITS } from '../tenancy/report-facts.repository';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import {
  BOOKING_VIEWS,
  buildBookingSearch,
  PAYMENT_STATE_SQL,
  VIEW_SQL,
  type BookingSearchQuery,
  type BookingView,
} from './booking-search';

export type BookingProjection = {
  id: string;
  guestId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  guestStreetAddress: string | null;
  guestAddressLine2: string | null;
  guestCity: string | null;
  guestCounty: string | null;
  guestPostcode: string | null;
  guestCountryCode?: string | null;
  guestCaptureVersion?: number;
  specialRequests: string | null;
  roomTypeId: string;
  roomTypeName: string;
  roomId: string | null;
  ratePlanId: string;
  ratePlanName: string;
  startsOn: string;
  endsOn: string;
  status: BookingStatus;
  // The PMS's own stay status as received (Clock: expected, checked_in, ...).
  pmsStayStatus: string | null;
  paymentMethod: BookingPaymentMethod;
  adults: number;
  children: number;
  total: { amount: string; currency: string };
  paidAmount: string;
  refundedAmount: string;
  externalReference: string;
  // Visibility only — every real Clock folio for this booking (Task B,
  // docs/CLOCK_FINANCIAL_RECONCILIATION_PLAN.md). A booking can genuinely
  // have both a deposit folio and a general folio at once; this is not a
  // payment-reconciliation signal on its own (Task C compares MUST's own
  // payment totals against the deposit folio specifically, in Clock).
  clockFolios: ClockFolioProjection[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type ClockFolioProjection = {
  id: string;
  isDeposit: boolean;
  balance: string | null;
  closedAt: Date | null;
};

export type BookingSearchItem = {
  cancellationPending: boolean;
  id: string;
  externalReference: string;
  orderReference: string | null;
  status: string;
  paymentMethod: string;
  paymentState: string;
  source: string | null;
  startsOn: string;
  endsOn: string;
  createdAt: string;
  adults: number;
  children: number;
  specialRequests: string | null;
  pmsStayStatus: string | null;
  roomId: string | null;
  roomName: string | null;
  roomTypeId: string;
  roomTypeName: string;
  ratePlanName: string;
  guestId: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  total: { amount: string; currency: string };
  paidAmount: string;
  refundedAmount: string;
};

export type BookingActivity = {
  action: string;
  createdAt: string;
  actorEmail: string | null;
  details: Record<string, unknown>;
};

export type BookingDetail = BookingSearchItem & {
  version: number;
  updatedAt: string;
  detailsManagedInClock: boolean;
  maxOccupancy: number;
  estimatedArrivalTime: string | null;
  externalBookingId: string | null;
  nightlyRates: Array<{ date: string; amount: string }> | null;
  cancellation: {
    isFree: boolean | null;
    freeUntilHours: number | null;
    cutoffAt: string | null;
  };
  orderRoomNumber: number | null;
  guestAddress: {
    street: string | null;
    line2: string | null;
    city: string | null;
    county: string | null;
    postcode: string | null;
  };
  clockFolios: Array<{
    id: string;
    isDeposit: boolean;
    balance: string | null;
    closedAt: string | null;
  }>;
  activity: BookingActivity[];
};

// Audit details can carry provider payloads; only these fields are shown to staff.
const VISIBLE_ACTIVITY_KEYS = [
  'amount',
  'note',
  'reason',
  'reference',
  'externalBookingId',
  'status',
  'from',
  'to',
  'provider',
] as const;

export type BookingSearchResult = {
  items: BookingSearchItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<BookingView, number>;
  metricBasis: { source: string; timezone: string; today: string; basis: string };
};

const isoDate = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value);

function toSearchItem(row: Record<string, unknown>): BookingSearchItem {
  return {
    id: String(row.id),
    externalReference: String(row.external_reference),
    orderReference: (row.order_reference as string | null) ?? null,
    status: String(row.status),
    cancellationPending: row.cancellation_pending === true,
    paymentMethod: String(row.payment_method),
    paymentState: String(row.payment_state),
    source: (row.source as string | null) ?? null,
    startsOn: isoDate(row.starts_on),
    endsOn: isoDate(row.ends_on),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    adults: Number(row.adults),
    children: Number(row.children),
    specialRequests: (row.special_requests as string | null) ?? null,
    pmsStayStatus: (row.pms_stay_status as string | null) ?? null,
    roomId: (row.room_id as string | null) ?? null,
    roomName: (row.room_name as string | null) ?? null,
    roomTypeId: String(row.room_type_id),
    roomTypeName: String(row.room_type_name),
    ratePlanName: String(row.rate_plan_name),
    guestId: (row.guest_id as string | null) ?? null,
    guestFirstName: (row.guest_first_name as string | null) ?? null,
    guestLastName: (row.guest_last_name as string | null) ?? null,
    guestEmail: (row.guest_email as string | null) ?? null,
    guestPhone: (row.guest_phone as string | null) ?? null,
    total: { amount: String(row.total_amount), currency: String(row.currency) },
    paidAmount: String(row.paid),
    refundedAmount: String(row.refunded),
  };
}

/** One row per booking with its guest, room, rate plan and payment totals. Used by list and detail. */
const BOOKING_BASE_SQL = `
      SELECT x.*, ${PAYMENT_STATE_SQL} AS payment_state FROM (
        SELECT NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_type='booking' AND a.target_id=b.id::text AND a.action='booking.attention_dismissed' AND a.details->>'version'=b.version::text AND a.details->>'status'=b.status::text) AS attention_open, b.id, b.external_reference, b.order_reference, b.status, b.payment_method, b.source,
          b.starts_on, b.ends_on, b.created_at, b.total_amount, b.adults, b.children,
          EXISTS(SELECT 1 FROM booking_requests q WHERE q.tenant_id=b.tenant_id AND q.property_id=b.property_id AND q.booking_id=b.id AND q.type='cancellation' AND q.status='Pending') AS cancellation_pending,
          b.special_requests, b.pms_stay_status, b.room_id, r.name AS room_name,
          b.room_type_id, rt.name AS room_type_name, rp.name AS rate_plan_name, rp.currency,
          b.guest_id, ${BOOKING_CONTACT_SQL.firstName} AS guest_first_name, ${BOOKING_CONTACT_SQL.lastName} AS guest_last_name,
          ${BOOKING_CONTACT_SQL.email} AS guest_email, ${BOOKING_CONTACT_SQL.phone} AS guest_phone,
          COALESCE(pt.paid, 0) AS paid, COALESCE(pt.refunded, 0) AS refunded,
          b.version, b.updated_at, b.external_booking_id, b.nightly_rates, b.estimated_arrival_time, rt.max_occupancy,
          (b.external_booking_id IS NOT NULL OR EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections ic ON ic.tenant_id=pc.tenant_id AND ic.id=pc.connection_id WHERE pc.tenant_id=b.tenant_id AND pc.property_id=b.property_id AND pc.enabled AND pc.kind='PMS' AND ic.provider='CLOCK_PMS')) AS details_managed_in_clock,
          b.cancellation_is_free, b.cancellation_free_until_hours, b.cancellation_cutoff_at,
          b.order_room_number, g.street_address AS guest_street_address,
          g.address_line_2 AS guest_address_line_2, g.city AS guest_city, g.county AS guest_county,
          g.postcode AS guest_postcode,
          COALESCE(p.timezone, 'UTC') AS tz,
          (now() AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date AS today
        FROM bookings b
        JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
        LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.id = b.room_id
        JOIN room_types rt
          ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        LEFT JOIN LATERAL (
          SELECT SUM(CASE WHEN py.kind = 'CHARGE' AND py.status IN ('succeeded', 'PAID') THEN py.amount ELSE 0 END) AS paid,
            SUM(CASE WHEN py.kind = 'REFUND' THEN py.amount ELSE 0 END) AS refunded
          FROM payments py
          WHERE py.tenant_id = b.tenant_id AND py.property_id = b.property_id AND py.booking_id = b.id
        ) pt ON TRUE
        WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
      ) x
    `;

@Injectable()
export class BookingProjectionService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  /**
   * Every live reservation that touches the window [from, to), for the calendar board. A
   * reservation is live unless it is cancelled, expired, a draft or only a quote. Capped so a
   * very busy hotel cannot overload the page; `truncated` says when the cap was hit.
   */
  async board(
    tenantId: string,
    propertyId: string,
    from: string,
    to: string,
    includeCancelled = false,
  ): Promise<{ items: BookingSearchItem[]; truncated: boolean }> {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(from) || !day.test(to) || to <= from)
      throw new BadRequestException('from and to must be dates, and to must be after from.');
    const spanDays =
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86_400_000;
    if (spanDays > 92) throw new BadRequestException('The calendar window can be at most 92 days.');
    const LIMIT = 1000;
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT x.* FROM (${BOOKING_BASE_SQL}) x
         WHERE x.starts_on < $4::date AND x.ends_on > $3::date
           AND x.status NOT IN (${includeCancelled ? "'EXPIRED', 'DRAFT', 'QUOTED'" : "'CANCELLED', 'EXPIRED', 'DRAFT', 'QUOTED'"})
         ORDER BY x.starts_on, x.created_at
         LIMIT ${LIMIT + 1}`,
        tenantId,
        propertyId,
        from,
        to,
      );
      return { items: rows.slice(0, LIMIT).map(toSearchItem), truncated: rows.length > LIMIT };
    });
  }

  /**
   * Recent reservations this staff member has not opened yet. A reservation counts as new for
   * 14 days after it was made; opening it (the preview or the detail page) clears it for them.
   */
  async unseen(
    tenantId: string,
    propertyId: string,
    userId: string,
  ): Promise<{ count: number; ids: string[] }> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT b.id
        FROM bookings b
        LEFT JOIN booking_seen s
          ON s.tenant_id = b.tenant_id AND s.booking_id = b.id AND s.user_id = ${userId}::uuid
        WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
          AND b.created_at > now() - interval '14 days'
          AND b.status NOT IN ('CANCELLED', 'EXPIRED', 'DRAFT', 'QUOTED')
          AND s.booking_id IS NULL
        ORDER BY b.created_at DESC
        LIMIT 500
      `;
      return { count: rows.length, ids: rows.map((row) => row.id) };
    });
  }

  /** Records that this staff member has opened the reservation. Safe to repeat. */
  async markSeen(
    tenantId: string,
    propertyId: string,
    userId: string,
    bookingId: string,
  ): Promise<void> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) return;
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO booking_seen (tenant_id, property_id, user_id, booking_id)
        SELECT b.tenant_id, b.property_id, ${userId}::uuid, b.id
        FROM bookings b
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${tenantId}::uuid
          AND b.property_id = ${propertyId}::uuid
        ON CONFLICT DO NOTHING
      `;
    });
  }

  /** One booking for the dashboard detail page, or null when it is not in this property. */
  async detail(
    tenantId: string,
    propertyId: string,
    bookingId: string,
  ): Promise<BookingDetail | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId))
      return null;
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT x.* FROM (${BOOKING_BASE_SQL}) x WHERE x.id = $3::uuid`,
        tenantId,
        propertyId,
        bookingId,
      );
      const row = rows[0];
      if (!row) return null;
      const folios = await tx.$queryRaw<
        Array<{ id: string; isDeposit: boolean; balance: string | null; closedAt: Date | null }>
      >`
        SELECT cf.clock_folio_id AS id, cf.is_deposit AS "isDeposit", cf.balance::text AS balance,
          cf.closed_at AS "closedAt"
        FROM clock_folios cf
        WHERE cf.booking_id = ${bookingId}::uuid AND cf.tenant_id = ${tenantId}::uuid
          AND cf.property_id = ${propertyId}::uuid
        ORDER BY cf.is_deposit DESC, cf.created_at
      `;
      const events = await tx.$queryRaw<
        Array<{
          action: string;
          createdAt: Date;
          actorEmail: string | null;
          details: Record<string, unknown> | null;
        }>
      >`
        SELECT a.action, a.created_at AS "createdAt", u.email AS "actorEmail", a.details
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.target_type = 'booking' AND a.target_id = ${bookingId}
          AND a.tenant_id = ${tenantId}::uuid
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 50
      `;
      const text = (value: unknown) =>
        value === null || value === undefined ? null : String(value);
      return {
        ...toSearchItem(row),
        version: Number(row.version),
        updatedAt:
          row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        externalBookingId: text(row.external_booking_id),
        detailsManagedInClock: row.details_managed_in_clock === true,
        maxOccupancy: Number(row.max_occupancy),
        estimatedArrivalTime: text(row.estimated_arrival_time),
        nightlyRates: (row.nightly_rates as BookingDetail['nightlyRates']) ?? null,
        cancellation: {
          isFree: (row.cancellation_is_free as boolean | null) ?? null,
          freeUntilHours:
            row.cancellation_free_until_hours === null
              ? null
              : Number(row.cancellation_free_until_hours),
          cutoffAt:
            row.cancellation_cutoff_at instanceof Date
              ? row.cancellation_cutoff_at.toISOString()
              : text(row.cancellation_cutoff_at),
        },
        orderRoomNumber: row.order_room_number === null ? null : Number(row.order_room_number),
        guestAddress: {
          street: text(row.guest_street_address),
          line2: text(row.guest_address_line_2),
          city: text(row.guest_city),
          county: text(row.guest_county),
          postcode: text(row.guest_postcode),
        },
        clockFolios: folios.map((folio) => ({
          ...folio,
          closedAt: folio.closedAt ? folio.closedAt.toISOString() : null,
        })),
        activity: events.map((event) => ({
          action: event.action,
          createdAt: event.createdAt.toISOString(),
          actorEmail: event.actorEmail,
          details: Object.fromEntries(
            VISIBLE_ACTIVITY_KEYS.flatMap((key) =>
              event.details && key in event.details ? [[key, event.details[key]]] : [],
            ),
          ),
        })),
      };
    });
  }

  /**
   * Server-side list for the dashboard Reservations page: filtered, sorted and paged in SQL, plus
   * a count for every saved view (counts ignore the other filters so the tabs stay stable).
   */
  async search(
    tenantId: string,
    propertyId: string,
    query: BookingSearchQuery,
  ): Promise<BookingSearchResult> {
    const built = buildBookingSearch(query);
    const limit = `$${built.params.length + 3}`;
    const offset = `$${built.params.length + 4}`;
    const base = BOOKING_BASE_SQL;
    const countSelect = BOOKING_VIEWS.filter(
      (view) => !['arriving_today', 'departing_today', 'in_house'].includes(view),
    )
      .map((view) => `COUNT(*) FILTER (WHERE ${VIEW_SQL[view]})::int AS "${view}"`)
      .join(', ');

    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      async (tx) => {
        const rows = await tx.$queryRawUnsafe<
          Array<Record<string, unknown> & { total_count: number }>
        >(
          `SELECT x.*, COUNT(*) OVER()::int AS total_count FROM (${base}) x
         WHERE ${built.where} ORDER BY ${built.orderBy} LIMIT ${limit} OFFSET ${offset}`,
          tenantId,
          propertyId,
          ...built.params,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        );
        const property = await pricingContext(tx, tenantId, propertyId);
        const scheduledRows = await tx.$queryRaw<ReservationMetricRow[]>`
        SELECT status::text,starts_on::text AS "startsOn",ends_on::text AS "endsOn",created_at::text AS "createdAt"
        FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND status='CONFIRMED'
          AND starts_on<=${property.today}::date AND ends_on>=${property.today}::date LIMIT ${REPORT_LIMITS.bookings + 1}`;
        checkReportCap(scheduledRows, REPORT_LIMITS.bookings);
        const scheduled = scheduledStayMetrics(scheduledRows, property.today, property.timezone);
        const counts = await tx.$queryRawUnsafe<Array<Record<BookingView, number>>>(
          `SELECT ${countSelect} FROM (${base}) x`,
          tenantId,
          propertyId,
        );
        return {
          items: rows.map(toSearchItem),
          total: rows.length > 0 ? Number(rows[0]!.total_count) : 0,
          page: query.page,
          pageSize: query.pageSize,
          metricBasis: {
            source: property.source === 'LOCAL' ? 'LOCAL' : 'CLOCK',
            timezone: property.timezone,
            today: property.today,
            basis: 'Confirmed scheduled stays, departure exclusive; stored reservation records',
          },
          counts: {
            ...(counts[0] ?? ({} as Record<BookingView, number>)),
            arriving_today: scheduled.arrivals,
            departing_today: scheduled.departures,
            in_house: scheduled.inHouse,
          },
        };
      },
      { timeoutMs: 20000, isolationLevel: 'RepeatableRead' },
    );
  }

  async list(tenantId: string, propertyId: string): Promise<BookingProjection[]> {
    const rows = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<
          Array<
            Omit<BookingProjection, 'total'> & {
              totalAmount: string;
              currency: string;
            }
          >
        >`
        SELECT b.id, b.guest_id AS "guestId", ${bookingContactSql.firstName} AS "guestFirstName",
          ${bookingContactSql.lastName} AS "guestLastName", ${bookingContactSql.email} AS "guestEmail", ${bookingContactSql.phone} AS "guestPhone",
          g.street_address AS "guestStreetAddress", g.address_line_2 AS "guestAddressLine2",
          g.city AS "guestCity", g.county AS "guestCounty", g.postcode AS "guestPostcode",g.country_code AS "guestCountryCode",g.capture_version AS "guestCaptureVersion",
          b.special_requests AS "specialRequests",
          b.room_type_id AS "roomTypeId", rt.name AS "roomTypeName", b.room_id AS "roomId",
          b.rate_plan_id AS "ratePlanId", rp.name AS "ratePlanName",
          b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn", b.status, b.pms_stay_status AS "pmsStayStatus",
          b.payment_method AS "paymentMethod",
          b.adults, b.children,
          b.total_amount::text AS "totalAmount", rp.currency, b.external_reference AS "externalReference",
          COALESCE(payment_totals."paidAmount", 0)::text AS "paidAmount",
          COALESCE(payment_totals."refundedAmount", 0)::text AS "refundedAmount",
          COALESCE(folios."clockFolios", '[]'::jsonb) AS "clockFolios",
          b.version, b.created_at AS "createdAt", b.updated_at AS "updatedAt"
        FROM bookings b
        LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN room_types rt
          ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        LEFT JOIN LATERAL (
          -- Real gateways (Stripe, PokPay) write status 'PAID'; only staff-recorded
          -- manual payments write 'succeeded' — both mean a real successful charge.
          SELECT SUM(CASE WHEN p.kind = 'CHARGE' AND p.status IN ('succeeded', 'PAID') THEN p.amount ELSE 0 END) AS "paidAmount",
            SUM(CASE WHEN p.kind = 'REFUND' THEN p.amount ELSE 0 END) AS "refundedAmount"
          FROM payments p
          WHERE p.tenant_id = b.tenant_id AND p.property_id = b.property_id AND p.booking_id = b.id
        ) payment_totals ON TRUE
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', cf.clock_folio_id, 'isDeposit', cf.is_deposit,
              'balance', cf.balance::text, 'closedAt', cf.closed_at
            ) ORDER BY cf.is_deposit DESC, cf.created_at
          ) AS "clockFolios"
          FROM clock_folios cf
          WHERE cf.tenant_id = b.tenant_id AND cf.property_id = b.property_id AND cf.booking_id = b.id
        ) folios ON TRUE
        WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
        ORDER BY b.starts_on DESC, b.created_at DESC, b.id DESC
      `,
    );
    return rows.map(({ totalAmount, currency, ...booking }) => ({
      ...booking,
      total: { amount: totalAmount, currency },
    }));
  }
}
