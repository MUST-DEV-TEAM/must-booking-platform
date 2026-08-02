import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Money, PaymentProviderContext, Result } from '@must/domain-contracts';

import { AuditLogService } from '../tenancy/audit-log.service';
import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';

type ManualPaymentMethod = 'cash' | 'card_in_person' | 'bank_transfer';

type ManualPaymentCommand = {
  bookingId: string;
  idempotencyKey: string;
  amount?: Money;
  method: ManualPaymentMethod;
  actorUserId: string;
};

type RecordedPayment = {
  id: string;
  bookingId: string;
  amount: Money;
  status: string;
  provider: string;
  method: ManualPaymentMethod;
  externalPaymentId: string;
};

type Booking = { id: string; totalAmount: string; currency: string };
type OperationRow = { requestHash: string; result: Result<RecordedPayment> | null };

@Injectable()
export class ManualPaymentService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  record(
    context: PaymentProviderContext,
    command: ManualPaymentCommand,
  ): Promise<Result<RecordedPayment>> {
    return this.database.withTenantTransaction(context, (tx) =>
      this.withIdempotency(tx, context, command, async () => {
        const booking = await this.booking(tx, context, command.bookingId);
        if (!booking) return this.failure('BOOKING_NOT_FOUND', 'Booking was not found.');
        const alreadyPaid = await this.paidAmount(tx, context, booking.id);
        const remaining = this.minorUnits(booking.totalAmount) - alreadyPaid;
        if (remaining <= 0n)
          return this.failure(
            'PAYMENT_NOT_AVAILABLE',
            'The booking has already been paid in full.',
          );
        const amount = command.amount ?? {
          amount: this.money(remaining),
          currency: booking.currency,
        };
        if (
          amount.currency !== booking.currency ||
          !this.validMoney(amount.amount) ||
          this.minorUnits(amount.amount) > remaining
        )
          return this.failure(
            'INVALID_PAYMENT_AMOUNT',
            'Payment amount must be a positive amount no greater than the remaining booking balance.',
          );
        const externalPaymentId = `manual:${command.method}:${randomUUID()}`;
        const rows = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO payments (
            tenant_id, property_id, booking_id, kind, provider, method, external_payment_id, status, amount, currency
          ) VALUES (
            ${context.tenantId}::uuid, ${context.propertyId}::uuid, ${booking.id}::uuid,
            'CHARGE'::"PaymentKind", 'manual', ${command.method}, ${externalPaymentId}, 'succeeded',
            ${amount.amount}::numeric, ${amount.currency}
          )
          RETURNING id
        `;
        const payment: RecordedPayment = {
          id: rows[0].id,
          bookingId: booking.id,
          amount,
          status: 'succeeded',
          provider: 'manual',
          method: command.method,
          externalPaymentId,
        };
        await this.audit.recordInTransaction(tx, {
          tenantId: context.tenantId,
          propertyId: context.propertyId,
          actorUserId: command.actorUserId,
          action: 'payment.manual_recorded',
          targetType: 'booking',
          targetId: booking.id,
          details: { amount, method: command.method, externalPaymentId },
        });
        return { ok: true, value: payment };
      }),
    );
  }

  private async booking(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
  ): Promise<Booking | null> {
    const rows = await tx.$queryRaw<Booking[]>`
      SELECT b.id, b.total_amount::text AS "totalAmount", rp.currency
      FROM bookings b
      JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      WHERE b.id = ${bookingId}::uuid AND b.tenant_id = ${context.tenantId}::uuid
        AND b.property_id = ${context.propertyId}::uuid
      FOR UPDATE OF b
    `;
    return rows[0] ?? null;
  }

  private async paidAmount(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    bookingId: string,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<Array<{ amount: string }>>`
      SELECT COALESCE(SUM(amount), 0)::text AS amount
      FROM payments
      WHERE tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid
        AND booking_id = ${bookingId}::uuid AND kind = 'CHARGE'::"PaymentKind"
        AND status = 'succeeded'
    `;
    return this.minorUnits(rows[0]?.amount ?? '0');
  }

  private async withIdempotency(
    tx: TenantTransaction,
    context: PaymentProviderContext,
    command: ManualPaymentCommand,
    execute: () => Promise<Result<RecordedPayment>>,
  ): Promise<Result<RecordedPayment>> {
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
        operation.result ??
        this.failure('IDEMPOTENCY_IN_PROGRESS', 'Payment recording is in progress.', true)
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

  private validMoney(amount: string): boolean {
    return /^\d+(?:\.\d{1,2})?$/.test(amount) && this.minorUnits(amount) > 0n;
  }

  private minorUnits(amount: string): bigint {
    const [whole, fraction = ''] = amount.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  }

  private money(minorUnits: bigint): string {
    return `${minorUnits / 100n}.${(minorUnits % 100n).toString().padStart(2, '0')}`;
  }

  private failure(code: string, message: string, retryable = false): Result<never> {
    return { ok: false, error: { code, message, retryable } };
  }
}
