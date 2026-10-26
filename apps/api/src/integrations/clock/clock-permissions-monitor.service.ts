import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { reportOperationalFailure } from '../../observability/error-tracking';
import { NotificationsService } from '../../tenancy/notifications.service';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { CLOCK_FEATURES } from './clock-feature-rights';
import { ClockPermissionsService, type ClockPermissionReport } from './clock-permissions.service';

const QUEUE = 'clock.permissions-monitor';
const SCHEDULER = 'clock-permissions-monitor-scheduler';
const JOB = 'check-clock-permissions';
// Hotels do change user rights in Clock, so each connected hotel is re-checked once a day.
const INTERVAL_MS = 24 * 60 * 60_000;
const BATCH = 12;

/**
 * Re-checks every connected Clock hotel once a day with the same harmless tests as the dashboard
 * button, and tells the hotel's owners (an in-app alert) when a right a feature depends on has newly
 * gone missing. A first check only alerts for features a hotel cannot run without.
 */
@Injectable()
export class ClockPermissionsMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClockPermissionsMonitorService.name);
  private readonly connection = this.bullConnection(process.env.REDIS_URL!);
  private readonly queue = new Queue(QUEUE, { connection: this.connection });
  private worker: Worker | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(ClockPermissionsService) private readonly permissions: ClockPermissionsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(QUEUE, () => this.checkAll(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) => {
      this.logger.error('Clock permissions monitor worker error.', error.stack);
    });
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { every: INTERVAL_MS },
      { name: JOB, data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  /** Every hotel with an enabled Clock connection, one at a time so Clock's request limit is respected. */
  async checkAll(): Promise<{ checked: number; alerted: number }> {
    // Row-level security hides connections from the platform role, so a narrow database function lists them.
    const rows = await this.database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<
          Array<{ tenantId: string; propertyId: string }>
        >`SELECT * FROM clock_connected_properties()`,
    );
    let alerted = 0;
    for (const row of rows) {
      try {
        if (await this.checkProperty(row)) alerted += 1;
      } catch (error) {
        reportOperationalFailure(error instanceof Error ? error : new Error(String(error)), {
          component: 'clock',
          operation: 'permissions-monitor',
          tenantId: row.tenantId,
          propertyId: row.propertyId,
        });
      }
    }
    this.logger.log(`Clock permissions check: ${rows.length} hotel(s), ${alerted} alerted.`);
    return { checked: rows.length, alerted };
  }

  /** Re-checks one hotel; returns true when its owners were alerted. */
  async checkProperty(scope: { tenantId: string; propertyId: string }): Promise<boolean> {
    const before = await this.permissions.report(scope);
    const ids = before.entries.filter((entry) => entry.probeable).map((entry) => entry.id);
    let after = before;
    for (let index = 0; index < ids.length; index += BATCH)
      after = await this.permissions.check(scope, null, ids.slice(index, index + BATCH));

    const firstCheck = before.checkedAt === null;
    const now = blockedRights(after, firstCheck);
    const earlier = blockedRights(before, firstCheck);
    const fresh = [...now.keys()].filter((right) => !earlier.has(right));
    if (fresh.length === 0) return false;

    const features = Array.from(new Set(fresh.flatMap((right) => now.get(right) ?? [])));
    await this.notifications.record(scope.tenantId, scope.propertyId, 'CLOCK_RIGHT_MISSING', {
      rights: fresh,
      features,
    });
    this.logger.warn(
      `Clock rights newly missing for property ${scope.propertyId}: ${fresh.join(', ')}`,
    );
    return true;
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

/** Rights that a MUST feature depends on and Clock refuses, with the features each one blocks. */
export function blockedRights(
  report: ClockPermissionReport,
  requiredOnly: boolean,
): Map<string, string[]> {
  const byId = new Map(report.entries.map((entry) => [entry.id, entry]));
  const blocked = new Map<string, string[]>();
  for (const feature of CLOCK_FEATURES) {
    if (requiredOnly && !feature.required) continue;
    for (const id of feature.needs) {
      const entry = byId.get(id);
      if (entry?.status !== 'missing') continue;
      const right = entry.right ?? entry.expectedRight ?? entry.name;
      blocked.set(right, [...(blocked.get(right) ?? []), feature.label]);
    }
  }
  return blocked;
}
