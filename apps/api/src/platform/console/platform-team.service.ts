import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';

import { TenantDatabaseService, type TenantTransaction } from '../../tenancy/tenant-database.service';
import { PlatformAuditService } from './platform-audit.service';
import { assertStrongPassword, emailPattern } from './platform-auth.service';
import { PLATFORM_CAPABILITY_CATALOG } from './platform-capabilities';
import { requireActor, type PlatformRequestContext } from './platform-console.decorators';
import { hashToken, PlatformSessionService } from './platform-session.service';

export interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  roleKey: string;
  roleName: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
  lastLoginAt: string | null;
  createdAt: string;
  version: number;
  invitationExpiresAt: string | null;
}

export interface TeamRole {
  id: string;
  key: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  capabilities: string[];
}

const INVITATION_DAYS = 7;

@Injectable()
export class PlatformTeamService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
    @Inject(PlatformSessionService) private readonly sessions: PlatformSessionService,
  ) {}

  async list(): Promise<TeamMember[]> {
    return this.database.withPlatformConsoleTransaction((tx) =>
      tx.$queryRaw<TeamMember[]>`
        SELECT a."id", a."email",
          NULLIF(BTRIM(CONCAT_WS(' ', a."first_name", a."last_name")), '') AS "name",
          r."key" AS "roleKey", r."name" AS "roleName", a."status",
          a."last_login_at" AS "lastLoginAt", a."created_at" AS "createdAt", a."version",
          (SELECT MAX(i."expires_at") FROM "platform_invitations" i
            WHERE i."account_id" = a."id" AND i."accepted_at" IS NULL AND i."revoked_at" IS NULL
              AND i."expires_at" > now()) AS "invitationExpiresAt"
        FROM "platform_accounts" a
        JOIN "platform_roles" r ON r."id" = a."role_id"
        ORDER BY a."created_at" ASC, a."email" ASC
      `,
    );
  }

  async roles(): Promise<{
    roles: TeamRole[];
    catalog: typeof PLATFORM_CAPABILITY_CATALOG;
  }> {
    const roles = await this.database.withPlatformConsoleTransaction((tx) =>
      tx.$queryRaw<TeamRole[]>`
        SELECT "id", "key", "name", "description", "is_built_in" AS "isBuiltIn", "capabilities"
        FROM "platform_roles" ORDER BY "is_built_in" DESC, "name" ASC
      `,
    );
    return { roles, catalog: PLATFORM_CAPABILITY_CATALOG };
  }

  /** Creates an INVITED account and returns the one-time acceptance token (shown once). */
  async invite(
    input: unknown,
    ctx: PlatformRequestContext,
  ): Promise<{ id: string; invitationToken: string; expiresAt: string }> {
    const actor = requireActor(ctx);
    const body = this.profile(input);
    const token = randomBytes(32).toString('base64url');
    return this.database.withPlatformConsoleTransaction(async (tx) => {
      const role = await this.grantableRole(tx, actor.capabilities, body.roleKey);
      const created = await this.insertAccount(tx, {
        ...body,
        roleId: role.id,
        passwordHash: null,
        status: 'INVITED',
        createdBy: actor.accountId,
      });
      const expires = await tx.$queryRaw<Array<{ expiresAt: string }>>`
        INSERT INTO "platform_invitations" ("account_id", "token_hash", "invited_by", "expires_at")
        VALUES (${created}::uuid, ${hashToken(token)}, ${actor.accountId}::uuid,
          now() + (${INVITATION_DAYS}::int * interval '1 day'))
        RETURNING "expires_at" AS "expiresAt"
      `;
      ctx.hint.targetType = 'platform_account';
      ctx.hint.targetId = created;
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.team.invited',
        targetType: 'platform_account',
        targetId: created,
        after: { email: body.email, role: role.key, status: 'INVITED' },
      });
      return { id: created, invitationToken: token, expiresAt: String(expires[0]?.expiresAt) };
    });
  }

  /** Creates an active account with a password chosen by the creator. */
  async create(input: unknown, ctx: PlatformRequestContext): Promise<{ id: string }> {
    const actor = requireActor(ctx);
    const body = this.profile(input);
    const password = assertStrongPassword((input as { password?: unknown }).password);
    const passwordHash = await bcrypt.hash(password, 12);
    return this.database.withPlatformConsoleTransaction(async (tx) => {
      const role = await this.grantableRole(tx, actor.capabilities, body.roleKey);
      const created = await this.insertAccount(tx, {
        ...body,
        roleId: role.id,
        passwordHash,
        status: 'ACTIVE',
        createdBy: actor.accountId,
      });
      ctx.hint.targetId = created;
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.team.created',
        targetType: 'platform_account',
        targetId: created,
        after: { email: body.email, role: role.key, status: 'ACTIVE' },
      });
      return { id: created };
    });
  }

  async changeRole(
    accountId: string,
    input: unknown,
    ctx: PlatformRequestContext,
  ): Promise<TeamMember> {
    const actor = requireActor(ctx);
    const body = (input ?? {}) as { roleKey?: unknown; version?: unknown };
    if (typeof body.roleKey !== 'string' || !Number.isInteger(body.version))
      throw new BadRequestException('roleKey and version are required.');
    await this.database.withPlatformConsoleTransaction(async (tx) => {
      const role = await this.grantableRole(tx, actor.capabilities, body.roleKey as string);
      const current = await this.lockAccount(tx, accountId);
      this.assertCanManage(current.roleCapabilities, actor.capabilities);
      if (current.version !== body.version)
        throw new ConflictException('This account was changed by someone else. Reload and retry.');
      if (current.roleKey === 'super_admin' && role.key !== 'super_admin' && current.status === 'ACTIVE')
        await this.assertAnotherSuperAdmin(tx, accountId);
      await tx.$executeRaw`
        UPDATE "platform_accounts"
        SET "role_id" = ${role.id}::uuid, "version" = "version" + 1, "updated_at" = now()
        WHERE "id" = ${accountId}::uuid
      `;
      await this.audit.recordInTransaction(tx, ctx, {
        action: 'platform.team.role_changed',
        targetType: 'platform_account',
        targetId: accountId,
        before: { role: current.roleKey, email: current.email },
        after: { role: role.key, email: current.email },
      });
    });
    return this.member(accountId);
  }

  async setStatus(
    accountId: string,
    input: unknown,
    ctx: PlatformRequestContext,
  ): Promise<TeamMember> {
    const actor = requireActor(ctx);
    const body = (input ?? {}) as { status?: unknown; version?: unknown };
    if ((body.status !== 'ACTIVE' && body.status !== 'SUSPENDED') || !Number.isInteger(body.version))
      throw new BadRequestException('status (ACTIVE or SUSPENDED) and version are required.');
    const status = body.status;
    if (accountId === actor.accountId)
      throw new ForbiddenException('You cannot change your own status.');
    await this.database.withPlatformConsoleTransaction(async (tx) => {
      const current = await this.lockAccount(tx, accountId);
      this.assertCanManage(current.roleCapabilities, actor.capabilities);
      if (current.version !== body.version)
        throw new ConflictException('This account was changed by someone else. Reload and retry.');
      if (current.status === 'INVITED')
        throw new BadRequestException('An invited account has not accepted yet.');
      if (current.status === status) throw new ConflictException(`The account is already ${status}.`);
      if (status === 'SUSPENDED' && current.roleKey === 'super_admin')
        await this.assertAnotherSuperAdmin(tx, accountId);
      await tx.$executeRaw`
        UPDATE "platform_accounts"
        SET "status" = ${status}, "version" = "version" + 1, "updated_at" = now()
        WHERE "id" = ${accountId}::uuid
      `;
      if (status === 'SUSPENDED')
        await tx.$executeRaw`
          UPDATE "platform_sessions" SET "revoked_at" = now(), "revoke_reason" = 'account_suspended'
          WHERE "account_id" = ${accountId}::uuid AND "revoked_at" IS NULL
        `;
      await this.audit.recordInTransaction(tx, ctx, {
        action: status === 'SUSPENDED' ? 'platform.team.suspended' : 'platform.team.reactivated',
        targetType: 'platform_account',
        targetId: accountId,
        before: { status: current.status, email: current.email },
        after: { status, email: current.email },
      });
    });
    return this.member(accountId);
  }

  private async member(accountId: string): Promise<TeamMember> {
    const members = await this.list();
    const found = members.find((member) => member.id === accountId);
    if (!found) throw new NotFoundException('Platform account not found.');
    return found;
  }

  private profile(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    if (typeof body.email !== 'string' || !emailPattern.test(body.email.trim()))
      throw new BadRequestException('A valid email is required.');
    if (typeof body.roleKey !== 'string') throw new BadRequestException('A role is required.');
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;
    return {
      email: body.email.trim().toLowerCase().slice(0, 320),
      roleKey: body.roleKey,
      firstName: text(body.firstName),
      lastName: text(body.lastName),
    };
  }

  private async grantableRole(
    tx: TenantTransaction,
    actorCapabilities: readonly string[],
    roleKey: string,
  ): Promise<{ id: string; key: string; capabilities: string[] }> {
    const rows = await tx.$queryRaw<Array<{ id: string; key: string; capabilities: string[] }>>`
      SELECT "id", "key", "capabilities" FROM "platform_roles" WHERE "key" = ${roleKey}
    `;
    const role = rows[0];
    if (!role) throw new BadRequestException('Unknown role.');
    // Nobody can hand out a role stronger than their own.
    if (!role.capabilities.every((key) => actorCapabilities.includes(key)))
      throw new ForbiddenException('You cannot assign a role with permissions you do not have.');
    return role;
  }

  private assertCanManage(
    targetCapabilities: readonly string[],
    actorCapabilities: readonly string[],
  ): void {
    if (!targetCapabilities.every((key) => actorCapabilities.includes(key)))
      throw new ForbiddenException('You cannot manage an account with more permissions than yours.');
  }

  private async lockAccount(tx: TenantTransaction, accountId: string) {
    const rows = await tx.$queryRaw<
      Array<{
        email: string;
        status: 'INVITED' | 'ACTIVE' | 'SUSPENDED';
        version: number;
        roleKey: string;
        roleCapabilities: string[];
      }>
    >`
      SELECT a."email", a."status", a."version", r."key" AS "roleKey", r."capabilities" AS "roleCapabilities"
      FROM "platform_accounts" a JOIN "platform_roles" r ON r."id" = a."role_id"
      WHERE a."id" = ${accountId}::uuid FOR UPDATE OF a
    `;
    if (!rows[0]) throw new NotFoundException('Platform account not found.');
    return rows[0];
  }

  /** The console must always keep one active Super admin. Locks the candidates first. */
  private async assertAnotherSuperAdmin(tx: TenantTransaction, excludingId: string): Promise<void> {
    const others = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT a."id" FROM "platform_accounts" a JOIN "platform_roles" r ON r."id" = a."role_id"
      WHERE r."key" = 'super_admin' AND a."status" = 'ACTIVE' AND a."id" <> ${excludingId}::uuid
      FOR UPDATE OF a
    `;
    if (others.length === 0)
      throw new ConflictException('At least one active Super admin must remain.');
  }

  private async insertAccount(
    tx: TenantTransaction,
    account: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      roleId: string;
      passwordHash: string | null;
      status: 'INVITED' | 'ACTIVE';
      createdBy: string;
    },
  ): Promise<string> {
    try {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "platform_accounts"
          ("email", "first_name", "last_name", "password_hash", "role_id", "status", "created_by")
        VALUES (${account.email}, ${account.firstName}, ${account.lastName}, ${account.passwordHash},
          ${account.roleId}::uuid, ${account.status}, ${account.createdBy}::uuid)
        RETURNING "id"
      `;
      return rows[0]!.id;
    } catch (error) {
      const code = (error as { meta?: { code?: string }; code?: string }).meta?.code;
      if (code === '23505') throw new ConflictException('That email already has a platform account.');
      throw error;
    }
  }
}
