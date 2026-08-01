import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { LocalPmsProvider } from '../booking/local-pms.provider';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PokPayPaymentService } from './pokpay-payment.service';

const PAYMENT_EXPIRY_QUEUE = 'payment-expiry';
const PAYMENT_EXPIRY_JOB = 'sweep-payment-pending';
const PAYMENT_EXPIRY_SCHEDULER = 'payment-pending-every-minute';
const PAYMENT_PENDING_TIMEOUT_MINUTES = 30;
const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 100;

type ExpiryCandidate = {
  bookingId: string;
  tenantId: string;
  propertyId: string;
};

@Injectable()
export class PaymentExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentExpiryService.name);
  private readonly connection = this.bullConnection(process.env.REDIS_URL!);
  private readonly queue = new Queue(PAYMENT_EXPIRY_QUEUE, { connection: this.connection });
  private worker: Worker | undefined;

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(LocalPmsProvider) private readonly bookings: LocalPmsProvider,
    @Inject(PokPayPaymentService) private readonly pokpay: PokPayPaymentService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(PAYMENT_EXPIRY_QUEUE, () => this.sweep(), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) => {
      this.logger.error('Payment expiry worker error.', error.stack);
    });
    await this.queue.upsertJobScheduler(
      PAYMENT_EXPIRY_SCHEDULER,
      { every: SWEEP_INTERVAL_MS },
      {
        name: PAYMENT_EXPIRY_JOB,
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }

  async sweep(now = new Date()): Promise<{ expired: number }> {
    await this.pokpay.pollPendingOrders();
    const cutoffAt = new Date(now.getTime() - PAYMENT_PENDING_TIMEOUT_MINUTES * 60_000);
    const candidates = await this.database.$queryRaw<ExpiryCandidate[]>`
      SELECT "bookingId", "tenantId", "propertyId"
      FROM "payment_pending_expiry_candidates"(
        ${cutoffAt}::timestamptz,
        ${SWEEP_BATCH_SIZE}::integer
      )
    `;
    let expired = 0;
    for (const candidate of candidates) {
      const didExpire = await this.database.withTenantTransaction(
        { tenantId: candidate.tenantId, propertyId: candidate.propertyId },
        (tx) =>
          this.bookings.expirePaymentPending(
            tx,
            { tenantId: candidate.tenantId, propertyId: candidate.propertyId },
            candidate.bookingId,
            cutoffAt,
          ),
      );
      if (didExpire) expired += 1;
    }
    return { expired };
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
