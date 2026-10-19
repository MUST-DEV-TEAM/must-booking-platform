import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { TenantDatabaseService } from './tenant-database.service';
import { NotificationInboxService } from './notification-inbox.service';
type Scope = { tenantId: string; propertyId: string };
/** Nightly inbox expiry only; source bookings, payments and reviews are retained. */
@Injectable()
export class NotificationRetentionService implements OnModuleInit, OnModuleDestroy {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: IORedis | null = null;
  private readonly logger = new Logger(NotificationRetentionService.name);
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(NotificationInboxService) private readonly inbox: NotificationInboxService,
  ) {}
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !process.env.REDIS_URL) return;
    this.connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue('notifications.retention', { connection: this.connection });
    this.worker = new Worker(
      'notifications.retention',
      async (job) => {
        if (job.name === 'sweep') await this.sweep();
        else await this.inbox.cleanup(job.data as Scope);
      },
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('error', () => this.logger.error('Notification retention worker failed.'));
    await this.queue.upsertJobScheduler(
      'notifications-nightly',
      { pattern: '17 2 * * *', tz: 'UTC' },
      { name: 'sweep', data: {}, opts: { removeOnComplete: true, removeOnFail: 100 } },
    );
  }
  async sweep() {
    const properties = await this.db.$queryRaw<
      Scope[]
    >`SELECT "tenantId","propertyId" FROM scheduled_email_properties()`;
    for (const scope of properties)
      if (this.queue)
        await this.queue.add('cleanup', scope, {
          jobId: `${scope.tenantId}-${scope.propertyId}-${new Date().toISOString().slice(0, 10)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: 100,
        });
      else await this.inbox.cleanup(scope);
  }
  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }
}
