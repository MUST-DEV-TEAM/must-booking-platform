import {
  AUDIT_EVENTS,
  AUDIT_SOURCES,
  AUDIT_SOURCE_LABELS,
  ROUTINE_AUDIT_ACTIONS,
  auditTitle,
} from './audit-event';
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from './audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { CapabilitiesService } from './capabilities.service';
import {
  AUDIT_FAMILIES,
  PHOTO_PREFIXES,
  AUDIT_CRITICAL_PATTERN,
  auditText,
  safeAuditValue,
  auditCsv,
} from './audit-workspace';
import { propertyDay, shiftDay } from './report-metrics';
import { NOTIFICATION_UUID } from './notification-registry';
export type AuditContext = { tenantId: string; propertyId: string; userId: string };
type Access = { broad: boolean; actors: boolean; prefixes: string[]; families: string[] };
type Filters = {
  from: string;
  to: string;
  search: string;
  family: string;
  actor: string;
  target: string;
  result: string;
  view: string;
  source: string;
};
type Row = {
  id: string;
  actorUserId: string | null;
  actorType: string;
  actorEmail: string | null;
  actorFirst: string | null;
  actorLast: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  requestContext: unknown;
  createdAt: Date;
  family: string;
  result: string;
  critical: boolean;
  source: string | null;
  operationId: string | null;
  amount: unknown;
  routine: boolean;
};
/** One authorized read model feeds list, detail, counters and audited exports. */
@Injectable()
export class ActivityAuditService {
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(CapabilitiesService) private readonly caps: CapabilitiesService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}
  private async access(c: AuditContext): Promise<Access> {
    const caps = await this.caps.effective(c),
      roles = await this.db.withTenantTransaction(
        c,
        (tx) =>
          tx.$queryRaw<
            { role: string }[]
          >`SELECT role FROM tenant_memberships WHERE tenant_id=${c.tenantId}::uuid AND user_id=${c.userId}::uuid`,
      );
    const broad = ['OWNER', 'ADMIN'].includes(roles[0]?.role ?? ''),
      families = AUDIT_FAMILIES.filter((f) => broad || caps.includes(f.capability)),
      prefixes: string[] = families.flatMap((f) => [...f.prefixes]);
    if (caps.includes('photos.manage')) prefixes.push(...PHOTO_PREFIXES);
    if (!broad && !prefixes.length)
      throw new ForbiddenException(
        'No audit event family is permitted by your current capabilities.',
      );
    return {
      broad,
      actors: caps.includes('staff.view'),
      prefixes: [...new Set(prefixes)].sort(),
      families: [
        ...new Set([
          ...families.map((f) => f.name),
          ...(caps.includes('photos.manage') ? ['Accommodation'] : []),
          'Exports',
          ...(broad ? ['Other'] : []),
        ]),
      ],
    };
  }
  private filters(query: Record<string, unknown>, today: string, a: Access): Filters {
    const text = (key: string, max = 100) => {
      const value = String(query[key] ?? '').trim();
      if (value.length > max) throw new BadRequestException(`${key} is too long.`);
      return value;
    };
    const day = (value: string) => {
      if (
        Number(value.slice(0, 4)) < 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        throw new BadRequestException('Use valid YYYY-MM-DD audit dates.');
      return value;
    };
    const from = day(text('from') || shiftDay(today, -29)),
      to = day(text('to') || today);
    if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 365)
      throw new BadRequestException('Choose an ordered audit date range of at most 366 days.');
    const family = text('family'),
      actor = text('actor'),
      result = text('result');
    if (family && !a.families.includes(family))
      throw new ForbiddenException('This audit family is not available.');
    if (actor && (!a.actors || (!NOTIFICATION_UUID.test(actor) && actor !== 'system')))
      throw new ForbiddenException('staff.view is required for a valid actor filter.');
    if (
      result &&
      !['Succeeded', 'Failed', 'Denied', 'Pending', 'Unknown', 'Not recorded'].includes(result)
    )
      throw new BadRequestException('Unknown recorded audit result.');
    const view = text('view') || 'all',
      source = text('source');
    if (!['all', 'business', 'system'].includes(view))
      throw new BadRequestException('Unknown audit view.');
    if (source && !AUDIT_SOURCES.some((value) => value === source))
      throw new BadRequestException('Unknown audit source.');
    return {
      from,
      to,
      search: text('search'),
      family,
      actor,
      target: text('target', 320),
      result,
      view,
      source,
    };
  }
  private base(c: AuditContext, a: Access) {
    const familyCase = Prisma.join(
      AUDIT_FAMILIES.map(
        (f) =>
          Prisma.sql`WHEN EXISTS(SELECT 1 FROM unnest(${[...f.prefixes]}::text[]) AS matched(prefix) WHERE starts_with(a.action,matched.prefix)) THEN ${f.name}`,
      ),
      ' ',
    );
    return Prisma.sql`SELECT a.id,a.actor_user_id AS "actorUserId",a.actor_type::text AS "actorType",u.email AS "actorEmail",u.first_name AS "actorFirst",u.last_name AS "actorLast",a.action,a.target_type AS "targetType",a.target_id AS "targetId",a.details,a.request_context AS "requestContext",a.created_at AS "createdAt",a.details#>>'{_audit,source}' AS source,COALESCE(a.details#>>'{_audit,operationId}',a.details->>'operationId') AS "operationId",a.details->'amount' AS amount,(a.action=ANY(${ROUTINE_AUDIT_ACTIONS}::text[]) AND lower(COALESCE(a.details#>>'{_audit,result}',a.details->>'result','completed')) NOT IN ('failed','unknown','denied')) AS routine,
   CASE WHEN starts_with(a.action,'booking.clock_deposit_') THEN 'Payments' ${familyCase} WHEN a.action='audit.exported' THEN 'Exports' ELSE 'Other' END AS family,
   CASE
   WHEN lower(COALESCE(a.details#>>'{_audit,result}',a.details->>'result',a.details->>'outcome','')) IN('success','succeeded','successful','ok','completed') THEN 'Succeeded'
   WHEN lower(COALESCE(a.details#>>'{_audit,result}',a.details->>'result',a.details->>'outcome','')) IN('pending','queued','processing') THEN 'Pending'
   WHEN lower(COALESCE(a.details#>>'{_audit,result}',a.details->>'result',a.details->>'outcome','')) IN('unknown','uncertain') THEN 'Unknown'
   WHEN lower(COALESCE(a.details#>>'{_audit,result}',a.details->>'result',a.details->>'outcome','')) IN('failure','failed','error') OR a.action LIKE '%.failed' THEN 'Failed'
   WHEN lower(COALESCE(a.details#>>'{_audit,result}',a.details->>'result',a.details->>'outcome','')) IN('denied','forbidden') OR a.action LIKE '%.denied' THEN 'Denied' ELSE 'Not recorded' END AS result,
   (a.action ~ ${AUDIT_CRITICAL_PATTERN}) AS critical
   FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id
   WHERE a.tenant_id=${c.tenantId}::uuid AND a.property_id=${c.propertyId}::uuid AND (${a.broad} OR EXISTS(SELECT 1 FROM unnest(${a.prefixes}::text[]) AS allowed(prefix) WHERE starts_with(a.action,allowed.prefix)) OR (a.action='audit.exported' AND a.actor_user_id=${c.userId}::uuid)) AND (NOT starts_with(a.action,'booking.clock_deposit_') OR ${a.broad || a.prefixes.includes('payment.')})`;
  }
  private where(f: Filters, timezone: string, a: Access, through?: Date) {
    const matchingActions = Object.entries(AUDIT_EVENTS)
      .filter(([, definition]) => definition.title.toLowerCase().includes(f.search.toLowerCase()))
      .map(([action]) => action);
    return Prisma.sql`
  ("createdAt" AT TIME ZONE ${timezone})::date BETWEEN ${f.from}::date AND ${f.to}::date
  AND (${through ?? null}::timestamptz IS NULL OR "createdAt"<=${through ?? null})
  AND (${f.view}='all' OR (${f.view}='system' AND routine) OR (${f.view}='business' AND NOT routine))
  AND (${f.source}='' OR source=${f.source})
  AND (${f.family}='' OR family=${f.family}) AND (${f.result}='' OR result=${f.result})
  AND (${f.actor}='' OR (${f.actor === 'system'} AND "actorUserId" IS NULL) OR "actorUserId"::text=${f.actor})
  AND (${f.target}='' OR "targetType" ILIKE ${'%' + f.target + '%'} OR ((${a.actors} OR "targetType" NOT IN('user','staff','tenant_membership')) AND "targetId" ILIKE ${'%' + f.target + '%'}))
  AND (${f.search}='' OR action=ANY(${matchingActions}::text[]) OR action ILIKE ${'%' + f.search + '%'} OR id::text ILIKE ${'%' + f.search + '%'} OR "targetType" ILIKE ${'%' + f.search + '%'} OR ((${a.actors} OR "targetType" NOT IN('user','staff','tenant_membership')) AND "targetId" ILIKE ${'%' + f.search + '%'}) OR (${a.actors} AND concat_ws(' ',"actorEmail","actorFirst","actorLast") ILIKE ${'%' + f.search + '%'}))`;
  }
  private present(row: Row, a: Access, summary = false) {
    const redactions = a.actors
      ? []
      : [
          row.actorEmail ?? '',
          row.actorFirst ?? '',
          row.actorLast ?? '',
          [row.actorFirst, row.actorLast].filter(Boolean).join(' '),
          row.actorUserId ?? '',
        ];
    const details = summary
      ? {}
      : (safeAuditValue(row.details, a.actors, redactions) as Record<string, unknown>);
    const personalTarget = ['user', 'staff', 'tenant_membership'].includes(row.targetType);
    return {
      id: row.id,
      action: auditText(row.action, redactions),
      title: auditTitle(auditText(row.action, redactions)),
      source: AUDIT_SOURCE_LABELS[row.source ?? ''] ?? 'Not specified',
      sourceKey: row.source && AUDIT_SOURCE_LABELS[row.source] ? row.source : null,
      operationId: row.operationId ? auditText(row.operationId, redactions) : null,
      routine: row.routine,
      summary: this.amountSummary(row.amount),
      family: row.family,
      result: row.result,
      critical: row.critical,
      createdAt: row.createdAt,
      actorUserId: a.actors ? row.actorUserId : null,
      actor: row.actorUserId
        ? a.actors
          ? [row.actorFirst, row.actorLast].filter(Boolean).join(' ') ||
            row.actorEmail ||
            'Unavailable account'
          : 'Hidden (requires staff.view)'
        : 'System',
      targetType: row.targetType,
      targetId: personalTarget && !a.actors ? null : auditText(row.targetId, redactions),
      ...(summary
        ? {}
        : {
            details,
            before: details.before ?? null,
            after: details.after ?? null,
            reason:
              typeof details.reason === 'string'
                ? details.reason
                : typeof details.note === 'string'
                  ? details.note
                  : null,
            requestContext: safeAuditValue(row.requestContext, a.actors, redactions),
          }),
    };
  }
  private amountSummary(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const amount = value as { amount?: unknown; currency?: unknown };
    return typeof amount.amount === 'string' &&
      /^-?\d+(?:\.\d{1,2})?$/.test(amount.amount) &&
      typeof amount.currency === 'string' &&
      /^[A-Z]{3}$/.test(amount.currency)
      ? `${amount.currency} ${amount.amount}`
      : null;
  }
  private async property(tx: TenantTransaction, c: AuditContext) {
    const rows = await tx.$queryRaw<
      { timezone: string; version: number; canExport: boolean }[]
    >`SELECT p.timezone,p.audit_export_version AS version,u.email_verified_at IS NOT NULL AS "canExport" FROM properties p JOIN users u ON u.id=${c.userId}::uuid WHERE p.tenant_id=${c.tenantId}::uuid AND p.id=${c.propertyId}::uuid`;
    if (!rows[0]) throw new NotFoundException('Property was not found.');
    return rows[0];
  }
  async list(c: AuditContext, query: Record<string, unknown> = {}) {
    const a = await this.access(c),
      page = Number(query.page ?? 1),
      pageSize = Number(query.pageSize ?? 25);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100
    )
      throw new BadRequestException('Invalid audit page.');
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        const p = await this.property(tx, c);
        const clock = await tx.$queryRaw<
          { through: Date }[]
        >`SELECT transaction_timestamp() AS through`;
        const today = propertyDay(clock[0].through, p.timezone),
          f = this.filters(query, today, a),
          base = this.base(c, a),
          where = this.where(f, p.timezone, a);
        const items = await tx.$queryRaw<Row[]>(
          Prisma.sql`WITH events AS (${base}) SELECT id,"actorUserId","actorType","actorEmail","actorFirst","actorLast",action,"targetType","targetId","createdAt",family,result,critical,source,"operationId",amount,routine FROM events WHERE ${where} ORDER BY "createdAt" DESC,id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );
        const stats = await tx.$queryRaw<
          { total: number; today: number; critical: number; uniqueActors: number }[]
        >(
          Prisma.sql`WITH events AS (${base}) SELECT count(*)::int AS total,count(*) FILTER(WHERE ("createdAt" AT TIME ZONE ${p.timezone})::date=${today}::date)::int AS today,count(*) FILTER(WHERE critical)::int AS critical,count(DISTINCT "actorUserId")::int AS "uniqueActors" FROM events WHERE ${where}`,
        );
        const actors = a.actors
          ? await tx.$queryRaw<{ id: string; label: string }[]>(
              Prisma.sql`WITH events AS (${base}) SELECT "actorUserId" AS id,max(COALESCE(NULLIF(trim(concat_ws(' ',"actorFirst","actorLast")),''),"actorEmail",'Unavailable account')) AS label FROM events WHERE ${where} AND "actorUserId" IS NOT NULL GROUP BY "actorUserId" ORDER BY label LIMIT 100`,
            )
          : [];
        return {
          items: items.map((r) => this.present(r, a, true)),
          page,
          pageSize,
          total: stats[0].total,
          counts: {
            today: stats[0].today,
            critical: stats[0].critical,
            uniqueActors: stats[0].uniqueActors,
          },
          actors,
          families: a.families,
          canViewActors: a.actors,
          canExport: p.canExport,
          version: p.version,
          through: clock[0].through,
          filters: f,
          scopeKey: JSON.stringify(a),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async detail(c: AuditContext, id: string) {
    if (!NOTIFICATION_UUID.test(id)) throw new BadRequestException('Invalid audit evidence id.');
    const a = await this.access(c);
    return this.db.withTenantTransaction(c, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>(
        Prisma.sql`WITH events AS (${this.base(c, a)}) SELECT * FROM events WHERE id=${id}::uuid`,
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('Audit event was not found.');
      const related = await tx.$queryRaw<Row[]>(
        Prisma.sql`WITH events AS (${this.base(c, a)}) SELECT * FROM events WHERE "targetType"=${row.targetType} AND "targetId"=${row.targetId} AND id<>${id}::uuid AND "createdAt" BETWEEN ${row.createdAt}::timestamptz-interval '24 hours' AND ${row.createdAt}::timestamptz+interval '24 hours' ORDER BY "createdAt" DESC,id DESC LIMIT 10`,
      );
      const linked = row.operationId
        ? await tx.$queryRaw<Row[]>(
            Prisma.sql`WITH events AS (${this.base(c, a)}) SELECT * FROM events WHERE "operationId"=${row.operationId} ORDER BY "createdAt",id LIMIT 51`,
          )
        : [];
      return {
        ...this.present(row, a),
        related: related.map((r) => this.present(r, a)),
        linked: linked.slice(0, 50).map((r) => this.present(r, a)),
        linkedTruncated: linked.length > 50,
      };
    });
  }
  async cleanupExports(c: { tenantId: string; propertyId: string }, now = new Date()) {
    return this.db.withTenantTransaction(c, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ':' + c.propertyId + ':audit-exports'},0))`;
      const removed =
        await tx.$executeRaw`DELETE FROM audit_export_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND created_at<${new Date(now.getTime() - 86400000)}`;
      if (removed)
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: null,
          action: 'audit.export_receipts_expired',
          targetType: 'property',
          targetId: c.propertyId,
          details: { result: 'succeeded', removed },
        });
      return { removed };
    });
  }
  async export(c: AuditContext, body: Record<string, unknown>, key: string | undefined) {
    if (
      !key ||
      !/^[\x21-\x7e]{1,128}$/.test(key) ||
      !body ||
      !Number.isSafeInteger(body.version) ||
      Number(body.version) < 0
    )
      throw new BadRequestException('An Idempotency-Key and current export version are required.');
    const through = new Date(String(body.through));
    if (Number.isNaN(through.getTime()) || through.getTime() > Date.now() + 5000)
      throw new BadRequestException('A valid observed through timestamp is required.');
    const ids = body.ids;
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        !ids.length ||
        ids.length > 100 ||
        ids.some((id) => typeof id !== 'string' || !NOTIFICATION_UUID.test(id)))
    )
      throw new BadRequestException('Select between 1 and 100 evidence IDs.');
    if (!body.filters || typeof body.filters !== 'object' || Array.isArray(body.filters))
      throw new BadRequestException('The current audit filters are required.');
    const a = await this.access(c),
      hash = createHash('sha256')
        .update(JSON.stringify({ body, access: a }))
        .digest('hex');
    return this.db.withTenantTransaction(
      c,
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid FOR UPDATE`;
        const p = await this.property(tx, c);
        if (!p.canExport)
          throw new ForbiddenException('Verify your email to export audit evidence.');
        await tx.$executeRaw`DELETE FROM audit_export_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND created_at<now()-interval '24 hours'`;
        const receipts = await tx.$queryRaw<
          {
            hash: string;
            response: {
              csv: string;
              count: number;
              version: number;
              evidenceId: string;
              filename: string;
            };
          }[]
        >`SELECT request_hash AS hash,response FROM audit_export_operations WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND user_id=${c.userId}::uuid AND idempotency_key=${key}`;
        if (receipts[0]) {
          if (receipts[0].hash !== hash)
            throw new ConflictException(
              'Export intent or permissions changed. Reload before exporting.',
            );
          return receipts[0].response;
        }
        if (p.version !== body.version)
          throw new ConflictException(
            'Another export changed the version. Reload before exporting.',
          );
        const f = this.filters(
          body.filters as Record<string, unknown>,
          propertyDay(through, p.timezone),
          a,
        );
        const selected = await tx.$queryRaw<{ id: string; bytes: bigint }[]>(
          Prisma.sql`WITH events AS (${this.base(c, a)}) SELECT id,(octet_length(details::text)+octet_length(COALESCE("requestContext",'null'::jsonb)::text))::bigint AS bytes FROM events WHERE ${this.where(f, p.timezone, a, through)} ${ids ? Prisma.sql`AND id=ANY(${ids as string[]}::uuid[])` : Prisma.empty} ORDER BY "createdAt" DESC,id DESC LIMIT 5001`,
        );
        if (ids && selected.length !== new Set(ids as string[]).size)
          throw new NotFoundException(
            'One or more selected events are outside the authorized filtered scope.',
          );
        if (selected.length > 5000)
          throw new BadRequestException('Export is limited to 5000 events. Narrow the filters.');
        if (selected.reduce((sum, row) => sum + row.bytes, 0n) > 2n * 1024n * 1024n)
          throw new BadRequestException(
            'Selected evidence exceeds 2MB before formatting. Narrow the filters.',
          );
        const rows = selected.length
          ? await tx.$queryRaw<Row[]>(
              Prisma.sql`WITH events AS (${this.base(c, a)}) SELECT * FROM events WHERE id=ANY(${selected.map((r) => r.id)}::uuid[]) ORDER BY "createdAt" DESC,id DESC`,
            )
          : [];
        const events = rows.map((r) => this.present(r, a)),
          csv = auditCsv([
            [
              'Evidence ID',
              'Time (UTC)',
              'Family',
              'Action',
              'Actor',
              'Actor ID',
              'Target type',
              'Target ID',
              'Recorded result',
              'Readable action',
              'Source',
              'Operation reference',
              'Critical classification',
              'Reason',
              'Before (recorded)',
              'After (recorded)',
              'Request context (recorded)',
            ],
            ...events.map((r) => [
              r.id,
              r.createdAt.toISOString(),
              r.family,
              r.action,
              r.actor,
              r.actorUserId,
              r.targetType,
              r.targetId,
              r.result === 'Not recorded'
                ? 'Outcome not specified'
                : r.result === 'Succeeded'
                  ? 'Completed'
                  : r.result,
              r.title,
              r.source,
              r.operationId,
              r.critical ? 'Sensitive' : 'Standard',
              r.reason,
              JSON.stringify(r.before),
              JSON.stringify(r.after),
              JSON.stringify(r.requestContext),
            ]),
          ]);
        if (Buffer.byteLength(csv, 'utf8') > 2 * 1024 * 1024)
          throw new BadRequestException('Export exceeds 2MB. Narrow the filters.');
        const operation = randomUUID();
        await this.audit.recordInTransaction(tx, {
          ...c,
          actorUserId: c.userId,
          action: 'audit.exported',
          targetType: 'audit_export',
          targetId: operation,
          details: {
            result: 'succeeded',
            rowCount: rows.length,
            filters: f,
            through: through.toISOString(),
            actorDetailsIncluded: a.actors,
            before: { version: p.version },
            after: { version: p.version + 1 },
          },
        });
        const evidence = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM audit_logs WHERE tenant_id=${c.tenantId}::uuid AND property_id=${c.propertyId}::uuid AND action='audit.exported' AND target_type='audit_export' AND target_id=${operation}`;
        const response = {
          csv,
          count: rows.length,
          version: p.version + 1,
          evidenceId: evidence[0].id,
          filename: `audit-${f.from}-${f.to}.csv`,
        };
        await tx.$executeRaw`UPDATE properties SET audit_export_version=${response.version} WHERE tenant_id=${c.tenantId}::uuid AND id=${c.propertyId}::uuid`;
        await tx.$executeRaw`INSERT INTO audit_export_operations(tenant_id,property_id,user_id,idempotency_key,request_hash,response) VALUES(${c.tenantId}::uuid,${c.propertyId}::uuid,${c.userId}::uuid,${key},${hash},${JSON.stringify(response)}::jsonb)`;
        return response;
      },
      { timeoutMs: 20000 },
    );
  }
}
