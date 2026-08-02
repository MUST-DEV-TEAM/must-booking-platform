import { Inject, Injectable } from '@nestjs/common';

import { BOOKING_NEEDS_ATTENTION_STATUSES } from '../booking/booking-attention';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService } from './tenant-database.service';

type Kpis = {
  date: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  bookedRoomNights: number;
  availableRoomNights: number;
};

export type PropertyOverview = {
  kpis: Kpis & { occupancyRate: number | null };
  needsAttention: Array<{
    id: string;
    status: string;
    startsOn: string;
    endsOn: string;
    guestName: string | null;
    guestEmail: string;
    roomTypeName: string;
  }>;
  recentActivity: Awaited<ReturnType<AuditLogService['listForProperty']>>;
};

@Injectable()
export class OverviewService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
  ) {}

  async get(tenantId: string, propertyId: string): Promise<PropertyOverview> {
    const [kpis, needsAttention, recentActivity] = await Promise.all([
      this.kpis(tenantId, propertyId),
      this.needsAttention(tenantId, propertyId),
      this.auditLogs.listForProperty(tenantId, propertyId),
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
      needsAttention,
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
          SELECT COALESCE(SUM(i.available_units), 0)::int AS "availableRoomNights"
          FROM inventory_units i CROSS JOIN property_today
          WHERE i.tenant_id = ${tenantId}::uuid AND i.property_id = ${propertyId}::uuid
            AND i.stays_on = property_today.date
        )
        SELECT property_today.date::text AS date,
          booking_counts.arrivals, booking_counts.departures, booking_counts."inHouse",
          booking_counts."inHouse" AS "bookedRoomNights", inventory."availableRoomNights"
        FROM property_today CROSS JOIN booking_counts CROSS JOIN inventory
      `,
    );
  }

  private needsAttention(tenantId: string, propertyId: string) {
    return this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<PropertyOverview['needsAttention']>`
        SELECT b.id, b.status::text AS status, b.starts_on::text AS "startsOn",
          b.ends_on::text AS "endsOn", NULLIF(CONCAT_WS(' ', g.first_name, g.last_name), '') AS "guestName",
          g.email AS "guestEmail", rt.name AS "roomTypeName"
        FROM bookings b
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id
          AND rt.id = b.room_type_id
        WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
          AND b.status = ANY(${BOOKING_NEEDS_ATTENTION_STATUSES}::"BookingStatus"[])
        ORDER BY b.updated_at DESC
        LIMIT 10
      `,
    );
  }
}
