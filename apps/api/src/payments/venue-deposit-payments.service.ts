import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Result } from '@must/domain-contracts';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { depositMinor } from '../tenancy/venue-deposit-policy';
import { PaymentProviderRegistry } from './payment-provider-registry';
import { POKPAY_STAGING_BASE_URL, resolvePokpayBaseUrl } from './pokpay-environments';

type Candidate = {
  tenantId: string;
  venueId: string;
  propertyId: string;
  reservationId: string;
  externalPaymentId: string | null;
};
type PaymentRow = {
  id: string;
  propertyId: string | null;
  status: string;
  amount: string;
  currency: string;
  holdMinutes: number;
  expiresAt: Date;
  externalPaymentId: string | null;
  checkoutUrl: string | null;
  operationState: string | null;
  guestEmail: string | null;
  reference: string;
  bookingTime: string;
  serviceName: string;
  areaName: string;
  freeCancelHours: number;
};
const fail = (code: string, message: string): Result<never> => ({
  ok: false,
  error: { code, message, retryable: false },
});

/** Restaurant receipts never enter hotel revenue or platform subscription billing. */
@Injectable()
export class VenueDepositPaymentsService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(PaymentProviderRegistry) private readonly providers: PaymentProviderRegistry,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(MailDeliveryService) private readonly mail: MailDeliveryService,
  ) {}

  async requireStaging(tenantId: string, propertyId: string | null) {
    if (!propertyId)
      throw new ConflictException('Link a hotel with staging PokPay before taking deposits.');
    const credentials = await this.connections.activePaymentConnectionCredentials(
      tenantId,
      propertyId,
      'POKPAY',
    );
    if (
      !credentials?.keyId ||
      !credentials.keySecret ||
      !credentials.merchantId ||
      resolvePokpayBaseUrl(credentials) !== POKPAY_STAGING_BASE_URL
    )
      throw new ConflictException(
        'Configure staging PokPay on the linked hotel before taking deposits.',
      );
  }
  private async row(tenantId: string, venueId: string, reservationId: string): Promise<PaymentRow> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<
        PaymentRow[]
      >`SELECT r.id,v.property_id AS "propertyId",r.status,
        r.deposit_terms->>'amount' AS amount,r.deposit_terms->>'currency' AS currency,v.hold_minutes AS "holdMinutes",
        r.payment_hold_expires_at AS "expiresAt",r.guest_email AS "guestEmail",r.reference,
        to_char(r.starts_at AT TIME ZONE v.timezone,'YYYY-MM-DD HH24:MI') AS "bookingTime",
        r.deposit_terms->>'serviceName' AS "serviceName",r.deposit_terms->>'areaName' AS "areaName",
        (r.deposit_terms->>'freeCancelHours')::integer AS "freeCancelHours",
        o.external_payment_id AS "externalPaymentId",o.checkout_url AS "checkoutUrl",o.state AS "operationState"
        FROM venue_reservations r JOIN venues v ON v.tenant_id=r.tenant_id AND v.id=r.venue_id
        LEFT JOIN venue_deposit_operations o ON o.tenant_id=r.tenant_id AND o.venue_id=r.venue_id AND o.reservation_id=r.id AND o.kind='checkout'
        WHERE r.tenant_id=${tenantId}::uuid AND r.venue_id=${venueId}::uuid AND r.id=${reservationId}::uuid`;
      if (!rows[0]) throw new NotFoundException('Reservation not found.');
      return rows[0];
    });
  }
  async start(tenantId: string, venueId: string, reservationId: string) {
    const row = await this.row(tenantId, venueId, reservationId);
    if (!row.amount || depositMinor(row.amount) === 0n || row.status !== 'pending_payment') return;
    if (row.operationState) {
      if (row.externalPaymentId && row.checkoutUrl)
        await this.repairBinding(tenantId, venueId, reservationId);
      return; // Durable intent: even an uncertain provider create is never repeated.
    }
    await this.requireStaging(tenantId, row.propertyId);
    const claimed = await this.database.withTenantTransaction(
      { tenantId },
      async (tx) => tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO venue_deposit_operations(tenant_id,venue_id,property_id,reservation_id,kind,amount,currency)
      SELECT ${tenantId}::uuid,${venueId}::uuid,${row.propertyId}::uuid,${reservationId}::uuid,'checkout',${row.amount}::numeric,${row.currency}
      WHERE EXISTS(SELECT 1 FROM venue_reservations WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND id=${reservationId}::uuid AND status='pending_payment' AND payment_hold_expires_at>now())
      ON CONFLICT(tenant_id,venue_id,reservation_id,kind) DO NOTHING RETURNING id`,
    );
    if (!claimed[0]) return;
    let knownOrder: string | null = null;
    let knownUrl: string | null = null;
    try {
      const base = (process.env.WEB_APP_URL ?? 'http://localhost:3011').replace(/\/$/, '');
      const result = await this.providers.pokpay.createCheckoutSession(
        { tenantId, propertyId: row.propertyId!, stagingOnly: true },
        {
          idempotencyKey: `restaurant:${reservationId}`,
          bookingId: reservationId,
          amount: { amount: row.amount, currency: row.currency },
          successUrl: `${base}/?restaurantPayment=received`,
          cancelUrl: `${base}/?restaurantPayment=cancelled`,
          expiresAfterMinutes: Math.max(
            1,
            Math.ceil((row.expiresAt.getTime() - Date.now()) / 60000),
          ),
        },
      );
      if (!result.ok) throw new Error('Checkout could not be verified.');
      knownOrder = result.value.id;
      knownUrl = result.value.url;
      await this.database.withTenantTransaction({ tenantId }, async (tx) => {
        await tx.$executeRaw`INSERT INTO payment_provider_sessions(tenant_id,property_id,booking_id,venue_id,venue_reservation_id,provider,external_payment_id,connection_id)
          VALUES(${tenantId}::uuid,${row.propertyId}::uuid,NULL,${venueId}::uuid,${reservationId}::uuid,'pokpay',${result.value.id},${result.value.connectionId ?? null}::uuid)`;
        await tx.$executeRaw`UPDATE venue_deposit_operations SET state='READY',external_payment_id=${result.value.id},checkout_url=${result.value.url}
          WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND reservation_id=${reservationId}::uuid AND kind='checkout'`;
      });
    } catch {
      await this.database.withTenantTransaction(
        { tenantId },
        (
          tx,
        ) => tx.$executeRaw`UPDATE venue_deposit_operations SET state='UNCERTAIN',external_payment_id=${knownOrder},checkout_url=${knownUrl}
        WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND reservation_id=${reservationId}::uuid AND kind='checkout'`,
      );
      // Keep the booking visible with an uncertain payment state; never blind-retry the order.
    }
  }
  /** Recover a local binding write from a known provider result without creating another order. */
  private repairBinding(tenantId: string, venueId: string, reservationId: string) {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      await tx.$executeRaw`INSERT INTO payment_provider_sessions(tenant_id,property_id,booking_id,venue_id,venue_reservation_id,provider,external_payment_id)
        SELECT tenant_id,property_id,NULL,venue_id,reservation_id,'pokpay',external_payment_id FROM venue_deposit_operations
        WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND reservation_id=${reservationId}::uuid AND kind='checkout' AND external_payment_id IS NOT NULL
        ON CONFLICT(tenant_id,provider,external_payment_id) DO NOTHING`;
      await tx.$executeRaw`UPDATE venue_deposit_operations o SET state='READY' WHERE o.tenant_id=${tenantId}::uuid AND o.venue_id=${venueId}::uuid AND o.reservation_id=${reservationId}::uuid
        AND o.kind='checkout' AND o.state IN ('PREPARING','UNCERTAIN') AND o.checkout_url IS NOT NULL
        AND EXISTS(SELECT 1 FROM payment_provider_sessions s WHERE s.tenant_id=o.tenant_id AND s.property_id=o.property_id AND s.venue_id=o.venue_id AND s.venue_reservation_id=o.reservation_id AND s.booking_id IS NULL AND s.provider='pokpay' AND s.external_payment_id=o.external_payment_id)`;
    });
  }
  async process(
    tenantId: string,
    propertyId: string,
    orderId: string,
  ): Promise<Result<{ duplicate: boolean }>> {
    const bound = await this.database.withTenantTransaction(
      { tenantId, propertyId },
      (tx) => tx.$queryRaw<Array<{ venueId: string; reservationId: string }>>`
      SELECT venue_id AS "venueId",venue_reservation_id AS "reservationId" FROM payment_provider_sessions
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND provider='pokpay' AND external_payment_id=${orderId} AND booking_id IS NULL`,
    );
    const binding = bound[0];
    if (!binding)
      return fail('POKPAY_ORDER_BINDING_INVALID', 'Restaurant payment binding not found.');
    await this.requireStaging(tenantId, propertyId);
    const payment = await this.providers.pokpay.getPayment(
      { tenantId, propertyId, stagingOnly: true },
      orderId,
    );
    if (
      !payment ||
      payment.id !== orderId ||
      !['CAPTURED', 'PAID', 'COMPLETED'].includes(payment.status)
    )
      return fail('POKPAY_ORDER_NOT_PAID', 'Payment is not verified as paid.');
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${binding.venueId},0))`;
      const rows = await tx.$queryRaw<
        Array<{ status: string; amount: string; currency: string; live: boolean }>
      >`SELECT status,deposit_terms->>'amount' AS amount,deposit_terms->>'currency' AS currency,
        payment_hold_expires_at>now() AS live FROM venue_reservations WHERE tenant_id=${tenantId}::uuid AND venue_id=${binding.venueId}::uuid AND id=${binding.reservationId}::uuid FOR UPDATE`;
      const row = rows[0];
      if (
        !row ||
        payment.amount.currency !== row.currency ||
        depositMinor(payment.amount.amount) !== depositMinor(row.amount)
      )
        return fail('POKPAY_ORDER_BINDING_INVALID', 'Payment amount or currency does not match.');
      const confirm = row.status === 'pending_payment' && row.live;
      const inserted = await tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO venue_deposit_receipts(tenant_id,venue_id,property_id,reservation_id,kind,external_payment_id,amount,currency,requires_refund)
        VALUES(${tenantId}::uuid,${binding.venueId}::uuid,${propertyId}::uuid,${binding.reservationId}::uuid,'CHARGE',${orderId},${row.amount}::numeric,${row.currency},${!confirm})
        ON CONFLICT(tenant_id,provider,external_payment_id,kind) DO NOTHING RETURNING id`;
      if (!inserted[0]) return { ok: true, value: { duplicate: true } };
      await tx.$executeRaw`UPDATE venue_deposit_operations SET state='PAID' WHERE tenant_id=${tenantId}::uuid AND venue_id=${binding.venueId}::uuid AND reservation_id=${binding.reservationId}::uuid AND kind='checkout'`;
      if (confirm) {
        await tx.$executeRaw`UPDATE venue_reservations SET status='confirmed',updated_at=now() WHERE tenant_id=${tenantId}::uuid AND venue_id=${binding.venueId}::uuid AND id=${binding.reservationId}::uuid`;
        await tx.$executeRaw`INSERT INTO venue_reservation_events(tenant_id,venue_id,reservation_id,from_status,to_status,note)
          VALUES(${tenantId}::uuid,${binding.venueId}::uuid,${binding.reservationId}::uuid,'pending_payment','confirmed','Verified PokPay deposit')`;
      }
      return { ok: true, value: { duplicate: false } };
    });
  }
  async sweep() {
    const candidates = await this.database.$queryRaw<
      Candidate[]
    >`SELECT * FROM venue_deposit_sweep_candidates(100)`;
    for (const row of candidates) {
      await this.database.withTenantTransaction(
        { tenantId: row.tenantId },
        (tx) =>
          tx.$executeRaw`UPDATE venue_deposit_operations SET last_polled_at=now() WHERE tenant_id=${row.tenantId}::uuid AND venue_id=${row.venueId}::uuid AND reservation_id=${row.reservationId}::uuid AND kind='checkout'`,
      );
      if (row.externalPaymentId) {
        await this.repairBinding(row.tenantId, row.venueId, row.reservationId);
        await this.process(row.tenantId, row.propertyId, row.externalPaymentId).catch(
          () => undefined,
        );
      }
      await this.database.withTenantTransaction({ tenantId: row.tenantId }, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${row.venueId},0))`;
        const expired = await tx.$queryRaw<
          Array<{ id: string }>
        >`UPDATE venue_reservations SET status='cancelled',cancelled_at=now(),updated_at=now()
          WHERE tenant_id=${row.tenantId}::uuid AND venue_id=${row.venueId}::uuid AND id=${row.reservationId}::uuid AND status='pending_payment' AND payment_hold_expires_at<=now() RETURNING id`;
        if (expired[0])
          await tx.$executeRaw`INSERT INTO venue_reservation_events(tenant_id,venue_id,reservation_id,from_status,to_status,note)
          VALUES(${row.tenantId}::uuid,${row.venueId}::uuid,${row.reservationId}::uuid,'pending_payment','cancelled','Deposit hold expired')`;
      });
    }
  }
  async refund(tenantId: string, venueId: string, reservationId: string) {
    const claim = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          propertyId: string;
          amount: string;
          currency: string;
          orderId: string;
          eligible: boolean;
        }>
      >`
        SELECT p.property_id AS "propertyId",p.amount::text,p.currency,p.external_payment_id AS "orderId",
          (p.requires_refund OR (r.status='cancelled' AND r.cancelled_at<=r.starts_at-((r.deposit_terms->>'freeCancelHours')::integer*interval '1 hour'))) AS eligible
        FROM venue_deposit_receipts p JOIN venue_reservations r ON r.tenant_id=p.tenant_id AND r.venue_id=p.venue_id AND r.id=p.reservation_id
        WHERE p.tenant_id=${tenantId}::uuid AND p.venue_id=${venueId}::uuid AND p.reservation_id=${reservationId}::uuid AND p.kind='CHARGE'`;
      const row = rows[0];
      if (!row?.eligible) return null;
      const claimed = await tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO venue_deposit_operations(tenant_id,venue_id,property_id,reservation_id,kind,amount,currency)
        VALUES(${tenantId}::uuid,${venueId}::uuid,${row.propertyId}::uuid,${reservationId}::uuid,'refund',${row.amount}::numeric,${row.currency})
        ON CONFLICT(tenant_id,venue_id,reservation_id,kind) DO NOTHING RETURNING id`;
      return claimed[0] ? row : null;
    });
    if (!claim) return { state: 'NO_ACTION' };
    try {
      await this.requireStaging(tenantId, claim.propertyId);
      const result = await this.providers.pokpay.refund(
        { tenantId, propertyId: claim.propertyId, stagingOnly: true },
        {
          idempotencyKey: `restaurant-refund:${reservationId}`,
          paymentId: claim.orderId,
          amount: { amount: claim.amount, currency: claim.currency },
        },
      );
      if (
        !result.ok ||
        !['REFUNDED', 'REFUND_SUCCEEDED'].includes(result.value.status) ||
        depositMinor(result.value.amount.amount) !== depositMinor(claim.amount) ||
        result.value.amount.currency !== claim.currency
      )
        throw new Error('Refund not verified.');
      await this.database.withTenantTransaction({ tenantId }, async (tx) => {
        await tx.$executeRaw`INSERT INTO venue_deposit_receipts(tenant_id,venue_id,property_id,reservation_id,kind,external_payment_id,amount,currency)
          VALUES(${tenantId}::uuid,${venueId}::uuid,${claim.propertyId}::uuid,${reservationId}::uuid,'REFUND',${claim.orderId},${claim.amount}::numeric,${claim.currency})
          ON CONFLICT(tenant_id,provider,external_payment_id,kind) DO NOTHING`;
        await tx.$executeRaw`UPDATE venue_deposit_operations SET state='REFUNDED' WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND reservation_id=${reservationId}::uuid AND kind='refund'`;
      });
      return { state: 'REFUNDED' };
    } catch {
      await this.database.withTenantTransaction(
        { tenantId },
        (tx) =>
          tx.$executeRaw`UPDATE venue_deposit_operations SET state='UNCERTAIN' WHERE tenant_id=${tenantId}::uuid AND venue_id=${venueId}::uuid AND reservation_id=${reservationId}::uuid AND kind='refund'`,
      );
      return { state: 'UNCERTAIN' };
    }
  }
  async sendLink(tenantId: string, venueId: string, reservationId: string) {
    const row = await this.row(tenantId, venueId, reservationId);
    if (
      !row.guestEmail ||
      !row.checkoutUrl ||
      row.operationState !== 'READY' ||
      row.status !== 'pending_payment' ||
      row.expiresAt.getTime() <= Date.now()
    )
      throw new ConflictException('A live checkout and guest email are required.');
    const text = `Booking ${row.reference}: ${row.bookingTime}, ${row.serviceName}, ${row.areaName}. Pay the ${row.amount} ${row.currency} deposit before ${row.expiresAt.toISOString()}. The deposit counts toward the final bill. Free cancellation until ${row.freeCancelHours} hours before the booking; later cancellations may forfeit the deposit. ${row.checkoutUrl}`;
    const escaped = text.replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    );
    await this.mail.dispatch(
      'rendered',
      {
        eventType: 'payment.link',
        to: row.guestEmail,
        subject: `Restaurant deposit Â· ${row.reference}`,
        html: `<p>${escaped}</p>`,
        text,
        idempotencyKey: `restaurant-deposit-link:${reservationId}`,
        bookingId: null,
      },
      { tenantId, propertyId: row.propertyId },
    );
    return { queued: true };
  }
}
