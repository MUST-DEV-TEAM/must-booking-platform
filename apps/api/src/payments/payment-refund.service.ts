import { bookingContactSql } from '../booking/booking-contact';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  type RefundReason,
  REFUND_REASONS,
  type MailBrand,
  type Money,
  type Payment,
  type PaymentProviderContext,
  type Result,
} from '@must/domain-contracts';

import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import { PaymentProviderRegistry } from './payment-provider-registry';
import { NotificationsService } from '../tenancy/notifications.service';
import { ClockBookingService } from '../integrations/clock/clock-booking.service';
import { ManualReviewService } from '../integrations/manual-review.service';

type Charge = {
  id: string;
  provider: string;
  externalPaymentId: string;
  amount: string;
  currency: string;
  status: string;
  chargeCount?: number;
};

type ManualRefundCommand = {
  bookingId: string;
  idempotencyKey: string;
  amount?: Money;
  percentage?: number;
  reasonCode?: RefundReason;
  note?: string;
  actorUserId: string;
};

type OperationRow = { requestHash: string; result: Result<Payment> | null };

export type RefundConfirmation = {
  bookingId: string;
  bookingReference: string;
  refundId: string;
  to: string;
  amount: Money;
  brand: MailBrand & {
    brandColour?: string | null;
    emailFooterText?: string | null;
    termsUrl?: string | null;
  };
  guest: { name: string };
  stay: { startsOn: string; endsOn: string };
  roomName: string;
  guestCount: number;
  nightlyRates?: Array<{ date: string; amount: string }>;
};

type RefundChargeOutcome = {
  result: Result<Payment>;
  confirmation: RefundConfirmation | null;
  /** Present only when this call created a new local refund row. Automatic
   * cancellation refunds deliberately ignore it; Task 11's Clock sync is
   * specifically for the staff/manual-refund command. */
  clockRefund: { amount: Money; refundId: string } | null;
};

type RefundEmailRow = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  externalReference: string;
  startsOn: string;
  endsOn: string;
  guestCount: number;
  nightlyRates: Array<{ date: string; amount: string }> | null;
  roomName: string;
  propertyName: string;
  brandColour: string | null;
  emailFooterText: string | null;
  termsUrl: string | null;
  logoUrl: string | null;
  supportEmail: string | null;
  phone: string | null;
  websiteUrl: string | null;
  address: string | null;
};

export function percentageRefundMinorUnits(amount: string, percentage: number): bigint | null {
  if (!Number.isFinite(percentage) || percentage < 1 || percentage > 100) return null;
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(percentage));
  if (!match) return null;
  const [wholeAmount, fractionAmount = ''] = amount.split('.');
  const originalMinorUnits =
    BigInt(wholeAmount || '0') * 100n + BigInt(fractionAmount.padEnd(2, '0'));
  const fraction = match[2] ?? '';
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(match[1]) * scale + BigInt(fraction || '0');
  const denominator = 100n * scale;
  return (originalMinorUnits * numerator + denominator / 2n) / denominator;
}

/** How long after a cancellation a refund can still be made from Payments. */
const REFUND_WINDOW_HOURS = 24;

@Injectable()
export class PaymentRefundService {
  private readonly logger = new Logger(PaymentRefundService.name);

  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(PaymentProviderRegistry) private readonly paymentProviders: PaymentProviderRegistry,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
    @Inject(NotificationsService) private readonly inAppNotifications: NotificationsService,
    @Inject(ClockBookingService) private readonly clockBooking: ClockBookingService,
    @Inject(ManualReviewService) private readonly manualReview: ManualReviewService,
  ) {}

  async refundPaidChargeForBooking(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    idempotencyKey: string,
  ): Promise<{ result: Result<Payment | null>; confirmation: RefundConfirmation | null }> {
    const charge = await this.chargeForBooking(tx, context, bookingId, ['PAID']);
    if (!charge) return { result: { ok: true, value: null }, confirmation: null };
    const outcome = await this.refundCharge(tx, context, bookingId, charge, {
      amount: { amount: charge.amount, currency: charge.currency },
      idempotencyKey,
    });
    return { result: outcome.result, confirmation: outcome.confirmation };
  }

  /** A multi-room order captures one gateway charge on its anchor booking, while
   * cancellation policy is evaluated per child. This is the bounded partial-refund
   * variant used by that order cancellation path. */
  async refundPaidChargeForBookingAmount(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    amount: Money,
    idempotencyKey: string,
    metadata?: { actorUserId: string; note: string },
  ): Promise<{ result: Result<Payment | null>; confirmation: RefundConfirmation | null }> {
    const charge = await this.chargeForBooking(tx, context, bookingId, ['PAID']);
    if (!charge) return { result: { ok: true, value: null }, confirmation: null };
    const alreadyRefunded = await this.refundedAmount(tx, context, bookingId);
    const remaining = this.minorUnits(charge.amount) - alreadyRefunded;
    if (
      amount.currency !== charge.currency ||
      !this.validMoney(amount.amount) ||
      this.minorUnits(amount.amount) > remaining
    )
      return {
        result: this.failure(
          'INVALID_REFUND_AMOUNT',
          'Refund amount exceeds the remaining booking charge.',
        ),
        confirmation: null,
      };
    const outcome = await this.refundCharge(tx, context, bookingId, charge, {
      amount,
      idempotencyKey,
      ...metadata,
    });
    return { result: outcome.result, confirmation: outcome.confirmation };
  }

  async refundCharge(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    charge: Pick<Charge, 'provider' | 'externalPaymentId' | 'amount' | 'currency' | 'chargeCount'>,
    command: {
      amount: Money;
      idempotencyKey: string;
      actorUserId?: string;
      note?: string;
      reasonCode?: RefundReason;
    },
  ): Promise<RefundChargeOutcome> {
    if ((charge.chargeCount ?? 1) > 1)
      return {
        result: this.failure(
          'REFUND_ALLOCATION_REVIEW_REQUIRED',
          'This booking has several payments. Review the original payments before refunding; no money has been returned.',
        ),
        confirmation: null,
        clockRefund: null,
      };
    if (charge.provider === 'manual')
      return this.recordManualRefund(tx, context, bookingId, charge, command);
    const provider = this.paymentProviders.forProvider(charge.provider);
    if (!provider)
      return {
        result: this.failure(
          'REFUND_PROVIDER_UNSUPPORTED',
          'This payment provider cannot refund here.',
        ),
        confirmation: null,
        clockRefund: null,
      };
    // The provider is the record of where the money really is. When it already shows this payment as refunded
    // in full but our records show less, bring our records in line instead of attempting a second refund.
    if (charge.provider === 'pokpay') {
      const synced = await this.syncRefundAlreadyDone(
        tx,
        context,
        bookingId,
        charge,
        provider,
        command,
      );
      if (synced) return synced;
    }
    const refunded = await this.gatewayRefund(
      context,
      bookingId,
      charge,
      {
        amount: command.amount,
        idempotencyKey: command.idempotencyKey,
        alreadyRefunded: {
          amount: this.money(await this.refundedAmount(tx, context, bookingId)),
          currency: charge.currency,
        },
      },
      provider,
    );
    if (!refunded.ok) {
      await this.manualReview.recordInTransaction(tx, {
        ...context,
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceType: 'booking',
        referenceId: bookingId,
        message:
          'A refund could not be confirmed. The saved gateway attempt blocks automatic retries; verify the original payment before resolving it.',
        context: {
          chargeExternalPaymentId: charge.externalPaymentId,
          amount: command.amount,
          error: refunded.error.code,
        },
      });
      await this.audit.recordInTransaction(tx, {
        ...context,
        actorUserId: command.actorUserId ?? null,
        action: 'payment.refund_unknown',
        targetType: 'booking',
        targetId: bookingId,
        operationId: command.idempotencyKey,
        source: charge.provider === 'pokpay' ? 'POKPAY' : 'STRIPE',
        details: {
          amount: command.amount,
          errorCode: refunded.error.code,
          reason: 'Refund result requires verification; retry is blocked by the saved attempt.',
        },
      });
      return { result: refunded, confirmation: null, clockRefund: null };
    }

    const completed = ['REFUNDED', 'succeeded'].includes(refunded.value.status);
    const savedStatus = completed ? 'REFUNDED' : 'REFUND_PENDING';
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payments (
        tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency, note, reason_code
      ) VALUES (
        ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookingId}::uuid,
        'REFUND'::"PaymentKind", ${charge.provider}, ${refunded.value.id}, ${savedStatus},
        ${command.amount.amount}::numeric, ${command.amount.currency}, ${command.note ?? null}, ${command.reasonCode ?? null}
      )
      ON CONFLICT (tenant_id, external_payment_id) DO NOTHING
      RETURNING id
    `;
    let confirmation: RefundConfirmation | null = null;
    if (inserted[0] && !completed) {
      await this.manualReview.recordInTransaction(tx, {
        ...context,
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceType: 'booking',
        referenceId: bookingId,
        message:
          'A refund was submitted but the provider has not confirmed completion. Verify the original payment before retrying or recording it in Clock.',
        context: {
          refundId: refunded.value.id,
          chargeExternalPaymentId: charge.externalPaymentId,
          amount: command.amount,
          providerStatus: refunded.value.status,
        },
      });
      await this.audit.recordInTransaction(tx, {
        ...context,
        actorUserId: command.actorUserId ?? null,
        action: 'payment.refund_pending',
        operationId: command.idempotencyKey,
        source:
          charge.provider === 'pokpay'
            ? 'POKPAY'
            : charge.provider === 'stripe'
              ? 'STRIPE'
              : 'MUST_STAFF',
        targetType: 'booking',
        targetId: bookingId,
        details: {
          chargeExternalPaymentId: charge.externalPaymentId,
          refundExternalPaymentId: refunded.value.id,
          amount: command.amount,
        },
      });
    }
    if (inserted[0] && completed) {
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId: command.actorUserId ?? null,
        action: 'payment.refunded',
        operationId: command.idempotencyKey,
        targetType: 'booking',
        targetId: bookingId,
        details: {
          chargeExternalPaymentId: charge.externalPaymentId,
          refundExternalPaymentId: refunded.value.id,
          amount: command.amount,
          ...(command.reasonCode ? { reasonCode: command.reasonCode } : {}),
          ...(command.note ? { note: command.note } : {}),
        },
      });
      await this.inAppNotifications.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        type: 'PAYMENT_REFUNDED',
        payload: { bookingId, refundId: refunded.value.id, amount: command.amount },
      });
      const guest = await tx.$queryRaw<Array<RefundEmailRow>>`
        SELECT ${bookingContactSql.email} AS email, ${bookingContactSql.firstName} AS "firstName", ${bookingContactSql.lastName} AS "lastName",
          b.external_reference AS "externalReference", b.starts_on::text AS "startsOn",
          b.ends_on::text AS "endsOn", (b.adults + b.children) AS "guestCount",
          b.nightly_rates AS "nightlyRates",
          COALESCE(r.name, rt.name) AS "roomName", p.name AS "propertyName",
          p.brand_colour AS "brandColour",p.email_footer_text AS "emailFooterText",p.terms_url AS "termsUrl",p.logo_url AS "logoUrl", p.support_email AS "supportEmail", p.phone,
          p.public_website_origin AS "websiteUrl", p.address
        FROM bookings b
        JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
      `;
      if (guest[0]) {
        confirmation = this.refundConfirmation(
          bookingId,
          refunded.value.id,
          guest[0],
          command.amount,
        );
      }
    }
    // StripePaymentProvider.refund has no booking context (RefundCommand doesn't carry one) and
    // returns command.paymentId (the Stripe charge/session id) in this slot as a placeholder;
    // correct it to the real booking id here, where it's actually known.
    return {
      result: { ok: true, value: { ...refunded.value, bookingId } },
      confirmation,
      clockRefund:
        inserted[0] && completed ? { amount: command.amount, refundId: refunded.value.id } : null,
    };
  }

  /**
   * The provider says this payment is already refunded in full. If our ledger shows less, the difference is
   * recorded as a refund "reconciled from the provider" (never sent again), audited and flagged for a look, so
   * every later screen agrees with the provider. Nothing is sent to the provider in this case.
   */
  private async syncRefundAlreadyDone(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    charge: Pick<Charge, 'provider' | 'externalPaymentId' | 'amount' | 'currency'>,
    provider: NonNullable<ReturnType<PaymentProviderRegistry['forProvider']>>,
    command: { actorUserId?: string },
  ): Promise<RefundChargeOutcome | null> {
    // A provider that cannot answer, or fails, never blocks a refund; the refund then goes its normal way.
    const state = await Promise.resolve()
      .then(() => provider.getPayment(context, charge.externalPaymentId))
      .catch(() => null);
    if (state?.status !== 'REFUNDED') return null;
    const missing =
      this.minorUnits(charge.amount) - (await this.refundedAmount(tx, context, bookingId));
    const behind = this.money(missing > 0n ? missing : 0n);
    if (missing > 0n) {
      const recordedId = `${charge.externalPaymentId}:refund:reconciled`;
      await tx.$executeRaw`
        INSERT INTO payments (
          tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency, note
        ) VALUES (
          ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookingId}::uuid,
          'REFUND'::"PaymentKind", ${charge.provider}, ${recordedId}, 'REFUNDED',
          ${behind}::numeric, ${charge.currency},
          'Reconciled from the payment provider: it already showed this payment as fully refunded.'
        )
        ON CONFLICT (tenant_id, external_payment_id) DO NOTHING
      `;
      await this.audit.recordInTransaction(tx, {
        ...context,
        actorUserId: command.actorUserId ?? null,
        action: 'payment.refund_reconciled',
        targetType: 'booking',
        targetId: bookingId,
        source: 'POKPAY',
        details: {
          chargeExternalPaymentId: charge.externalPaymentId,
          amount: { amount: behind, currency: charge.currency },
          reason: 'The provider showed the payment as fully refunded; the ledger was behind.',
        },
      });
      await this.manualReview.recordInTransaction(tx, {
        ...context,
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceType: 'booking',
        referenceId: bookingId,
        message: `The payment provider had already refunded this payment in full; our records were behind by ${behind} ${charge.currency} and were corrected. If the hotel system also holds this payment, check it matches.`,
        context: { chargeExternalPaymentId: charge.externalPaymentId, reconciled: true },
      });
    }
    return {
      result: this.failure(
        'REFUND_ALREADY_DONE',
        missing > 0n
          ? `The payment provider had already refunded this payment in full, so nothing new was sent. Our records were behind by ${behind} ${charge.currency}; they are now corrected.`
          : 'The payment provider shows this payment as already fully refunded, and our records agree. Nothing was sent.',
      ),
      confirmation: null,
      clockRefund: null,
    };
  }

  /** Persist before the provider call. A lost response or rolled-back booking transaction
   * must never turn the next click into a second refund. Replays restore the saved
   * provider result; unresolved outcomes block new keys for the same booking. */
  private async gatewayRefund(
    context: PaymentProviderContext,
    bookingId: string,
    charge: Pick<Charge, 'provider' | 'externalPaymentId'>,
    command: { amount: Money; idempotencyKey: string; alreadyRefunded: Money },
    provider: NonNullable<ReturnType<PaymentProviderRegistry['forProvider']>>,
  ): Promise<Result<Payment>> {
    const key = `gateway-refund:${command.idempotencyKey}`;
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          bookingId,
          provider: charge.provider,
          paymentId: charge.externalPaymentId,
          amount: command.amount,
        }),
      )
      .digest('hex');
    const prepared = await this.database.withTenantTransaction(context, async (durable) => {
      await durable.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.tenantId + ':' + context.propertyId + ':' + bookingId + ':refund'},0))`;
      const existing = await durable.$queryRaw<
        Array<{ hash: string; result: { providerResult?: Result<Payment> } }>
      >`
        SELECT request_hash AS hash,result FROM integration_operations WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND idempotency_key=${key}`;
      if (existing[0]) {
        if (existing[0].hash !== hash)
          return {
            replay: this.failure(
              'IDEMPOTENCY_KEY_CONFLICT',
              'This refund attempt belongs to another request.',
            ),
          };
        return {
          replay:
            existing[0].result?.providerResult ??
            this.failure(
              'REFUND_REQUIRES_REVIEW',
              'This refund attempt has an uncertain result. Verify the original payment before retrying.',
            ),
        };
      }
      const unresolved = await durable.$queryRaw<Array<{ id: string }>>`
        SELECT op.id FROM integration_operations op WHERE op.tenant_id=${context.tenantId}::uuid AND op.property_id=${context.propertyId}::uuid AND op.aggregate_id=${bookingId}::uuid AND op.result->>'kind'='gateway_refund'
        AND (op.result->>'stage' IS DISTINCT FROM 'RETURNED' OR NOT EXISTS (
          SELECT 1 FROM payments p WHERE p.tenant_id=op.tenant_id AND p.property_id=op.property_id AND p.booking_id=op.aggregate_id AND p.kind='REFUND' AND p.status='REFUNDED' AND p.external_payment_id=op.result#>>'{providerResult,value,id}'
        )) LIMIT 1`;
      if (unresolved[0])
        return {
          replay: this.failure(
            'REFUND_REQUIRES_REVIEW',
            'An earlier refund is pending or uncertain. Review it before requesting another refund.',
          ),
        };
      await durable.$executeRaw`INSERT INTO integration_operations(tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,result) VALUES(${context.tenantId}::uuid,${context.propertyId}::uuid,${key},${bookingId}::uuid,${hash},'PENDING',${JSON.stringify({ kind: 'gateway_refund', stage: 'PREPARING', provider: charge.provider, chargeExternalPaymentId: charge.externalPaymentId, amount: command.amount })}::jsonb)`;
      return { replay: null };
    });
    if (prepared.replay) return prepared.replay;
    let result: Result<Payment>;
    try {
      result = await provider.refund(context, { ...command, paymentId: charge.externalPaymentId });
    } catch {
      result = this.failure(
        'REFUND_REQUIRES_REVIEW',
        'The provider did not give a definite refund result. Verify the original payment before retrying.',
      );
    }
    // Even an error may follow a provider write. Preserve it and require review;
    // a new browser idempotency key cannot bypass the saved uncertain attempt.
    await this.database.withTenantTransaction(
      context,
      (durable) => durable.$executeRaw`
      UPDATE integration_operations SET status=${result.ok ? 'SUCCEEDED' : 'FAILED'}, result=result || ${JSON.stringify({ stage: result.ok ? 'RETURNED' : 'UNCERTAIN', providerResult: result })}::jsonb,updated_at=now()
      WHERE tenant_id=${context.tenantId}::uuid AND property_id=${context.propertyId}::uuid AND idempotency_key=${key} AND request_hash=${hash}`,
    );
    return result;
  }

  /**
   * A cancelled reservation can still be refunded from Payments, but only for a day after it was
   * cancelled. True when the booking is cancelled and the cancellation is older than that.
   */
  async refundWindowClosed(context: PaymentProviderContext, bookingId: string): Promise<boolean> {
    const rows = await this.database.withTenantTransaction(
      context,
      (tx) =>
        tx.$queryRaw<Array<{ closed: boolean }>>`
      SELECT (
        b.status = 'CANCELLED' AND COALESCE(
          (SELECT MAX(a.created_at) FROM audit_logs a
            WHERE a.tenant_id = b.tenant_id AND a.target_type = 'booking'
              AND a.target_id = b.id::text AND a.action = 'booking.cancelled'),
          b.updated_at
        ) < now() - make_interval(hours => ${REFUND_WINDOW_HOURS}::integer)
      ) AS closed
      FROM bookings b
      WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
    `,
    );
    return rows[0]?.closed === true;
  }

  async manualRefund(
    context: PaymentProviderContext,
    command: ManualRefundCommand,
  ): Promise<Result<Payment>> {
    if (command.reasonCode !== undefined && !REFUND_REASONS.includes(command.reasonCode))
      return this.failure('INVALID_REFUND_REASON', 'Choose a valid refund reason.');
    if (command.note !== undefined && command.note.length > 500)
      return this.failure('INVALID_REFUND_NOTE', 'Refund note must be 500 characters or fewer.');
    let confirmation: RefundConfirmation | null = null;
    const result = await this.database.withTenantTransaction(
      context,
      (tx) =>
        this.withIdempotency(tx, context, command, async () => {
          await this.lockBooking(tx, context, command.bookingId);
          if (command.amount && command.percentage !== undefined)
            return this.failure(
              'INVALID_REFUND_REQUEST',
              'Provide a fixed amount or a percentage, not both.',
            );
          if (command.percentage !== undefined && !this.validPercentage(command.percentage))
            return this.failure(
              'INVALID_REFUND_PERCENTAGE',
              'Refund percentage must be between 1 and 100.',
            );
          const charge = await this.chargeForBooking(tx, context, command.bookingId, [
            'PAID',
            'LATE_AFTER_EXPIRY',
            'succeeded',
          ]);
          if (!charge) return this.failure('CHARGE_NOT_FOUND', 'No refundable charge was found.');
          if ((charge.chargeCount ?? 1) > 1)
            return this.failure(
              'REFUND_ALLOCATION_REVIEW_REQUIRED',
              'This booking has several payments. Review the original payments before refunding; no money has been returned.',
            );
          const alreadyRefunded = await this.refundedAmount(tx, context, command.bookingId);
          const remaining = this.minorUnits(charge.amount) - alreadyRefunded;
          if (remaining <= 0n)
            return this.failure(
              'REFUND_NOT_AVAILABLE',
              'The charge has already been fully refunded.',
            );
          if (
            command.amount &&
            (command.amount.currency !== charge.currency || !this.validMoney(command.amount.amount))
          )
            return this.failure(
              'INVALID_REFUND_AMOUNT',
              'Refund amount must be positive and use the charge currency.',
            );
          const requestedAmount = command.amount
            ? this.minorUnits(command.amount.amount)
            : command.percentage !== undefined
              ? // A staff percentage means a share of what can still be refunded, not of the
                // original charge: 50% after a 50 refund of 250 is 100, not 125.
                this.percentageAmount(this.money(remaining), command.percentage)
              : remaining;
          if (requestedAmount === null || requestedAmount <= 0n) {
            return this.failure(
              'INVALID_REFUND_AMOUNT',
              'Refund amount must be positive and use the charge currency.',
            );
          }
          if (requestedAmount > remaining)
            return this.failure(
              'INVALID_REFUND_AMOUNT',
              'The requested refund exceeds what remains refundable. Refresh and review the amount.',
            );
          const amount = {
            amount: this.money(requestedAmount),
            currency: charge.currency,
          };
          const outcome = await this.refundCharge(tx, context, command.bookingId, charge, {
            amount,
            idempotencyKey: `manual-refund:${command.idempotencyKey}`,
            actorUserId: command.actorUserId,
            note: command.note,
            ...(command.reasonCode ? { reasonCode: command.reasonCode } : {}),
          });
          confirmation = outcome.confirmation;
          if (outcome.result.ok && outcome.clockRefund) {
            await this.syncManualRefundToClock(tx, context, command.bookingId, outcome.clockRefund);
          }
          return outcome.result;
        }),
      // Gateway refund plus Clock reads/posting can legitimately exceed Prisma
      // default 5s. Do not roll back its ledger after money has been returned.
      { timeoutMs: 90_000 },
    );
    if (confirmation)
      await this.notifications.sendRefundConfirmationEmailSafely(confirmation, context);
    return result;
  }

  private async recordManualRefund(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    charge: Pick<Charge, 'externalPaymentId' | 'amount' | 'currency'>,
    command: {
      amount: Money;
      actorUserId?: string;
      note?: string;
      reasonCode?: RefundReason;
      idempotencyKey?: string;
    },
  ): Promise<RefundChargeOutcome> {
    const externalPaymentId = `manual:refund:${randomUUID()}`;
    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payments (
        tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency, note, reason_code
      ) VALUES (
        ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookingId}::uuid,
        'REFUND'::"PaymentKind", 'manual', ${externalPaymentId}, 'REFUNDED',
        ${command.amount.amount}::numeric, ${command.amount.currency}, ${command.note ?? null}, ${command.reasonCode ?? null}
      )
      ON CONFLICT (tenant_id, external_payment_id) DO NOTHING
      RETURNING id
    `;
    let confirmation: RefundConfirmation | null = null;
    if (inserted[0]) {
      await this.audit.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        actorUserId: command.actorUserId ?? null,
        action: 'payment.refunded',
        operationId: command.idempotencyKey,
        targetType: 'booking',
        targetId: bookingId,
        details: {
          chargeExternalPaymentId: charge.externalPaymentId,
          refundExternalPaymentId: externalPaymentId,
          amount: command.amount,
          ...(command.reasonCode ? { reasonCode: command.reasonCode } : {}),
          ...(command.note ? { note: command.note } : {}),
        },
      });
      await this.inAppNotifications.recordInTransaction(tx, {
        tenantId: context.tenantId,
        propertyId: context.propertyId,
        type: 'PAYMENT_REFUNDED',
        payload: { bookingId, refundId: externalPaymentId, amount: command.amount },
      });
      const guest = await tx.$queryRaw<Array<RefundEmailRow>>`
        SELECT ${bookingContactSql.email} AS email, ${bookingContactSql.firstName} AS "firstName", ${bookingContactSql.lastName} AS "lastName",
          b.external_reference AS "externalReference", b.starts_on::text AS "startsOn",
          b.ends_on::text AS "endsOn", (b.adults + b.children) AS "guestCount",
          b.nightly_rates AS "nightlyRates",
          COALESCE(r.name, rt.name) AS "roomName", p.name AS "propertyName",
          p.brand_colour AS "brandColour",p.email_footer_text AS "emailFooterText",p.terms_url AS "termsUrl",p.logo_url AS "logoUrl", p.support_email AS "supportEmail", p.phone,
          p.public_website_origin AS "websiteUrl", p.address
        FROM bookings b
        JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        JOIN room_types rt ON rt.tenant_id = b.tenant_id AND rt.property_id = b.property_id AND rt.id = b.room_type_id
        LEFT JOIN rooms r ON r.tenant_id = b.tenant_id AND r.property_id = b.property_id AND r.id = b.room_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
      `;
      if (guest[0])
        confirmation = this.refundConfirmation(
          bookingId,
          externalPaymentId,
          guest[0],
          command.amount,
        );
    }
    return {
      result: {
        ok: true,
        value: {
          id: externalPaymentId,
          bookingId,
          amount: command.amount,
          status: 'REFUNDED',
        },
      },
      confirmation,
      clockRefund: inserted[0] ? { amount: command.amount, refundId: externalPaymentId } : null,
    };
  }

  /** Task 11: the gateway refund and MUST ledger remain authoritative. Clock
   * is a downstream accounting mirror, so any Clock failure is deliberately
   * swallowed after a tenant/property-scoped review item is recorded. */
  private async syncManualRefundToClock(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    refund: { amount: Money; refundId: string },
  ): Promise<void> {
    try {
      await this.clockBooking.postRefund(
        tx,
        context,
        bookingId,
        refund.amount,
        `must-refund:${refund.refundId}`,
      );
    } catch (error) {
      // ClockBookingService normally returns a Result and records the review
      // itself. This is the last-resort boundary for an unexpected adapter or
      // transport exception: never let it roll back money already returned by
      // the gateway.
      this.logger.error(
        `Clock refund sync crashed for booking ${bookingId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      try {
        await this.manualReview.recordInTransaction(tx, {
          tenantId: context.tenantId,
          propertyId: context.propertyId,
          category: 'PAYMENT_BOOKING_MISMATCH',
          referenceType: 'booking',
          referenceId: bookingId,
          message:
            'The refund succeeded in MUST, but Clock refund synchronization failed unexpectedly. Post the negative payment to the original Clock deposit folio and issue the Deposit Adjustment manually.',
          context: { refundId: refund.refundId, amount: refund.amount },
        });
        await this.inAppNotifications.recordInTransaction(tx, {
          tenantId: context.tenantId,
          propertyId: context.propertyId,
          type: 'BOOKING_NEEDS_ATTENTION',
          payload: { bookingId, reason: 'clock_refund_sync_unexpected_failure' },
        });
      } catch (reviewError) {
        this.logger.error(
          `Could not record Clock refund-sync review for booking ${bookingId}: ${reviewError instanceof Error ? reviewError.message : String(reviewError)}`,
        );
      }
    }
  }

  private async chargeForBooking(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    statuses: string[],
  ): Promise<Charge | null> {
    const rows = await tx.$queryRaw<Charge[]>`
      SELECT id, provider, external_payment_id AS "externalPaymentId", amount::text AS amount,
        currency, status
      FROM payments
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND booking_id = ${bookingId}::uuid AND kind = 'CHARGE'::"PaymentKind"
      ORDER BY created_at DESC
    `;
    const eligible = rows.filter((row) => statuses.includes(row.status));
    return eligible[0] ? { ...eligible[0], chargeCount: eligible.length } : null;
  }

  private async refundedAmount(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ amount: string }>>`
      SELECT COALESCE(SUM(amount), 0)::text AS amount
      FROM payments
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND booking_id = ${bookingId}::uuid AND kind = 'REFUND'::"PaymentKind"
    `;
    return this.minorUnits(rows[0]?.amount ?? '0');
  }

  private async lockBooking(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
  ): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings
      WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid
        AND property_id = ${context.propertyId}::uuid
      FOR UPDATE
    `;
  }

  private async withIdempotency(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    command: ManualRefundCommand,
    execute: () => Promise<Result<Payment>>,
  ): Promise<Result<Payment>> {
    if (!command.idempotencyKey.trim())
      return this.failure('IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required.');
    const requestHash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const inserted = await tx.$queryRaw<Array<{ requestHash: string }>>`
      INSERT INTO integration_operations (
        tenant_id, property_id, idempotency_key, aggregate_id, request_hash, status
      ) VALUES (
        ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${command.idempotencyKey},
        ${command.bookingId}::uuid, ${requestHash}, 'PENDING'
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING request_hash AS "requestHash"
    `;
    if (!inserted[0]) {
      const rows = await tx.$queryRaw<OperationRow[]>`
        SELECT request_hash AS "requestHash", result
        FROM integration_operations
        WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
          AND idempotency_key = ${command.idempotencyKey}
        FOR UPDATE
      `;
      const operation = rows[0];
      if (!operation || operation.requestHash !== requestHash)
        return this.failure(
          'IDEMPOTENCY_KEY_CONFLICT',
          'Idempotency key was used for another request.',
        );
      await tx.$executeRaw`
        UPDATE integration_operations SET attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${context.tenantId}::uuid AND idempotency_key = ${command.idempotencyKey}
      `;
      return (
        operation.result ?? this.failure('IDEMPOTENCY_IN_PROGRESS', 'Refund is in progress.', true)
      );
    }

    const result = await execute();
    await tx.$executeRaw`
      UPDATE integration_operations
      SET status = ${result.ok ? 'SUCCEEDED' : 'FAILED'},
          result = ${JSON.stringify(result)}::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND idempotency_key = ${command.idempotencyKey}
    `;
    return result;
  }

  private minorUnits(amount: string): bigint {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }

  private money(minorUnits: bigint): string {
    return `${minorUnits / 100n}.${(minorUnits % 100n).toString().padStart(2, '0')}`;
  }

  private validMoney(amount: string): boolean {
    return /^\d+(?:\.\d{1,2})?$/.test(amount) && this.minorUnits(amount) > 0n;
  }

  private validPercentage(percentage: number): boolean {
    return (
      Number.isFinite(percentage) &&
      percentage >= 1 &&
      percentage <= 100 &&
      /^\d+(?:\.\d{1,4})?$/.test(String(percentage))
    );
  }

  private percentageAmount(amount: string, percentage: number): bigint | null {
    return percentageRefundMinorUnits(amount, percentage);
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }

  private refundConfirmation(
    bookingId: string,
    refundId: string,
    row: RefundEmailRow,
    amount: Money,
  ): RefundConfirmation {
    return {
      bookingId,
      bookingReference: row.externalReference,
      refundId,
      to: row.email,
      amount,
      brand: {
        name: row.propertyName,
        brandColour: row.brandColour,
        emailFooterText: row.emailFooterText,
        termsUrl: row.termsUrl,
        logoUrl: row.logoUrl,
        supportEmail: row.supportEmail,
        phone: row.phone,
        websiteUrl: row.websiteUrl,
        address: row.address,
      },
      guest: { name: [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || row.email },
      stay: { startsOn: row.startsOn, endsOn: row.endsOn },
      roomName: row.roomName,
      guestCount: row.guestCount,
      nightlyRates: row.nightlyRates ?? undefined,
    };
  }
}
