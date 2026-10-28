import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { reportOperationalFailure } from '../observability/error-tracking';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PokPayPaymentProvider } from './pokpay-payment.provider';
import {
  compareWithProvider,
  type ProviderOrder,
  type RecordedOrder,
} from './pokpay-reconciliation';

const QUEUE = 'pokpay-reconciliation';
const JOB = 'reconcile-pokpay';
const SCHEDULER = 'pokpay-reconciliation-nightly';
/** 03:15 UTC: after the hotels' night, before the first staff arrive. */
const NIGHTLY = '15 3 * * *';
/** How far back orders are checked: past normal refund windows, small enough to stay polite to PokPay. */
const LOOK_BACK_DAYS = 45;
const MAXIMUM_ORDERS = 500;
const PAUSE_BETWEEN_ORDERS_MS = 150;
const SOURCE = 'pokpay_reconciliation';

type Candidate = RecordedOrder & { tenantId: string; propertyId: string; bookingId: string };

export type ReconciliationSummary = {
  checked: number;
  /** PokPay could not be asked (credentials, outage); nothing is reported for these. */
  unreadable: number;
  differences: number;
  /** Earlier differences that no longer exist. */
  resolved: number;
};

/**
 * The nightly check of PokPay against our payment records. For every PokPay order of the last 45 days it asks
 * PokPay what it has and compares that with our records. A difference becomes a review item on the booking (the
 * owners are emailed by the existing alert emails); it never changes money by itself. A difference that no longer
 * exists is closed again by itself.
 */
@Injectable()
export class PokPayReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PokPayReconciliationService.name);
  private readonly connection = this.bullConnection(process.env.REDIS_URL!);
  private readonly queue = new Queue(QUEUE, { connection: this.connection });
  private worker: Worker | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PokPayPaymentProvider) private readonly pokpay: PokPayPaymentProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(QUEUE, () => this.run(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.error('PokPay reconciliation worker error.', error.stack),
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
    await this.queue.close();
  }

  async run(): Promise<ReconciliationSummary> {
    const candidates = await this.database.$queryRaw<
      Array<{
        tenantId: string;
        propertyId: string;
        bookingId: string;
        orderId: string;
        chargeStatus: string | null;
        chargeAmount: string | null;
        chargeCurrency: string | null;
        refundedAmount: string;
        refundCurrencies: string[];
        refundCount: number;
      }>
    >`SELECT * FROM "payment_pokpay_reconciliation_candidates"(${LOOK_BACK_DAYS}::integer, ${MAXIMUM_ORDERS}::integer)`;

    const summary: ReconciliationSummary = {
      checked: 0,
      unreadable: 0,
      differences: 0,
      resolved: 0,
    };
    for (const candidate of candidates) {
      const order = await this.read(candidate);
      if (!order) {
        summary.unreadable += 1;
        continue;
      }
      summary.checked += 1;
      try {
        const outcome = await this.settle(candidate, compareWithProvider(candidate, order));
        summary.differences += outcome.raised;
        summary.resolved += outcome.resolved;
      } catch (error) {
        this.logger.error(
          `Could not record the result for order ${candidate.orderId}.`,
          (error as Error).stack,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_ORDERS_MS));
    }
    this.logger.log(`PokPay reconciliation: ${JSON.stringify(summary)}`);
    if (candidates.length >= 3 && summary.checked === 0)
      reportOperationalFailure(
        new Error('The nightly PokPay check could not read a single order.'),
        {
          component: 'payments',
          operation: 'pokpay-reconciliation',
        },
      );
    return summary;
  }

  private async read(candidate: Candidate): Promise<ProviderOrder | null> {
    try {
      const payment = await this.pokpay.getPayment(
        { tenantId: candidate.tenantId, propertyId: candidate.propertyId },
        candidate.orderId,
      );
      return payment
        ? {
            status: payment.status,
            amount: payment.amount.amount,
            currency: payment.amount.currency,
          }
        : null;
    } catch {
      return null;
    }
  }

  /** Records a difference once, and closes earlier differences of this order that are gone. */
  private async settle(
    candidate: Candidate,
    difference: { kind: string; message: string } | null,
  ): Promise<{ raised: number; resolved: number }> {
    const scope = { tenantId: candidate.tenantId, propertyId: candidate.propertyId };
    return this.database.withTenantTransaction(scope, async (tx) => {
      const kind = difference?.kind ?? null;
      const resolved = await tx.$executeRaw`
        UPDATE manual_review_items SET status = 'RESOLVED', resolved_at = now(), updated_at = now()
        WHERE tenant_id = ${candidate.tenantId}::uuid AND property_id = ${candidate.propertyId}::uuid
          AND category = 'PAYMENT_BOOKING_MISMATCH' AND status = 'OPEN'
          AND context->>'source' = ${SOURCE} AND context->>'orderId' = ${candidate.orderId}
          AND (${kind}::text IS NULL OR context->>'kind' <> ${kind}::text)`;
      if (!difference) return { raised: 0, resolved };
      const raised = await tx.$executeRaw`
        INSERT INTO manual_review_items (tenant_id, property_id, category, reference_type, reference_id, message, context)
        SELECT ${candidate.tenantId}::uuid, ${candidate.propertyId}::uuid, 'PAYMENT_BOOKING_MISMATCH'::"ManualReviewCategory",
          'booking', ${candidate.bookingId}, ${difference.message},
          ${JSON.stringify({ source: SOURCE, orderId: candidate.orderId, kind: difference.kind })}::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM manual_review_items
          WHERE tenant_id = ${candidate.tenantId}::uuid AND property_id = ${candidate.propertyId}::uuid
            AND category = 'PAYMENT_BOOKING_MISMATCH' AND status = 'OPEN' AND reference_id = ${candidate.bookingId}
            AND context->>'source' = ${SOURCE} AND context->>'orderId' = ${candidate.orderId}
            AND context->>'kind' = ${difference.kind})`;
      return { raised, resolved };
    });
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
