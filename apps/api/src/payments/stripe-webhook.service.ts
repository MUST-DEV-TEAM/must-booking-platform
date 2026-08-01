import { Inject, Injectable } from '@nestjs/common';
import {
  BookingPaymentMethod,
  BookingStatus,
  type PaymentWebhookEvent,
  type Result,
} from '@must/domain-contracts';

import { LocalPmsProvider } from '../booking/local-pms.provider';
import { CancellationLinkService } from '../booking/cancellation-link.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentRefundService } from './payment-refund.service';
import type { RefundConfirmation } from './payment-refund.service';

type PaymentPendingBooking = {
  id: string;
  totalAmount: string;
  currency: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
  guestEmail: string | null;
  guestSessionId: string;
  guestReturnUrl: string | null;
};

@Injectable()
export class StripeWebhookService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(LocalPmsProvider) private readonly bookings: LocalPmsProvider,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
    @Inject(CancellationLinkService) private readonly cancellations: CancellationLinkService,
  ) {}

  async processPaymentSucceeded(
    event: PaymentWebhookEvent,
  ): Promise<Result<{ duplicate: boolean }>> {
    if (!event.tenantId || !event.propertyId || !event.bookingId) {
      return this.failure(
        'STRIPE_WEBHOOK_EVENT_INVALID',
        'Verified event is missing booking scope.',
      );
    }
    const context = { tenantId: event.tenantId, propertyId: event.propertyId };
    let paymentConfirmation:
      Parameters<PaymentNotificationService['sendPaymentConfirmationEmailSafely']>[0] | null = null;
    let refundConfirmation: RefundConfirmation | null = null;
    const result = await this.database.withTenantTransaction<Result<{ duplicate: boolean }>>(
      context,
      async (tx) => {
        const bookings = await tx.$queryRaw<PaymentPendingBooking[]>`
        SELECT b.id, b.total_amount::text AS "totalAmount", rp.currency, b.status,
          b.payment_method AS "paymentMethod", g.email AS "guestEmail", b.guest_session_id AS "guestSessionId", b.guest_return_url AS "guestReturnUrl"
        FROM bookings b
        JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        WHERE b.id = ${event.bookingId}::uuid
          AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
        FOR UPDATE OF b
      `;
        const booking = bookings[0];
        if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
        if (booking.status === BookingStatus.EXPIRED) {
          const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO payments (
            tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency
          ) VALUES (
            ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${booking.id}::uuid,
            'CHARGE'::"PaymentKind", 'stripe', ${event.externalPaymentId}, 'LATE_AFTER_EXPIRY',
            ${booking.totalAmount}::numeric, ${booking.currency}
          )
          ON CONFLICT (tenant_id, external_payment_id) DO NOTHING
          RETURNING id
        `;
          if (inserted[0]) {
            await this.audit.recordInTransaction(tx, {
              tenantId: context.tenantId,
              propertyId: context.propertyId,
              actorUserId: null,
              action: 'payment.late_webhook_rejected',
              targetType: 'booking',
              targetId: booking.id,
              details: { externalPaymentId: event.externalPaymentId },
            });
            const refunded = await this.refunds.refundCharge(
              tx,
              context,
              booking.id,
              {
                provider: 'stripe',
                externalPaymentId: event.externalPaymentId,
                amount: booking.totalAmount,
                currency: booking.currency,
              },
              {
                amount: { amount: booking.totalAmount, currency: booking.currency },
                idempotencyKey: `late-expiry-refund:${event.id}`,
              },
            );
            if (!refunded.result.ok) throw new StripeWebhookProcessingError(refunded.result);
            refundConfirmation = refunded.confirmation;
          }
          return { ok: true, value: { duplicate: !inserted[0] } };
        }
        if (booking.status !== BookingStatus.PAYMENT_PENDING) {
          const existing = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM payments
          WHERE tenant_id = ${context.tenantId}::uuid
            AND external_payment_id = ${event.externalPaymentId}
        `;
          if (existing[0]) return { ok: true, value: { duplicate: true } };
          return this.failure(
            'INVALID_BOOKING_STATE',
            `Booking cannot accept payment from ${booking.status}.`,
          );
        }

        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO payments (
          tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency
        ) VALUES (
          ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${booking.id}::uuid,
          'CHARGE'::"PaymentKind", 'stripe', ${event.externalPaymentId}, 'PAID',
          ${booking.totalAmount}::numeric, ${booking.currency}
        )
        ON CONFLICT (tenant_id, external_payment_id) DO NOTHING
        RETURNING id
      `;
        if (!inserted[0]) return { ok: true, value: { duplicate: true } };

        const confirmed = await this.bookings.continueAfterPayment(tx, context, booking.id);
        if (!confirmed.ok) throw new StripeWebhookProcessingError(confirmed);
        if (booking.paymentMethod === BookingPaymentMethod.STRIPE_CHECKOUT && booking.guestEmail) {
          paymentConfirmation = {
            bookingId: booking.id,
            paymentId: event.externalPaymentId,
            to: booking.guestEmail,
            amount: { amount: booking.totalAmount, currency: booking.currency },
            cancellationUrl: booking.guestReturnUrl
              ? this.cancellationUrl(
                  booking.guestReturnUrl,
                  booking.id,
                  this.cancellations.create({
                    tenantId: context.tenantId,
                    propertyId: context.propertyId,
                    bookingId: booking.id,
                    guestSessionId: booking.guestSessionId,
                  }),
                )
              : undefined,
          };
        }
        return { ok: true, value: { duplicate: false } };
      },
    );
    if (paymentConfirmation)
      await this.notifications.sendPaymentConfirmationEmailSafely(paymentConfirmation);
    if (refundConfirmation)
      await this.notifications.sendRefundConfirmationEmailSafely(refundConfirmation);
    return result;
  }

  private cancellationUrl(base: string, bookingId: string, cancellationToken: string): string {
    const url = new URL(base);
    url.searchParams.set('booking_id', bookingId);
    url.searchParams.set('cancellationToken', cancellationToken);
    url.searchParams.set('must_action', 'cancel');
    return url.toString();
  }

  private failure(code: string, message: string): Result<never> {
    return { ok: false, error: { code, message, retryable: false } };
  }
}

class StripeWebhookProcessingError extends Error {
  constructor(readonly result: Result<unknown>) {
    super(result.ok ? 'Stripe webhook processing failed.' : result.error.message);
  }
}
