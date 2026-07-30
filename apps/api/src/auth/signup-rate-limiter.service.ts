import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';

export const SIGNUP_IP_LIMIT = 10;
export const SIGNUP_EMAIL_LIMIT = 3;
const WINDOW_SECONDS = 3_600;

export type SignupRateLimitResult = { allowed: boolean; retryAfterSeconds: number };

@Injectable()
export class SignupRateLimiterService implements OnModuleDestroy {
  private readonly redis: RedisClientType;
  private connectPromise: Promise<RedisClientType> | undefined;

  constructor() {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async consume(ip: string, email: string): Promise<SignupRateLimitResult> {
    const [ipLimit, emailLimit] = await Promise.all([
      this.increment('ip', ip, SIGNUP_IP_LIMIT),
      this.increment('email', email.trim().toLowerCase(), SIGNUP_EMAIL_LIMIT),
    ]);
    const exceeded = [ipLimit, emailLimit].find((limit) => !limit.allowed);

    return exceeded ?? { allowed: true, retryAfterSeconds: 0 };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  private async increment(
    dimension: 'ip' | 'email',
    value: string,
    maximum: number,
  ): Promise<SignupRateLimitResult> {
    const response = (await this.client()).eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       return { count, redis.call('TTL', KEYS[1]) }`,
      {
        keys: [`rate-limit:signup:${dimension}:${this.hash(value)}`],
        arguments: [String(WINDOW_SECONDS)],
      },
    ) as Promise<[number, number]>;
    const [count, ttl] = await response;

    return {
      allowed: count <= maximum,
      retryAfterSeconds: Math.max(1, ttl),
    };
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
