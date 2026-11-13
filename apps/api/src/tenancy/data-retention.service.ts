import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { TenantDatabaseService } from './tenant-database.service';

type Scope = { tenantId: string; propertyId: string };

/**
 * One retention rule. `where` is a fixed SQL condition (never user input) that selects the rows the rule
 * would act on, inside one hotel. Periods: ADR-0042 (owner decision D3, Milestone 38).
 */
export interface RetentionRule {
  name: string;
  table: string;
  action: 'scrub-raw-payload' | 'delete';
  where: Prisma.Sql;
}

/**
 * Idempotency receipts: rows that only hold a request hash and the response, kept so a repeated request gets
 * the same answer. Clients repeat within minutes; 30 days is a wide margin. Not listed on purpose:
 * integration_operations and venue_deposit_* (money evidence), audit_export_operations and
 * notification_operations (they already expire sooner in their own services), platform_idempotency_keys
 * (platform billing, outside hotel scope).
 */
export const RECEIPT_TABLES = [
  'email_workspace_operations',
  'guest_capture_operations',
  'inventory_block_operations',
  'inventory_restriction_operations',
  'inventory_stock_operations',
  'pricing_operations',
  'report_view_operations',
] as const;

export const RETENTION_RULES: RetentionRule[] = [
  {
    // Keep the row: its (connection_id, event_id) pair is what recognises a re-delivered webhook.
    name: 'provider_events.raw_payload after 90 days',
    table: 'provider_events',
    action: 'scrub-raw-payload',
    where: Prisma.sql`created_at < now() - interval '90 days' AND status IN ('HYDRATED','IGNORED') AND raw_payload <> '{}'::jsonb`,
  },
  ...RECEIPT_TABLES.map((table): RetentionRule => ({
    name: `${table} after 30 days`,
    table,
    action: 'delete',
    where: Prisma.sql`created_at < now() - interval '30 days'`,
  })),
];

export type RetentionCount = { rule: string; action: RetentionRule['action']; matching: number };

/**
 * Nightly retention, Milestone 38 task 8. This first release only COUNTS what each rule would act on, per
 * hotel, and logs it for the owner to review. It changes no data. The release that acts on the rules comes
 * after that review, first on the test hotel only. Guest records and the audit log are never touched
 * (decisions D3 and D4).
 */
@Injectable()
export class DataRetentionService implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: IORedis | null = null;
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(@Inject(TenantDatabaseService) private readonly db: TenantDatabaseService) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !process.env.REDIS_URL) return;
    this.connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue('data.retention', { connection: this.connection });
    this.worker = new Worker(
      'data.retention',
      async (job) => {
        if (job.name === 'sweep') await this.sweep();
        else this.report(job.data as Scope, await this.count(job.data as Scope));
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('error', () => this.logger.error('Data retention worker failed.'));
    await this.queue.upsertJobScheduler(
      'data-retention-nightly',
      // 02:41 UTC: after the notification retention (02:17), before the nightly backup (03:15).
      { pattern: '41 2 * * *', tz: 'UTC' },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async sweep() {
    const properties = await this.db.$queryRaw<
      Scope[]
    >`SELECT "tenantId","propertyId" FROM scheduled_email_properties()`;
    for (const scope of properties) {
      const day = new Date().toISOString().slice(0, 10);
      if (this.queue)
        await this.queue.add(
          'count',
          { tenantId: scope.tenantId, propertyId: scope.propertyId },
          {
            jobId: `${scope.tenantId}-${scope.propertyId}-${day}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
      else this.report(scope, await this.count(scope));
    }
  }

  /** How many rows each rule would act on in one hotel. Read-only, under the hotel's row-level security. */
  async count(scope: Scope): Promise<RetentionCount[]> {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const counts: RetentionCount[] = [];
      for (const rule of RETENTION_RULES) {
        const [row] = await tx.$queryRaw<Array<{ n: number }>>(
          Prisma.sql`SELECT count(*)::int AS n FROM ${Prisma.raw(rule.table)} WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid AND ${rule.where}`,
        );
        counts.push({ rule: rule.name, action: rule.action, matching: row?.n ?? 0 });
      }
      return counts;
    });
  }

  private report(scope: Scope, counts: RetentionCount[]) {
    const total = counts.reduce((sum, c) => sum + c.matching, 0);
    this.logger.log(
      `Data retention dry run (no data changed): ${JSON.stringify({ ...scope, total, counts })}`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
