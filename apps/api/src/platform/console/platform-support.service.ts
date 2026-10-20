import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { AuditLogService } from '../../tenancy/audit-log.service';
import { currentAuditContext } from '../../tenancy/audit-request-context';
import {
  TenantDatabaseService,
  type TenantTransaction,
} from '../../tenancy/tenant-database.service';
import { hotelDashboardAccess, type LifecycleState } from './hotel-lifecycle';
import { PlatformAuditService } from './platform-audit.service';
import { requireActor, type PlatformRequestContext } from './platform-console.decorators';
import { hashToken } from './platform-session.service';

export const SUPPORT_COOKIE = 'must_support';
export const VIEW_DEFAULT_MINUTES = 60;
export const VIEW_MAX_MINUTES = 120;
export const ACT_MAX_MINUTES = 60;
/** A direct session has no expiry; the stored end date is only a far-future placeholder. */
const DIRECT_PLACEHOLDER_YEARS = 10;
/** How long an act-as request waits for approval before it lapses. */
export const APPROVAL_WINDOW_MINUTES = 30;

export type SupportKind = 'VIEW' | 'ACT';
export type SupportStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'DENIED';

export interface SupportSessionSummary {
  id: string;
  tenantId: string;
  hotelName?: string;
  kind: SupportKind;
  status: SupportStatus;
  reason: string;
  requestedBy: { accountId: string; email: string; name: string | null };
  durationMinutes: number;
  createdAt: string;
  startsAt: string | null;
  expiresAt: string;
  approvalMethod: 'OWNER' | 'PLATFORM' | null;
  approvedBy: string | null;
  approvedAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  /** Temporary Super admin shortcut: no approval, reason or expiry; hidden from the hotel. */
  direct: boolean;
  showBanner: boolean;
}

type Row = {
  id: string;
  tenantId: string;
  accountId: string;
  accountEmail: string;
  accountName: string | null;
  kind: SupportKind;
  status: SupportStatus;
  reason: string;
  durationMinutes: number;
  createdAt: string;
  startsAt: string | null;
  expiresAt: string;
  approvalMethod: 'OWNER' | 'PLATFORM' | null;
  approvedBy: string | null;
  approvedAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  direct: boolean;
  showBanner: boolean;
  hotelName?: string;
};

const COLUMNS = `s."id", s."tenant_id" AS "tenantId", s."platform_account_id" AS "accountId",
  s."account_email" AS "accountEmail", s."account_name" AS "accountName", s."kind", s."status",
  s."reason", s."duration_minutes" AS "durationMinutes", s."created_at" AS "createdAt",
  s."starts_at" AS "startsAt", s."expires_at" AS "expiresAt", s."approval_method" AS "approvalMethod",
  s."approved_by" AS "approvedBy", s."approved_at" AS "approvedAt", s."ended_at" AS "endedAt",
  s."ended_by" AS "endedBy", s."direct", s."show_banner" AS "showBanner"`;

const COLS = Prisma.raw(COLUMNS);

export const toSummary = (row: Row): SupportSessionSummary => ({
  id: row.id,
  tenantId: row.tenantId,
  hotelName: row.hotelName,
  kind: row.kind,
  status: row.status,
  reason: row.reason,
  requestedBy: { accountId: row.accountId, email: row.accountEmail, name: row.accountName },
  durationMinutes: row.durationMinutes,
  createdAt: row.createdAt,
  startsAt: row.startsAt,
  expiresAt: row.expiresAt,
  approvalMethod: row.approvalMethod,
  approvedBy: row.approvedBy,
  approvedAt: row.approvedAt,
  endedAt: row.endedAt,
  endedBy: row.endedBy,
  direct: row.direct,
  showBanner: row.showBanner,
});

export interface ResolvedSupportAccess {
  sessionId: string;
  tenantId: string;
  kind: SupportKind;
  accountId: string;
  accountEmail: string;
  expiresAt: string;
  ownerUserId: string;
  lifecycleState: LifecycleState;
  direct: boolean;
  showBanner: boolean;
}

@Injectable()
export class PlatformSupportService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(AuditLogService) private readonly hotelAudit: AuditLogService,
  ) {}

  // ---- platform side ------------------------------------------------------------------------

  async create(input: unknown, ctx: PlatformRequestContext): Promise<SupportSessionSummary> {
    const actor = requireActor(ctx);
    const body = (input ?? {}) as {
      tenantId?: unknown;
      kind?: unknown;
      reason?: unknown;
      durationMinutes?: unknown;
      direct?: unknown;
      showBanner?: unknown;
    };
    if (body.direct === true) return this.createDirect(body, ctx);
    if (body.kind !== 'VIEW' && body.kind !== 'ACT')
      throw new BadRequestException('kind must be VIEW or ACT.');
    const kind: SupportKind = body.kind;
    const needed = kind === 'VIEW' ? 'platform.support.view_as' : 'platform.support.act_as';
    if (!actor.capabilities.includes(needed))
      throw new ForbiddenException('Your platform role does not allow this.');
    if (typeof body.tenantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.tenantId))
      throw new BadRequestException('A hotel is required.');
    const tenantId = body.tenantId;
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 10 || reason.length > 500)
      throw new BadRequestException('Explain why you need access (10 to 500 characters).');
    const max = kind === 'VIEW' ? VIEW_MAX_MINUTES : ACT_MAX_MINUTES;
    const minutes =
      body.durationMinutes === undefined ? VIEW_DEFAULT_MINUTES : Number(body.durationMinutes);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > max)
      throw new BadRequestException(`Duration must be between 5 and ${max} minutes.`);
    ctx.hint.tenantId = tenantId;
    ctx.hint.reason = reason;

    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const orgs = await tx.$queryRaw<Array<{ name: string; state: LifecycleState }>>`
        SELECT "name", "lifecycle_state"::text AS "state" FROM "organizations"
        WHERE "id" = ${tenantId}::uuid FOR SHARE
      `;
      if (!orgs[0]) throw new NotFoundException('Hotel not found.');
      if (kind === 'ACT' && hotelDashboardAccess(orgs[0].state, 'POST') !== 'allowed')
        throw new ConflictException(
          'Act-as access is only available for a hotel that is in service.',
        );
      await this.expireStale(tx, tenantId);
      const name = actor.name;
      let created: Row[];
      try {
        created = await tx.$queryRaw<Row[]>`
          INSERT INTO "support_sessions" ("tenant_id", "platform_account_id", "account_email", "account_name",
            "kind", "status", "reason", "duration_minutes", "starts_at", "expires_at")
          VALUES (${tenantId}::uuid, ${actor.accountId}::uuid, ${actor.email}, ${name}, ${kind},
            ${kind === 'VIEW' ? 'ACTIVE' : 'PENDING_APPROVAL'}, ${reason}, ${minutes},
            ${kind === 'VIEW' ? new Date() : null},
            ${new Date(Date.now() + (kind === 'VIEW' ? minutes : APPROVAL_WINDOW_MINUTES) * 60_000)})
          RETURNING id, tenant_id AS "tenantId", platform_account_id AS "accountId",
            account_email AS "accountEmail", account_name AS "accountName", kind, status, reason,
            duration_minutes AS "durationMinutes", created_at AS "createdAt", starts_at AS "startsAt",
            expires_at AS "expiresAt", approval_method AS "approvalMethod", approved_by AS "approvedBy",
            approved_at AS "approvedAt", ended_at AS "endedAt", ended_by AS "endedBy", direct,
            show_banner AS "showBanner"
        `;
      } catch (error) {
        if ((error as { meta?: { code?: string } }).meta?.code === '23505')
          throw new ConflictException('You already have an open support session for this hotel.');
        throw error;
      }
      const session = toSummary({ ...created[0]!, hotelName: orgs[0].name });
      ctx.hint.targetId = session.id;
      await this.audit.recordInTransaction(tx, ctx, {
        action:
          kind === 'VIEW' ? 'platform.support.view_started' : 'platform.support.act_requested',
        tenantId,
        targetType: 'support_session',
        targetId: session.id,
        reason,
        supportSessionId: session.id,
        after: { kind, status: session.status, expiresAt: session.expiresAt, minutes },
      });
      await this.hotelAudit.recordInTransaction(tx, {
        tenantId,
        actorUserId: actor.accountId,
        actorType: 'PLATFORM_ADMIN',
        action: kind === 'VIEW' ? 'support.session.started' : 'support.session.requested',
        targetType: 'support_session',
        targetId: session.id,
        details: { kind, reason, performedBy: actor.email, expiresAt: session.expiresAt },
      });
      return session;
    });
  }

  /**
   * TEMPORARY Super admin shortcut: enters the hotel as its owner at once. No approval, reason or
   * expiry; the banner is optional. Only the platform log records it. The hotel never sees it.
   */
  private async createDirect(
    body: { tenantId?: unknown; reason?: unknown; showBanner?: unknown },
    ctx: PlatformRequestContext,
  ): Promise<SupportSessionSummary> {
    const actor = requireActor(ctx);
    if (!actor.capabilities.includes('platform.support.direct'))
      throw new ForbiddenException('Your platform role does not allow this.');
    if (typeof body.tenantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.tenantId))
      throw new BadRequestException('A hotel is required.');
    const tenantId = body.tenantId;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const showBanner = body.showBanner !== false;
    ctx.hint.tenantId = tenantId;
    if (reason) ctx.hint.reason = reason;

    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const orgs = await tx.$queryRaw<Array<{ name: string }>>`
        SELECT "name" FROM "organizations" WHERE "id" = ${tenantId}::uuid FOR SHARE
      `;
      if (!orgs[0]) throw new NotFoundException('Hotel not found.');
      await this.expireStale(tx, tenantId);
      // One open session per person and hotel: a new direct entry replaces the previous one.
      await tx.$executeRaw`
        UPDATE "support_sessions" SET "status" = 'REVOKED', "ended_at" = now(), "ended_by" = ${actor.email},
          "token_hash" = NULL, "version" = "version" + 1
        WHERE "tenant_id" = ${tenantId}::uuid AND "platform_account_id" = ${actor.accountId}::uuid
          AND "status" IN ('PENDING_APPROVAL', 'ACTIVE')
      `;
      const created = await tx.$queryRaw<Row[]>`
        INSERT INTO "support_sessions" ("tenant_id", "platform_account_id", "account_email", "account_name",
          "kind", "status", "reason", "duration_minutes", "starts_at", "expires_at", "approved_by",
          "approved_at", "direct", "show_banner")
        VALUES (${tenantId}::uuid, ${actor.accountId}::uuid, ${actor.email}, ${actor.name}, 'ACT', 'ACTIVE',
          ${reason}, 120, now(), now() + (${DIRECT_PLACEHOLDER_YEARS} * interval '1 year'), ${actor.email},
          now(), true, ${showBanner})
        RETURNING id, tenant_id AS "tenantId", platform_account_id AS "accountId",
          account_email AS "accountEmail", account_name AS "accountName", kind, status, reason,
          duration_minutes AS "durationMinutes", created_at AS "createdAt", starts_at AS "startsAt",
          expires_at AS "expiresAt", approval_method AS "approvalMethod", approved_by AS "approvedBy",
          approved_at AS "approvedAt", ended_at AS "endedAt", ended_by AS "endedBy", direct,
          show_banner AS "showBanner"
      `;
      const session = toSummary({ ...created[0]!, hotelName: orgs[0].name });
      ctx.hint.targetId = session.id;
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.support.direct_started',
        tenantId,
        targetType: 'support_session',
        targetId: session.id,
        reason: reason || undefined,
        supportSessionId: session.id,
        after: { direct: true, showBanner },
      });
      return session;
    });
  }

  /** Sessions the caller requested, plus other people's pending act-as requests they may approve. */
  async list(ctx: PlatformRequestContext, tenantId?: string): Promise<SupportSessionSummary[]> {
    const actor = requireActor(ctx);
    const canApprove = actor.capabilities.includes('platform.support.approve');
    const rows = await this.database.withPlatformConsoleTransaction(async (tx) => {
      await this.expireStale(tx);
      return tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT ${COLS} FROM "support_sessions" s
        WHERE (${tenantId ?? null}::uuid IS NULL OR s."tenant_id" = ${tenantId ?? null}::uuid)
          AND (s."platform_account_id" = ${actor.accountId}::uuid
            OR (${canApprove}::boolean AND s."status" = 'PENDING_APPROVAL'))
        ORDER BY s."created_at" DESC LIMIT 100`);
    });
    return (await this.withHotelNames(rows)).map(toSummary);
  }

  async approve(id: string, ctx: PlatformRequestContext): Promise<SupportSessionSummary> {
    const actor = requireActor(ctx);
    const tenantId = await this.tenantOf(id);
    ctx.hint.tenantId = tenantId;
    ctx.hint.targetId = id;
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.accountId === actor.accountId)
        throw new ForbiddenException('A different team member must approve your request.');
      const row = await this.decide(tx, id, 'PLATFORM', actor.email);
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.support.act_approved',
        tenantId,
        targetType: 'support_session',
        targetId: id,
        supportSessionId: id,
        before: { status: 'PENDING_APPROVAL' },
        after: { status: 'ACTIVE', expiresAt: row.expiresAt, approvedBy: actor.email },
        details: { requestedBy: current.accountEmail },
      });
      await this.hotelAudit.recordInTransaction(tx, {
        tenantId,
        actorUserId: actor.accountId,
        actorType: 'PLATFORM_ADMIN',
        action: 'support.session.approved',
        targetType: 'support_session',
        targetId: id,
        details: {
          approvedBy: actor.email,
          via: 'platform',
          requestedBy: current.accountEmail,
          expiresAt: row.expiresAt,
        },
      });
      return toSummary(row);
    });
  }

  async deny(id: string, ctx: PlatformRequestContext): Promise<SupportSessionSummary> {
    const actor = requireActor(ctx);
    const tenantId = await this.tenantOf(id);
    ctx.hint.tenantId = tenantId;
    ctx.hint.targetId = id;
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.accountId === actor.accountId)
        throw new ForbiddenException('Withdraw your own request instead of denying it.');
      const row = await this.deny_(tx, id, actor.email);
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.support.act_denied',
        tenantId,
        targetType: 'support_session',
        targetId: id,
        supportSessionId: id,
        before: { status: 'PENDING_APPROVAL' },
        after: { status: 'DENIED' },
      });
      await this.hotelAudit.recordInTransaction(tx, {
        tenantId,
        actorUserId: actor.accountId,
        actorType: 'PLATFORM_ADMIN',
        action: 'support.session.denied',
        targetType: 'support_session',
        targetId: id,
        details: { deniedBy: actor.email, via: 'platform', requestedBy: current.accountEmail },
      });
      return toSummary(row);
    });
  }

  /** Ends a session early. The requester can always end theirs; approvers can end any. */
  async revoke(id: string, ctx: PlatformRequestContext): Promise<SupportSessionSummary> {
    const actor = requireActor(ctx);
    const tenantId = await this.tenantOf(id);
    ctx.hint.tenantId = tenantId;
    ctx.hint.targetId = id;
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const current = await this.lock(tx, id);
      if (
        current.accountId !== actor.accountId &&
        !actor.capabilities.includes('platform.support.approve')
      )
        throw new ForbiddenException(
          'Only the requester or a support approver can end this session.',
        );
      const row = await this.end(tx, id, 'REVOKED', actor.email);
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.support.revoked',
        tenantId,
        targetType: 'support_session',
        targetId: id,
        supportSessionId: id,
        before: { status: current.status },
        after: { status: 'REVOKED' },
      });
      if (!current.direct)
        await this.hotelAudit.recordInTransaction(tx, {
          tenantId,
          actorUserId: actor.accountId,
          actorType: 'PLATFORM_ADMIN',
          action: 'support.session.ended',
          targetType: 'support_session',
          targetId: id,
          details: { endedBy: actor.email, by: 'platform', requestedBy: current.accountEmail },
        });
      return toSummary(row);
    });
  }

  /** Mints the cookie token for the requester's own active session. */
  async enter(
    id: string,
    ctx: PlatformRequestContext,
  ): Promise<{ session: SupportSessionSummary; token: string }> {
    const actor = requireActor(ctx);
    const tenantId = await this.tenantOf(id);
    ctx.hint.tenantId = tenantId;
    ctx.hint.targetId = id;
    const token = randomBytes(32).toString('base64url');
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.accountId !== actor.accountId)
        throw new ForbiddenException('Only the person who opened a session can enter it.');
      const rows = await tx.$queryRaw<Row[]>`
        UPDATE "support_sessions" s SET "token_hash" = ${hashToken(token)}, "version" = s."version" + 1
        WHERE s."id" = ${id}::uuid AND s."status" = 'ACTIVE' AND s."expires_at" > now()
        RETURNING ${COLS}
      `;
      if (!rows[0]) throw new ConflictException('This session is not active any more.');
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.support.entered',
        tenantId,
        targetType: 'support_session',
        targetId: id,
        supportSessionId: id,
        details: { kind: current.kind },
      });
      return { session: toSummary(rows[0]), token };
    });
  }

  // ---- hotel side (Owner) --------------------------------------------------------------------

  async listForHotel(tenantId: string): Promise<SupportSessionSummary[]> {
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      await this.expireStale(tx, tenantId);
      const rows = await tx.$queryRaw<Row[]>(
        Prisma.sql`SELECT ${COLS} FROM "support_sessions" s WHERE s."tenant_id" = ${tenantId}::uuid AND s."direct" = false ORDER BY s."created_at" DESC LIMIT 100`,
      );
      return rows.map(toSummary);
    });
  }

  async ownerDecide(
    tenantId: string,
    id: string,
    ownerUserId: string,
    ownerEmail: string,
    decision: 'approve' | 'deny' | 'revoke',
  ): Promise<SupportSessionSummary> {
    return this.database.withConsoleTenantTransaction({ tenantId }, async (tx) => {
      const current = await this.lock(tx, id);
      if (current.tenantId !== tenantId || current.direct)
        throw new NotFoundException('Support session not found.');
      const row =
        decision === 'approve'
          ? await this.decide(tx, id, 'OWNER', ownerEmail)
          : decision === 'deny'
            ? await this.deny_(tx, id, ownerEmail)
            : await this.end(tx, id, 'REVOKED', ownerEmail);
      await this.hotelAudit.recordInTransaction(tx, {
        tenantId,
        actorUserId: ownerUserId,
        action:
          decision === 'approve'
            ? 'support.session.approved'
            : decision === 'deny'
              ? 'support.session.denied'
              : 'support.session.ended',
        targetType: 'support_session',
        targetId: id,
        details: {
          by: ownerEmail,
          via: 'owner',
          requestedBy: current.accountEmail,
          kind: current.kind,
        },
      });
      // The platform log records the owner's decision too, without a platform actor.
      await tx.$executeRaw`
        INSERT INTO "platform_audit_log" ("action", "tenant_id", "target_type", "target_id", "result",
          "support_session_id", "details", "actor_email", "actor_role")
        VALUES (${'platform.support.owner_' + decision}, ${tenantId}::uuid, 'support_session', ${id},
          'succeeded', ${id}::uuid, ${JSON.stringify({ by: ownerEmail, requestedBy: current.accountEmail })}::jsonb,
          ${ownerEmail}, 'hotel_owner')
      `;
      return toSummary(row);
    });
  }

  // ---- support cookie: request authorisation, banner and ending ----------------------------

  /**
   * Resolves a support cookie for one hotel. The hotel id must equal the session's own, so a
   * session can never be used on another tenant. Re-checks that the platform account is still
   * active and still holds the capability, so suspensions and role changes bite immediately.
   */
  async resolveForTenant(
    token: string | undefined,
    tenantId: string,
  ): Promise<ResolvedSupportAccess | null> {
    if (!token || token.length > 200) return null;
    return this.database.withConsoleTenantTransaction({ tenantId }, (tx) =>
      this.resolveInTransaction(tx, token, tenantId),
    );
  }

  async resolveAny(token: string | undefined): Promise<ResolvedSupportAccess | null> {
    if (!token || token.length > 200) return null;
    const found = await this.database.withPlatformConsoleTransaction(
      (tx) =>
        tx.$queryRaw<Array<{ tenantId: string }>>`
        SELECT "tenant_id" AS "tenantId" FROM "support_sessions"
        WHERE "token_hash" = ${hashToken(token)} AND "status" = 'ACTIVE' AND "expires_at" > now()
      `,
    );
    return found[0] ? this.resolveForTenant(token, found[0].tenantId) : null;
  }

  async currentForBanner(token: string | undefined) {
    const access = await this.resolveAny(token);
    if (!access) return { active: false as const };
    await this.recordCookieRequest(access, '/support/current');
    return this.database.withConsoleTenantTransaction({ tenantId: access.tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`
        SELECT ${COLS}, (SELECT "name" FROM "organizations" WHERE "id" = ${access.tenantId}::uuid) AS "hotelName"
        FROM "support_sessions" s WHERE s."id" = ${access.sessionId}::uuid
      `;
      return { active: true as const, session: toSummary(rows[0]!) };
    });
  }

  async endByCookie(token: string | undefined): Promise<void> {
    const access = await this.resolveAny(token);
    if (!access) return;
    await this.database.withConsoleTenantTransaction({ tenantId: access.tenantId }, async (tx) => {
      await this.lock(tx, access.sessionId);
      await this.end(tx, access.sessionId, 'REVOKED', access.accountEmail).catch(() => undefined);
      await tx.$executeRaw`
        INSERT INTO "platform_audit_log" ("action", "tenant_id", "target_type", "target_id", "result",
          "support_session_id", "actor_account_id", "actor_email", "details")
        VALUES ('platform.support.ended', ${access.tenantId}::uuid, 'support_session', ${access.sessionId},
          'succeeded', ${access.sessionId}::uuid, ${access.accountId}::uuid, ${access.accountEmail}, '{"by":"requester"}'::jsonb)
      `;
      if (!access.direct)
        await this.hotelAudit.recordInTransaction(tx, {
          tenantId: access.tenantId,
          actorUserId: access.accountId,
          actorType: 'PLATFORM_ADMIN',
          action: 'support.session.ended',
          targetType: 'support_session',
          targetId: access.sessionId,
          details: { endedBy: access.accountEmail, by: 'requester' },
        });
    });
  }

  /** Records a support-cookie request that does not pass the tenant guard (session, banner). */
  async recordCookieRequest(access: ResolvedSupportAccess, route: string): Promise<void> {
    await this.recordRequest(access, {
      method: 'GET',
      route,
      result: 'succeeded',
      requestId: currentAuditContext()?.requestId ?? null,
      ip: null,
      userAgent: null,
    });
  }

  /** Records one request made inside a support session (the platform log is the source of truth). */
  async recordRequest(
    access: ResolvedSupportAccess,
    entry: {
      method: string;
      route: string;
      result: 'succeeded' | 'denied';
      reason?: string;
      requestId: string | null;
      ip: string | null;
      userAgent: string | null;
    },
  ): Promise<void> {
    await this.database.withConsoleTenantTransaction({ tenantId: access.tenantId }, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "platform_audit_log" ("actor_account_id", "actor_email", "action", "tenant_id",
          "target_type", "target_id", "result", "ip", "user_agent", "request_id", "support_session_id", "details")
        VALUES (${access.accountId}::uuid, ${access.accountEmail}, ${'platform.support.request'},
          ${access.tenantId}::uuid, 'support_session', ${access.sessionId}, ${entry.result}, ${entry.ip},
          ${entry.userAgent}, ${entry.requestId}, ${access.sessionId}::uuid,
          ${JSON.stringify({ mode: access.kind, method: entry.method, route: entry.route, reason: entry.reason ?? null })}::jsonb)
      `;
      // The owner sees what an act-as session did in their own audit log.
      if (
        !access.direct &&
        access.kind === 'ACT' &&
        entry.method !== 'GET' &&
        entry.method !== 'HEAD'
      )
        await this.hotelAudit.recordInTransaction(tx, {
          tenantId: access.tenantId,
          actorUserId: access.accountId,
          actorType: 'PLATFORM_ADMIN',
          action:
            entry.result === 'succeeded' ? 'support.action.performed' : 'support.action.refused',
          targetType: 'support_session',
          targetId: access.sessionId,
          details: {
            performedBy: access.accountEmail,
            onBehalfOfHotel: true,
            method: entry.method,
            route: entry.route,
            reason: entry.reason ?? null,
          },
        });
    });
  }

  // ---- internals ----------------------------------------------------------------------------

  private async resolveInTransaction(
    tx: TenantTransaction,
    token: string,
    tenantId: string,
  ): Promise<ResolvedSupportAccess | null> {
    const rows = await tx.$queryRaw<
      Array<{
        sessionId: string;
        kind: SupportKind;
        accountId: string;
        accountEmail: string;
        expiresAt: string;
        capabilities: string[];
        lifecycleState: LifecycleState;
        ownerUserId: string | null;
        direct: boolean;
        showBanner: boolean;
      }>
    >`
      SELECT s."id" AS "sessionId", s."kind", a."id" AS "accountId", a."email" AS "accountEmail",
        s."expires_at" AS "expiresAt", r."capabilities", o."lifecycle_state"::text AS "lifecycleState", s."direct", s."show_banner" AS "showBanner",
        (SELECT tm."user_id" FROM "tenant_memberships" tm
          WHERE tm."tenant_id" = s."tenant_id" AND tm."role" = 'OWNER'::"TenantMembershipRole"
          ORDER BY tm."created_at" LIMIT 1) AS "ownerUserId"
      FROM "support_sessions" s
      JOIN "platform_accounts" a ON a."id" = s."platform_account_id" AND a."status" = 'ACTIVE'
      JOIN "platform_roles" r ON r."id" = a."role_id"
      JOIN "organizations" o ON o."id" = s."tenant_id"
      WHERE s."token_hash" = ${hashToken(token)} AND s."tenant_id" = ${tenantId}::uuid
        AND s."status" = 'ACTIVE' AND s."expires_at" > now()
    `;
    const row = rows[0];
    if (!row || !row.ownerUserId) return null;
    const needed = row.direct
      ? 'platform.support.direct'
      : row.kind === 'VIEW'
        ? 'platform.support.view_as'
        : 'platform.support.act_as';
    if (!row.capabilities.includes(needed)) return null;
    return {
      sessionId: row.sessionId,
      tenantId,
      kind: row.kind,
      accountId: row.accountId,
      accountEmail: row.accountEmail,
      expiresAt: row.expiresAt,
      ownerUserId: row.ownerUserId,
      lifecycleState: row.lifecycleState,
      direct: row.direct,
      showBanner: row.showBanner,
    };
  }

  private async tenantOf(id: string): Promise<string> {
    const rows = await this.database.withPlatformConsoleTransaction(
      (tx) =>
        tx.$queryRaw<Array<{ tenantId: string }>>`
        SELECT "tenant_id" AS "tenantId" FROM "support_sessions" WHERE "id" = ${id}::uuid
      `,
    );
    if (!rows[0]) throw new NotFoundException('Support session not found.');
    return rows[0].tenantId;
  }

  private async lock(tx: TenantTransaction, id: string): Promise<Row> {
    const rows = await tx.$queryRaw<Row[]>(
      Prisma.sql`SELECT ${COLS} FROM "support_sessions" s WHERE s."id" = ${id}::uuid FOR UPDATE OF s`,
    );
    if (!rows[0]) throw new NotFoundException('Support session not found.');
    return rows[0];
  }

  /** The single conditional UPDATE that makes double approval impossible. */
  private async decide(
    tx: TenantTransaction,
    id: string,
    method: 'OWNER' | 'PLATFORM',
    approvedBy: string,
  ): Promise<Row> {
    const rows = await tx.$queryRaw<Row[]>`
      UPDATE "support_sessions" s
      SET "status" = 'ACTIVE', "approval_method" = ${method}, "approved_by" = ${approvedBy},
        "approved_at" = now(), "starts_at" = now(),
        "expires_at" = now() + (s."duration_minutes" * interval '1 minute'), "version" = s."version" + 1
      WHERE s."id" = ${id}::uuid AND s."status" = 'PENDING_APPROVAL' AND s."expires_at" > now()
      RETURNING ${COLS}
    `;
    if (!rows[0]) throw new ConflictException('This request was already decided or has expired.');
    return rows[0];
  }

  private async deny_(tx: TenantTransaction, id: string, deniedBy: string): Promise<Row> {
    const rows = await tx.$queryRaw<Row[]>`
      UPDATE "support_sessions" s
      SET "status" = 'DENIED', "denied_at" = now(), "ended_at" = now(), "ended_by" = ${deniedBy},
        "version" = s."version" + 1
      WHERE s."id" = ${id}::uuid AND s."status" = 'PENDING_APPROVAL' AND s."expires_at" > now()
      RETURNING ${COLS}
    `;
    if (!rows[0]) throw new ConflictException('This request was already decided or has expired.');
    return rows[0];
  }

  private async end(
    tx: TenantTransaction,
    id: string,
    status: 'REVOKED',
    by: string,
  ): Promise<Row> {
    const rows = await tx.$queryRaw<Row[]>`
      UPDATE "support_sessions" s
      SET "status" = ${status}, "ended_at" = now(), "ended_by" = ${by}, "token_hash" = NULL,
        "version" = s."version" + 1
      WHERE s."id" = ${id}::uuid AND s."status" IN ('PENDING_APPROVAL', 'ACTIVE')
      RETURNING ${COLS}
    `;
    if (!rows[0]) throw new ConflictException('This session has already ended.');
    return rows[0];
  }

  private async expireStale(tx: TenantTransaction, tenantId?: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE "support_sessions" SET "status" = 'EXPIRED', "ended_at" = "expires_at", "ended_by" = 'system',
        "token_hash" = NULL
      WHERE "status" IN ('PENDING_APPROVAL', 'ACTIVE') AND "expires_at" <= now()
        AND (${tenantId ?? null}::uuid IS NULL OR "tenant_id" = ${tenantId ?? null}::uuid)
    `;
  }

  private async withHotelNames(rows: Row[]): Promise<Row[]> {
    const ids = [...new Set(rows.map((row) => row.tenantId))];
    if (!ids.length) return rows;
    const names = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT "id", "name" FROM "organizations" WHERE "id" = ANY(${ids}::uuid[])
      `,
    );
    const byId = new Map(names.map((row) => [row.id, row.name]));
    return rows.map((row) => ({ ...row, hotelName: byId.get(row.tenantId) }));
  }
}
