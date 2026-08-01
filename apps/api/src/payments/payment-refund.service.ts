import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  type Money,
  type Payment,
  type PaymentProviderContext,
  type Result,
} from '@must/domain-contracts';

import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';
import { PaymentNotificationService } from '../mail/payment-notification.service';
import { PaymentProviderRegistry } from './payment-provider-registry';

type Charge = {
  id: string;
  provider: string;
  externalPaymentId: string;
  amount: string;
  currency: string;
  status: string;
};

type ManualRefundCommand = {
  bookingId: string;
  idempotencyKey: string;
  amount?: Money;
  actorUserId: string;
};

type OperationRow = { requestHash: string; result: Result<Payment> | null };

export type RefundConfirmation = {
  bookingId: string;
  refundId: string;
  to: string;
  amount: Money;
};

type RefundChargeOutcome = {
  result: Result<Payment>;
  confirmation: RefundConfirmation | null;
};

@Injectable()
export class PaymentRefundService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(PaymentProviderRegistry) private readonly paymentProviders: PaymentProviderRegistry,
    @Inject(PaymentNotificationService) private readonly notifications: PaymentNotificationService,
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

  async refundCharge(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
    charge: Pick<Charge, 'provider' | 'externalPaymentId' | 'amount' | 'currency'>,
    command: { amount: Money; idempotencyKey: string; actorUserId?: string },
  ): Promise<RefundChargeOutcome> {
    const provider = this.paymentProviders.forProvider(charge.provider);
    if (!provider)
      return {
        result: this.failure(
          'REFUND_PROVIDER_UNSUPPORTED',
          'This payment provider cannot refund here.',
        ),
        confirmation: null,
      };
    const refunded = await provider.refund(context, {
      idempotencyKey: command.idempotencyKey,
      paymentId: charge.externalPaymentId,
      amount: command.amount,
    });
    if (!refunded.ok) return { result: refunded, confirmation: null };

    const inserted = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO payments (
        tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency
      ) VALUES (
        ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${bookingId}::uuid,
        'REFUND'::"PaymentKind", ${charge.provider}, ${refunded.value.id}, 'REFUNDED',
        ${command.amount.amount}::numeric, ${command.amount.currency}
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
        targetType: 'booking',
        targetId: bookingId,
        details: {
          chargeExternalPaymentId: charge.externalPaymentId,
          refundExternalPaymentId: refunded.value.id,
          amount: command.amount,
        },
      });
      const guest = await tx.$queryRaw<Array<{ email: string }>>`
        SELECT g.email
        FROM bookings b
        JOIN guests g ON g.tenant_id = b.tenant_id AND g.id = b.guest_id
        WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
          AND b.property_id = ${context.propertyId}::uuid
      `;
      if (guest[0]) {
        confirmation = {
          bookingId,
          refundId: refunded.value.id,
          to: guest[0].email,
          amount: command.amount,
        };
      }
    }
    // StripePaymentProvider.refund has no booking context (RefundCommand doesn't carry one) and
    // returns command.paymentId (the Stripe charge/session id) in this slot as a placeholder;
    // correct it to the real booking id here, where it's actually known.
    return { result: { ok: true, value: { ...refunded.value, bookingId } }, confirmation };
  }

  async manualRefund(
    context: PaymentProviderContext,
    command: ManualRefundCommand,
  ): Promise<Result<Payment>> {
    let confirmation: RefundConfirmation | null = null;
    const result = await this.database.withTenantTransaction(context, (tx) =>
      this.withIdempotency(tx, context, command, async () => {
        await this.lockBooking(tx, context, command.bookingId);
        const charge = await this.chargeForBooking(tx, context, command.bookingId, [
          'PAID',
          'LATE_AFTER_EXPIRY',
        ]);
        if (!charge) return this.failure('CHARGE_NOT_FOUND', 'No refundable charge was found.');
        const alreadyRefunded = await this.refundedAmount(tx, context, command.bookingId);
        const remaining = this.minorUnits(charge.amount) - alreadyRefunded;
        if (remaining <= 0n)
          return this.failure(
            'REFUND_NOT_AVAILABLE',
            'The charge has already been fully refunded.',
          );
        const amount = command.amount ?? {
          amount: this.money(remaining),
          currency: charge.currency,
        };
        if (
          amount.currency !== charge.currency ||
          !this.validMoney(amount.amount) ||
          this.minorUnits(amount.amount) > remaining
        ) {
          return this.failure(
            'INVALID_REFUND_AMOUNT',
            'Refund amount exceeds the remaining charge.',
          );
        }
        const outcome = await this.refundCharge(tx, context, command.bookingId, charge, {
          amount,
          idempotencyKey: `manual-refund:${command.idempotencyKey}`,
          actorUserId: command.actorUserId,
        });
        confirmation = outcome.confirmation;
        return outcome.result;
      }),
    );
    if (confirmation) await this.notifications.sendRefundConfirmationEmailSafely(confirmation);
    return result;
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
    return rows.find((row) => statuses.includes(row.status)) ?? null;
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

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
