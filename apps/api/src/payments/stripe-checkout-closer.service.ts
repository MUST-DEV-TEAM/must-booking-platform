import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PaymentProvider } from '@must/domain-contracts';

import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PAYMENT_PROVIDER } from './payment.provider';

const BATCH_SIZE = 50;

type EndedCheckout = {
  tenantId: string;
  propertyId: string;
  bookingId: string;
  externalPaymentId: string;
};

/**
 * Closes the open Stripe page of every booking that was cancelled or expired, so a guest cannot pay it
 * afterwards. Runs from the payment expiry sweep (every minute) and covers every way a booking can end.
 * If a guest still pays in the minute before it is closed, the webhook refunds that payment in full.
 */
@Injectable()
export class StripeCheckoutCloserService {
  private readonly logger = new Logger(StripeCheckoutCloserService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PAYMENT_PROVIDER) private readonly stripe: PaymentProvider,
  ) {}

  async closeEndedCheckouts(): Promise<{ closed: number; retry: number }> {
    if (!this.stripe.expireCheckout) return { closed: 0, retry: 0 };
    const ended = await this.database.$queryRaw<EndedCheckout[]>`
      SELECT "tenantId", "propertyId", "bookingId", "externalPaymentId"
      FROM "stripe_checkouts_to_close"(${BATCH_SIZE}::integer)
    `;
    let closed = 0;
    let retry = 0;
    for (const item of ended) {
      const context = { tenantId: item.tenantId, propertyId: item.propertyId };
      try {
        const result = await this.stripe.expireCheckout(context, item.externalPaymentId);
        // A hotel that no longer has a usable Stripe connection cannot close it either: stop trying.
        const done = result.ok
          ? result.value.closed
          : result.error.code === 'STRIPE_NOT_CONFIGURED';
        if (!done) {
          retry += 1;
          continue;
        }
        await this.database.withTenantTransaction(
          context,
          (tx) =>
            tx.$executeRaw`
            UPDATE payment_provider_sessions SET checkout_closed_at = now()
            WHERE tenant_id = ${item.tenantId}::uuid AND provider = 'stripe'
              AND external_payment_id = ${item.externalPaymentId}`,
        );
        closed += 1;
      } catch (error) {
        retry += 1;
        this.logger.warn(
          `A Stripe checkout could not be closed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }
    return { closed, retry };
  }
}
