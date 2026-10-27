import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

import { LocalPmsProvider } from '../booking/local-pms.provider';
import { BookingUpdateNotificationService } from '../mail/booking-update-notification.service';
import { LifecycleEmailService } from '../mail/lifecycle-email.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentCollectionService } from './payment-collection.service';
import { PokPayPaymentService } from './pokpay-payment.service';

const PAYMENT_EXPIRY_QUEUE = 'payment-expiry';
const PAYMENT_EXPIRY_JOB = 'sweep-payment-pending';
const PAYMENT_EXPIRY_SCHEDULER = 'payment-pending-every-minute';
const PAYMENT_PENDING_TIMEOUT_MINUTES = 30;
const SWEEP_INTERVAL_MS = 60_000;
const SWEEP_BATCH_SIZE = 100;
/** An unpaid hold gets one "finish paying" email when this many minutes are left. */
const EXPIRING_WARNING_MINUTES = 10;

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
    @Inject(BookingUpdateNotificationService)
    private readonly updates: BookingUpdateNotificationService,
    @Inject(LifecycleEmailService) private readonly lifecycle: LifecycleEmailService,
    @Inject(PaymentCollectionService) private readonly collection: PaymentCollectionService,
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
    await this.warnExpiring();
    await this.collection.sendDueReminders().catch(() => {
      this.logger.warn('Payment reminders could not be prepared.');
    });
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
      if (!didExpire) continue;
      expired += 1;
      await this.updates.sendPaymentNotCompleted(
        { tenantId: candidate.tenantId, propertyId: candidate.propertyId },
        candidate.bookingId,
      );
      await this.lifecycle.staff(
        { tenantId: candidate.tenantId, propertyId: candidate.propertyId },
        {
          topic: 'payment_not_completed',
          key: 'staff_payment_failed',
          eventType: 'staff.payment_not_completed',
          idempotencyKey: `payment-not-completed/staff/${candidate.bookingId}`,
          bookingId: candidate.bookingId,
          heading: 'Payment not completed',
          rows: [{ label: 'What happened', value: 'Not paid in time; the room was released' }],
        },
      );
    }
    return { expired };
  }

  /** One email to guests whose unpaid online booking is about to be released, with the link to finish. */
  async warnExpiring(): Promise<void> {
    const candidates = await this.database.$queryRaw<Array<ExpiryCandidate & { expiresAt: Date }>>`
      SELECT "bookingId", "tenantId", "propertyId", "expiresAt"
      FROM "payment_pending_expiring_candidates"(
        ${EXPIRING_WARNING_MINUTES}::integer,
        ${SWEEP_BATCH_SIZE}::integer
      )
    `;
    for (const candidate of candidates) {
      const context = { tenantId: candidate.tenantId, propertyId: candidate.propertyId };
      try {
        const link = await this.database.withTenantTransaction(context, async (tx) => {
          const rows = await tx.$queryRaw<Array<{ url: string; time: string }>>`
            SELECT op.result->'value'->>'checkoutUrl' AS url,
              to_char(${candidate.expiresAt}::timestamptz AT TIME ZONE COALESCE(p.timezone, 'UTC'), 'HH24:MI') AS time
            FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
            JOIN LATERAL (
              SELECT result FROM integration_operations
              WHERE tenant_id = b.tenant_id AND property_id = b.property_id
                AND external_entity_id IN (
                  SELECT x.id FROM bookings x
                  WHERE x.tenant_id = b.tenant_id AND x.property_id = b.property_id
                    AND (x.id = b.id OR (b.order_reference IS NOT NULL AND x.order_reference = b.order_reference)))
                AND status = 'SUCCEEDED' AND result->'value'->>'checkoutUrl' IS NOT NULL
              ORDER BY created_at DESC LIMIT 1) op ON true
            WHERE b.tenant_id = ${candidate.tenantId}::uuid AND b.property_id = ${candidate.propertyId}::uuid
              AND b.id = ${candidate.bookingId}::uuid AND b.status = 'PAYMENT_PENDING'
          `;
          return rows[0] ?? null;
        });
        if (!link) continue;
        await this.lifecycle.guest(context, {
          topic: 'payment_link_expiring',
          key: 'payment_link_expiring',
          eventType: 'guest.payment_link_expiring',
          idempotencyKey: `payment-link-expiring/${candidate.bookingId}`,
          bookingId: candidate.bookingId,
          heading: 'Finish your booking',
          values: { payment_link: link.url, expires_at: link.time },
          cta: { label: 'Complete payment', url: link.url },
        });
      } catch (error) {
        this.logger.warn(
          `Could not prepare the payment-link-expiring email for booking ${candidate.bookingId}: ${
            error instanceof Error ? error.name : 'unknown error'
          }`,
        );
      }
    }
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
