import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService } from './tenant-database.service';

// 30 minutes: long enough for an admin to switch tabs and paste the code,
// short enough that a code visible in a screenshot/support ticket isn't
// useful for long. No 0/O/1/I, matching booking-reference.ts's alphabet —
// avoids characters that are easy to misread when typed by hand.
const TTL_SECONDS = 30 * 60;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REDEEM_IP_LIMIT = 20;
const REDEEM_WINDOW_SECONDS = 3_600;

type PairingPayload = { tenantId: string; propertyId: string };

export type WordpressPairingResult = {
  tenantId: string;
  propertyId: string;
  apiBaseUrl: string;
  propertyName: string;
};

/**
 * Per ADR-0027: a short-lived, single-use pairing code lets a WordPress site
 * self-serve its connection (tenant ID, property ID, API base URL) instead
 * of an admin manually typing raw UUIDs found nowhere in the product today.
 * Deliberately Redis-backed, not a Postgres table — mirrors the existing
 * StaffInviteService/AuthService token pattern (SET with EX, single-use via
 * GETDEL) rather than inventing new persistence for the same shape of
 * problem. No durable credential is introduced: the code is discarded after
 * one redemption, and what WordPress ends up storing is identical in kind
 * to what it already stores today.
 */
@Injectable()
export class WordpressPairingService implements OnModuleDestroy {
  private readonly redis: RedisClientType;
  private connectPromise: Promise<RedisClientType> | undefined;

  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  async generate(tenantId: string, propertyId: string): Promise<string> {
    const properties = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<Array<{ slug: string }>>`
          SELECT slug FROM properties
          WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
        `,
    );
    const property = properties[0];
    if (!property) throw new NotFoundException('Property was not found.');

    const code = this.buildCode(property.slug);
    const payload: PairingPayload = { tenantId, propertyId };
    await (await this.client()).set(this.key(code), JSON.stringify(payload), { EX: TTL_SECONDS });
    return code;
  }

  async redeem(code: string, clientIp: string): Promise<WordpressPairingResult> {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) throw new BadRequestException('A connection code is required.');
    await this.enforceRedeemRateLimit(clientIp);

    const raw = await (await this.client()).getDel(this.key(trimmed));
    if (!raw) throw new BadRequestException('This connection code is invalid or has expired.');
    const payload = JSON.parse(raw) as PairingPayload;

    const property = await this.database.withTenantTransaction(
      { tenantId: payload.tenantId, propertyId: payload.propertyId },
      async (tx) => {
        const properties = await tx.$queryRaw<Array<{ name: string }>>`
          SELECT name FROM properties
          WHERE tenant_id = ${payload.tenantId}::uuid AND id = ${payload.propertyId}::uuid
        `;
        if (!properties[0]) return null;
        await tx.$executeRaw`
          UPDATE properties SET wordpress_connected_at = now()
          WHERE tenant_id = ${payload.tenantId}::uuid AND id = ${payload.propertyId}::uuid
        `;
        return properties[0];
      },
    );
    if (!property)
      throw new BadRequestException('The property for this connection code no longer exists.');

    return {
      tenantId: payload.tenantId,
      propertyId: payload.propertyId,
      apiBaseUrl: this.apiBaseUrl(),
      propertyName: property.name,
    };
  }

  // The public web app is the only publicly routable hostname (confirmed
  // against the real deployment, 2026-08-06) — must.dejvis.dev proxies
  // /api/:path* to the API container via a Next.js rewrite; there is no
  // separate API subdomain. WordPress's own base URL must include that
  // /api prefix to actually reach the backend.
  private apiBaseUrl(): string {
    const webAppUrl = process.env.WEB_APP_URL;
    if (!webAppUrl) throw new Error('WEB_APP_URL must be configured.');
    return `${webAppUrl.replace(/\/$/, '')}/api`;
  }

  private buildCode(slug: string): string {
    const prefix = slug.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() || 'HOTEL';
    const segment = () =>
      Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    return `MUST-${prefix}-${segment()}-${segment()}`;
  }

  private key(code: string): string {
    return `wordpress-pairing:${createHash('sha256').update(code).digest('hex')}`;
  }

  private async enforceRedeemRateLimit(clientIp: string): Promise<void> {
    const rateLimitKey = `rate-limit:wordpress-pairing:${createHash('sha256').update(clientIp).digest('hex')}`;
    const [count] = (await (
      await this.client()
    ).eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return { count }`,
      { keys: [rateLimitKey], arguments: [String(REDEEM_WINDOW_SECONDS)] },
    )) as [number];
    if (count > REDEEM_IP_LIMIT)
      throw new HttpException(
        'Too many connection attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private async client(): Promise<RedisClientType> {
    if (!this.redis.isOpen) {
      this.connectPromise ??= this.redis.connect();
      await this.connectPromise;
    }
    return this.redis;
  }
}
