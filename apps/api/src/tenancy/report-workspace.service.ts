import { otbHistory } from './report-otb';
import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditLogService } from './audit-log.service';
import { CapabilitiesService } from './capabilities.service';
import { TenantDatabaseService } from './tenant-database.service';
import { pricingContext } from './pricing.repository';
import { reportFacts, REPORT_LIMITS } from './report-facts.repository';
import { projectReport, reportSeriesColumns } from './report-projection';
import {
  parseReportQuery,
  reportInvalid,
  reportObject,
  type ReportColumn,
  type ReportRow,
  type ReportQuery,
} from './report-query';
import { comparisonRange, REPORT_METRICS } from './report-metrics';

type Context = { tenantId: string; propertyId: string; userId: string };
const ttl = 5000;
export type ReportWorkspace = {
  meta: {
    tenantId: string;
    propertyId: string;
    timezone: string;
    today: string;
    source: string;
    basis: string;
    asOf: string;
    fingerprint: string;
    moneyVisible: boolean;
    staffActivityVisible: boolean;
    hasData: boolean;
    coverage: ReturnType<typeof projectReport>['coverage'];
    limits: typeof REPORT_LIMITS & { maxDays: number; maxPageSize: number };
    cacheSeconds: number;
    dateBases: Record<string, string>;
    warnings: string[];
    definitions: (typeof REPORT_METRICS)[number][];
    drilldowns: Record<string, ReportQuery>;
  };
  query: ReportQuery;
  summary: Record<string, unknown>;
  series: ReportRow[];
  seriesColumns: ReportColumn[];
  columns: ReportColumn[];
  rows: ReportRow[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
  comparison: {
    from: string;
    to: string;
    kind: string;
    hasData: boolean;
    summary: Record<string, unknown> | null;
    series: ReportRow[];
  } | null;
  facets: {
    roomTypes: { value: string; label: string }[];
    rooms: { value: string; label: string; roomTypeId: string }[];
    ratePlans: { value: string; label: string }[];
    currencies: string[];
    sources: string[];
    bookingMode: string;
  };
};

@Injectable()
export class ReportWorkspaceService {
  private readonly cache = new Map<string, { expires: number; value: ReportWorkspace }>();
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async workspace(context: Context, query: unknown, fresh = false): Promise<ReportWorkspace> {
    const grants = await this.capabilities.effective(context);
    if (!grants.includes('reports.view'))
      throw new ForbiddenException('Reports permission is required.');
    const property = await this.database.withTenantTransaction(context, (tx) =>
      pricingContext(tx, context.tenantId, context.propertyId),
    );
    const q = parseReportQuery(query, property.today),
      money = grants.includes('payments.view'),
      staff = grants.includes('staff.view');
    if (
      (q.detail === 'staff' && !staff) ||
      (q.report === 'revenue' && q.detail !== 'default' && !money)
    )
      throw new ForbiddenException('Additional permission is required for this detail table.');
    const key = JSON.stringify([
      context.tenantId,
      context.propertyId,
      context.userId,
      [...grants].sort(),
      q,
      property.today,
      property.source,
      property.timezone,
      property.bookingMode,
      property.pricingVersion,
    ]);
    const cached = this.cache.get(key);
    if (!fresh && cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const workspace = await this.database.withTenantTransaction(
      context,
      async (tx) => {
        const facts = await reportFacts(tx, context.tenantId, context.propertyId, q, staff);
        const current = projectReport(facts, q, context.tenantId, context.propertyId, money, staff);
        const history = await otbHistory(
          tx,
          context.tenantId,
          context.propertyId,
          q,
          facts.context.today,
          facts.context.source === 'LOCAL' ? 'LOCAL' : 'CLOCK',
          facts.context.timezone,
          money,
          facts,
        );
        if (history) current.summary.onTheBooksHistory = history;
        const comparisonDates =
          q.comparison === 'none' ? null : comparisonRange(q.from, q.to, q.comparison);
        const compared = comparisonDates
          ? projectReport(
              facts,
              { ...q, ...comparisonDates },
              context.tenantId,
              context.propertyId,
              money,
              staff,
            )
          : null;
        const clock = await tx.$queryRaw<
          Array<{ asOf: string }>
        >`SELECT transaction_timestamp()::text AS "asOf"`;
        const asOf = new Date(clock[0]!.asOf).toISOString();
        return {
          meta: {
            tenantId: context.tenantId,
            propertyId: context.propertyId,
            timezone: facts.context.timezone,
            today: facts.context.today,
            source: facts.context.source === 'LOCAL' ? 'LOCAL' : 'CLOCK',
            basis:
              facts.context.source === 'LOCAL'
                ? 'MUST locally stored records'
                : 'Synced from Clock — locally stored records; inventory Unknown',
            asOf,
            fingerprint: '',
            moneyVisible: money,
            staffActivityVisible: staff,
            hasData: current.hasData,
            coverage: current.coverage,
            limits: { maxDays: 366, maxPageSize: 100, ...REPORT_LIMITS },
            cacheSeconds: ttl / 1000,
            dateBases: {
              bookings: 'Property-local created date',
              occupancy: 'Stay night; departure exclusive',
              roomRevenue: 'Recognized stay night, immutable snapshots',
              cash: 'Property-local successful ledger posting date',
              refunds: 'Property-local refund ledger posting date',
            },
            warnings: [
              'Live current totals; pickup/pace compare these live facts to complete compatible daily captured observations.',
              'Room revenue excludes all mandatory charge components; new classified components carry tax categories and older evidence is Unclassified.',
              'Plan and meal-plan labels are current metadata, not historical snapshots.',
              'Gross supply includes blocks. Historical physical supply and Clock supply are Unknown.',
              'Non-capacity filters narrow bookings and linked payments; they do not reduce the room-supply denominator.',
              'Cash period and booking-value reconciliation use different stated date bases; they are not expected to equal.',
            ],
            definitions: REPORT_METRICS.filter((d) => money || !d.money),
            drilldowns: Object.fromEntries(
              [
                ['bookings', 'created', undefined],
                ['cancelled', 'created', 'CANCELLED'],
                ['soldNights', 'stay', 'CONFIRMED'],
                ['arrivals', 'arrival', 'CONFIRMED'],
                ['departures', 'departure', 'CONFIRMED'],
                ['cash', 'payment', undefined],
                ['bookedRevenue', 'stay', 'CONFIRMED'],
              ].map(([metric, rowBasis, status]) => [
                metric,
                {
                  ...q,
                  report: 'reservations',
                  detail: 'default',
                  rowBasis,
                  status: status ?? q.status,
                  sort: '',
                  page: 1,
                },
              ]),
            ) as Record<string, ReportQuery>,
          },
          query: q,
          summary: current.summary,
          series: current.series,
          seriesColumns: reportSeriesColumns.filter((c) => money || !c.money),
          columns: current.columns,
          rows: current.rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
          pagination: current.pagination,
          comparison: comparisonDates
            ? {
                ...comparisonDates,
                kind: q.comparison,
                hasData: compared!.hasData,
                summary: compared!.hasData ? compared!.summary : null,
                series: compared!.hasData ? compared!.series : [],
              }
            : null,
          facets: {
            roomTypes: facts.types.map((t) => ({ value: t.id, label: t.name })),
            rooms: facts.rooms.map((r) => ({
              value: r.id,
              label: r.name,
              roomTypeId: r.roomTypeId,
            })),
            ratePlans: facts.plans.map((p) => ({ value: p.id, label: p.name })),
            currencies: [
              ...new Set([
                ...facts.plans.map((p) => p.currency),
                ...facts.bookings.map((b) => b.currency),
                ...(money ? facts.payments.map((p) => p.currency) : []),
              ]),
            ].sort(),
            sources: ['DIRECT', 'WEBSITE', 'UNKNOWN'],
            bookingMode: facts.context.bookingMode,
          },
        };
      },
      { timeoutMs: 30000, isolationLevel: 'RepeatableRead' },
    );
    workspace.meta.fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          tenantId: context.tenantId,
          propertyId: context.propertyId,
          source: workspace.meta.source,
          timezone: workspace.meta.timezone,
          today: workspace.meta.today,
          moneyVisible: workspace.meta.moneyVisible,
          staffActivityVisible: workspace.meta.staffActivityVisible,
          query: workspace.query,
          summary: workspace.summary,
          series: workspace.series,
          columns: workspace.columns,
          rows: workspace.rows,
          pagination: workspace.pagination,
          comparison: workspace.comparison,
        }),
      )
      .digest('hex');
    if (!fresh) {
      for (const [old, entry] of this.cache)
        if (entry.expires <= Date.now()) this.cache.delete(old);
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: Date.now() + ttl, value: structuredClone(workspace) });
    }
    return workspace;
  }

  async exportHistory(context: Context) {
    if (!(await this.capabilities.effective(context)).includes('reports.view'))
      throw new ForbiddenException('Reports permission is required.');
    return this.database.withTenantTransaction(context, async (tx) => ({
      exports: await tx.$queryRaw<
        Array<{
          id: string;
          createdAt: string;
          report: string;
          format: string;
          rowCount: number;
          asOf: string;
          timezone: string;
          basis: string;
          filters: ReportQuery;
        }>
      >`
      SELECT target_id AS id,created_at::text AS "createdAt",details->>'report' AS report,details->>'format' AS format,
        (details->>'rowCount')::int AS "rowCount",details->>'asOf' AS "asOf",details->>'timezone' AS timezone,
        details->>'basis' AS basis,details->'filters' AS filters
      FROM audit_logs WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid
        AND actor_user_id=${context.userId}::uuid AND action='report.exported'
      ORDER BY created_at DESC,id DESC LIMIT 50`,
    }));
  }

  async export(context: Context, body: unknown) {
    const input = reportObject(body);
    if (
      Object.keys(input).some(
        (k) =>
          !['query', 'target', 'columns', 'rowIds', 'format', 'expectedFingerprint'].includes(k),
      )
    )
      reportInvalid('Unknown export option.');
    const format = input.format ?? 'csv',
      target = input.target ?? 'rows';
    if (!['csv', 'print'].includes(String(format)) || !['rows', 'series'].includes(String(target)))
      reportInvalid('Choose CSV or print and a visible report table.');
    const workspace = await this.workspace(context, input.query, true);
    const columns = target === 'series' ? workspace.seriesColumns : workspace.columns;
    const rows = target === 'series' ? workspace.series : workspace.rows;
    const selected = selectExport(columns, rows, input.columns, input.rowIds);
    if (input.expectedFingerprint !== undefined) {
      if (
        typeof input.expectedFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(input.expectedFingerprint)
      )
        reportInvalid('Invalid report fingerprint.');
      if (input.expectedFingerprint !== workspace.meta.fingerprint)
        throw new ConflictException({
          code: 'REPORT_CHANGED',
          message: 'Report data changed. Refresh and review it before exporting.',
        });
    }
    const exportId = randomUUID();
    const content =
      format === 'csv'
        ? reportCsv(selected.columns, selected.rows)
        : JSON.stringify({
            meta: workspace.meta,
            query: workspace.query,
            summary: workspace.summary,
            columns: selected.columns,
            rows: selected.rows,
          });
    await this.audit.record({
      tenantId: context.tenantId,
      propertyId: context.propertyId,
      actorUserId: context.userId,
      action: 'report.exported',
      targetType: 'report_export',
      targetId: exportId,
      details: {
        report: workspace.query.report,
        format,
        target,
        filters: workspace.query,
        columns: selected.columns.map((c) => c.key),
        selectedRowIds: input.rowIds ?? null,
        rowCount: selected.rows.length,
        basis: workspace.meta.basis,
        dateBases: workspace.meta.dateBases,
        timezone: workspace.meta.timezone,
        asOf: workspace.meta.asOf,
        fingerprint: workspace.meta.fingerprint,
        displayedFingerprint: input.expectedFingerprint ?? null,
        moneyVisible: workspace.meta.moneyVisible,
        actor: context.userId,
        exportedAt: new Date().toISOString(),
      },
    });
    return {
      exportId,
      filename: `${workspace.query.report}-${workspace.query.from}-${workspace.query.to}.${format === 'csv' ? 'csv' : 'json'}`,
      contentType: format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
      content,
      rowCount: selected.rows.length,
      asOf: workspace.meta.asOf,
      fingerprint: workspace.meta.fingerprint,
    };
  }
}

export function selectExport(
  columns: ReportColumn[],
  rows: ReportRow[],
  rawColumns: unknown,
  rawIds: unknown,
) {
  const keys = rawColumns ?? columns.map((c) => c.key);
  if (
    !Array.isArray(keys) ||
    !keys.length ||
    keys.length > 50 ||
    keys.some((k) => typeof k !== 'string' || !columns.some((c) => c.key === k)) ||
    new Set(keys).size !== keys.length
  )
    reportInvalid('Choose unique visible columns for export.');
  if (
    rawIds !== undefined &&
    (!Array.isArray(rawIds) ||
      rawIds.length > 1000 ||
      rawIds.some((id) => typeof id !== 'string' || !rows.some((r) => r.id === id)) ||
      new Set(rawIds).size !== rawIds.length)
  )
    reportInvalid('Choose unique rows from the visible table.');
  const selectedRows =
    rawIds === undefined ? rows : rows.filter((r) => (rawIds as string[]).includes(r.id));
  return { columns: keys.map((key) => columns.find((c) => c.key === key)!), rows: selectedRows };
}
/** UTF-8 BOM and quoted formula-safe cells, including leading whitespace/control characters. */
export function reportCsv(columns: ReportColumn[], rows: ReportRow[]) {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      columns.map((c) => cell(c.label)).join(','),
      ...rows.map((row) =>
        columns
          .map((c) =>
            cell(
              c.money && row[c.key] !== null && row[c.key] !== undefined && row.currency
                ? `${row.currency} ${row[c.key]}`
                : row[c.key],
            ),
          )
          .join(','),
      ),
    ].join('\r\n') +
    '\r\n'
  );
}
