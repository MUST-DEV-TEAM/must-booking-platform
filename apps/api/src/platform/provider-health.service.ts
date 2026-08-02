import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createClient, type RedisClientType } from 'redis';

import { PokPayPaymentProvider } from '../payments/pokpay-payment.provider';
import { StripePaymentProvider } from '../payments/stripe-payment.provider';

const PROVIDER_HEALTH_QUEUE = 'platform-provider-health';
const PROVIDER_HEALTH_SCHEDULER = 'platform-provider-health-scheduler';
const PROVIDER_HEALTH_JOB = 'check-provider-health';
const PROVIDER_HEALTH_INTERVAL_MS = 5 * 60_000;
const CACHE_PREFIX = 'platform:provider-health:';

type ProviderName = 'stripe' | 'pokpay';
type CachedHealth = { ok: boolean; checkedAt: string; error?: string };
export type ProviderHealth =
  | { status: 'checking'; ok: null; checkedAt: null }
  | ({ status: 'healthy' | 'unhealthy' } & CachedHealth);

@Injectable()
export class ProviderHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderHealthService.name);
  private readonly redis = createClient({ url: process.env.REDIS_URL });
  private readonly connection = this.bullConnection(process.env.REDIS_URL!);
  private readonly queue = new Queue(PROVIDER_HEALTH_QUEUE, { connection: this.connection });
  private worker: Worker | undefined;
  private redisConnectPromise: Promise<RedisClientType> | undefined;

  constructor(
    private readonly stripe: StripePaymentProvider,
    private readonly pokpay: PokPayPaymentProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(PROVIDER_HEALTH_QUEUE, () => this.checkAll(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) => {
      this.logger.error('Provider health worker error.', error.stack);
    });
    await this.queue.upsertJobScheduler(
      PROVIDER_HEALTH_SCHEDULER,
      { every: PROVIDER_HEALTH_INTERVAL_MS },
      {
        name: PROVIDER_HEALTH_JOB,
        data: {},
        opts: { removeOnComplete: true, removeOnFail: 100 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
    if (this.redis.isOpen) await this.redis.quit();
  }

  async checkAll(): Promise<Record<ProviderName, CachedHealth>> {
    const [stripe, pokpay] = await Promise.all([
      this.checkProvider(() => this.stripe.checkHealth()),
      this.checkProvider(() => this.pokpay.checkHealth()),
    ]);
    await Promise.all([this.write('stripe', stripe), this.write('pokpay', pokpay)]);
    return { stripe, pokpay };
  }

  async getHealth(): Promise<Record<ProviderName, ProviderHealth>> {
    const [stripe, pokpay] = await Promise.all([this.read('stripe'), this.read('pokpay')]);
    return { stripe: this.toResponse(stripe), pokpay: this.toResponse(pokpay) };
  }

  private async checkProvider(
    check: () => Promise<{ ok: boolean; error?: string }>,
  ): Promise<CachedHealth> {
    try {
      const result = await check();
      return {
        ok: result.ok,
        checkedAt: new Date().toISOString(),
        ...(result.error ? { error: result.error } : {}),
      };
    } catch {
      return { ok: false, checkedAt: new Date().toISOString(), error: 'Health check failed.' };
    }
  }

  private async write(provider: ProviderName, value: CachedHealth): Promise<void> {
    const client = await this.redisClient();
    await client.set(`${CACHE_PREFIX}${provider}`, JSON.stringify(value));
  }

  private async read(provider: ProviderName): Promise<CachedHealth | null> {
    const client = await this.redisClient();
    const value = await client.get(`${CACHE_PREFIX}${provider}`);
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as Partial<CachedHealth>;
      return typeof parsed.ok === 'boolean' && typeof parsed.checkedAt === 'string'
        ? {
            ok: parsed.ok,
            checkedAt: parsed.checkedAt,
            ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
          }
        : null;
    } catch {
      return null;
    }
  }

  private toResponse(value: CachedHealth | null): ProviderHealth {
    if (!value) return { status: 'checking', ok: null, checkedAt: null };
    return { ...value, status: value.ok ? 'healthy' : 'unhealthy' };
  }

  private async redisClient(): Promise<RedisClientType> {
    if (!this.redis.isOpen) {
      this.redisConnectPromise ??= this.redis.connect();
      await this.redisConnectPromise;
    }
    return this.redis;
  }

  private bullConnection(redisUrl: string): ConnectionOptions {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: url.password || undefined,
      tls: url.protocol === 'rediss:' ? {} : undefined,
      maxRetriesPerRequest: null,
    };
  }
}
