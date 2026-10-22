import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
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
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { renderBrandedEmail } from '../mail/email-layout';
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
  constructor(
    @Inject(TenantDatabaseService) private readonly db: TenantDatabaseService,
    @Inject(PaymentProviderRegistry) private readonly providers: PaymentProviderRegistry,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(ClockBookingService) private readonly clock: ClockBookingService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
    @Inject(ClockFinancialService) private readonly financial: ClockFinancialService,
  ) {}
  async options(scope: Scope, bookingId: string) {
    return this.db.withTenantTransaction(scope, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ pokpay: boolean }>
      >`SELECT (b.external_booking_id IS NULL OR b.external_reference NOT LIKE 'CLOCK-%' OR EXISTS(SELECT 1 FROM clock_sync_jobs j JOIN property_integration_connections ap ON ap.tenant_id=j.tenant_id AND ap.property_id=j.property_id AND ap.connection_id=j.connection_id AND ap.enabled AND ap.kind='PMS' WHERE j.tenant_id=b.tenant_id AND j.property_id=b.property_id AND j.resource='financial:'||b.id::text AND j.last_success_at>now()-interval '5 minutes' AND (j.snapshot->'balance'->>'amount')::numeric>0)) AND p.pokpay_enabled AND EXISTS(SELECT 1 FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id=pc.tenant_id AND c.id=pc.connection_id WHERE pc.tenant_id=p.tenant_id AND pc.property_id=p.id AND pc.enabled AND c.provider='POKPAY' AND c.status='CONNECTED') AS pokpay FROM properties p JOIN bookings b ON b.tenant_id=p.tenant_id AND b.property_id=p.id WHERE p.tenant_id=${scope.tenantId}::uuid AND p.id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid`;
      if (!rows[0]) throw new NotFoundException('Booking not found.');
      return rows[0];
    });
  }
  async start(scope: Scope, bookingId: string, actorUserId: string, key: string) {
    if (!key || key.length > 200)
      throw new BadRequestException('A payment attempt key is required.');
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
        targetType: 'booking',
        targetId: bookingId,
        details: { operationId: id, amount, currency: b.currency },
      });
      return { id, result, existing: false };
    });
    if (intent.existing)
      return {
        checkoutUrl: intent.result.checkoutUrl,
        amount: { amount: intent.result.amount, currency: intent.result.currency },
      };
    const origin = process.env.WEB_APP_URL ?? 'http://localhost:3001';
    let checkout;
    try {
      checkout = await this.providers.pokpay.createCheckoutSession(scope, {
        idempotencyKey: intent.id,
        bookingId,
        amount: { amount: intent.result.amount, currency: intent.result.currency },
        successUrl: new URL(`/bookings/${bookingId}/payment/success`, origin).toString(),
        cancelUrl: new URL(`/bookings/${bookingId}/payment/cancel`, origin).toString(),
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
    return {
      checkoutUrl: ready.checkoutUrl,
      amount: { amount: ready.amount, currency: ready.currency },
    };
  }
  async sendLink(scope: Scope, bookingId: string, actorUserId: string, key: string) {
    const checkout = await this.start(scope, bookingId, actorUserId, key);
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
    const subject = `Payment link - ${row.reference}`;
    const amount = `${checkout.amount.amount} ${checkout.amount.currency}`;
    const text = `Please pay ${amount} for your existing booking ${row.reference} at ${row.name}: ${checkout.checkoutUrl}`;
    await this.delivery.dispatch(
      'rendered',
      {
        to: row.email,
        subject,
        text,
        html: renderBrandedEmail({
          subject,
          brand: { name: row.name, logoUrl: row.logoUrl, supportEmail: row.supportEmail },
          heading: 'Pay your booking balance',
          content: '<p>Use the secure payment page below to settle your existing reservation.</p>',
          summaryRows: [
            { label: 'Booking', value: row.reference },
            { label: 'Amount', value: amount },
          ],
          cta: { label: 'Pay securely with PokPay', url: checkout.checkoutUrl! },
        }),
        idempotencyKey: `balance-link/${scope.propertyId}/${key}`,
        eventType: 'payment.link',
        bookingId,
      },
      scope,
    );
    await this.audit.record({
      ...scope,
      actorUserId,
      action: 'payment.link_requested',
      targetType: 'booking',
      targetId: bookingId,
      details: { recipient: row.email, amount: checkout.amount },
    });
    return { queued: true };
  }
  async refresh(scope: Scope, bookingId: string) {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) =>
        tx.$queryRaw<
          Array<{ externalReference: string }>
        >`SELECT external_reference AS "externalReference" FROM integration_operations WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND aggregate_id=${bookingId}::uuid AND result->>'kind'='balance_collection' AND result->>'stage' IN ('READY','PAID') AND external_reference IS NOT NULL ORDER BY created_at DESC LIMIT 5`,
    );
    let paid = false;
    for (const row of rows) {
      const result = await this.process(scope, bookingId, row.externalReference);
      paid ||= result?.ok === true;
    }
    return { paid };
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
          );
        await tx.$executeRaw`UPDATE integration_operations SET result=jsonb_set(result,'{stage}','"PAID"'::jsonb),updated_at=now() WHERE tenant_id=${scope.tenantId}::uuid AND property_id=${scope.propertyId}::uuid AND id=${op.id}::uuid`;
        await this.audit.recordInTransaction(tx, {
          ...scope,
          actorUserId: null,
          action: 'payment.balance_collected',
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
    if (result.ok) await this.sendReceipt(scope, bookingId, orderId, op.result);
    return result;
  }
  private async sendReceipt(
    scope: Scope,
    bookingId: string,
    orderId: string,
    collection: Collection,
  ) {
    const rows = await this.db.withTenantTransaction(
      scope,
      (tx) => tx.$queryRaw<
        Array<{
          email: string | null;
          reference: string;
          name: string;
          logoUrl: string | null;
          supportEmail: string | null;
          brandColour: string | null;
          phone: string | null;
          address: string | null;
          startsOn: string;
          endsOn: string;
          roomName: string;
          guests: number;
        }>
      >`
   SELECT ${bookingContactSql.email} AS email,b.external_reference AS reference,p.name,p.logo_url AS "logoUrl",p.support_email AS "supportEmail",p.brand_colour AS "brandColour",p.phone,p.address,b.starts_on::text AS "startsOn",b.ends_on::text AS "endsOn",rt.name AS "roomName",(b.adults+b.children) AS guests
   FROM bookings b LEFT JOIN guests g ON g.tenant_id=b.tenant_id AND g.id=b.guest_id JOIN properties p ON p.tenant_id=b.tenant_id AND p.id=b.property_id JOIN room_types rt ON rt.tenant_id=b.tenant_id AND rt.property_id=b.property_id AND rt.id=b.room_type_id
   WHERE b.tenant_id=${scope.tenantId}::uuid AND b.property_id=${scope.propertyId}::uuid AND b.id=${bookingId}::uuid`,
    );
    const row = rows[0];
    if (!row?.email) return;
    const subject = `Payment received - ${row.reference}`;
    const amount = `${collection.amount} ${collection.currency}`;
    const text = `We received your payment of ${amount} for booking ${row.reference} at ${row.name}. Stay: ${row.startsOn} to ${row.endsOn}. Room type: ${row.roomName}. Guests: ${row.guests}. Keep this receipt with your booking confirmation.`;
    await this.delivery.dispatch(
      'rendered',
      {
        to: row.email,
        subject,
        text,
        html: renderBrandedEmail({
          subject,
          brand: {
            name: row.name,
            logoUrl: row.logoUrl,
            supportEmail: row.supportEmail,
            brandColour: row.brandColour,
            phone: row.phone,
            address: row.address,
          },
          heading: 'Payment received',
          content:
            '<p>Thank you. Your payment has been recorded against your existing reservation.</p>',
          summaryRows: [
            { label: 'Booking', value: row.reference },
            { label: 'Stay', value: `${row.startsOn} to ${row.endsOn}` },
            { label: 'Room type', value: row.roomName },
            { label: 'Guests', value: String(row.guests) },
            { label: 'Payment method', value: 'PokPay' },
            { label: 'Amount received', value: amount },
          ],
        }),
        idempotencyKey: `balance-receipt/${orderId}`,
        eventType: 'payment.received',
        bookingId,
      },
      scope,
    );
  }
}
