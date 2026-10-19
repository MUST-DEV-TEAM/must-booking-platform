import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { PlatformAuditService } from './platform-audit.service';
import type { PlatformActor, PlatformRequestContext } from './platform-console.decorators';
import { trustedProxyHops } from './platform-access.guard';
import { hashToken, PlatformSessionService } from './platform-session.service';

export const PLATFORM_LOGIN_EMAIL_LIMIT = 8;
export const PLATFORM_LOGIN_IP_LIMIT = 40;
const LOGIN_WINDOW_SECONDS = 900;

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertStrongPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200)
    throw new BadRequestException('Password must be at least 12 characters.');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw new BadRequestException('Password must contain a letter and a digit.');
  return password;
}

export interface PlatformMe {
  id: string;
  email: string;
  name: string | null;
  roleKey: string;
  roleName: string;
  capabilities: readonly string[];
}

export const toMe = (actor: PlatformActor): PlatformMe => ({
  id: actor.accountId,
  email: actor.email,
  name: actor.name,
  roleKey: actor.roleKey,
  roleName: actor.roleName,
  capabilities: actor.capabilities,
});

@Injectable()
export class PlatformAuthService implements OnModuleDestroy {
  private readonly redis: RedisClientType = createClient({ url: process.env.REDIS_URL });
  private connection?: Promise<RedisClientType>;
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PlatformSessionService) private readonly sessions: PlatformSessionService,
    @Inject(PlatformAuditService) private readonly audit: PlatformAuditService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  async login(
    input: unknown,
    ctx: PlatformRequestContext,
  ): Promise<{ token: string; me: PlatformMe }> {
    const body = (input ?? {}) as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || typeof body.password !== 'string')
      throw new BadRequestException('Email and password are required.');
    const email = body.email.trim().toLowerCase().slice(0, 320);
    const password = body.password.slice(0, 200);

    const emailKey = this.key('email', email);
    // Behind a proxy that is not configured as trusted every request shares one address, so a
    // per-IP bucket would let one attacker lock everybody out. It applies only to a trusted IP.
    const ipKey = trustedProxyHops() > 0 && ctx.ip ? this.key('ip', ctx.ip) : null;
    const [emailAttempts, ipAttempts] = await Promise.all([
      this.count(emailKey),
      ipKey ? this.count(ipKey) : Promise.resolve(0),
    ]);
    if (emailAttempts > PLATFORM_LOGIN_EMAIL_LIMIT || ipAttempts > PLATFORM_LOGIN_IP_LIMIT) {
      await this.audit.record(ctx, {
        action: 'platform.auth.login',
        result: 'denied',
        actorEmail: email,
        details: { reason: 'throttled' },
      });
      throw new HttpException(
        'Too many sign-in attempts. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const account = await this.database.withPlatformConsoleTransaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          passwordHash: string | null;
          status: string;
        }>
      >`
        SELECT "id", "password_hash" AS "passwordHash", "status"
        FROM "platform_accounts" WHERE lower("email") = ${email}
      `;
      return rows[0] ?? null;
    });

    // Always run one bcrypt comparison so an unknown email costs the same as a wrong password.
    const matches = await bcrypt.compare(password, account?.passwordHash ?? (await this.dummy()));
    if (!account || !account.passwordHash || !matches || account.status !== 'ACTIVE') {
      await this.audit.record(ctx, {
        action: 'platform.auth.login',
        result: 'failed',
        actorEmail: email,
        details: {
          reason: !account ? 'unknown_account' : account.status !== 'ACTIVE' ? 'not_active' : 'bad_password',
        },
      });
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.redis.del(emailKey).catch(() => undefined);
    const token = await this.sessions.create(account.id, ctx.ip, ctx.userAgent);
    const actor = await this.sessions.authenticate(token);
    if (!actor) throw new UnauthorizedException('Invalid email or password.');
    ctx.actor = actor;
    await this.audit.record(ctx, {
      action: 'platform.auth.login',
      targetType: 'platform_account',
      targetId: actor.accountId,
    });
    return { token, me: toMe(actor) };
  }

  async logout(ctx: PlatformRequestContext): Promise<void> {
    const actor = ctx.actor;
    if (!actor) return;
    await this.sessions.revoke(actor.sessionId, 'signed_out');
    await this.audit.record(ctx, {
      action: 'platform.auth.logout',
      targetType: 'platform_account',
      targetId: actor.accountId,
    });
  }

  async logoutEverywhere(ctx: PlatformRequestContext): Promise<{ revoked: number }> {
    const actor = ctx.actor;
    if (!actor) return { revoked: 0 };
    const revoked = await this.sessions.revokeAll(actor.accountId, 'signed_out_everywhere');
    await this.audit.record(ctx, {
      action: 'platform.auth.logout_everywhere',
      targetType: 'platform_account',
      targetId: actor.accountId,
      details: { revoked },
    });
    return { revoked };
  }

  async acceptInvitation(
    input: unknown,
    ctx: PlatformRequestContext,
  ): Promise<{ token: string; me: PlatformMe }> {
    const body = (input ?? {}) as {
      token?: unknown;
      password?: unknown;
      firstName?: unknown;
      lastName?: unknown;
    };
    if (typeof body.token !== 'string' || body.token.length > 200)
      throw new BadRequestException('Invalid or expired invitation.');
    const password = assertStrongPassword(body.password);
    const hash = await bcrypt.hash(password, 12);
    const first = typeof body.firstName === 'string' ? body.firstName.trim().slice(0, 100) : null;
    const last = typeof body.lastName === 'string' ? body.lastName.trim().slice(0, 100) : null;

    const accepted = await this.database.withPlatformConsoleTransaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; accountId: string }>>`
        UPDATE "platform_invitations" SET "accepted_at" = now()
        WHERE "token_hash" = ${hashToken(body.token as string)}
          AND "accepted_at" IS NULL AND "revoked_at" IS NULL AND "expires_at" > now()
        RETURNING "id", "account_id" AS "accountId"
      `;
      const invite = rows[0];
      if (!invite) return null;
      const updated = await tx.$executeRaw`
        UPDATE "platform_accounts"
        SET "password_hash" = ${hash}, "status" = 'ACTIVE',
          "first_name" = COALESCE(${first || null}, "first_name"),
          "last_name" = COALESCE(${last || null}, "last_name"),
          "version" = "version" + 1, "updated_at" = now()
        WHERE "id" = ${invite.accountId}::uuid AND "status" = 'INVITED'
      `;
      if (updated !== 1) throw new BadRequestException('Invalid or expired invitation.');
      return invite.accountId;
    });
    if (!accepted) throw new BadRequestException('Invalid or expired invitation.');

    const token = await this.sessions.create(accepted, ctx.ip, ctx.userAgent);
    const actor = await this.sessions.authenticate(token);
    if (!actor) throw new BadRequestException('Invalid or expired invitation.');
    ctx.actor = actor;
    await this.audit.record(ctx, {
      action: 'platform.team.invitation_accepted',
      targetType: 'platform_account',
      targetId: actor.accountId,
    });
    return { token, me: toMe(actor) };
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= bcrypt.hash('not-a-real-password-for-timing', 12);
    return this.dummyHash;
  }

  private key(scope: string, value: string): string {
    return `rate-limit:platform-login:${scope}:${createHash('sha256').update(value).digest('hex')}`;
  }

  private async count(key: string): Promise<number> {
    if (!this.redis.isOpen) {
      this.connection ??= this.redis.connect();
      await this.connection;
    }
    const [count] = (await this.redis.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return { count }`,
      { keys: [key], arguments: [String(LOGIN_WINDOW_SECONDS)] },
    )) as [number];
    return count;
  }
}
