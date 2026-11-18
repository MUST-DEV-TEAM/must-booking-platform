import { Controller, Get, OnModuleDestroy, Res } from '@nestjs/common';
import type { HealthStatus } from '@must/shared-types';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { Public } from '../tenancy/tenant-context.decorator';

export const READINESS_TIMEOUT_MS = 2_000;

export type ReadinessPart = 'database' | 'redis';

export type ReadinessStatus = { status: 'ok' } | { status: 'unavailable'; failed: ReadinessPart[] };

@Public()
@Controller('health')
export class HealthController implements OnModuleDestroy {
  private redis: RedisClientType | undefined;
  private connectPromise: Promise<unknown> | undefined;

  constructor(private readonly database: TenantDatabaseService) {}

  /** Cheap liveness answer: the process is up and serving requests. */
  @Get()
  getHealth(): HealthStatus {
    return { status: 'ok' };
  }

  /** Readiness: the app pool can run a query and Redis answers a PING. Names failed parts only. */
  @Get('ready')
  async getReadiness(
    @Res({ passthrough: true }) response: { status(code: number): unknown },
  ): Promise<ReadinessStatus> {
    const checks: Array<[ReadinessPart, () => Promise<unknown>]> = [
      ['database', () => this.database.$queryRaw`SELECT 1`],
      ['redis', () => this.pingRedis()],
    ];
    const results = await Promise.allSettled(
      checks.map(([, check]) => withTimeout(check, READINESS_TIMEOUT_MS)),
    );
    const failed = checks.flatMap(([part], index) =>
      results[index].status === 'rejected' ? [part] : [],
    );

    if (failed.length === 0) return { status: 'ok' };

    response.status(503);
    return { status: 'unavailable', failed };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.isOpen) await this.redis.quit().catch(() => undefined);
  }

  private async pingRedis(): Promise<unknown> {
    if (!this.redis) {
      // No offline queue: while Redis is down a PING fails at once instead of piling up.
      this.redis = createClient({ url: process.env.REDIS_URL, disableOfflineQueue: true });
      // Without a listener a connection error would crash the process.
      this.redis.on('error', () => undefined);
    }
    const client = this.redis;
    if (!client.isOpen) {
      this.connectPromise ??= client.connect().catch(() => {
        this.connectPromise = undefined;
      });
      await this.connectPromise;
    }

    return client.ping();
  }
}

function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    operation().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('failed'));
      },
    );
  });
}
