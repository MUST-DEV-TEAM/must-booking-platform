import { Inject, Injectable } from '@nestjs/common';

import { BOOKING_NEEDS_ATTENTION_STATUSES } from '../booking/booking-attention';
import { TenantDatabaseService } from './tenant-database.service';

type Kpis = {
  date: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  bookedRoomNights: number;
  availableRoomNights: number;
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
  revenue: { today: { amount: string; currency: string } | null };
  balanceDueAtDesk: { amount: string; currency: string } | null;
  newBookingsSinceYesterday: number;
  needsAttentionCount: number;
  needsAttention: NeedsAttentionBooking[];
  todaysArrivals: ArrivalDeparture[];
  todaysDepartures: ArrivalDeparture[];
  upcomingArrivals: UpcomingArrival[];
  soldOutRooms: SoldOutRoom[];
  recentCancellations: RecentCancellation[];
  recentActivity: ActivityItem[];
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
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async get(tenantId: string, propertyId: string): Promise<PropertyOverview> {
    const [
      kpis,
      revenue,
      balanceDueAtDesk,
      newBookingsSinceYesterday,
      needsAttentionCount,
      needsAttention,
      todaysArrivals,
      todaysDepartures,
      upcomingArrivals,
      soldOutRooms,
      recentCancellations,
      recentActivity,
    ] = await Promise.all([
      this.kpis(tenantId, propertyId),
      this.revenueToday(tenantId, propertyId),
      this.balanceDueAtDesk(tenantId, propertyId),
      this.newBookingsSinceYesterday(tenantId, propertyId),
      this.needsAttentionCount(tenantId, propertyId),
      this.needsAttentionBookings(tenantId, propertyId),
      this.arrivalsOrDeparturesOn(tenantId, propertyId, 'starts_on'),
      this.arrivalsOrDeparturesOn(tenantId, propertyId, 'ends_on'),
      this.upcomingArrivals(tenantId, propertyId),
      this.soldOutRooms(tenantId, propertyId),
      this.recentCancellations(tenantId, propertyId),
      this.recentActivity(tenantId, propertyId),
    ]);
    const values = kpis[0] ?? {
      date: new Date().toISOString().slice(0, 10),
      arrivals: 0,
      departures: 0,
      inHouse: 0,
      bookedRoomNights: 0,
      availableRoomNights: 0,
    };
    return {
      kpis: {
        ...values,
        occupancyRate:
          values.availableRoomNights === 0
            ? null
            : Math.round((values.bookedRoomNights / values.availableRoomNights) * 100),
      },
      revenue: { today: revenue },
      balanceDueAtDesk,
      newBookingsSinceYesterday,
      needsAttentionCount,
      needsAttention,
      todaysArrivals,
      todaysDepartures,
      upcomingArrivals,
      soldOutRooms,
      recentCancellations,
      recentActivity,
    };
  }

  private kpis(tenantId: string, propertyId: string) {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<Kpis[]>`
        WITH property_today AS (
          SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS date
          FROM properties
          WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
        ), booking_counts AS (
          SELECT
            COUNT(*) FILTER (WHERE b.starts_on = property_today.date)::int AS arrivals,
            COUNT(*) FILTER (WHERE b.ends_on = property_today.date)::int AS departures,
            COUNT(*) FILTER (
              WHERE b.starts_on <= property_today.date AND b.ends_on > property_today.date
            )::int AS "inHouse"
          FROM bookings b CROSS JOIN property_today
          WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
            AND b.status = 'CONFIRMED'::"BookingStatus"
        ), inventory AS (
          -- Falls back to a count of physical rooms when no inventory_units row
          -- exists for today (e.g. individual-room properties, or a room-type
          -- property that never had its per-night inventory explicitly set) so
          -- occupancy doesn't silently read as "0 of 0" for a property that
          -- plainly has rooms and in-house guests.
          SELECT COALESCE(
            (
              SELECT SUM(i.available_units)::int FROM inventory_units i CROSS JOIN property_today
              WHERE i.tenant_id = ${tenantId}::uuid AND i.property_id = ${propertyId}::uuid
                AND i.stays_on = property_today.date
            ),
            (
              SELECT COUNT(*)::int FROM rooms r
              WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid
            ),
            0
          ) AS "availableRoomNights"
        )
        SELECT property_today.date::text AS date,
          booking_counts.arrivals, booking_counts.departures, booking_counts."inHouse",
          booking_counts."inHouse" AS "bookedRoomNights", inventory."availableRoomNights"
        FROM property_today CROSS JOIN booking_counts CROSS JOIN inventory
      `,
    );
  }

  private async revenueToday(
    tenantId: string,
    propertyId: string,
  ): Promise<{ amount: string; currency: string } | null> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ amount: string; currency: string }>>(
        `WITH property_today AS (
           SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS date FROM properties
           WHERE tenant_id = $1::uuid AND id = $2::uuid
         )
         SELECT COALESCE(SUM(b.total_amount), 0)::text AS amount, MAX(rp.currency) AS currency
         FROM bookings b
         CROSS JOIN property_today
         JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
         WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
           AND b.created_at::date = property_today.date
           AND b.status = ANY($3::"BookingStatus"[])`,
        tenantId,
        propertyId,
        OCCUPYING_STATUSES,
      );
      const row = rows[0];
      if (!row || !row.currency) return null;
      return { amount: row.amount, currency: row.currency };
    });
  }

  private async balanceDueAtDesk(
    tenantId: string,
    propertyId: string,
  ): Promise<{ amount: string; currency: string } | null> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ amount: string; currency: string }>>(
        `WITH property_today AS (
           SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS date FROM properties
           WHERE tenant_id = $1::uuid AND id = $2::uuid
         )
         SELECT COALESCE(SUM(b.total_amount), 0)::text AS amount, MAX(rp.currency) AS currency
         FROM bookings b
         CROSS JOIN property_today
         JOIN rate_plans rp ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
         WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
           AND b.starts_on = property_today.date
           AND b.payment_method = 'PAY_AT_HOTEL'::"BookingPaymentMethod"
           AND b.status = 'CONFIRMED'::"BookingStatus"`,
        tenantId,
        propertyId,
      );
      const row = rows[0];
      if (!row || !row.currency) return null;
      return { amount: row.amount, currency: row.currency };
    });
  }

  private newBookingsSinceYesterday(tenantId: string, propertyId: string) {
    return this.database
      .withTenantTransaction({ tenantId, propertyId }, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: number }>>(
          `WITH property_today AS (
             SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date AS date FROM properties
             WHERE tenant_id = $1::uuid AND id = $2::uuid
           )
           SELECT COUNT(*)::int AS count
           FROM bookings b CROSS JOIN property_today
           WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
             AND b.created_at::date >= property_today.date - INTERVAL '1 day'
             AND b.status = ANY($3::"BookingStatus"[])`,
          tenantId,
          propertyId,
          OCCUPYING_STATUSES,
        ),
      )
      .then((rows) => rows[0]?.count ?? 0);
  }

  private needsAttentionCount(tenantId: string, propertyId: string) {
    return this.database
      .withTenantTransaction({ tenantId, propertyId }, (tx) =>
        tx.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT COUNT(*)::int AS count FROM bookings b
           WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
             AND b.status = ANY($3::"BookingStatus"[])`,
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
           NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), '') AS "guestName",
           COALESCE(g.email, '') AS "guestEmail",
           COALESCE(rt.name, '') AS "roomTypeName"
         FROM bookings b
         LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
         LEFT JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
         WHERE b.tenant_id = $1::uuid AND b.property_id = $2::uuid
           AND b.status = ANY($3::"BookingStatus"[])
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
           NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), '') AS "guestName",
           g.email AS "guestEmail", rt.name AS "roomTypeName", b.adults, b.children,
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
         ORDER BY COALESCE(NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), ''), g.email) ASC`,
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
           NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), '') AS "guestName",
           g.email AS "guestEmail", rt.name AS "roomTypeName", b.adults, b.children,
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
           COALESCE(NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), ''), g.email) ASC
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
             WHERE ab.tenant_id = r.tenant_id AND ab.property_id = r.property_id
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
                 AND b.status = ANY($3::"BookingStatus"[])
             )
             OR EXISTS (
               SELECT 1 FROM availability_blocks ab
               WHERE ab.tenant_id = r.tenant_id AND ab.property_id = r.property_id
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
           NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), '') AS "guestName",
           g.email AS "guestEmail", rt.name AS "roomTypeName",
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
             NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), '') AS "guestName",
             g.email AS "guestEmail", rt.name AS "roomTypeName",
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
