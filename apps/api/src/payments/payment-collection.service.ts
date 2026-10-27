import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClockFinancialService } from '../integrations/clock/clock-financial.service';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Result } from '@must/domain-contracts';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { AuditLogService } from '../tenancy/audit-log.service';
import { PaymentProviderRegistry } from './payment-provider-registry';
import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { IntegrationConnectionsService } from '../integrations/integration-connections.service';
import { LifecycleEmailService } from '../mail/lifecycle-email.service';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { bookingContactSql } from '../booking/booking-contact';
type Scope = { tenantId: string; propertyId: string };
type Collection = {
  kind: 'balance_collection';
  amount: string;
  currency: string;
  checkoutUrl?: string;
  externalPaymentId?: string;
  clockConnectionId?: string;
  stage: 'PREPARING' | 'READY' | 'PAID' | 'UNCERTAIN';
};
type Operation = { id: string; result: Collection };
/** Confirmed reservations keep their identity and payment method. Captures append to the ledger.
 * The committed PREPARING intent prevents a timeout/retry from creating another gateway order.
 */
@Injectable()
export class PaymentCollectionService {
  private readonly logger = new Logger(PaymentCollectionService.name);
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(PaymentProviderRegistry) private readonly providers: PaymentProviderRegistry,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockBookingService) private readonly clock: ClockBookingService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
    @Inject(ClockFinancialService) private readonly financial: ClockFinancialService,
    @Inject(LifecycleEmailService) private readonly lifecycle: LifecycleEmailService,
  ) {}
  async options(scope: Scope, bookingId: string) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ gatewayReady: boolean; financialReady: boolean }>
      >`SELECT
        (p.pokpay_enabled AND EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=p.tenant_id AND pc.property_id=p.id AND pc.enabled AND c.provider='POKPAY' AND c.status='CONNECTED')) AS "gatewayReady",
        (b.external_booking_id IS NULL OR b.external_reference NOT LIKE 'CLOCK-%' OR EXISTS(
          SELECT 1 FROM clock_sync_jobs j JOIN property_integration_connections ap ON ap.tenant_id=j.tenant_id AND ap.property_id=j.property_id AND ap.connection_id=j.connection_id AND ap.enabled AND ap.kind='PMS'
          JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
          WHERE j.tenant_id=b.tenant_id AND j.property_id=b.property_id AND j.resource='financial:'||b.id::text
          AND j.status='SYNCED' AND j.last_error IS NULL AND j.last_success_at>now()-interval '5 minutes'
          AND (j.snapshot->>'bookingVersion')::int=b.version AND j.snapshot#>>'{balance,currency}'=rp.currency
          AND (j.snapshot->>'localPaid')::numeric=COALESCE((SELECT sum(amount) FROM payments a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.booking_id=b.id AND a.kind='CHARGE' AND a.status IN ('PAID','succeeded')),0)
          AND (j.snapshot->>'localRefunded')::numeric=COALESCE((SELECT sum(amount) FROM payments a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.booking_id=b.id AND a.kind='REFUND' AND a.status='REFUNDED'),0)
          AND (j.snapshot#>>'{balance,amount}')::numeric>0)) AS "financialReady"
        FROM properties p JOIN bookings b ON b.tenant_id=p.tenant_id AND b.property_id=p.id WHERE p.tenant_id=${scope.tenantId}::uuid AND p.id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid`;
      if (!rows[0]) throw new NotFoundException('Booking not found.');
      const row = rows[0];
      return {
        pokpay: row.gatewayReady && row.financialReady,
        unavailableReason: !row.gatewayReady
          ? 'PokPay is disabled or not connected for this hotel.'
          : !row.financialReady
            ? 'Online payment is waiting for a current, verified Clock balance.'
            : null,
      };
    });
  }
  async start(scope: Scope, bookingId: string, actorUserId: string, key: string) {
    if (!key || key.length > 200)
      throw new BadRequestException('A payment attempt key is required.');
    const reusable = await this.reusableLink(scope, bookingId);
    if (reusable) return reusable;
    const verified = await this.financial.refresh(scope, bookingId);
    const intent = await this.db.withTenantTransaction(scope, async (tx) => {
      const bookings = await tx.$queryRaw<
        Array<{
          status: string;
          currency: string;
          total: string;
          paid: string;
          enabled: boolean;
          orderReference: string | null;
          balanceManagedInClock: boolean;
          version: number;
          refunded: string;
        }>
      >`
    SELECT (b.external_booking_id IS NOT NULL AND b.external_reference LIKE 'CLOCK-%') AS "balanceManagedInClock",b.version,COALESCE((SELECT sum(amount) FROM payments rf WHERE rf.tenant_id=b.tenant_id AND rf.property_id=b.property_id AND rf.booking_id=b.id AND rf.kind='REFUND' AND rf.status='REFUNDED'),0)::text AS refunded,b.status::text AS status,rp.currency,b.total_amount::text AS total,(p.pokpay_enabled AND EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections ic ON ic.tenant_id=pc.tenant_id AND ic.id=pc.connection_id WHERE pc.tenant_id=p.tenant_id AND pc.property_id=p.id AND pc.enabled AND ic.provider='POKPAY' AND ic.status='CONNECTED')) AS enabled,b.order_reference AS "orderReference",
      COALESCE((SELECT SUM(amount) FROM payments c WHERE c.tenant_id=b.tenant_id AND c.property_id=b.property_id AND c.booking_id=b.id AND c.kind='CHARGE' AND c.status IN ('PAID','succeeded')),0)::text AS paid
    FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
    WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid FOR UPDATE OF b`;
      const b = bookings[0];
      if (!b) throw new NotFoundException('Booking not found.');
      if (b.balanceManagedInClock && !verified)
        throw new ConflictException(
          'Earlier payments for this imported booking are managed in Clock. Verify its balance in Clock before collecting money.',
        );
      if (b.status !== 'CONFIRMED')
        throw new ConflictException('Confirm the booking before collecting a balance.');
      if (b.orderReference)
        throw new ConflictException(
          'Collect shared-order payments through the original order checkout.',
        );
      if (!b.enabled)
        throw new ConflictException(
          'Enable a connected PokPay payment method for this hotel first.',
        );
      if (verified) {
        const binding = await tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT connection_id AS id FROM property_integration_connections WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND kind='PMS' AND enabled FOR SHARE`;
        if (binding[0]?.id !== verified.connectionId)
          throw new ConflictException(
            'Clock connection changed during verification. Reload and retry.',
          );
      }
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
        : new Prisma.Decimal(b.total).minus(b.paid).toFixed(2);
      if (new Prisma.Decimal(amount).lte(0))
        throw new ConflictException('This booking has no outstanding balance.');
      const existing = await tx.$queryRaw<
        Operation[]
      >`SELECT id,result FROM integration_operations WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND aggregate_id=${bookingId}::uuid AND result->>'kind'='balance_collection' AND result->>'stage' IN ('PREPARING','READY','UNCERTAIN') ORDER BY created_at DESC LIMIT 1`;
      if (existing[0]) {
        if (
          existing[0].result.stage === 'READY' &&
          existing[0].result.amount === amount &&
          existing[0].result.currency === b.currency
        )
          return { ...existing[0], existing: true };
        throw new ConflictException(
          'An existing payment link needs review. Do not create another charge while its result is uncertain or the balance has changed.',
        );
      }
      const id = randomUUID();
      const result: Collection = {
        kind: 'balance_collection',
        ...(verified ? { clockConnectionId: verified.connectionId } : {}),
        amount,
        currency: b.currency,
        stage: 'PREPARING',
      };
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ bookingId, amount, currency: b.currency }))
        .digest('hex');
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO integration_operations(id,tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,result)
    VALUES(${id}::uuid,${scope.tenantId}::uuid,${scope.propertyId}::uuid,${'collect:' + key},${bookingId}::uuid,${requestHash},'PENDING',${JSON.stringify(result)}::jsonb)
    ON CONFLICT(tenant_id,idempotency_key) DO NOTHING RETURNING id`;
      if (!rows[0])
        throw new ConflictException('This payment attempt was already used. Reload the booking.');
      await this.audit.recordInTransaction(tx, {
        ...scope,
        actorUserId,
        action: 'payment.collection_requested',
        operationId: id,
        targetType: 'booking',
        targetId: bookingId,
        details: { operationId: id, amount, currency: b.currency },
      });
      return { id, result, existing: false };
    });
    if (intent.existing)
      return {
        checkoutUrl: intent.result.checkoutUrl,
        orderId: intent.result.externalPaymentId,
        amount: { amount: intent.result.amount, currency: intent.result.currency },
      };
    const origin = process.env.WEB_APP_URL ?? 'http://localhost:3001';
    let checkout;
    try {
      checkout = await this.providers.pokpay.createCheckoutSession(scope, {
        idempotencyKey: intent.id,
        bookingId,
        amount: { amount: intent.result.amount, currency: intent.result.currency },
        successUrl: new URL(
          `/bookings/${bookingId}/payment/success?${new URLSearchParams(scope)}`,
          origin,
        ).toString(),
        cancelUrl: new URL(
          `/bookings/${bookingId}/payment/cancel?${new URLSearchParams(scope)}`,
          origin,
        ).toString(),
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
          tx.$executeRaw`UPDATE integration_operations SET status='FAILED',result=jsonb_set(result,'{stage}','"UNCERTAIN"'::jsonb),updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${intent.id}::uuid`,
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
          reason:
            'The provider did not confirm checkout creation. The saved attempt requires review.',
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
    };
    await this.db.withTenantTransaction(scope, async (tx) => {
      await tx.$executeRaw`INSERT INTO payment_provider_sessions(tenant_id,property_id,booking_id,provider,external_payment_id) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${bookingId}::uuid,'pokpay',${checkout.value.id}) ON CONFLICT(tenant_id,provider,external_payment_id) DO NOTHING`;
      await tx.$executeRaw`UPDATE integration_operations SET status='COMPLETED',external_reference=${checkout.value.id},result=${JSON.stringify(ready)}::jsonb,updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${intent.id}::uuid`;
    });
    await this.audit.record({
      ...scope,
      actorUserId,
      action: 'payment.checkout_ready',
      targetType: 'booking',
      targetId: bookingId,
      operationId: intent.id,
      source: 'POKPAY',
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
  private async reusableLink(scope: Scope, bookingId: string) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ result: Collection }>>`
        SELECT op.result FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
        JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
        JOIN integration_operations op ON op.tenant_id=b.tenant_id AND op.property_id=b.property_id AND op.aggregate_id=b.id
        LEFT JOIN property_integration_connections pc ON pc.tenant_id=b.tenant_id AND pc.property_id=b.property_id AND pc.enabled AND pc.kind='PMS'
        LEFT JOIN clock_sync_jobs j ON j.tenant_id=b.tenant_id AND j.property_id=b.property_id AND j.connection_id=pc.connection_id AND j.resource='financial:'||b.id::text
        WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid
          AND b.status='CONFIRMED' AND b.order_reference IS NULL AND p.pokpay_enabled
          AND op.result->>'kind'='balance_collection' AND op.result->>'stage'='READY'
          AND op.result->>'checkoutUrl' IS NOT NULL AND op.updated_at>now()-interval '15 minutes'
          AND op.result->>'currency'=rp.currency
          AND EXISTS(SELECT 1 FROM property_integration_connections pay JOIN integration_connections ic ON ic.tenant_id=pay.tenant_id AND ic.id=pay.connection_id WHERE pay.tenant_id=b.tenant_id AND pay.property_id=b.property_id AND pay.enabled AND ic.provider='POKPAY' AND ic.status='CONNECTED')
          AND CASE WHEN op.result->>'clockConnectionId' IS NULL THEN
            b.external_booking_id IS NULL AND (op.result->>'amount')::numeric=b.total_amount-COALESCE((SELECT sum(amount) FROM payments a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.booking_id=b.id AND a.kind='CHARGE' AND a.status IN ('PAID','succeeded')),0)
          ELSE j.status='SYNCED' AND j.last_error IS NULL AND j.snapshot->>'fetchedAt' IS NOT NULL
            AND (j.snapshot->>'fetchedAt')::timestamptz>now()-interval '60 seconds'
            AND op.result->>'clockConnectionId'=pc.connection_id::text
            AND (j.snapshot->>'bookingVersion')::int=b.version
            AND j.snapshot->'balance'->>'currency'=rp.currency
            AND (j.snapshot->'balance'->>'amount')::numeric>0
            AND (j.snapshot->'balance'->>'amount')::numeric=(op.result->>'amount')::numeric
            AND (j.snapshot->>'localPaid')::numeric=COALESCE((SELECT sum(amount) FROM payments a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.booking_id=b.id AND a.kind='CHARGE' AND a.status IN ('PAID','succeeded')),0)
            AND (j.snapshot->>'localRefunded')::numeric=COALESCE((SELECT sum(amount) FROM payments a WHERE a.tenant_id=b.tenant_id AND a.property_id=b.property_id AND a.booking_id=b.id AND a.kind='REFUND' AND a.status='REFUNDED'),0)
          END
        ORDER BY op.created_at DESC LIMIT 1 FOR SHARE OF b`;
      const saved = rows[0]?.result;
      return saved?.checkoutUrl
        ? {
            checkoutUrl: saved.checkoutUrl,
            orderId: saved.externalPaymentId,
            amount: { amount: saved.amount, currency: saved.currency },
          }
        : null;
    });
  }
  async sendLink(scope: Scope, bookingId: string, actorUserId: string, key: string) {
    const initial = await this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ url: string; amount: string; currency: string }>>`
        SELECT op.result->'value'->>'checkoutUrl' AS url,b.total_amount::text AS amount,rp.currency
        FROM bookings b JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id
        JOIN rate_plans rp ON rp.tenant_id=b.tenant_id AND rp.property_id=b.property_id AND rp.id=b.rate_plan_id
        JOIN LATERAL (SELECT result FROM integration_operations WHERE tenant_id=b.tenant_id AND property_id=b.property_id AND external_entity_id=b.id AND status='SUCCEEDED' AND result->'value'->>'checkoutUrl' IS NOT NULL ORDER BY created_at DESC LIMIT 1) op ON true
        WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid
        AND b.status='PAYMENT_PENDING' AND b.payment_method='POKPAY'
        AND b.created_at>now()-make_interval(mins=>p.online_payment_hold_minutes)`;
      const row = rows[0];
      return row
        ? { checkoutUrl: row.url, amount: { amount: row.amount, currency: row.currency } }
        : null;
    });
    const checkout = initial ?? (await this.start(scope, bookingId, actorUserId, key));
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) => tx.$queryRaw<
        Array<{
          email: string | null;
          reference: string;
          name: string;
          logoUrl: string | null;
          supportEmail: string | null;
        }>
      >`
   SELECT ${bookingContactSql.email} AS email,b.external_reference AS reference,p.name,p.logo_url AS "logoUrl",p.support_email AS "supportEmail"
   FROM bookings b LEFT JOIN guests g ON g.tenant_id=b.tenant_id AND g.id=b.guest_id JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id JOIN room_types rt ON rt.tenant_id=b.tenant_id AND rt.property_id=b.property_id AND rt.id=b.room_type_id
   WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid`,
    );
    const row = rows[0];
    if (!row?.email)
      throw new ConflictException('Add a verified guest email before sending a payment link.');
    const amount = `${checkout.amount.amount} ${checkout.amount.currency}`;
    // The hotel's own wording and branding; staff asked for this one, so the topic switch does not hold it.
    await this.lifecycle.guest(scope, {
      topic: 'payment_pending',
      key: 'payment_pending',
      eventType: 'payment.link',
      idempotencyKey: `balance-link/${scope.propertyId}/${key}`,
      bookingId,
      heading: 'Pay your booking balance',
      values: { payment_link: checkout.checkoutUrl!, payment_due: amount },
      rows: [{ label: 'Amount', value: amount }],
      cta: { label: 'Pay securely with PokPay', url: checkout.checkoutUrl! },
      force: true,
    });
    await this.audit.record({
      ...scope,
      actorUserId,
      action: 'payment.link_requested',
      targetType: 'booking',
      targetId: bookingId,
      details: { recipient: row.email, amount: checkout.amount },
    });
    return { queued: true, orderId: 'orderId' in checkout ? checkout.orderId : undefined };
  }
  async refresh(scope: Scope, bookingId: string, orderId?: string) {
    if (orderId !== undefined && (!orderId.trim() || orderId.length > 320))
      throw new BadRequestException('Choose a valid payment attempt.');
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{ externalReference: string }>
        >`SELECT external_reference AS "externalReference" FROM integration_operations WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND aggregate_id=${bookingId}::uuid AND result->>'kind'='balance_collection' AND result->>'stage' IN ('READY','PAID') AND external_reference IS NOT NULL AND (${orderId ?? null}::text IS NULL OR external_reference=${orderId ?? null}) ORDER BY created_at DESC LIMIT 1`,
    );
    if (!rows[0]) {
      if (orderId)
        throw new NotFoundException('This payment attempt does not belong to the reservation.');
      return { paid: false, orderId: null };
    }
    // Never let an older successful order confirm a newer checkout.
    const selected = rows[0].externalReference;
    const result = await this.process(scope, bookingId, selected);
    return {
      paid: result?.ok === true,
      orderId: selected,
      ...(result && !result.ok ? { message: result.error.message } : {}),
    };
  }
  async process(
    scope: Scope,
    bookingId: string,
    orderId: string,
  ): Promise<Result<{ duplicate: boolean }> | null> {
    const ops = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Operation[]
        >`SELECT id,result FROM integration_operations WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND aggregate_id=${bookingId}::uuid AND external_reference=${orderId} AND result->>'kind'='balance_collection' LIMIT 1`,
    );
    const op = ops[0];
    if (!op) return null;
    if (op.result.stage === 'PAID') {
      const recorded = await this.db.withTenantTransaction(
        scope,
        (tx) =>
          tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM payments WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND booking_id=${bookingId}::uuid AND provider='pokpay' AND external_payment_id=${orderId} AND kind='CHARGE' AND status='PAID' AND amount=${op.result.amount}::numeric AND currency=${op.result.currency}`,
      );
      if (recorded[0]) {
        await this.sendReceiptSafely(scope, bookingId, orderId, op.result);
        return { ok: true as const, value: { duplicate: true } };
      }
      return {
        ok: false as const,
        error: {
          code: 'COLLECTION_REQUIRES_REVIEW',
          message: 'The saved payment and ledger need review.',
          retryable: false,
        },
      };
    }
    const payment = await this.providers.pokpay.getPayment(scope, orderId);
    if (
      !payment ||
      payment.id !== orderId ||
      new Prisma.Decimal(payment.amount.amount).toFixed(2) !== op.result.amount ||
      payment.amount.currency !== op.result.currency
    )
      return {
        ok: false,
        error: {
          code: 'COLLECTION_BINDING_INVALID',
          message: 'The payment does not match this saved collection.',
          retryable: false,
        },
      };
    if (!['CAPTURED', 'PAID', 'COMPLETED'].includes(payment.status))
      return {
        ok: false,
        error: {
          code: 'COLLECTION_NOT_PAID',
          message: 'Payment has not completed.',
          retryable: true,
        },
      };
    const clockCheck = op.result.clockConnectionId
      ? await this.financial.refresh(scope, bookingId).catch(() => null)
      : null;
    const result = await this.db.withTenantTransaction(
      scope,
      async (tx) => {
        const bookings = await tx.$queryRaw<
          Array<{ status: string; total: string; paid: string }>
        >`SELECT b.status::text AS status,b.total_amount::text AS total,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.tenant_id=b.tenant_id AND p.property_id=b.property_id AND p.booking_id=b.id AND p.kind='CHARGE' AND p.status IN ('PAID','succeeded')),0)::text AS paid FROM bookings b WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid FOR UPDATE`;
        const b = bookings[0];
        if (!b) throw new NotFoundException('Booking not found.');
        const inserted = await tx.$queryRaw<
          Array<{ id: string }>
        >`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,${bookingId}::uuid,'CHARGE','pokpay',${orderId},'PAID',${op.result.amount}::numeric,${op.result.currency}) ON CONFLICT(tenant_id,external_payment_id) DO NOTHING RETURNING id`;
        if (!inserted[0]) return { ok: true as const, value: { duplicate: true } };
        const binding = op.result.clockConnectionId
          ? await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT connection_id AS id FROM property_integration_connections WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND kind='PMS' AND enabled FOR SHARE`
          : null;
        const needsReview =
          b.status !== 'CONFIRMED' ||
          (op.result.clockConnectionId
            ? binding?.[0]?.id !== op.result.clockConnectionId ||
              !clockCheck ||
              clockCheck.connectionId !== op.result.clockConnectionId ||
              clockCheck.balance.currency !== op.result.currency ||
              new Prisma.Decimal(clockCheck.balance.amount).lt(op.result.amount)
            : new Prisma.Decimal(b.paid).plus(op.result.amount).gt(b.total));
        if (needsReview)
          await tx.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message) VALUES(${scope.tenantId}::uuid,${scope.propertyId}::uuid,'PAYMENT_BOOKING_MISMATCH','booking',${bookingId},'A saved payment link was paid after the booking or outstanding balance changed. The received money is recorded; review any refund due.')`;

        if (
          (!binding || binding[0]?.id === op.result.clockConnectionId) &&
          b.status === 'CONFIRMED' &&
          (await this.connections.activePmsConnectionCredentials(scope.tenantId, scope.propertyId))
            ?.provider === 'CLOCK_PMS'
        )
          await this.clock.postDeposit(
            tx,
            scope,
            bookingId,
            { amount: op.result.amount, currency: op.result.currency },
            'PokPay',
            orderId,
            'on-line',
            op.id,
          );
        await tx.$executeRaw`UPDATE integration_operations SET result=jsonb_set(result,'{stage}','"PAID"'::jsonb),updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${op.id}::uuid`;
        await this.audit.recordInTransaction(tx, {
          ...scope,
          actorUserId: null,
          action: 'payment.balance_collected',
          operationId: op.id,
          targetType: 'booking',
          targetId: bookingId,
          details: {
            amount: { amount: op.result.amount, currency: op.result.currency },
            externalPaymentId: orderId,
            needsReview,
          },
        });
        return { ok: true as const, value: { duplicate: false } };
      },
      { timeoutMs: 90000 },
    );
    if (result.ok) await this.sendReceiptSafely(scope, bookingId, orderId, op.result);
    return result;
  }
  private async sendReceiptSafely(
    scope: Scope,
    bookingId: string,
    orderId: string,
    collection: Collection,
  ) {
    try {
      await this.sendReceipt(scope, bookingId, orderId, collection);
    } catch {
      this.logger.error(
        `Receipt could not be queued for recorded payment ${orderId}; a later payment check can retry delivery without charging again.`,
      );
    }
  }
  private async sendReceipt(
    scope: Scope,
    bookingId: string,
    orderId: string,
    collection: Collection,
  ) {
    const email = {
      topic: 'payment_received' as const,
      eventType: 'payment.received',
      idempotencyKey: `balance-receipt/${orderId}`,
      bookingId,
      heading: 'Payment received',
      values: { payment_amount: `${collection.amount} ${collection.currency}` },
      rows: [
        { label: 'Payment method', value: 'PokPay' },
        { label: 'Amount received', value: `${collection.amount} ${collection.currency}` },
      ],
    };
    await this.lifecycle.guest(scope, { ...email, key: 'payment_received' });
    await this.lifecycle.staff(scope, {
      ...email,
      key: 'staff_payment_received',
      idempotencyKey: `balance-receipt/staff/${orderId}`,
    });
  }
}
