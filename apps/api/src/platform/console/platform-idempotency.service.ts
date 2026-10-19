import { ConflictException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';

export type IdempotencyClaim =
  | { state: 'new' }
  | { state: 'replay'; statusCode: number; body: unknown };

const IN_PROGRESS = 0;
/** An unfinished claim older than this is treated as abandoned (the process died mid-request). */
const STALE_CLAIM_SECONDS = 120;

export const requestHash = (route: string, body: unknown): string =>
  createHash('sha256')
    .update(route + '\n' + JSON.stringify(body ?? null))
    .digest('hex');

/**
 * Makes a mutating console request safe to repeat. The first request with a key claims it;
 * a repeat with the same payload replays the stored response; a repeat while the first is still
 * running, or with a different payload, is refused.
 */
@Injectable()
export class PlatformIdempotencyService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async begin(
    accountId: string,
    key: string,
    route: string,
    hash: string,
  ): Promise<IdempotencyClaim> {
    return this.database.withPlatformConsoleTransaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO "platform_idempotency_keys" ("account_id", "key", "route", "request_hash", "status_code")
        VALUES (${accountId}::uuid, ${key}, ${route}, ${hash}, ${IN_PROGRESS})
        ON CONFLICT ("account_id", "key") DO NOTHING
      `;
      if (inserted === 1) return { state: 'new' } as const;

      const rows = await tx.$queryRaw<
        Array<{
          route: string;
          requestHash: string;
          statusCode: number;
          response: unknown;
          ageSeconds: number;
        }>
      >`
        SELECT "route", "request_hash" AS "requestHash", "status_code" AS "statusCode", "response",
          EXTRACT(EPOCH FROM (now() - "created_at"))::int AS "ageSeconds"
        FROM "platform_idempotency_keys"
        WHERE "account_id" = ${accountId}::uuid AND "key" = ${key}
        FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return { state: 'new' } as const;
      if (row.route !== route || row.requestHash !== hash)
        throw new HttpException(
          'This Idempotency-Key was already used for a different request.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      if (row.statusCode === IN_PROGRESS) {
        if (row.ageSeconds < STALE_CLAIM_SECONDS)
          throw new ConflictException('The same request is still being processed.');
        await tx.$executeRaw`
          UPDATE "platform_idempotency_keys" SET "created_at" = now()
          WHERE "account_id" = ${accountId}::uuid AND "key" = ${key}
        `;
        return { state: 'new' } as const;
      }
      return { state: 'replay', statusCode: row.statusCode, body: row.response } as const;
    });
  }

  async complete(accountId: string, key: string, statusCode: number, body: unknown): Promise<void> {
    await this.database.withPlatformConsoleTransaction((tx) =>
      tx.$executeRaw`
        UPDATE "platform_idempotency_keys"
        SET "status_code" = ${statusCode}, "response" = ${JSON.stringify(body ?? null)}::jsonb
        WHERE "account_id" = ${accountId}::uuid AND "key" = ${key}
      `,
    );
  }

  /** The request failed: let the caller retry with the same key. */
  async release(accountId: string, key: string): Promise<void> {
    await this.database.withPlatformConsoleTransaction((tx) =>
      tx.$executeRaw`
        UPDATE "platform_idempotency_keys" SET "status_code" = ${IN_PROGRESS}, "created_at" = now() - (${STALE_CLAIM_SECONDS + 1}::int * interval '1 second')
        WHERE "account_id" = ${accountId}::uuid AND "key" = ${key} AND "status_code" = ${IN_PROGRESS}
      `,
    );
  }
}
