import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

import type { PublicRateLimitOptions } from './public-rate-limit.decorator';

export type PublicRateLimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Redis-backed fixed-window limiter for the public guest and callback surface. */
@Injectable()
export class PublicRateLimiterService implements OnModuleDestroy {
  private readonly redis: RedisClientType;
  private connectPromise: Promise<RedisClientType> | undefined;

  constructor() {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async consume(
    options: PublicRateLimitOptions,
    clientIp: string,
    tenantId?: string,
    propertyId?: string,
  ): Promise<PublicRateLimitResult> {
    const keyParts = [options.name, clientIp, tenantId ?? '', propertyId ?? ''];
    const key = `rate-limit:public:${options.name}:${this.hash(keyParts.join('|'))}`;
    const response = (await this.client()).eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return { count, redis.call('TTL', KEYS[1]) }`,
      { keys: [key], arguments: [String(options.windowSeconds)] },
    ) as Promise<[number, number]>;
    const [count, ttl] = await response;
    return {
      allowed: count <= options.maximum,
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
