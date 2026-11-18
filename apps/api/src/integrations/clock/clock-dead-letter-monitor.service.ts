import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';

import { AlertEmailService } from '../../mail/alert-email.service';
import { ClockQueueService } from './clock-queue.service';

const QUEUE = 'clock.dead-letter-monitor';
const SCHEDULER = 'clock-dead-letter-monitor-scheduler';
const JOB = 'check-clock-dead-letter';
const INTERVAL_MS = 10 * 60_000;
/** The count the system owner was last told about. */
export const DEAD_LETTER_ALERTED_KEY = 'clock:dead-letter:alerted-count';

/**
 * Watches the Clock dead-letter queue (Milestone 39 task 8). When the count grows past what the system owner
 * was last told, one platform alert email goes out for the whole growth, not one per job. When the count falls
 * (jobs were cleaned up) the remembered number falls with it, so the next growth is reported again.
 */
@Injectable()
export class ClockDeadLetterMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClockDeadLetterMonitorService.name);
  private connection: ConnectionOptions | null = null;
  private redis: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(ClockQueueService) private readonly queues: ClockQueueService,
    @Inject(AlertEmailService) private readonly alerts: AlertEmailService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Tests call check() directly; a background check would email about the test queues.
    if (process.env.NODE_ENV === 'test') return;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;
    this.connection = this.bullConnection(redisUrl);
    this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, () => this.check(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) => {
      this.logger.error('Clock dead-letter monitor worker error.', error.stack);
    });
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { every: INTERVAL_MS },
      { name: JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.redis?.disconnect();
  }

  async check(): Promise<{ count: number; alerted: boolean }> {
    const redis = this.redis;
    if (!redis) return { count: 0, alerted: false };
    const stats = await this.queues.deadLetterStats();
    const told = Number((await redis.get(DEAD_LETTER_ALERTED_KEY)) ?? '0') || 0;
    let alerted = false;
    if (stats.count > told) {
      const age =
        stats.oldestAgeSeconds === null ? '' : `, oldest ${formatAge(stats.oldestAgeSeconds)} old`;
      alerted = await this.alerts.sendPlatformNotice(
        {
          tenantId: '',
          propertyId: null,
          tenantName: null,
          propertyName: null,
          kind: 'clock_dead_letter',
          itemId: String(stats.count),
          reference: null,
          detail: `${stats.count} jobs waiting${age} (was ${told}). Look at them in the platform console.`,
          occurredAt: new Date(),
        },
        `clock-dead-letter/${stats.count}`,
      );
    }
    // Remember the new number once it was reported, or whenever it fell; keep trying while a growth is unreported.
    if (alerted || stats.count < told)
      await redis.set(DEAD_LETTER_ALERTED_KEY, String(stats.count));
    return { count: stats.count, alerted };
  }

  /** The count the system owner was last told about (0 when none). */
  async alertedCount(): Promise<number> {
    return Number((await this.redis?.get(DEAD_LETTER_ALERTED_KEY)) ?? '0') || 0;
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

export function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} days`;
}
