import { Inject, Injectable } from '@nestjs/common';
import { ReportWorkspaceService } from './report-workspace.service';
export type PropertyReports = {
  from: string;
  to: string;
  occupancy: Array<{
    date: string;
    bookedRoomNights: number;
    availableRoomNights: number | null;
    rate: number | null;
  }>;
  bookingsCreated: Array<{ date: string; count: number }>;
  revenue: Array<{ date: string; currency: string; amount: string }>;
  cancellationRate: { createdBookings: number; cancelledBookings: number; rate: number | null };
};
/** Compatibility shape over the one report engine; no separate metric SQL. */
@Injectable()
export class ReportsService {
  constructor(@Inject(ReportWorkspaceService) private readonly workspace: ReportWorkspaceService) {}
  async get(
    tenantId: string,
    propertyId: string,
    query: unknown,
    userId: string,
  ): Promise<PropertyReports> {
    const workspace = await this.workspace.workspace({ tenantId, propertyId, userId }, query, true);
    const periods = [...new Map(workspace.series.map((row) => [String(row.date), row])).values()];
    return {
      from: workspace.query.from,
      to: workspace.query.to,
      occupancy: periods.map((row) => ({
        date: String(row.date),
        bookedRoomNights: Number(row.soldNights),
        availableRoomNights: row.availableNights as number | null,
        rate: row.occupancy as number | null,
      })),
      bookingsCreated: periods.map((row) => ({
        date: String(row.date),
        count: Number(row.bookings),
      })),
      revenue: workspace.series
        .filter((row) => row.currency && row.netCollected !== undefined)
        .map((row) => ({
          date: String(row.date),
          currency: String(row.currency),
          amount: String(row.netCollected),
        })),
      cancellationRate: {
        createdBookings: Number(workspace.summary.bookings),
        cancelledBookings: Number(workspace.summary.cancelled),
        rate: workspace.summary.cancellationRate as number | null,
      },
    };
  }
}
