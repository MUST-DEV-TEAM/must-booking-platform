import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';

type DailyOccupancy = {
  date: string;
  bookedRoomNights: number;
  availableRoomNights: number;
};

type DailyBookingsCreated = { date: string; count: number };
type DailyRevenue = { date: string; currency: string; amount: string };

export type PropertyReports = {
  from: string;
  to: string;
  occupancy: Array<DailyOccupancy & { rate: number | null }>;
  bookingsCreated: DailyBookingsCreated[];
  revenue: DailyRevenue[];
  cancellationRate: { createdBookings: number; cancelledBookings: number; rate: number | null };
};

@Injectable()
export class ReportsService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async get(tenantId: string, propertyId: string, query: unknown): Promise<PropertyReports> {
    const { from, to } = this.range(query);
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const [occupancy, bookingsCreated, revenue, cancellation] = await Promise.all([
        tx.$queryRaw<DailyOccupancy[]>`
          WITH days AS (
            SELECT stays_on::date AS date
            FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') AS stays_on
          ), available AS (
            SELECT stays_on::date AS date, SUM(available_units)::int AS "availableRoomNights"
            FROM inventory_units
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
              AND stays_on >= ${from}::date AND stays_on <= ${to}::date
            GROUP BY stays_on
          ), booked AS (
            SELECT days.date, COUNT(b.id)::int AS "bookedRoomNights"
            FROM days
            LEFT JOIN bookings b
              ON b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
              AND b.status = 'CONFIRMED'::"BookingStatus"
              AND b.starts_on <= days.date AND b.ends_on > days.date
            GROUP BY days.date
          )
          SELECT days.date::text AS date, COALESCE(booked."bookedRoomNights", 0) AS "bookedRoomNights",
            COALESCE(available."availableRoomNights", 0) AS "availableRoomNights"
          FROM days
          LEFT JOIN available ON available.date = days.date
          LEFT JOIN booked ON booked.date = days.date
          ORDER BY days.date
        `,
        tx.$queryRaw<DailyBookingsCreated[]>`
          WITH days AS (
            SELECT created_on::date AS date
            FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') AS created_on
          )
          SELECT days.date::text AS date, COUNT(b.id)::int AS count
          FROM days
          LEFT JOIN bookings b
            ON b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
            AND b.created_at >= days.date AND b.created_at < days.date + INTERVAL '1 day'
          GROUP BY days.date
          ORDER BY days.date
        `,
        tx.$queryRaw<DailyRevenue[]>`
          WITH days AS (
            SELECT occurred_on::date AS date
            FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') AS occurred_on
          ), currencies AS (
            SELECT DISTINCT currency FROM rate_plans
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            UNION
            SELECT DISTINCT currency FROM payments
            WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
              AND created_at >= ${from}::date AND created_at < ${to}::date + INTERVAL '1 day'
          ), totals AS (
            SELECT p.created_at::date AS date, p.currency, SUM(
              CASE WHEN p.kind = 'REFUND'::"PaymentKind" THEN -p.amount ELSE p.amount END
            ) AS amount
            FROM payments p
            WHERE p.tenant_id = ${tenantId}::uuid AND p.property_id = ${propertyId}::uuid
              AND p.created_at >= ${from}::date AND p.created_at < ${to}::date + INTERVAL '1 day'
              AND ((p.kind = 'CHARGE'::"PaymentKind" AND p.status = 'succeeded')
                OR p.kind = 'REFUND'::"PaymentKind")
            GROUP BY p.created_at::date, p.currency
          )
          SELECT days.date::text AS date, currencies.currency, COALESCE(totals.amount, 0)::text AS amount
          FROM days CROSS JOIN currencies
          LEFT JOIN totals ON totals.date = days.date AND totals.currency = currencies.currency
          ORDER BY days.date, currencies.currency
        `,
        tx.$queryRaw<Array<{ createdBookings: number; cancelledBookings: number }>>`
          SELECT COUNT(*)::int AS "createdBookings",
            COUNT(*) FILTER (WHERE status = 'CANCELLED'::"BookingStatus")::int AS "cancelledBookings"
          FROM bookings
          WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
            AND created_at >= ${from}::date AND created_at < ${to}::date + INTERVAL '1 day'
        `,
      ]);
      const totals = cancellation[0] ?? { createdBookings: 0, cancelledBookings: 0 };
      return {
        from,
        to,
        occupancy: occupancy.map((day) => ({
          ...day,
          rate:
            day.availableRoomNights === 0
              ? null
              : (day.bookedRoomNights / day.availableRoomNights) * 100,
        })),
        bookingsCreated,
        revenue,
        cancellationRate: {
          ...totals,
          rate:
            totals.createdBookings === 0
              ? null
              : (totals.cancelledBookings / totals.createdBookings) * 100,
        },
      };
    });
  }

  private range(query: unknown): { from: string; to: string } {
    const value = (query ?? {}) as Record<string, unknown>;
    const to = value.to === undefined ? this.today() : this.date(value.to, 'to');
    const from = value.from === undefined ? this.daysBefore(to, 29) : this.date(value.from, 'from');
    if (from > to) throw new BadRequestException('from must be on or before to.');
    return { from, to };
  }

  private date(value: unknown, field: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
      throw new BadRequestException(`${field} must be an ISO date (YYYY-MM-DD).`);
    return value;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private daysBefore(date: string, days: number): string {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - days);
    return value.toISOString().slice(0, 10);
  }
}
