import { Inject, Injectable } from '@nestjs/common';
import { BookingPaymentMethod, BookingStatus, type Result } from '@must/domain-contracts';

import { LocalPmsProvider } from '../booking/local-pms.provider';
import { BookingConfirmationNotificationService } from '../mail/booking-confirmation-notification.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { PaymentProviderRegistry } from './payment-provider-registry';

type SessionCandidate = { bookingId: string; tenantId: string; propertyId: string };
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
    let emailBookingId: string | null = null;
    const result = await this.database.withTenantTransaction<Result<{ duplicate: boolean }>>(
      context,
      async (tx) => {
        const rows = await tx.$queryRaw<BookingRow[]>`
        SELECT b.id, b.total_amount::text AS "totalAmount", rp.currency, b.status,
          b.payment_method AS "paymentMethod"
        FROM bookings b JOIN rate_plans rp
          ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
        JOIN payment_provider_sessions s
          ON s.tenant_id = b.tenant_id AND s.property_id = b.property_id AND s.booking_id = b.id
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
          return existing[0]
            ? { ok: true, value: { duplicate: true } }
            : this.failure(
                'INVALID_BOOKING_STATE',
                `Booking cannot accept payment from ${booking.status}.`,
              );
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
    );
    if (emailBookingId)
      await this.confirmations.sendAfterConfirmation(context, emailBookingId, orderId);
    return result;
  }

  async pollPendingOrders(): Promise<void> {
    const candidates = await this.database.$queryRaw<PendingCandidate[]>`
      SELECT "bookingId", "tenantId", "propertyId", "externalPaymentId"
      FROM "payment_pending_pokpay_candidates"(100::integer)
    `;
    for (const candidate of candidates)
      await this.processAuthoritativeOrder(candidate.externalPaymentId);
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
