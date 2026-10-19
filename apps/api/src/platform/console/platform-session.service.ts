import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import type { PlatformActor } from './platform-console.decorators';

export const PLATFORM_COOKIE = 'must_platform';
export const PLATFORM_SESSION_ABSOLUTE_HOURS = 12;
export const PLATFORM_SESSION_IDLE_HOURS = 2;

export function platformCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PLATFORM_SESSION_ABSOLUTE_HOURS * 3_600_000,
  };
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

type SessionRow = {
  sessionId: string;
  accountId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roleKey: string;
  roleName: string;
  capabilities: string[];
  lastSeenAt: Date;
};

@Injectable()
export class PlatformSessionService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  /** Creates a session and returns the raw token for the cookie; only its hash is stored. */
  async create(accountId: string, ip: string | null, userAgent: string | null): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.database.withPlatformConsoleTransaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "platform_sessions" ("account_id", "token_hash", "expires_at", "ip", "user_agent")
        VALUES (${accountId}::uuid, ${hashToken(token)},
          now() + (${PLATFORM_SESSION_ABSOLUTE_HOURS}::int * interval '1 hour'),
          ${ip?.slice(0, 64) ?? null}, ${userAgent?.slice(0, 300) ?? null})
      `;
      await tx.$executeRaw`
        UPDATE "platform_accounts" SET "last_login_at" = now() WHERE "id" = ${accountId}::uuid
      `;
    });
    return token;
  }

  /** Resolves a cookie token to a live actor, or null (expired, idle, revoked, suspended). */
  async authenticate(token: string | undefined): Promise<PlatformActor | null> {
    if (!token || token.length > 200) return null;
    const hash = hashToken(token);
    return this.database.withPlatformConsoleTransaction(async (tx) => {
      const rows = await tx.$queryRaw<SessionRow[]>`
        SELECT s."id" AS "sessionId", a."id" AS "accountId", a."email", a."first_name" AS "firstName",
          a."last_name" AS "lastName", r."key" AS "roleKey", r."name" AS "roleName",
          r."capabilities", s."last_seen_at" AS "lastSeenAt"
        FROM "platform_sessions" s
        JOIN "platform_accounts" a ON a."id" = s."account_id"
        JOIN "platform_roles" r ON r."id" = a."role_id"
        WHERE s."token_hash" = ${hash}
          AND s."revoked_at" IS NULL
          AND s."expires_at" > now()
          AND s."last_seen_at" > now() - (${PLATFORM_SESSION_IDLE_HOURS}::int * interval '1 hour')
          AND a."status" = 'ACTIVE'
      `;
      const row = rows[0];
      if (!row) return null;
      if (Date.now() - new Date(row.lastSeenAt).getTime() > 60_000)
        await tx.$executeRaw`
          UPDATE "platform_sessions" SET "last_seen_at" = now() WHERE "id" = ${row.sessionId}::uuid
        `;
      const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || null;
      return {
        accountId: row.accountId,
        email: row.email,
        name,
        roleKey: row.roleKey,
        roleName: row.roleName,
        capabilities: row.capabilities,
        sessionId: row.sessionId,
      };
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.database.withPlatformConsoleTransaction((tx) =>
      tx.$executeRaw`
        UPDATE "platform_sessions" SET "revoked_at" = now(), "revoke_reason" = ${reason}
        WHERE "id" = ${sessionId}::uuid AND "revoked_at" IS NULL
      `,
    );
  }

  /** Signs an account out of every device; returns how many sessions were ended. */
  async revokeAll(accountId: string, reason: string): Promise<number> {
    return this.database.withPlatformConsoleTransaction((tx) =>
      tx.$executeRaw`
        UPDATE "platform_sessions" SET "revoked_at" = now(), "revoke_reason" = ${reason}
        WHERE "account_id" = ${accountId}::uuid AND "revoked_at" IS NULL
      `,
    );
  }
}
