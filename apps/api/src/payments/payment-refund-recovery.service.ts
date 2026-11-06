import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { reportOperationalFailure } from '../observability/error-tracking';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentRefundService, type StuckRefundOperation } from './payment-refund.service';

const QUEUE = 'payment-refund-recovery';
const JOB = 'recover-stuck-refunds';
const SCHEDULER = 'payment-refund-recovery-every-5-minutes';
const EVERY_MS = 5 * 60 * 1000;
/** A refund still running is left alone; only attempts older than this are looked at. */
const MINIMUM_AGE_MINUTES = 5;
const MAXIMUM_PER_RUN = 50;
/** A person is told about an attempt that is still unresolved after this long. */
const ALERT_AFTER_MINUTES = 10;
const PAUSE_BETWEEN_ATTEMPTS_MS = 150;

export type RefundRecoverySummary = {
  found: number;
  recovered: number;
  nothingToDo: number;
  needsPerson: number;
  errors: number;
};

/**
 * Every 5 minutes, finishes refunds the payment provider already paid but this system never recorded. For each
 * stuck attempt it asks the provider what happened (it never sends a refund), records the missing REFUND row,
 * tells Clock and closes the attempt. Anything it cannot prove is left for a person.
 */
@Injectable()
export class PaymentRefundRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentRefundRecoveryService.name);
  private connection: ConnectionOptions | undefined;
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = this.bullConnection(process.env.REDIS_URL!);
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, () => this.run(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.error('Refund recovery worker error.', error.stack),
    );
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { every: EVERY_MS },
      {
        name: JOB,
        data: {},
        opts: { attempts: 1, removeOnComplete: true, removeOnFail: 30 },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async run(): Promise<RefundRecoverySummary> {
    const stuck = await this.database.$queryRaw<StuckRefundOperation[]>`
      SELECT * FROM "payment_stuck_refund_operations"(${MINIMUM_AGE_MINUTES}::integer, ${MAXIMUM_PER_RUN}::integer)`;
    const summary: RefundRecoverySummary = {
      found: stuck.length,
      recovered: 0,
      nothingToDo: 0,
      needsPerson: 0,
      errors: 0,
    };
    for (const operation of stuck) {
      try {
        const outcome = await this.refunds.recoverStuckRefund(operation);
        if (outcome === 'RECOVERED') summary.recovered += 1;
        else if (outcome === 'NOTHING_TO_DO') summary.nothingToDo += 1;
        else {
          summary.needsPerson += 1;
          if (operation.ageMinutes >= ALERT_AFTER_MINUTES)
            await this.refunds.raiseStuckRefundAlert(operation);
        }
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          `Could not recover refund attempt ${operation.operationId} for booking ${operation.bookingId}.`,
          (error as Error).stack,
        );
        reportOperationalFailure(error, {
          component: 'payments',
          operation: 'refund-recovery',
          tenantId: operation.tenantId,
          propertyId: operation.propertyId,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_ATTEMPTS_MS));
    }
    if (summary.found > 0) this.logger.log(`Refund recovery: ${JSON.stringify(summary)}`);
    return summary;
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
