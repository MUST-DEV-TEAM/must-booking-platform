import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { reportOperationalFailure } from '../../observability/error-tracking';

// Same shape as ProviderHealthService (apps/api/src/platform/provider-health.service.ts)
// — its own queue/scheduler, not sharing a Clock queue, so this has no
// dependency on (or collision risk with) whatever else lands in
// ClockWorkerService tonight. Clock certification gap Task B,
// docs/CLOCK_CERTIFICATION_GAPS_PLAN.md.
const WEBHOOK_HEALTH_QUEUE = 'clock.webhook-health';
const WEBHOOK_HEALTH_SCHEDULER = 'clock-webhook-health-scheduler';
const WEBHOOK_HEALTH_JOB = 'check-webhook-health';
const WEBHOOK_HEALTH_INTERVAL_MS = 6 * 60 * 60_000; // every 6 hours
// Clock traffic is guest/staff-activity-driven, not constant — long enough
// that a quiet property overnight doesn't false-positive, short enough that
// a genuinely broken subscription is caught same-day, not a week later.
const STALE_THRESHOLD_MS = 48 * 60 * 60_000;

interface ConnectionHealthRow {
  id: string;
  tenantId: string;
  lastWebhookReceivedAt: Date | null;
  createdAt: Date;
}

export interface WebhookHealthCheckResult {
  checked: number;
  stale: number;
}

@Injectable()
export class ClockWebhookHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClockWebhookHealthService.name);
  private readonly connection = this.bullConnection(process.env.REDIS_URL!);
  private readonly queue = new Queue(WEBHOOK_HEALTH_QUEUE, { connection: this.connection });
  private worker: Worker | undefined;

  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(WEBHOOK_HEALTH_QUEUE, () => this.checkAll(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) => {
      this.logger.error('Clock webhook health worker error.', error.stack);
    });
    // Idempotent across restarts — BullMQ dedupes by scheduler id, so this
    // is safe to call unconditionally on every module init.
    await this.queue.upsertJobScheduler(
      WEBHOOK_HEALTH_SCHEDULER,
      { every: WEBHOOK_HEALTH_INTERVAL_MS },
      { name: WEBHOOK_HEALTH_JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  /**
   * Every enabled Clock connection, checked cross-tenant under the platform-
   * admin RLS context (this is a system health job, not a request scoped to
   * one tenant). A connection that's never received a webhook yet is judged
   * against its own createdAt, not treated as already stale — a brand-new
   * connection hasn't had a chance to receive anything.
   */
  async checkAll(): Promise<WebhookHealthCheckResult> {
    const rows = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRawUnsafe<ConnectionHealthRow[]>(
          `SELECT DISTINCT c.id, c.tenant_id AS "tenantId",
             c.last_webhook_received_at AS "lastWebhookReceivedAt", c.created_at AS "createdAt"
           FROM integration_connections c
           JOIN property_integration_connections pic
             ON pic.tenant_id = c.tenant_id AND pic.connection_id = c.id
           WHERE c.kind = 'PMS' AND c.provider = 'CLOCK_PMS' AND c.status = 'CONNECTED'
             AND pic.enabled = true`,
        ),
    );

    const now = Date.now();
    let stale = 0;
    for (const row of rows) {
      const reference = row.lastWebhookReceivedAt ?? row.createdAt;
      if (now - reference.getTime() <= STALE_THRESHOLD_MS) continue;
      stale += 1;
      reportOperationalFailure(
        new Error(
          `Clock connection ${row.id} has not received a webhook in over 48 hours (last seen: ${
            row.lastWebhookReceivedAt?.toISOString() ?? 'never'
          }).`,
        ),
        { component: 'clock', operation: 'webhook-health-check', tenantId: row.tenantId },
      );
    }
    this.logger.log(`Clock webhook health check: ${rows.length} connection(s), ${stale} stale.`);
    return { checked: rows.length, stale };
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
