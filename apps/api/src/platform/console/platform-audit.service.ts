import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { auditCsv } from '../../tenancy/audit-workspace';
import {
  TenantDatabaseService,
  type TenantTransaction,
} from '../../tenancy/tenant-database.service';
import type { PlatformRequestContext } from './platform-console.decorators';

export interface PlatformAuditEntry {
  action: string;
  result?: 'succeeded' | 'failed' | 'denied';
  tenantId?: string | null;
  propertyId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  details?: Record<string, unknown>;
  supportSessionId?: string | null;
  /** Used for events without a signed-in actor, such as a failed login. */
  actorEmail?: string | null;
}

export interface PlatformAuditFilters {
  actor?: string;
  actionFamily?: string;
  tenantId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface PlatformAuditRow {
  id: string;
  createdAt: string;
  actorAccountId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  result: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  supportSessionId: string | null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY = /pass(word)?|secret|token|credential|api[_-]?key|authorization|cookie/i;

/** Remove anything that looks like a secret before it reaches the audit log. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => redactForAudit(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? '[redacted]' : redactForAudit(item, depth + 1),
      ]),
    );
  if (typeof value === 'string') return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  return value;
}

const SELECT_ROWS = Prisma.sql`
  SELECT l."id", l."created_at" AS "createdAt", l."actor_account_id" AS "actorAccountId",
    l."actor_email" AS "actorEmail", l."actor_role" AS "actorRole", l."action",
    l."tenant_id" AS "tenantId", NULL::text AS "tenantName", l."target_type" AS "targetType",
    l."target_id" AS "targetId", l."before", l."after", l."reason", l."result", l."ip",
    l."user_agent" AS "userAgent", l."request_id" AS "requestId",
    l."support_session_id" AS "supportSessionId"
  FROM "platform_audit_log" l`;

@Injectable()
export class PlatformAuditService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  /** Writes inside the caller's transaction, so the change and its audit row commit together. */
  async recordInTransaction(
    tx: TenantTransaction,
    ctx: PlatformRequestContext,
    entry: PlatformAuditEntry,
  ): Promise<void> {
    ctx.audited = true;
    const before = entry.before === undefined ? null : JSON.stringify(redactForAudit(entry.before));
    const after = entry.after === undefined ? null : JSON.stringify(redactForAudit(entry.after));
    await tx.$executeRaw`
      INSERT INTO "platform_audit_log" (
        "actor_account_id", "actor_email", "actor_role", "action", "tenant_id", "property_id",
        "target_type", "target_id", "before", "after", "reason", "result", "ip", "user_agent",
        "request_id", "support_session_id", "details")
      VALUES (
        ${ctx.actor?.accountId ?? null}::uuid,
        ${ctx.actor?.email ?? entry.actorEmail ?? null},
        ${ctx.actor?.roleKey ?? null},
        ${entry.action},
        ${entry.tenantId ?? null}::uuid,
        ${entry.propertyId ?? null}::uuid,
        ${entry.targetType ?? null},
        ${entry.targetId ?? null},
        ${before}::jsonb,
        ${after}::jsonb,
        ${entry.reason ?? null},
        ${entry.result ?? 'succeeded'},
        ${ctx.ip},
        ${ctx.userAgent},
        ${ctx.requestId},
        ${entry.supportSessionId ?? null}::uuid,
        ${JSON.stringify(redactForAudit(entry.details ?? {}))}::jsonb)
    `;
  }

  /** Writes its own transaction: used for denials, failures and the interceptor's fallback row. */
  async record(ctx: PlatformRequestContext, entry: PlatformAuditEntry): Promise<void> {
    await this.database.withPlatformConsoleTransaction((tx) =>
      this.recordInTransaction(tx, ctx, entry),
    );
  }

  async search(
    filters: PlatformAuditFilters,
  ): Promise<{ items: PlatformAuditRow[]; total: number; page: number; pageSize: number }> {
    const where = this.where(filters);
    const offset = (filters.page - 1) * filters.pageSize;
    const result = await this.database.withPlatformConsoleTransaction(async (tx) => {
      const [items, total] = await Promise.all([
        tx.$queryRaw<PlatformAuditRow[]>(Prisma.sql`
          ${SELECT_ROWS} ${where}
          ORDER BY l."created_at" DESC, l."id" DESC
          LIMIT ${filters.pageSize} OFFSET ${offset}`),
        tx.$queryRaw<[{ count: number }]>(
          Prisma.sql`SELECT COUNT(*)::int AS "count" FROM "platform_audit_log" l ${where}`,
        ),
      ]);
      return { items, total: total[0]?.count ?? 0 };
    });
    return {
      items: await this.withHotelNames(result.items),
      total: result.total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  /** Up to `limit` matching rows for CSV export. */
  async exportRows(filters: PlatformAuditFilters, limit = 10_000): Promise<PlatformAuditRow[]> {
    const where = this.where(filters);
    const rows = await this.database.withPlatformConsoleTransaction((tx) =>
      tx.$queryRaw<PlatformAuditRow[]>(Prisma.sql`
        ${SELECT_ROWS} ${where}
        ORDER BY l."created_at" DESC, l."id" DESC
        LIMIT ${limit}`),
    );
    return this.withHotelNames(rows);
  }

  private async withHotelNames(rows: PlatformAuditRow[]): Promise<PlatformAuditRow[]> {
    const ids = [...new Set(rows.map((row) => row.tenantId).filter((id): id is string => !!id))];
    if (!ids.length) return rows;
    const names = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<Array<{ id: string; name: string }>>`
          SELECT "id", "name" FROM "organizations" WHERE "id" = ANY(${ids}::uuid[])`,
    );
    const byId = new Map(names.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      ...row,
      tenantName: row.tenantId ? (byId.get(row.tenantId) ?? null) : null,
    }));
  }

  private where(filters: PlatformAuditFilters): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    const escape = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);
    if (filters.actor)
      conditions.push(
        Prisma.sql`lower(l."actor_email") LIKE ${'%' + escape(filters.actor.toLowerCase()) + '%'}`,
      );
    if (filters.actionFamily)
      conditions.push(Prisma.sql`l."action" LIKE ${escape(filters.actionFamily) + '%'}`);
    if (filters.tenantId) conditions.push(Prisma.sql`l."tenant_id" = ${filters.tenantId}::uuid`);
    if (filters.from) conditions.push(Prisma.sql`l."created_at" >= ${filters.from}::timestamptz`);
    if (filters.to) conditions.push(Prisma.sql`l."created_at" <= ${filters.to}::timestamptz`);
    return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
  }
}

export function parseAuditFilters(query: Record<string, string | undefined>): PlatformAuditFilters {
  const tenantId = query.tenantId?.trim();
  if (tenantId && !uuidPattern.test(tenantId)) throw new BadRequestException('Invalid hotel id.');
  const date = (value: string | undefined, name: string) => {
    if (!value) return undefined;
    if (Number.isNaN(Date.parse(value))) throw new BadRequestException(`Invalid ${name} date.`);
    return new Date(value).toISOString();
  };
  const positive = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    actor: query.actor?.trim().slice(0, 320) || undefined,
    actionFamily: query.actionFamily?.trim().slice(0, 60) || undefined,
    tenantId: tenantId || undefined,
    from: date(query.from, 'from'),
    to: date(query.to, 'to'),
    page: positive(query.page, 1),
    pageSize: Math.min(positive(query.pageSize, 50), 200),
  };
}

export function platformAuditCsv(rows: readonly PlatformAuditRow[]): string {
  return auditCsv([
    ['Time', 'Actor', 'Role', 'Action', 'Hotel', 'Target', 'Reason', 'Result', 'IP', 'Request id'],
    ...rows.map((row) => [
      row.createdAt,
      row.actorEmail ?? '',
      row.actorRole ?? '',
      row.action,
      row.tenantName ?? row.tenantId ?? '',
      [row.targetType, row.targetId].filter(Boolean).join(' '),
      row.reason ?? '',
      row.result,
      row.ip ?? '',
      row.requestId ?? '',
    ]),
  ]);
}
