import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { reportOperationalFailure } from '../../observability/error-tracking';
import { TenantDatabaseService } from '../../tenancy/tenant-database.service';
import { ManualReviewService } from '../manual-review.service';
import { ClockBookingService } from './clock-booking.service';

const QUEUE = 'clock-refund-mirror-check';
const JOB = 'check-clock-refunds';
const SCHEDULER = 'clock-refund-mirror-check-nightly';
/** 03:45 UTC: after the nightly PokPay check (03:15). */
const NIGHTLY = '45 3 * * *';
const LOOK_BACK_DAYS = 45;
const MAXIMUM_REFUNDS = 100;
const PAUSE_BETWEEN_REFUNDS_MS = 500;

type Candidate = {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  refundExternalPaymentId: string;
  amount: string;
  currency: string;
};

export type RefundMirrorCheckSummary = {
  checked: number;
  missingInClock: number;
  unreadable: number;
};

/**
 * The nightly check that every gateway refund reached Clock. It only READS Clock: for each recent refund it looks
 * for the negative payment MUST posts on the guest's original deposit folio. A refund Clock does not have becomes
 * one manual-review item on the booking (raised once); nothing is ever written to Clock or changed here.
 */
@Injectable()
export class ClockRefundMirrorCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClockRefundMirrorCheckService.name);
  private connection: ConnectionOptions | undefined;
  private queue: Queue | undefined;
  private worker: Worker | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(ClockBookingService) private readonly clock: ClockBookingService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.connection = this.bullConnection(process.env.REDIS_URL!);
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, () => this.run(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.error('Clock refund check worker error.', error.stack),
    );
    await this.queue.upsertJobScheduler(
      SCHEDULER,
      { pattern: NIGHTLY, tz: 'UTC' },
      {
        name: JOB,
        data: {},
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: 30,
        },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async run(): Promise<RefundMirrorCheckSummary> {
    const candidates = await this.database.$queryRaw<Candidate[]>`
      SELECT * FROM "payment_refunds_for_clock_check"(${LOOK_BACK_DAYS}::integer, ${MAXIMUM_REFUNDS}::integer)`;
    const summary: RefundMirrorCheckSummary = { checked: 0, missingInClock: 0, unreadable: 0 };
    for (const candidate of candidates) {
      try {
        const context = { tenantId: candidate.tenantId, propertyId: candidate.propertyId };
        const status = await this.clock.refundMirrorStatus(
          context,
          candidate.bookingId,
          candidate.refundExternalPaymentId,
        );
        if (!status.ok) {
          summary.unreadable += 1;
        } else {
          summary.checked += 1;
          if (status.value === 'MISSING') {
            await this.manualReview.record({
              ...context,
              category: 'PAYMENT_BOOKING_MISMATCH',
              referenceType: 'booking',
              referenceId: candidate.bookingId,
              message: `A refund recorded here was not found in Clock: ${candidate.amount} ${candidate.currency}. The guest was refunded, but the deposit in Clock may still show the payment. Post the negative payment on the original deposit folio in Clock, and do the Deposit Adjustment if your hotel needs it.`,
              context: {
                refundExternalPaymentId: candidate.refundExternalPaymentId,
                amount: candidate.amount,
                currency: candidate.currency,
              },
            });
            summary.missingInClock += 1;
          }
        }
      } catch (error) {
        summary.unreadable += 1;
        this.logger.error(
          `Could not check the Clock refund for booking ${candidate.bookingId}.`,
          (error as Error).stack,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_REFUNDS_MS));
    }
    this.logger.log(`Clock refund check: ${JSON.stringify(summary)}`);
    if (candidates.length >= 3 && summary.checked === 0)
      reportOperationalFailure(new Error('The nightly Clock refund check could not read Clock.'), {
        component: 'clock',
        operation: 'refund-mirror-check',
      });
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
