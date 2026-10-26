import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { isClockBackgroundWork } from './clock-request-context';
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
      `local count = tonumber(redis.call('GET', KEYS[1]) or '0')
       local background = tonumber(redis.call('GET', KEYS[2]) or '0')
       if count >= tonumber(ARGV[2]) or (ARGV[3] == '1' and background >= tonumber(ARGV[4])) then
         return { 0, math.max(1, redis.call('TTL', KEYS[1])) }
       end
       count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       if ARGV[3] == '1' then
         background = redis.call('INCR', KEYS[2])
         redis.call('EXPIRE', KEYS[2], math.max(1, redis.call('TTL', KEYS[1])))
       end
       return { 1, redis.call('TTL', KEYS[1]) }`,
      {
        keys: [
          `rate-limit:clock:${this.hash(apiUser)}`,
          `rate-limit:clock:${this.hash(apiUser)}:background`,
        ],
        arguments: [
          String(WINDOW_SECONDS),
          String(CLOCK_RATE_LIMIT_PER_SECOND),
          isClockBackgroundWork() ? '1' : '0',
          '2',
        ],
      },
    ) as Promise<[number, number]>;
    const [allowed, ttl] = await response;

    return {
      allowed: allowed === 1,
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
