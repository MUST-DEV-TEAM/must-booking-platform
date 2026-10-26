import { BOOKING_CONTACT_SQL } from '../booking/booking-contact';
import { Inject, Injectable } from '@nestjs/common';

import { BOOKING_NEEDS_ATTENTION_STATUSES } from '../booking/booking-attention';
import { CapabilitiesService } from './capabilities.service';
import { DashboardMetricsService } from './dashboard-metrics.service';
import { resolveOverviewType, visibleWidgets, type WidgetKey } from './overview-widgets';
import { TenantDatabaseService } from './tenant-database.service';

type Kpis = {
  date: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  bookedRoomNights: number;
  availableRoomNights: number | null;
};

export type ArrivalDeparture = {
  id: string;
  externalReference: string;
  guestName: string | null;
  guestEmail: string;
  roomTypeName: string;
  adults: number;
  children: number;
  hasSpecialRequests: boolean;
  paymentMethod: string;
  totalAmount: string;
  currency: string;
};

export type UpcomingArrival = ArrivalDeparture & { startsOn: string };

export type SoldOutRoom = {
  roomId: string;
  roomName: string;
  roomTypeName: string;
  reason: 'booked' | 'blocked';
};

export type RecentCancellation = {
  id: string;
  externalReference: string;
  guestName: string | null;
  guestEmail: string;
  roomTypeName: string;
  startsOn: string;
  endsOn: string;
  cancelledAt: string;
};

export type ActivityItem = {
  id: string;
  action: string;
  createdAt: string;
  summary: string;
};

export type NeedsAttentionBooking = {
  id: string;
  status: string;
  startsOn: string;
  endsOn: string;
  guestName: string | null;
  guestEmail: string;
  roomTypeName: string;
};

export type PropertyOverview = {
  kpis: Kpis & { occupancyRate: number | null };
  revenue: {
    today: { amount: string; currency: string } | null;
    byCurrency: Array<{ amount: string; currency: string }>;
  };
  balanceDueAtDesk: { amount: string; currency: string } | null;
  balancesDueAtDesk: Array<{ amount: string; currency: string }>;
  metricBasis: {
    asOf: string;
    source: string;
    timezone: string;
    moneyVisible: boolean;
    capacity: string;
    cash: string;
    desk: string;
  };
  newBookingsSinceYesterday: number;
  needsAttentionCount: number;
  needsAttention: NeedsAttentionBooking[];
  todaysArrivals: ArrivalDeparture[];
  todaysDepartures: ArrivalDeparture[];
  upcomingArrivals: UpcomingArrival[];
  soldOutRooms: SoldOutRoom[];
  recentCancellations: RecentCancellation[];
  recentActivity: ActivityItem[];
  /** Which widgets this person sees. Data of every other widget is left out, not just hidden. */
  view: { type: string; widgets: WidgetKey[] };
};

// Every non-terminal-failure booking status that occupies a room/rate for a
// night — the same list availability.service.ts uses to decide a room is
// unavailable, kept in sync deliberately rather than importing a private
// constant across modules.
const OCCUPYING_STATUSES = [
  'PAYMENT_PENDING',
  'PAYMENT_NOT_REQUIRED',
  'PMS_CREATION_PENDING',
  'PMS_CONFIRMATION_PENDING',
  'CONFIRMED',
  'PAYMENT_FAILED',
  'PMS_UNKNOWN_RESULT',
  'PMS_REJECTED',
  'MANUAL_REVIEW',
] as const;

// Only business events a front-desk user would recognize without decoding
// an internal action string — catalog sync, integration plumbing, logins,
// and other system-internal audit rows are deliberately excluded here.
const ACTIVITY_ACTIONS = ['booking.created', 'booking.cancelled'] as const;

@Injectable()
export class OverviewService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(DashboardMetricsService) private readonly metrics: DashboardMetricsService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}

  private async viewFor(tenantId: string, propertyId: string, userId: string, source: string) {
    const capabilities = await this.capabilities.effective({ tenantId, propertyId, userId });
    const rows = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<
          Array<{
            role: 'OWNER' | 'ADMIN' | 'STAFF';
            roleName: string | null;
            roleKind: 'BUILT_IN' | 'CUSTOM' | null;
            overviewType: string | null;
          }>
        >`SELECT tm.role::text AS role, prt.name AS "roleName", prt.kind::text AS "roleKind",
          prt.overview_type AS "overviewType"
        FROM tenant_memberships tm
        LEFT JOIN property_staff_assignments psa ON psa.tenant_id = tm.tenant_id
          AND psa.property_id = ${propertyId}::uuid AND psa.user_id = tm.user_id AND psa.suspended_at IS NULL
        LEFT JOIN property_role_templates prt ON prt.tenant_id = psa.tenant_id
          AND prt.property_id = psa.property_id AND prt.id = psa.role_template_id
        WHERE tm.tenant_id = ${tenantId}::uuid AND tm.user_id = ${userId}::uuid`,
    );
    const row = rows[0];
    const type = resolveOverviewType({
      tenantRole: row?.role ?? 'STAFF',
      roleName: row?.roleName,
      roleKind: row?.roleKind,
      storedType: row?.overviewType,
      capabilities,
    });
    return {
      type,
      widgets: visibleWidgets(type, capabilities, {
        source: source === 'CLOCK' ? 'CLOCK' : 'LOCAL',
      }),
    };
  }

  async get(tenantId: string, propertyId: string, userId: string): Promise<PropertyOverview> {
    const [
      metrics,
      needsAttentionCount,
      needsAttention,
      todaysArrivals,
      todaysDepartures,
      upcomingArrivals,
      soldOutRooms,
      recentCancellations,
      recentActivity,
    ] = await Promise.all([
      this.metrics.overview({ tenantId, propertyId, userId }),
      this.needsAttentionCount(tenantId, propertyId),
      this.needsAttentionBookings(tenantId, propertyId),
      this.arrivalsOrDeparturesOn(tenantId, propertyId, 'starts_on'),
      this.arrivalsOrDeparturesOn(tenantId, propertyId, 'ends_on'),
      this.upcomingArrivals(tenantId, propertyId),
      this.soldOutRooms(tenantId, propertyId),
      this.recentCancellations(tenantId, propertyId),
      this.recentActivity(tenantId, propertyId),
    ]);
    const view = await this.viewFor(tenantId, propertyId, userId, metrics.metricBasis.source);
    const has = (key: WidgetKey) => view.widgets.includes(key);
    // Data of widgets the person may not (or need not) see is left out of the response entirely.
    return {
      ...metrics,
      kpis: {
        ...metrics.kpis,
        arrivals: has('tile.arrivals') ? metrics.kpis.arrivals : 0,
        departures: has('tile.departures') ? metrics.kpis.departures : 0,
        inHouse: has('tile.inHouse') ? metrics.kpis.inHouse : 0,
        occupancyRate: has('tile.occupancy') ? metrics.kpis.occupancyRate : null,
      },
      revenue: has('tile.collectedToday') ? metrics.revenue : { today: null, byCurrency: [] },
      balanceDueAtDesk: has('tile.dueAtDesk') ? metrics.balanceDueAtDesk : null,
      balancesDueAtDesk: has('tile.dueAtDesk') ? metrics.balancesDueAtDesk : [],
      newBookingsSinceYesterday: has('tile.newBookings') ? metrics.newBookingsSinceYesterday : 0,
      needsAttentionCount: has('tile.needsAttention') ? needsAttentionCount : 0,
      needsAttention: has('list.needsAttention') ? needsAttention : [],
      todaysArrivals: has('list.arrivals') ? todaysArrivals : [],
      todaysDepartures: has('list.departures') ? todaysDepartures : [],
      upcomingArrivals: has('list.upcomingArrivals') ? upcomingArrivals : [],
      soldOutRooms:
        metrics.metricBasis.source === 'CLOCK' || !has('list.soldOut') ? [] : soldOutRooms,
      recentCancellations: has('list.cancellations') ? recentCancellations : [],
      recentActivity: has('list.activity') ? recentActivity : [],
      view,
    };
  }

  private needsAttentionCount(tenantId: string, propertyId: string) {
    return this.database
      .withTenantTransaction({ tenantId, propertyId }, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT COUNT(*)::int AS count FROM bookings b
           WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
             AND b.status = ANY($3::"BookingStatus"[]) AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_type='booking' AND a.target_id=b.id::text AND a.action='booking.attention_dismissed' AND a.details->>'version'=b.version::text AND a.details->>'status'=b.status::text)`,
          tenantId,
          propertyId,
          BOOKING_NEEDS_ATTENTION_STATUSES,
        ),
      )
      .then((rows) => rows[0]?.count ?? 0);
  }

  /** The bookings behind needsAttentionCount, newest first. Guest and room type are
   * LEFT-joined so a booking that came from the PMS without a guest still appears. */
  private needsAttentionBookings(
    tenantId: string,
    propertyId: string,
  ): Promise<NeedsAttentionBooking[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<NeedsAttentionBooking[]>(
        `SELECT b.id, b.status::text AS status, b.starts_on::text AS "startsOn",
           b.ends_on::text AS "endsOn",
           NULLIF(CONCAT_WS(' ', ${BOOKING_CONTACT_SQL.firstName}, ${BOOKING_CONTACT_SQL.lastName}), '') AS "guestName",
           COALESCE(${BOOKING_CONTACT_SQL.email}, '') AS "guestEmail",
           COALESCE(rt.name, '') AS "roomTypeName"
         FROM bookings b
         LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
         LEFT JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
         WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
           AND b.status = ANY($3::"BookingStatus"[]) AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_type='booking' AND a.target_id=b.id::text AND a.action='booking.attention_dismissed' AND a.details->>'version'=b.version::text AND a.details->>'status'=b.status::text)
         ORDER BY b.created_at DESC
         LIMIT 50`,
        tenantId,
        propertyId,
        BOOKING_NEEDS_ATTENTION_STATUSES,
      ),
    );
  }

  /** Today's arrivals or departures (by whichever date column names the
   * event), richest-first columns front desk actually needs: guest, party
   * size, a special-requests flag (not the text itself — kept out of a
   * summary list), payment method/amount, and the reference number staff
   * use to pull up the reservation. Ordered alphabetically by guest name,
   * matching a same-day arrivals sheet. */
  private arrivalsOrDeparturesOn(
    tenantId: string,
    propertyId: string,
    dateColumn: 'starts_on' | 'ends_on',
  ): Promise<ArrivalDeparture[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<ArrivalDeparture[]>(
        `WITH property_today AS (
           SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS date FROM properties
           WHERE tenant_id = $1::uuid AND id = $2::uuid
         )
         SELECT b.id, b.external_reference AS "externalReference",
           NULLIF(CONCAT_WS(' ', ${BOOKING_CONTACT_SQL.firstName}, ${BOOKING_CONTACT_SQL.lastName}), '') AS "guestName",
           ${BOOKING_CONTACT_SQL.email} AS "guestEmail", rt.name AS "roomTypeName", b.adults, b.children,
           (b.special_requests IS NOT NULL AND b.special_requests <> '') AS "hasSpecialRequests",
           b.payment_method::text AS "paymentMethod", b.total_amount::text AS "totalAmount",
           rp.currency
         FROM bookings b
         CROSS JOIN property_today
         JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
         JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
         JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
         WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
           AND b.${dateColumn} = property_today.date
           AND b.status = 'CONFIRMED'::"BookingStatus"
         ORDER BY COALESCE(NULLIF(CONCAT_WS(' ', ${BOOKING_CONTACT_SQL.firstName}, ${BOOKING_CONTACT_SQL.lastName}), ''), ${BOOKING_CONTACT_SQL.email}) ASC`,
        tenantId,
        propertyId,
      ),
    );
  }

  /** Next 7 days of arrivals (excluding today, already covered above),
   * ordered by arrival date first and then alphabetically by guest name
   * within the same date — a same-day tie-break, not a global sort. */
  private upcomingArrivals(tenantId: string, propertyId: string): Promise<UpcomingArrival[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<UpcomingArrival[]>(
        `WITH property_today AS (
           SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS date FROM properties
           WHERE tenant_id = $1::uuid AND id = $2::uuid
         )
         SELECT b.id, b.external_reference AS "externalReference",
           NULLIF(CONCAT_WS(' ', ${BOOKING_CONTACT_SQL.firstName}, ${BOOKING_CONTACT_SQL.lastName}), '') AS "guestName",
           ${BOOKING_CONTACT_SQL.email} AS "guestEmail", rt.name AS "roomTypeName", b.adults, b.children,
           (b.special_requests IS NOT NULL AND b.special_requests <> '') AS "hasSpecialRequests",
           b.payment_method::text AS "paymentMethod", b.total_amount::text AS "totalAmount",
           rp.currency, b.starts_on::text AS "startsOn"
         FROM bookings b
         CROSS JOIN property_today
         JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
         JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
         JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
         WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
           AND b.starts_on > property_today.date AND b.starts_on <= property_today.date + INTERVAL '7 days'
           AND b.status = 'CONFIRMED'::"BookingStatus"
         ORDER BY b.starts_on ASC,
           COALESCE(NULLIF(CONCAT_WS(' ', ${BOOKING_CONTACT_SQL.firstName}, ${BOOKING_CONTACT_SQL.lastName}), ''), ${BOOKING_CONTACT_SQL.email}) ASC
         LIMIT 20`,
        tenantId,
        propertyId,
      ),
    );
  }

  /** Individual rooms unavailable for tonight, split by why: genuinely
   * booked (normal occupancy, not a problem) vs blocked by an availability
   * block (out of service, maintenance, etc. — the "can I still sell this"
   * question front desk actually has). Local-room-tracking properties only
   * (ROOM_TYPE_ONLY has no physical rooms to enumerate here); Clock-side
   * stop-from-sale isn't queried per-room here to avoid the same live,
   * per-room Clock rate-limit cost the rate-ranking batch fix avoided. */
  private soldOutRooms(tenantId: string, propertyId: string): Promise<SoldOutRoom[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<SoldOutRoom[]>(
        `WITH property_today AS (
           SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS date FROM properties
           WHERE tenant_id = $1::uuid AND id = $2::uuid
         )
         SELECT r.id AS "roomId", r.name AS "roomName", rt.name AS "roomTypeName",
           CASE WHEN EXISTS (
             SELECT 1 FROM availability_blocks ab CROSS JOIN property_today
             WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = r.tenant_id AND ab.property_id = r.property_id
               AND ab.starts_on <= property_today.date AND ab.ends_on > property_today.date
               AND (
                 ab.blocks_all
                 OR EXISTS (
                   SELECT 1 FROM availability_block_rooms abr
                   WHERE abr.tenant_id = ab.tenant_id AND abr.property_id = ab.property_id
                     AND abr.block_id = ab.id AND abr.room_id = r.id
                 )
                 OR EXISTS (
                   SELECT 1 FROM availability_block_room_types abrt
                   WHERE abrt.tenant_id = ab.tenant_id AND abrt.property_id = ab.property_id
                     AND abrt.block_id = ab.id AND abrt.room_type_id = r.room_type_id
                 )
               )
           ) THEN 'blocked' ELSE 'booked' END AS reason
         FROM rooms r
         CROSS JOIN property_today
         JOIN room_types rt ON rt.tenant_id = r.tenant_id AND rt.property_id = r.property_id AND rt.id = r.room_type_id
         WHERE r.tenant_id = $1::uuid AND r.property_id = $2::uuid
           AND (
             EXISTS (
               SELECT 1 FROM room_availability ra
               WHERE ra.tenant_id = r.tenant_id AND ra.property_id = r.property_id AND ra.room_id = r.id
                 AND ra.stays_on = property_today.date AND ra.is_available = false
             )
             OR EXISTS (
               SELECT 1 FROM bookings b
               WHERE b.tenant_id = r.tenant_id AND b.property_id = r.property_id AND b.room_id = r.id
                 AND b.starts_on <= property_today.date AND b.ends_on > property_today.date
                 AND b.status = ANY($3::"BookingStatus"[]) AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.target_type='booking' AND a.target_id=b.id::text AND a.action='booking.attention_dismissed' AND a.details->>'version'=b.version::text AND a.details->>'status'=b.status::text)
             )
             OR EXISTS (
               SELECT 1 FROM availability_blocks ab
               WHERE ab.lifecycle IN ('Active','Scheduled') AND ab.tenant_id = r.tenant_id AND ab.property_id = r.property_id
                 AND ab.starts_on <= property_today.date AND ab.ends_on > property_today.date
                 AND (
                   ab.blocks_all
                   OR EXISTS (
                     SELECT 1 FROM availability_block_rooms abr
                     WHERE abr.tenant_id = ab.tenant_id AND abr.property_id = ab.property_id
                       AND abr.block_id = ab.id AND abr.room_id = r.id
                   )
                   OR EXISTS (
                     SELECT 1 FROM availability_block_room_types abrt
                     WHERE abrt.tenant_id = ab.tenant_id AND abrt.property_id = ab.property_id
                       AND abrt.block_id = ab.id AND abrt.room_type_id = r.room_type_id
                   )
                 )
             )
           )
         ORDER BY reason DESC, rt.name ASC, r.name ASC`,
        tenantId,
        propertyId,
        OCCUPYING_STATUSES,
      ),
    );
  }

  private recentCancellations(tenantId: string, propertyId: string): Promise<RecentCancellation[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<RecentCancellation[]>(
        `SELECT b.id, b.external_reference AS "externalReference",
           NULLIF(CONCAT_WS(' ', ${BOOKING_CONTACT_SQL.firstName}, ${BOOKING_CONTACT_SQL.lastName}), '') AS "guestName",
           ${BOOKING_CONTACT_SQL.email} AS "guestEmail", rt.name AS "roomTypeName",
           b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn",
           b.updated_at::text AS "cancelledAt"
         FROM bookings b
         JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
         JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
         WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
           AND b.status = 'CANCELLED'::"BookingStatus"
           AND b.updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
         ORDER BY b.updated_at DESC
         LIMIT 20`,
        tenantId,
        propertyId,
      ),
    );
  }

  /** Human-readable business events only (ACTIVITY_ACTIONS) — joins back to
   * the booking/guest/room-type the audit row's target_id points at, since
   * the audit log's own `details` jsonb doesn't carry enough to build a
   * real sentence (booking.created's details is just { guestId }). */
  private recentActivity(tenantId: string, propertyId: string): Promise<ActivityItem[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx
        .$queryRawUnsafe<
          Array<{
            id: string;
            action: string;
            createdAt: string;
            guestName: string | null;
            guestEmail: string | null;
            roomTypeName: string | null;
            startsOn: string | null;
            endsOn: string | null;
          }>
        >(
          `SELECT al.id, al.action, al.created_at::text AS "createdAt",
             NULLIF(CONCAT_WS(' ', ${BOOKING_CONTACT_SQL.firstName}, ${BOOKING_CONTACT_SQL.lastName}), '') AS "guestName",
             ${BOOKING_CONTACT_SQL.email} AS "guestEmail", rt.name AS "roomTypeName",
             b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn"
           FROM audit_logs al
           LEFT JOIN bookings b ON b.tenant_id = al.tenant_id AND al.target_type = 'booking' AND b.id = al.target_id::uuid
           LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
           LEFT JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
           WHERE al.tenant_id = $1::uuid AND al.property_id = $2::uuid
             AND al.action = ANY($3::text[])
           ORDER BY al.created_at DESC
           LIMIT 15`,
          tenantId,
          propertyId,
          ACTIVITY_ACTIONS,
        )
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            action: row.action,
            createdAt: row.createdAt,
            summary: this.activitySummary(row),
          })),
        ),
    );
  }

  private activitySummary(row: {
    action: string;
    guestName: string | null;
    guestEmail: string | null;
    roomTypeName: string | null;
    startsOn: string | null;
    endsOn: string | null;
  }): string {
    const guest = row.guestName ?? row.guestEmail ?? 'A guest';
    // — (em dash) spelled as an escape, not a literal multi-byte
    // character — a literal here was observed getting mangled into a
    // replacement character (U+FFFD) somewhere in the raw-SQL/JSON response
    // pipeline in this environment.
    const stay =
      row.roomTypeName && row.startsOn && row.endsOn
        ? ` — ${row.roomTypeName}, ${row.startsOn} to ${row.endsOn}`
        : '';
    if (row.action === 'booking.created') return `${guest} booked${stay}`;
    if (row.action === 'booking.cancelled') return `${guest} cancelled${stay}`;
    return `${guest}: ${row.action.replaceAll('.', ' ')}`;
  }
}
