import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { BookingPaymentMethod } from '@must/domain-contracts';

import { bookingContactSql } from '../booking/booking-contact';
import { paymentMethodAvailability } from '../booking/payment-method-availability';
import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { ClockFinancialService } from '../integrations/clock/clock-financial.service';
import { LifecycleEmailService } from '../mail/lifecycle-email.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { loadCheckoutDescription } from './checkout-description';
import { PaymentProviderRegistry } from './payment-provider-registry';

type Scope = { tenantId: string; propertyId: string };

/** The saved attempt of a Stripe balance link. Kept apart from PokPay's `balance_collection` on purpose. */
export const STRIPE_BALANCE_KIND = 'balance_collection_stripe';
type Collection = {
  kind: typeof STRIPE_BALANCE_KIND;
  provider: 'stripe';
  amount: string;
  currency: string;
  stage: 'PREPARING' | 'READY' | 'PAID' | 'UNCERTAIN';
  checkoutUrl?: string;
  expiresAt?: string;
  externalPaymentId?: string;
  clockConnectionId?: string;
};
type Operation = { id: string; result: Collection };

/** Stripe keeps a Checkout page open for at most 24 hours. */
const STRIPE_MAX_LINK_MINUTES = 24 * 60;
const STRIPE_MIN_LINK_MINUTES = 31;
const DEFAULT_LINK_DAYS = 7;

/**
 * Staff "pay your balance" links through Stripe (gap G-44). It sits beside the PokPay flow and shares none of its
 * saved attempts, so nothing about PokPay's live behaviour changes. Design: docs/roadmap/stripe-balance-links-design.md.
 *
 * The link lasts the hotel's own number of days but never longer than Stripe keeps the page open (24 hours);
 * after that staff send a new link (a durable site link that opens a fresh Stripe page is the next step).
 */
@Injectable()
export class StripeBalanceCollectionService {
  private readonly logger = new Logger(StripeBalanceCollectionService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(PaymentProviderRegistry) private readonly providers: PaymentProviderRegistry,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(ClockFinancialService) private readonly financial: ClockFinancialService,
    @Inject(ClockBookingService) private readonly clock: ClockBookingService,
    @Inject(LifecycleEmailService) private readonly lifecycle: LifecycleEmailService,
  ) {}

  /**
   * Whether a Stripe link can be offered for this hotel at all (the switch and a connected account), and, for a
   * room of a multi-room order, what the whole order still owes (G-47).
   */
  async options(
    scope: Scope,
    bookingId?: string,
  ): Promise<{ stripe: boolean; orderBalance: { amount: string; currency: string } | null }> {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const available = await paymentMethodAvailability(tx, scope);
      const order = bookingId ? await this.orderBalance(tx, scope, bookingId) : null;
      return {
        stripe: available.stripe,
        orderBalance: order && new Prisma.Decimal(order.amount).gt(0) ? order : null,
      };
    });
  }

  /** What a multi-room order still owes (all rooms confirmed, no Clock reservation), or null for a single booking. */
  private async orderBalance(
    tx: TenantTransaction,
    scope: Scope,
    bookingId: string,
  ): Promise<{ amount: string; currency: string } | null> {
    const rows = await tx.$queryRaw<
      Array<{ total: string; paid: string; refunded: string; currency: string; ready: boolean }>
    >`
      SELECT COALESCE(sum(c.total_amount),0)::text AS total, max(rp.currency) AS currency,
        COALESCE((SELECT sum(p.amount) FROM payments p JOIN bookings pb ON pb.tenant_id=p.tenant_id AND pb.id=p.booking_id
          WHERE pb.tenant_id=b.tenant_id AND pb.order_reference=b.order_reference AND p.kind='CHARGE' AND p.status IN ('PAID','succeeded')),0)::text AS paid,
        COALESCE((SELECT sum(p.amount) FROM payments p JOIN bookings pb ON pb.tenant_id=p.tenant_id AND pb.id=p.booking_id
          WHERE pb.tenant_id=b.tenant_id AND pb.order_reference=b.order_reference AND p.kind='REFUND' AND p.status='REFUNDED'),0)::text AS refunded,
        (bool_and(c.status::text='CONFIRMED') AND bool_and(c.external_booking_id IS NULL)) AS ready
      FROM bookings b
      JOIN bookings c ON c.tenant_id=b.tenant_id AND c.property_id=b.property_id AND c.order_reference=b.order_reference
      JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
      WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid
        AND b.id=${bookingId}::uuid AND b.order_reference IS NOT NULL
      GROUP BY b.tenant_id, b.id, b.order_reference`;
    const row = rows[0];
    if (!row || !row.ready) return null;
    return {
      amount: new Prisma.Decimal(row.total).minus(row.paid).plus(row.refunded).toFixed(2),
      currency: row.currency,
    };
  }

  /** A room of a multi-room order is paid through the order's first room (where the order's payment lives). */
  private async anchorOf(scope: Scope, bookingId: string): Promise<string> {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<Array<{ id: string }>>`
          SELECT a.id::text FROM bookings b
          JOIN bookings a ON a.tenant_id=b.tenant_id AND a.property_id=b.property_id
            AND a.order_reference=b.order_reference AND a.order_room_number=1
          WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid
            AND b.id=${bookingId}::uuid AND b.order_reference IS NOT NULL`,
    );
    return rows[0]?.id ?? bookingId;
  }

  async start(scope: Scope, requestedBookingId: string, actorUserId: string, key: string) {
    if (!key || key.length > 200)
      throw new BadRequestException('A payment attempt key is required.');
    const bookingId = await this.anchorOf(scope, requestedBookingId);
    const verified = await this.financial.refresh(scope, bookingId);
    const intent = await this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          status: string;
          currency: string;
          total: string;
          paid: string;
          orderReference: string | null;
          balanceManagedInClock: boolean;
          version: number;
          refunded: string;
          linkDays: number | null;
          orderReady: boolean | null;
        }>
      >`
        SELECT b.status::text AS status, rp.currency, b.version,
          COALESCE((SELECT sum(o.total_amount) FROM bookings o WHERE o.tenant_id=b.tenant_id AND o.property_id=b.property_id AND o.order_reference=b.order_reference), b.total_amount)::text AS total,
          (SELECT bool_and(o.status::text='CONFIRMED' AND o.external_booking_id IS NULL) FROM bookings o WHERE o.tenant_id=b.tenant_id AND o.property_id=b.property_id AND o.order_reference=b.order_reference) AS "orderReady",
          b.order_reference AS "orderReference", p.payment_link_valid_days AS "linkDays",
          (b.external_booking_id IS NOT NULL AND b.external_reference LIKE 'CLOCK-%') AS "balanceManagedInClock",
          COALESCE((SELECT sum(c.amount) FROM payments c JOIN bookings cb ON cb.tenant_id=c.tenant_id AND cb.id=c.booking_id WHERE cb.tenant_id=b.tenant_id AND cb.property_id=b.property_id AND (cb.id=b.id OR (b.order_reference IS NOT NULL AND cb.order_reference=b.order_reference)) AND c.kind='CHARGE' AND c.status IN ('PAID','succeeded')),0)::text AS paid,
          COALESCE((SELECT sum(r.amount) FROM payments r JOIN bookings rb ON rb.tenant_id=r.tenant_id AND rb.id=r.booking_id WHERE rb.tenant_id=b.tenant_id AND rb.property_id=b.property_id AND (rb.id=b.id OR (b.order_reference IS NOT NULL AND rb.order_reference=b.order_reference)) AND r.kind='REFUND' AND r.status='REFUNDED'),0)::text AS refunded
        FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
        JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
        WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid
        FOR UPDATE OF b`;
      const b = rows[0];
      if (!b) throw new NotFoundException('Booking not found.');
      if (b.balanceManagedInClock && !verified)
        throw new ConflictException(
          'Earlier payments for this imported booking are managed in Clock. Verify its balance in Clock before collecting money.',
        );
      if (b.status !== 'CONFIRMED')
        throw new ConflictException('Confirm the booking before collecting a balance.');
      // A multi-room order is paid as one: every room confirmed, no room held in Clock (each of those has its own bill).
      if (b.orderReference && !b.orderReady)
        throw new ConflictException(
          'A payment link for a multi-room order needs every room confirmed and none held in Clock.',
        );
      if (!(await paymentMethodAvailability(tx, scope)).stripe)
        throw new ConflictException(
          'Enable a connected Stripe payment method for this hotel first.',
        );
      if (
        verified &&
        (verified.bookingVersion !== b.version ||
          verified.balance.currency !== b.currency ||
          !new Prisma.Decimal(verified.localPaid).eq(b.paid) ||
          !new Prisma.Decimal(verified.localRefunded).eq(b.refunded))
      )
        throw new ConflictException(
          'The booking or its payments changed during verification. Reload and retry.',
        );
      const amount = verified
        ? new Prisma.Decimal(verified.balance.amount).toFixed(2)
        : new Prisma.Decimal(b.total)
            .minus(b.paid)
            .plus(b.orderReference ? b.refunded : 0)
            .toFixed(2);
      if (new Prisma.Decimal(amount).lte(0))
        throw new ConflictException('This booking has no outstanding balance.');

      const existing = await tx.$queryRaw<Operation[]>`
        SELECT id, result FROM integration_operations
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
          AND aggregate_id=${bookingId}::uuid AND result->>'kind'=${STRIPE_BALANCE_KIND}
          AND result->>'stage' IN ('PREPARING','READY','UNCERTAIN')
        ORDER BY created_at DESC LIMIT 1`;
      if (existing[0]) {
        const result = existing[0].result;
        const stillOpen = result.expiresAt && new Date(result.expiresAt).getTime() > Date.now();
        if (
          result.stage === 'READY' &&
          stillOpen &&
          result.amount === amount &&
          result.currency === b.currency
        )
          return { ...existing[0], existing: true, validMinutes: 0 };
        if (result.stage !== 'READY' || (stillOpen && result.amount !== amount))
          throw new ConflictException(
            'An existing payment link needs review. Do not create another charge while its result is uncertain or the balance has changed.',
          );
        // A READY link whose page has closed: its operation ends here and a new one is made below.
        await tx.$executeRaw`UPDATE integration_operations SET result=jsonb_set(result,'{stage}','"EXPIRED"'::jsonb), updated_at=now()
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${existing[0].id}::uuid`;
      }
      const days =
        b.linkDays && b.linkDays >= 1 && b.linkDays <= 14 ? b.linkDays : DEFAULT_LINK_DAYS;
      const validMinutes = Math.min(days * 24 * 60, STRIPE_MAX_LINK_MINUTES);
      const id = randomUUID();
      const result: Collection = {
        kind: STRIPE_BALANCE_KIND,
        provider: 'stripe',
        ...(verified ? { clockConnectionId: verified.connectionId } : {}),
        amount,
        currency: b.currency,
        stage: 'PREPARING',
      };
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ bookingId, amount, currency: b.currency, provider: 'stripe' }))
        .digest('hex');
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO integration_operations(id,tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,result)
        VALUES(${id}::uuid,${scope.tenantId}::uuid,${scope.propertyId}::uuid,${'collect-stripe:' + key},${bookingId}::uuid,${requestHash},'PENDING',${JSON.stringify(result)}::jsonb)
        ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id`;
      if (!inserted[0])
        throw new ConflictException('This payment attempt was already used. Reload the booking.');
      await this.audit.recordInTransaction(tx, {
        ...scope,
        actorUserId,
        action: 'payment.collection_requested',
        operationId: id,
        targetType: 'booking',
        targetId: bookingId,
        details: { operationId: id, amount, currency: b.currency, provider: 'stripe' },
      });
      return { id, result, existing: false, validMinutes };
    });
    if (intent.existing)
      return {
        checkoutUrl: intent.result.checkoutUrl,
        orderId: intent.result.externalPaymentId,
        amount: { amount: intent.result.amount, currency: intent.result.currency },
      };

    const provider = this.providers.forBookingMethod(BookingPaymentMethod.STRIPE_CHECKOUT);
    const origin = process.env.WEB_APP_URL ?? 'http://localhost:3001';
    const minutes = Math.max(intent.validMinutes, STRIPE_MIN_LINK_MINUTES);
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    let checkout;
    try {
      const description = await this.db.withTenantTransaction(scope, (tx) =>
        loadCheckoutDescription(tx, scope, bookingId),
      );
      checkout = await provider!.createCheckoutSession(scope, {
        idempotencyKey: intent.id,
        bookingId,
        description,
        amount: { amount: intent.result.amount, currency: intent.result.currency },
        successUrl: new URL(
          `/bookings/${bookingId}/payment/success?${new URLSearchParams(scope)}`,
          origin,
        ).toString(),
        cancelUrl: new URL(
          `/bookings/${bookingId}/payment/cancel?${new URLSearchParams(scope)}`,
          origin,
        ).toString(),
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
      });
    } catch {
      checkout = {
        ok: false as const,
        error: {
          code: 'UNKNOWN',
          message: 'The payment provider did not give a definite answer.',
          retryable: true,
        },
      };
    }
    if (!checkout.ok) {
      await this.db.withTenantTransaction(
        scope,
        (tx) =>
          tx.$executeRaw`UPDATE integration_operations SET status='FAILED',result=jsonb_set(result,'{stage}','"UNCERTAIN"'::jsonb),updated_at=now()
            WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${intent.id}::uuid`,
      );
      await this.audit.record({
        ...scope,
        actorUserId,
        action: 'payment.collection_unknown',
        targetType: 'booking',
        targetId: bookingId,
        operationId: intent.id,
        details: {
          amount: { amount: intent.result.amount, currency: intent.result.currency },
          reason: 'Stripe did not confirm checkout creation. The saved attempt requires review.',
        },
      });
      throw new ConflictException(
        'The payment link could not be confirmed. Its attempt is saved for review; retrying will not create another charge.',
      );
    }
    const ready: Collection = {
      ...intent.result,
      stage: 'READY',
      externalPaymentId: checkout.value.id,
      checkoutUrl: checkout.value.url,
      expiresAt: expiresAt.toISOString(),
    };
    await this.db.withTenantTransaction(scope, async (tx) => {
      await tx.$executeRaw`INSERT INTO payment_provider_sessions(tenant_id,property_id,booking_id,provider,external_payment_id,connection_id)
        VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${bookingId}::uuid,'stripe',${checkout.value.id},${checkout.value.connectionId ?? null}::uuid)
        ON CONFLICT(tenant_id,provider,external_payment_id) DO NOTHING`;
      await tx.$executeRaw`UPDATE integration_operations SET status='COMPLETED',external_reference=${checkout.value.id},result=${JSON.stringify(ready)}::jsonb,updated_at=now()
        WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${intent.id}::uuid`;
    });
    await this.audit.record({
      ...scope,
      actorUserId,
      action: 'payment.checkout_ready',
      targetType: 'booking',
      targetId: bookingId,
      operationId: intent.id,
      source: 'STRIPE',
      details: {
        amount: { amount: ready.amount, currency: ready.currency },
        externalPaymentId: ready.externalPaymentId,
      },
    });
    return {
      checkoutUrl: ready.checkoutUrl,
      orderId: ready.externalPaymentId,
      amount: { amount: ready.amount, currency: ready.currency },
    };
  }

  /**
   * Whether a Stripe link has been paid, for the dashboard's "waiting for payment" check. The payment itself is
   * recorded by the Stripe webhook, so this only reads the saved attempt. `null` when the id is not a Stripe link.
   */
  async check(
    scope: Scope,
    bookingId: string,
    sessionId: string,
  ): Promise<{ paid: boolean; orderId: string } | null> {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<Array<{ stage: string }>>`
          SELECT result->>'stage' AS stage FROM integration_operations
          WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
            AND aggregate_id=${bookingId}::uuid AND external_reference=${sessionId}
            AND result->>'kind'=${STRIPE_BALANCE_KIND} LIMIT 1`,
    );
    return rows[0] ? { paid: rows[0].stage === 'PAID', orderId: sessionId } : null;
  }

  /** Emails the Stripe link to the guest (staff asked for it, so the topic switch does not hold it). */
  async sendLink(scope: Scope, bookingId: string, actorUserId: string, key: string) {
    const checkout = await this.start(scope, bookingId, actorUserId, key);
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<Array<{ email: string | null }>>`
          SELECT ${bookingContactSql.email} AS email
          FROM bookings b LEFT JOIN guests g ON g.tenant_id=b.tenant_id AND g.id=b.guest_id
          WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid`,
    );
    if (!rows[0]?.email)
      throw new ConflictException('Add a verified guest email before sending a payment link.');
    const amount = `${checkout.amount.amount} ${checkout.amount.currency}`;
    await this.lifecycle.guest(scope, {
      topic: 'payment_pending',
      key: 'payment_pending',
      eventType: 'payment.link',
      idempotencyKey: `balance-link/${scope.propertyId}/${key}`,
      bookingId,
      heading: 'Pay your booking balance',
      values: { payment_link: checkout.checkoutUrl!, payment_due: amount },
      rows: [{ label: 'Amount', value: amount }],
      cta: { label: 'Pay securely with Stripe', url: checkout.checkoutUrl! },
      force: true,
    });
    await this.audit.record({
      ...scope,
      actorUserId,
      action: 'payment.link_requested',
      targetType: 'booking',
      targetId: bookingId,
      details: { recipient: rows[0].email, amount: checkout.amount, provider: 'stripe' },
    });
    return { queued: true, orderId: checkout.orderId };
  }

  /**
   * Called by the Stripe webhook inside its own transaction for a verified paid session. When the session belongs
   * to a Stripe balance link of a booking that is still confirmed, the charge is recorded (never refunded) and the
   * attempt is closed. Anything else is not handled here, so the webhook's existing rules (a booking that is no
   * longer confirmed gets the money refunded) apply.
   */
  async complete(
    tx: TenantTransaction,
    scope: Scope,
    booking: { id: string; status: string },
    sessionId: string,
  ): Promise<
    | { handled: false }
    | { handled: true; duplicate: boolean; receipt?: { amount: string; currency: string } }
  > {
    const ops = await tx.$queryRaw<Operation[]>`
      SELECT id, result FROM integration_operations
      WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid
        AND aggregate_id=${booking.id}::uuid AND external_reference=${sessionId}
        AND result->>'kind'=${STRIPE_BALANCE_KIND}
      LIMIT 1 FOR UPDATE`;
    const op = ops[0];
    if (!op) return { handled: false };
    if (booking.status !== 'CONFIRMED') return { handled: false };
    if (op.result.stage === 'PAID') return { handled: true, duplicate: true };
    const { amount, currency } = op.result;
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency)
      VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${booking.id}::uuid,'CHARGE','stripe',${sessionId},'PAID',${amount}::numeric,${currency})
      ON CONFLICT(tenant_id,external_payment_id) DO NOTHING RETURNING id`;
    if (!inserted[0]) return { handled: true, duplicate: true };

    const totals = await tx.$queryRaw<Array<{ total: string; paid: string }>>`
      SELECT COALESCE((SELECT sum(o.total_amount) FROM bookings o WHERE o.tenant_id=b.tenant_id AND o.property_id=b.property_id AND o.order_reference=b.order_reference), b.total_amount)::text AS total,
        COALESCE((SELECT sum(p.amount) FROM payments p JOIN bookings pb ON pb.tenant_id=p.tenant_id AND pb.id=p.booking_id
          WHERE pb.tenant_id=b.tenant_id AND pb.property_id=b.property_id AND (pb.id=b.id OR (b.order_reference IS NOT NULL AND pb.order_reference=b.order_reference))
            AND p.kind='CHARGE' AND p.status IN ('PAID','succeeded')),0)::text AS paid
      FROM bookings b WHERE b.tenant_id=${scope.tenantId}::uuid AND b.id=${booking.id}::uuid`;
    // Paid more than the booking costs (two links paid, or the balance moved meanwhile): a person decides.
    const overpaid =
      !op.result.clockConnectionId &&
      totals[0] &&
      new Prisma.Decimal(totals[0].paid).gt(totals[0].total);
    if (overpaid)
      await tx.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message,context)
        VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,'PAYMENT_BOOKING_MISMATCH'::"ManualReviewCategory",'booking',${booking.id},
          'A Stripe balance payment brought the paid total above the booking total. Check whether part of it should be refunded.',
          ${JSON.stringify({ kind: 'STRIPE_BALANCE_OVERPAID', sessionId })}::jsonb)`;
    if (op.result.clockConnectionId) {
      const posted = await this.clock.postDeposit(
        tx,
        scope,
        booking.id,
        { amount, currency },
        'Stripe',
        sessionId,
        'on-line',
        op.id,
      );
      if (!posted.ok)
        await tx.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message,context)
          VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,'PAYMENT_BOOKING_MISMATCH'::"ManualReviewCategory",'booking',${booking.id},
            ${`A Stripe balance payment of ${amount} ${currency} was recorded here but could not be posted to Clock: ${posted.error.message}`},
            ${JSON.stringify({ kind: 'STRIPE_BALANCE_NOT_POSTED_TO_CLOCK', sessionId })}::jsonb)`;
    }
    await tx.$executeRaw`UPDATE integration_operations SET result=jsonb_set(result,'{stage}','"PAID"'::jsonb), updated_at=now()
      WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${op.id}::uuid`;
    await this.audit.recordInTransaction(tx, {
      ...scope,
      actorUserId: null,
      action: 'payment.balance_collected',
      operationId: op.id,
      targetType: 'booking',
      targetId: booking.id,
      details: { amount: { amount, currency }, externalPaymentId: sessionId, provider: 'stripe' },
    });
    return { handled: true, duplicate: false, receipt: { amount, currency } };
  }

  /** The guest's and staff's "payment received" emails, after the charge is saved. Never throws. */
  async sendReceiptSafely(
    scope: Scope,
    bookingId: string,
    sessionId: string,
    receipt: { amount: string; currency: string },
  ): Promise<void> {
    try {
      const amount = `${receipt.amount} ${receipt.currency}`;
      const email = {
        topic: 'payment_received' as const,
        eventType: 'payment.received',
        idempotencyKey: `balance-receipt/${sessionId}`,
        bookingId,
        heading: 'Payment received',
        values: { payment_amount: amount },
        rows: [
          { label: 'Payment method', value: 'Stripe' },
          { label: 'Amount received', value: amount },
        ],
      };
      await this.lifecycle.guest(scope, { ...email, key: 'payment_received' });
      await this.lifecycle.staff(scope, {
        ...email,
        key: 'staff_payment_received',
        idempotencyKey: `balance-receipt/staff/${sessionId}`,
      });
    } catch {
      this.logger.error(
        `Receipt could not be queued for recorded Stripe payment ${sessionId}; the payment itself is saved.`,
      );
    }
  }
}
