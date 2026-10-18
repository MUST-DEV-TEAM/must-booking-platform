import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { CapabilitiesService } from './capabilities.service';
import { AuditLogService } from './audit-log.service';
import { ReportWorkspaceService } from './report-workspace.service';
import { reportSeriesColumns } from './report-projection';
import { parseReportQuery, reportInvalid, reportObject, type ReportQuery } from './report-query';

type Context = { tenantId: string; propertyId: string; userId: string };
export type ReportViewConfiguration = {
  query: ReportQuery;
  columns: string[];
  metrics: string[];
  display: 'chart' | 'table';
  chartMetric: string;
};
type View = {
  id: string;
  ownerUserId: string;
  name: string;
  visibility: 'private' | 'team';
  configuration: ReportViewConfiguration;
  version: number;
  updatedAt: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = Prisma.sql`id,owner_user_id AS "ownerUserId",name,visibility,configuration,version,updated_at::text AS "updatedAt"`;
const scalarMetrics = [
  'bookings',
  'cancelled',
  'cancellationRate',
  'averageLengthOfStay',
  'averageLeadDays',
  'soldNights',
  'availableNights',
  'occupancy',
  'blockedNights',
  'arrivals',
  'departures',
  'adults',
  'children',
  'sameDay',
  'advance',
];
function name(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
    reportInvalid('Choose a name of 1-120 characters.');
  return value.trim();
}
function version(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    reportInvalid('A current integer version is required.');
  return Number(value);
}
function strings(value: unknown, allowed: string[], max: number) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > max ||
    new Set(value).size !== value.length ||
    value.some((v) => typeof v !== 'string' || !allowed.includes(v))
  )
    reportInvalid('Choose unique supported columns and metrics.');
  return value as string[];
}
/** Saved configuration only; every execution rechecks the caller's current report permissions. */
@Injectable()
export class ReportViewsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly capabilities: CapabilitiesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(ReportWorkspaceService) private readonly workspace: ReportWorkspaceService,
  ) {}
  private async authorize(c: Context) {
    const grants = await this.capabilities.effective(c);
    if (!grants.includes('reports.view'))
      throw new ForbiddenException('Reports permission is required.');
    return grants;
  }
  private async find(tx: TenantTransaction, c: Context, id: string, lock = false) {
    if (!uuid.test(id)) throw new NotFoundException('Report view not found.');
    const rows = await tx.$queryRaw<View[]>(
      Prisma.sql`SELECT ${fields} FROM report_views WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid AND (owner_user_id=${c.userId}::uuid OR visibility='team') ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
    );
    if (!rows[0]) throw new NotFoundException('Report view not found.');
    return rows[0];
  }
  async list(c: Context) {
    await this.authorize(c);
    return this.database.withTenantTransaction(c, async (tx) => ({
      views: (
        await tx.$queryRaw<View[]>(
          Prisma.sql`SELECT ${fields} FROM report_views WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND (owner_user_id=${c.userId}::uuid OR visibility='team') ORDER BY updated_at DESC,id`,
        )
      ).map((v) => ({ ...v, canEdit: v.ownerUserId === c.userId })),
    }));
  }
  async execute(c: Context, id: string) {
    const grants = await this.authorize(c);
    const view = await this.database.withTenantTransaction(c, (tx) => this.find(tx, c, id));
    const query = { ...view.configuration.query };
    if (!grants.includes('payments.view')) query.sort = '';
    const result = await this.workspace.workspace(c, query);
    return { view: { ...view, canEdit: view.ownerUserId === c.userId }, workspace: result };
  }
  private async configuration(c: Context, raw: unknown) {
    const v = reportObject(raw);
    if (
      Object.keys(v).some(
        (k) => !['query', 'columns', 'metrics', 'display', 'chartMetric'].includes(k),
      )
    )
      reportInvalid('Unknown view configuration.');
    const result = await this.workspace.workspace(c, v.query, true);
    const columns = strings(
      v.columns,
      result.columns.map((v) => v.key),
      50,
    );
    const metricColumns = reportSeriesColumns.filter(
      (v) => v.type !== 'date' && v.key !== 'currency' && (result.meta.moneyVisible || !v.money),
    );
    const allowed = [...new Set([...scalarMetrics, ...metricColumns.map((v) => v.key)])];
    const metrics = strings(v.metrics, allowed, 30);
    if (
      !['chart', 'table'].includes(String(v.display)) ||
      typeof v.chartMetric !== 'string' ||
      !metricColumns.some((m) => m.key === v.chartMetric)
    )
      reportInvalid('Choose table or chart and a supported chart metric.');
    return {
      query: parseReportQuery(result.query, result.meta.today),
      columns,
      metrics,
      display: v.display as 'chart' | 'table',
      chartMetric: v.chartMetric,
    };
  }
  async change(
    c: Context,
    key: string | undefined,
    action: 'create' | 'update' | 'delete' | 'duplicate',
    id: string | undefined,
    raw: unknown,
  ) {
    await this.authorize(c);
    if (!key || !/^[\x21-\x7e]{1,128}$/.test(key))
      reportInvalid('Idempotency-Key is required (1-128 printable nonspace characters).');
    const body = reportObject(raw);
    const keys =
      action === 'delete'
        ? ['version']
        : action === 'duplicate'
          ? ['name', 'version']
          : ['name', 'visibility', 'configuration', ...(action === 'update' ? ['version'] : [])];
    if (Object.keys(body).some((k) => !keys.includes(k)))
      reportInvalid('Unknown saved-view option.');
    const expected = action === 'create' ? undefined : version(body.version);
    const viewName =
      action === 'delete'
        ? undefined
        : action === 'duplicate' && body.name === undefined
          ? undefined
          : name(body.name);
    if (
      ['create', 'update'].includes(action) &&
      !['private', 'team'].includes(String(body.visibility))
    )
      reportInvalid('Choose private or team visibility.');
    // Stable key ordering gives equivalent JSON object bodies the same intent hash.
    const stable = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(stable)
        : v && typeof v === 'object'
          ? Object.fromEntries(
              Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, x]) => [k, stable(x)]),
            )
          : v;
    const hash = createHash('sha256')
      .update(JSON.stringify(stable({ actor: c.userId, action, id, body })))
      .digest('hex');
    // Validate after the receipt lookup so retries remain valid after a permission-dependent column disappears.
    return this.database.withTenantTransaction(
      c,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid FOR UPDATE`;
        const receipt = await tx.$queryRaw<
          Array<{ hash: string; response: Prisma.JsonValue }>
        >`SELECT request_hash AS hash,response FROM report_view_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND idempotency_key=${key}`;
        if (receipt[0]) {
          if (receipt[0].hash !== hash)
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'This key was used for a different saved-view change.',
            });
          return receipt[0].response;
        }
        const before = id ? await this.find(tx, c, id, true) : null;
        if (before && ['update', 'delete'].includes(action) && before.ownerUserId !== c.userId)
          throw new ForbiddenException('Only the creator can change this view.');
        if (before && before.version !== expected)
          throw new ConflictException({
            code: 'REPORT_VIEW_VERSION_CONFLICT',
            message: 'This view changed. Reload before saving.',
            currentVersion: before.version,
          });
        let result: View | { id: string; deleted: true };
        if (action === 'delete') {
          await tx.$executeRaw`DELETE FROM report_views WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid`;
          result = { id: id!, deleted: true };
        } else {
          const configuration =
            action === 'duplicate'
              ? await this.configuration(c, before!.configuration)
              : await this.configuration(c, body.configuration);
          if (action !== 'update') {
            const counts = await tx.$queryRaw<
              Array<{ total: number; owned: number }>
            >`SELECT count(*)::int AS total,count(*) FILTER(WHERE owner_user_id=${c.userId}::uuid)::int AS owned FROM report_views WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid`;
            if (counts[0]!.total >= 1000 || counts[0]!.owned >= 100)
              reportInvalid('Saved-view limit reached. Delete an unused view first.');
            const nextId = randomUUID();
            const rows = await tx.$queryRaw<View[]>(
              Prisma.sql`INSERT INTO report_views(tenant_id,property_id,id,owner_user_id,name,visibility,configuration) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${nextId}::uuid,${c.userId}::uuid,${viewName ?? name((before!.name + ' copy').slice(0, 120))},${action === 'duplicate' ? 'private' : body.visibility},${JSON.stringify(configuration)}::jsonb) RETURNING ${fields}`,
            );
            result = rows[0]!;
          } else {
            const rows = await tx.$queryRaw<View[]>(
              Prisma.sql`UPDATE report_views SET name=${viewName},visibility=${body.visibility},configuration=${JSON.stringify(configuration)}::jsonb,version=version+1,updated_at=now() WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND id=${id}::uuid RETURNING ${fields}`,
            );
            result = rows[0]!;
          }
        }
        await this.audit.recordInTransaction(tx, {
          tenantId: c.tenantId,
          propertyId: c.propertyId,
          actorUserId: c.userId,
          action: `report.view.${action}`,
          targetType: 'report_view',
          targetId: result.id,
          details: { before, after: result },
        });
        await tx.$executeRaw`INSERT INTO report_view_operations(tenant_id,property_id,idempotency_key,request_hash,response) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${key},${hash},${JSON.stringify(result)}::jsonb)`;
        return result;
      },
      { timeoutMs: 30000 },
    );
  }
}
