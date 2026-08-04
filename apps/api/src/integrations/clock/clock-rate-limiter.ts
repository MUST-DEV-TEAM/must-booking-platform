import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

// Source brief section 10: Clock documents 5 req/s per API user; the
// recommended *operational* ceiling (a safety margin below Clock's own
// limit) is 4 req/s. Same Lua INCR+EXPIRE fixed-window pattern as
// apps/api/src/auth/signup-rate-limiter.service.ts, just a 1-second window
// instead of an hour, and keyed by Clock API user instead of IP/email.
export const CLOCK_RATE_LIMIT_PER_SECOND = 4;
const WINDOW_SECONDS = 1;

export interface ClockRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class ClockRateLimiterService implements OnModuleDestroy {
  private readonly redis: RedisClientType;
  private connectPromise: Promise<RedisClientType> | undefined;

  constructor() {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async consume(apiUser: string): Promise<ClockRateLimitResult> {
    const response = (await this.client()).eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return { count, redis.call('TTL', KEYS[1]) }`,
      {
        keys: [`rate-limit:clock:${this.hash(apiUser)}`],
        arguments: [String(WINDOW_SECONDS)],
      },
    ) as Promise<[number, number]>;
    const [count, ttl] = await response;

    return {
      allowed: count <= CLOCK_RATE_LIMIT_PER_SECOND,
      retryAfterSeconds: Math.max(1, ttl),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  private async client(): Promise<RedisClientType> {
    if (!this.redis.isOpen) {
      this.connectPromise ??= this.redis.connect();
      await this.connectPromise;
    }
    return this.redis;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
