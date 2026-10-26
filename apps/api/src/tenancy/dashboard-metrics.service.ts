import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { TenantDatabaseService } from './tenant-database.service';
import { CapabilitiesService } from './capabilities.service';
import { pricingContext } from './pricing.repository';
import { reportFacts } from './report-facts.repository';
import { projectReport, type ReportFinancial } from './report-projection';
import { parseReportQuery, reportObject, reportInvalid } from './report-query';
import {
  cashMetrics,
  bookingOutstanding,
  reportMinor,
  reservationMetrics,
  shiftDay,
} from './report-metrics';
import { decimal } from '../booking/pricing-evaluator';
type Context = { tenantId: string; propertyId: string; userId: string };
/** Existing dashboard audiences, using the exact Reports fact reader and pure metrics kernel. */
@Injectable()
export class DashboardMetricsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
  ) {}
  async overview(c: Context) {
    const money = (await this.capabilities.effective(c)).includes('payments.view');
    return this.database.withTenantTransaction(
      c,
      async (tx) => {
        const context = await pricingContext(tx, c.tenantId, c.propertyId),
          today = context.today;
        const q = parseReportQuery(
          { report: 'reservations', from: shiftDay(today, -1), to: today },
          today,
        );
        const facts = await reportFacts(tx, c.tenantId, c.propertyId, q, false);
        const projected = projectReport(
          facts,
          { ...q, from: today },
          c.tenantId,
          c.propertyId,
          money,
          false,
        );
        const summary = projected.summary,
          financial = (summary.financial ?? []) as ReportFinancial[];
        const collected = financial.map((row) => ({
          currency: row.currency,
          amount: row.collected,
        }));
        const desk = new Map<string, bigint>();
        if (money)
          for (const b of facts.bookings.filter(
            (b) =>
              b.status === 'CONFIRMED' &&
              b.startsOn === today &&
              b.paymentMethod === 'PAY_AT_HOTEL',
          )) {
            const cash =
              cashMetrics(
                (facts.paymentsByBooking.get(b.id) ?? []).filter((p) => p.currency === b.currency),
              )[0]?.netCollected ?? '0.00';
            desk.set(
              b.currency,
              (desk.get(b.currency) ?? 0n) + reportMinor(bookingOutstanding(b, cash)),
            );
          }
        const clock = await tx.$queryRaw<
          Array<{ at: string }>
        >`SELECT transaction_timestamp()::text AS at`;
        const due = [...desk].map(([currency, amount]) => ({ currency, amount: decimal(amount) }));
        return {
          kpis: {
            date: today,
            arrivals: Number(summary.arrivals),
            departures: Number(summary.departures),
            inHouse: Number(summary.soldNights),
            bookedRoomNights: Number(summary.soldNights),
            availableRoomNights: summary.availableNights as number | null,
            occupancyRate: summary.occupancy as number | null,
          },
          revenue: { today: collected.length === 1 ? collected[0]! : null, byCurrency: collected },
          balanceDueAtDesk: due.length === 1 ? due[0]! : null,
          balancesDueAtDesk: due,
          newBookingsSinceYesterday: reservationMetrics(
            facts.bookings,
            q.from,
            q.to,
            context.timezone,
          ).bookings,
          metricBasis: {
            asOf: new Date(clock[0]!.at).toISOString(),
            source: context.source === 'LOCAL' ? 'LOCAL' : 'CLOCK',
            timezone: context.timezone,
            moneyVisible: money,
            capacity: 'Gross configured supply; Clock Unknown',
            cash: 'Successful charge ledger posting date',
            desk: 'Confirmed pay-at-hotel arrivals today; net matching-currency balance',
          },
        };
      },
      { timeoutMs: 30000, isolationLevel: 'RepeatableRead' },
    );
  }
  async payments(c: Context, raw: unknown) {
    if (!(await this.capabilities.effective(c)).includes('payments.view'))
      throw new ForbiddenException('Payments permission is required.');
    const input = reportObject(raw ?? {});
    if (Object.keys(input).some((k) => !['from', 'to'].includes(k)))
      reportInvalid('Payment summary accepts only from and to dates.');
    return this.database.withTenantTransaction(
      c,
      async (tx) => {
        const context = await pricingContext(tx, c.tenantId, c.propertyId),
          q = parseReportQuery({ ...input, report: 'revenue' }, context.today);
        const facts = await reportFacts(tx, c.tenantId, c.propertyId, q, false),
          report = projectReport(facts, q, c.tenantId, c.propertyId, true, false);
        const clock = await tx.$queryRaw<
          Array<{ at: string }>
        >`SELECT transaction_timestamp()::text AS at`;
        return {
          query: q,
          meta: {
            source: context.source === 'LOCAL' ? 'LOCAL' : 'CLOCK',
            timezone: context.timezone,
            asOf: new Date(clock[0]!.at).toISOString(),
            basis:
              context.source === 'LOCAL'
                ? 'MUST locally stored records'
                : 'Synced from Clock - locally stored records',
            cashBasis: 'Successful ledger posting dates',
            balanceBasis:
              'Confirmed bookings created in the period; all matching-currency linked cash',
          },
          financial: report.summary.financial as ReportFinancial[],
        };
      },
      { timeoutMs: 30000, isolationLevel: 'RepeatableRead' },
    );
  }
}
