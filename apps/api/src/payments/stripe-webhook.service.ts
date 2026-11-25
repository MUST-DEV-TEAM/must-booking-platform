import { bookingContactSql } from '../booking/booking-contact';
import { Inject, Injectable } from '@nestjs/common';
import {
  BookingPaymentMethod,
  BookingStatus,
  type PaymentWebhookEvent,
  type Result,
} from '@must/domain-contracts';

import { LocalPmsProvider } from '../booking/local-pms.provider';
import { BookingConfirmationNotificationService } from '../mail/booking-confirmation-notification.service';
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
};

@Injectable()
export class StripeWebhookService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(LocalPmsProvider) private readonly bookings: LocalPmsProvider,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(PaymentRefundService) private readonly refunds: PaymentRefundService,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
    @Inject(BookingConfirmationNotificationService)
    private readonly confirmations: BookingConfirmationNotificationService,
  ) {}

  async processPaymentSucceeded(
    event: PaymentWebhookEvent,
    connectionId?: string,
  ): Promise<Result<{ duplicate: boolean }>> {
    if (!event.tenantId || !event.propertyId || !event.bookingId) {
      return this.failure(
        'STRIPE_WEBHOOK_EVENT_INVALID',
        'Verified event is missing booking scope.',
      );
    }
    const context = { tenantId: event.tenantId, propertyId: event.propertyId };
    await this.bookings.expireRequestPaymentIfDue(context, event.bookingId, {
      externalPaymentId: event.externalPaymentId,
      paidAt: event.occurredAt ? new Date(event.occurredAt) : undefined,
    });
    const bookingConfirmation: { bookingId?: string; paymentId?: string } = {};
    let refundConfirmation: RefundConfirmation | null = null;
    const result = await this.database.withTenantTransaction<Result<{ duplicate: boolean }>>(
      context,
      async (tx) => {
        const bookings = await tx.$queryRaw<PaymentPendingBooking[]>`
        SELECT b.id, COALESCE(order_totals.total_amount, b.total_amount)::text AS "totalAmount", rp.currency, b.status,
          b.payment_method AS "paymentMethod", ${bookingContactSql.email} AS "guestEmail"
        FROM bookings b
        JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        LEFT JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        LEFT JOIN LATERAL (
          SELECT SUM(child.total_amount) AS total_amount
          FROM bookings child
          WHERE child.tenant_id = b.tenant_id AND child.property_id = b.property_id
            AND child.order_reference = b.order_reference
        ) order_totals ON b.order_reference IS NOT NULL
        WHERE b.id = ${event.bookingId}::uuid
          AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
        FOR UPDATE OF b
      `;
        const booking = bookings[0];
        if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
        if (connectionId) {
          // The payment session names the Stripe account that created it. A signed event from any
          // other connection is refused; a session with no recorded account (created before accounts
          // were recorded) takes the verified one, so the payment is marked and refunded correctly.
          await tx.$executeRaw`
            INSERT INTO payment_provider_sessions (
              tenant_id, property_id, booking_id, provider, external_payment_id, connection_id
            ) VALUES (
              ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${booking.id}::uuid,
              'stripe', ${event.externalPaymentId}, ${connectionId}::uuid
            )
            ON CONFLICT (tenant_id, provider, external_payment_id) DO NOTHING`;
          await tx.$executeRaw`
            UPDATE payment_provider_sessions SET connection_id = ${connectionId}::uuid
            WHERE tenant_id = ${context.tenantId}::uuid AND provider = 'stripe'
              AND external_payment_id = ${event.externalPaymentId} AND connection_id IS NULL`;
          const owner = await tx.$queryRaw<Array<{ connectionId: string | null }>>`
            SELECT connection_id AS "connectionId" FROM payment_provider_sessions
            WHERE tenant_id = ${context.tenantId}::uuid AND provider = 'stripe'
              AND external_payment_id = ${event.externalPaymentId}`;
          if (owner[0]?.connectionId && owner[0].connectionId !== connectionId)
            return this.failure(
              'STRIPE_CONNECTION_MISMATCH',
              'This payment belongs to a different Stripe connection.',
            );
        }
        // A paid event the booking can no longer accept (the hold expired, or staff or the guest cancelled it
        // before payment, or it is already paid another way) is recorded and refunded in full, never left as
        // an error that Stripe retries while the guest's money sits uncredited.
        if (booking.status !== BookingStatus.PAYMENT_PENDING) {
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
              details: {
                externalPaymentId: event.externalPaymentId,
                bookingStatus: booking.status,
              },
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
        if (booking.paymentMethod === BookingPaymentMethod.STRIPE_CHECKOUT && booking.guestEmail)
          Object.assign(bookingConfirmation, {
            bookingId: booking.id,
            paymentId: event.externalPaymentId,
          });
        return { ok: true, value: { duplicate: false } };
      },
      // continueAfterPayment can attach a real Clock reservation and post a
      // real deposit folio + credit_item inside this transaction — several
      // real outbound Clock calls, same reasoning as
      // ClockBookingService.createBooking's own extended timeout.
      { timeoutMs: 45_000 },
    );
    if (bookingConfirmation.bookingId && bookingConfirmation.paymentId)
      await this.confirmations.sendAfterConfirmation(
        context,
        bookingConfirmation.bookingId,
        bookingConfirmation.paymentId,
      );
    if (refundConfirmation)
      await this.notifications.sendRefundConfirmationEmailSafely(refundConfirmation, context);
    return result;
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
