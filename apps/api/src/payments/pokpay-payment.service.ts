import { PaymentCollectionService } from './payment-collection.service';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { BookingPaymentMethod, BookingStatus, type Result } from '@must/domain-contracts';

import { LocalPmsProvider } from '../booking/local-pms.provider';
import { BookingConfirmationNotificationService } from '../mail/booking-confirmation-notification.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { VenueDepositPaymentsService } from './venue-deposit-payments.service';
import { PaymentProviderRegistry } from './payment-provider-registry';
import { ManualReviewService } from '../integrations/manual-review.service';
import { LatePaymentFlowService } from './late-payment-flow.service';

type SessionCandidate = { bookingId: string | null; tenantId: string; propertyId: string };
type PendingCandidate = SessionCandidate & { externalPaymentId: string };
type BookingRow = {
  id: string;
  totalAmount: string;
  currency: string;
  status: BookingStatus;
  paymentMethod: BookingPaymentMethod;
};

@Injectable()
export class PokPayPaymentService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(LocalPmsProvider) private readonly bookings: LocalPmsProvider,
    @Inject(PaymentProviderRegistry) private readonly providers: PaymentProviderRegistry,
    @Inject(BookingConfirmationNotificationService)
    private readonly confirmations: BookingConfirmationNotificationService,
    @Inject(PaymentCollectionService) private readonly collections: PaymentCollectionService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
    @Optional()
    @Inject(VenueDepositPaymentsService)
    private readonly venueDeposits?: VenueDepositPaymentsService,
    @Optional()
    @Inject(LatePaymentFlowService)
    private readonly latePayments?: LatePaymentFlowService,
  ) {}

  async processAuthoritativeOrder(orderId: string): Promise<Result<{ duplicate: boolean }>> {
    if (!orderId.trim())
      return this.failure('POKPAY_ORDER_ID_REQUIRED', 'A PokPay order ID is required.');
    const candidates = await this.database.$queryRaw<SessionCandidate[]>`
      SELECT "bookingId", "tenantId", "propertyId"
      FROM "pokpay_payment_session_candidate"(${orderId})
    `;
    const candidate = candidates[0];
    if (!candidate)
      return this.failure(
        'POKPAY_ORDER_BINDING_INVALID',
        'PokPay order is not bound to a booking.',
      );
    const context = { tenantId: candidate.tenantId, propertyId: candidate.propertyId };
    if (!candidate.bookingId)
      return this.venueDeposits
        ? this.venueDeposits.process(candidate.tenantId, candidate.propertyId, orderId)
        : this.failure('POKPAY_ORDER_BINDING_INVALID', 'Restaurant payment handler unavailable.');
    await this.bookings.expireRequestPaymentIfDue(context, candidate.bookingId, {
      externalPaymentId: orderId,
    });
    const collection = await this.collections.process(context, candidate.bookingId, orderId);
    if (collection) return collection;
    let emailBookingId: string | null = null;
    let lateFlowId: string | null = null;
    const result = await this.database.withTenantTransaction<Result<{ duplicate: boolean }>>(
      context,
      async (tx) => {
        const rows = await tx.$queryRaw<BookingRow[]>`
        SELECT b.id, COALESCE(order_totals.total_amount, b.total_amount)::text AS "totalAmount", rp.currency, b.status,
          b.payment_method AS "paymentMethod"
        FROM bookings b JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        JOIN payment_provider_sessions s
          ON s.tenant_id = b.tenant_id AND s.property_id = b.property_id AND s.booking_id = b.id
        LEFT JOIN LATERAL (
          SELECT SUM(child.total_amount) AS total_amount
          FROM bookings child
          WHERE child.tenant_id = b.tenant_id AND child.property_id = b.property_id
            AND child.order_reference = b.order_reference
        ) order_totals ON b.order_reference IS NOT NULL
        WHERE b.id = ${candidate.bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid AND s.provider = 'pokpay'
          AND s.external_payment_id = ${orderId}
        FOR UPDATE OF b
      `;
        const booking = rows[0];
        if (!booking || booking.paymentMethod !== BookingPaymentMethod.POKPAY)
          return this.failure(
            'POKPAY_ORDER_BINDING_INVALID',
            'PokPay order is not bound to this booking.',
          );
        const provider = this.providers.pokpay;
        const payment = await provider.getPayment(context, orderId);
        if (!payment)
          return this.failure(
            'POKPAY_AUTHORITATIVE_REREAD_FAILED',
            'PokPay order could not be verified.',
            true,
          );
        if (
          payment.id !== orderId ||
          payment.amount.amount !== booking.totalAmount ||
          payment.amount.currency !== booking.currency
        )
          return this.failure(
            'POKPAY_ORDER_BINDING_INVALID',
            'PokPay order does not match the booking payment.',
          );
        if (!['CAPTURED', 'PAID', 'COMPLETED'].includes(payment.status))
          return this.failure(
            'POKPAY_ORDER_NOT_PAID',
            'PokPay has not confirmed this order as paid.',
          );
        if (booking.status !== BookingStatus.PAYMENT_PENDING) {
          const existing = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM payments WHERE tenant_id = ${context.tenantId}::uuid
            AND external_payment_id = ${orderId}
        `;
          if (existing[0]) {
            // A prior webhook can have committed the payment and advanced the
            // booking to PMS_CREATION_PENDING before Clock attachment failed.
            // Re-enter the idempotent continuation for that unfinished state;
            // CONFIRMED and all other paid states remain duplicate no-ops.
            if (booking.status === BookingStatus.PMS_CREATION_PENDING) {
              const resumed = await this.bookings.continueAfterPayment(tx, context, booking.id);
              if (!resumed.ok) return resumed;
              emailBookingId = booking.id;
            }
            return { ok: true, value: { duplicate: true } };
          }
          // The money is at PokPay but the booking no longer awaits payment (hold
          // expired, unpaid hold cancelled, or a second order on a confirmed booking).
          // Record the payment so it is never lost. The refund (or a person) follows in a
          // saved flow, never inside this transaction. No note on the row: the database allows a
          // note only on refunds (payments_note_refund_only); the flow and its history say it was late.
          const late = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency)
          VALUES (${context.tenantId}::uuid, ${context.propertyId}::uuid, ${booking.id}::uuid,
            'CHARGE'::"PaymentKind", 'pokpay', ${orderId}, 'PAID', ${payment.amount.amount}::numeric, ${payment.amount.currency})
          ON CONFLICT (tenant_id, external_payment_id) DO NOTHING RETURNING id
        `;
          // ADR-0043: a saved flow refunds it automatically (or hands it to a person), started in the same
          // transaction as the payment row so neither can exist without the other.
          if (late[0] && this.latePayments)
            lateFlowId = await this.latePayments.start(tx, context, {
              bookingId: booking.id,
              orderId,
              amount: payment.amount.amount,
              currency: payment.amount.currency,
              bookingStatusAtPayment: booking.status,
            });
          else if (late[0])
            await this.manualReview.recordInTransaction(tx, {
              ...context,
              category: 'PAYMENT_BOOKING_MISMATCH',
              referenceType: 'booking',
              referenceId: booking.id,
              message:
                'A PokPay payment arrived after this booking stopped awaiting payment. The money is recorded; the booking was not confirmed. Refund the payment or rebook the guest.',
              context: {
                kind: 'LATE_PAYMENT_AFTER_EXPIRY',
                orderId,
                bookingStatus: booking.status,
                amount: payment.amount.amount,
                currency: payment.amount.currency,
              },
            });
          return { ok: true, value: { duplicate: !late[0] } };
        }
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency)
        VALUES (${context.tenantId}::uuid, ${context.propertyId}::uuid, ${booking.id}::uuid,
          'CHARGE'::"PaymentKind", 'pokpay', ${orderId}, 'PAID', ${booking.totalAmount}::numeric, ${booking.currency})
        ON CONFLICT (tenant_id, external_payment_id) DO NOTHING RETURNING id
      `;
        if (!inserted[0]) return { ok: true, value: { duplicate: true } };
        const confirmed = await this.bookings.continueAfterPayment(tx, context, booking.id);
        if (!confirmed.ok) return confirmed;
        emailBookingId = booking.id;
        return { ok: true, value: { duplicate: false } };
      },
      // continueAfterPayment can attach a real Clock reservation and post a
      // real deposit folio + credit_item inside this transaction â€” several
      // real outbound Clock calls, same reasoning as
      // ClockBookingService.createBooking's own extended timeout.
      { timeoutMs: 45_000 },
    );
    if (emailBookingId)
      await this.confirmations.sendAfterConfirmation(context, emailBookingId, orderId);
    // Run the flow straight away; if it stops part-way the worker picks it up. The webhook still answers 200.
    if (lateFlowId && this.latePayments)
      await this.latePayments.run(context, lateFlowId).catch(() => undefined);
    return result;
  }

  async pollPendingOrders(): Promise<void> {
    await this.venueDeposits?.sweep();
    const candidates = await this.database.$queryRaw<PendingCandidate[]>`
      SELECT "bookingId", "tenantId", "propertyId", "externalPaymentId"
      FROM "payment_pending_pokpay_candidates"(100::integer)
    `;
    for (const candidate of candidates)
      await this.processAuthoritativeOrder(candidate.externalPaymentId);
  }

  /**
   * Asks PokPay right now whether this booking's order was paid, and confirms the booking if it
   * was (the same authoritative re-read the webhook and the minute sweep use). Lets staff see the
   * result straight after the guest pays without waiting for the next sweep.
   */
  async refreshBooking(tenantId: string, propertyId: string, bookingId: string): Promise<void> {
    const candidates = await this.database.$queryRaw<PendingCandidate[]>`
      SELECT "bookingId", "tenantId", "propertyId", "externalPaymentId"
      FROM "payment_pending_pokpay_candidates"(100::integer)
    `;
    const own = candidates.filter(
      (candidate) =>
        candidate.bookingId === bookingId &&
        candidate.tenantId === tenantId &&
        candidate.propertyId === propertyId,
    );
    for (const candidate of own) await this.processAuthoritativeOrder(candidate.externalPaymentId);
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
