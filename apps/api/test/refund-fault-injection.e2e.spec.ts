import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { NotificationsService } from '../src/tenancy/notifications.service';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { ManualReviewService } from '../src/integrations/manual-review.service';
import {
  PaymentRefundService,
  type StuckRefundOperation,
} from '../src/payments/payment-refund.service';

// The 2026-11-06 incident, rehearsed: the provider pays the refund, then the write that saves its answer keeps
// failing. The recovery must record the refund exactly once, tell Clock exactly once, and alert exactly once.
// Isolated local schema copied from the real tables, dropped afterward. Provider and Clock are fakes.
const schema = 'refund_fault_' + randomUUID().replaceAll('-', '');
const adminUrl = 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking';
const appUrl = 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
const admin = new PrismaClient({ datasources: { db: { url: adminUrl + '?schema=' + schema } } });
const db = new TenantDatabaseService({
  datasources: { db: { url: appUrl + '?schema=' + schema } },
});

let failWrites = 0;
const realTransaction = db.withTenantTransaction.bind(db);
let transactionCalls = 0;
db.withTenantTransaction = (async (
  context: Parameters<typeof realTransaction>[0],
  operation: Parameters<typeof realTransaction>[1],
  options?: Parameters<typeof realTransaction>[2],
) => {
  transactionCalls += 1;
  // Call 1 prepares the refund attempt; later calls inside gatewayRefund save the provider's answer.
  if (failWrites > 0 && transactionCalls > 1) {
    failWrites -= 1;
    throw Object.assign(new Error('Unable to start a transaction in the given time.'), {
      code: 'P2028',
    });
  }
  return realTransaction(
    context,
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      return operation(tx);
    },
    options,
  );
}) as typeof db.withTenantTransaction;

const tenantId = randomUUID();
const propertyId = randomUUID();
const bookingId = randomUUID();
const context = { tenantId, propertyId };
const orderId = 'order-' + randomUUID();
const tables = [
  'bookings',
  'payments',
  'integration_operations',
  'manual_review_items',
  'notifications',
  'audit_logs',
];

const provider = {
  refund: vi.fn(async () => ({
    ok: true as const,
    value: {
      id: `${orderId}:refund:k1`,
      status: 'REFUNDED',
      amount: { amount: '100.00', currency: 'ALL' },
      bookingId: orderId,
    },
  })),
  getPayment: vi.fn(async () => ({
    id: orderId,
    status: 'REFUNDED',
    amount: { amount: '100.00', currency: 'ALL' },
  })),
};
const clock = {
  postRefund: vi.fn<(...args: unknown[]) => Promise<{ ok: true; value: undefined }>>(async () => ({
    ok: true,
    value: undefined,
  })),
};
let refunds: PaymentRefundService;

const count = async (table: string, where = '') =>
  Number(
    (
      await admin.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM "${schema}"."${table}" ${where}`,
      )
    )[0]?.n ?? 0,
  );

async function stuckOperation(): Promise<StuckRefundOperation> {
  const [row] = await admin.$queryRawUnsafe<Array<{ id: string; idempotency_key: string }>>(
    `SELECT id, idempotency_key FROM "${schema}".integration_operations WHERE aggregate_id = $1::uuid`,
    bookingId,
  );
  return {
    tenantId,
    propertyId,
    bookingId,
    operationId: row!.id,
    idempotencyKey: row!.idempotency_key,
    stage: 'PREPARING',
    chargeExternalPaymentId: orderId,
    amount: '100.00',
    currency: 'ALL',
    ageMinutes: 12,
  };
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$transaction(
    async (tx) => {
      for (const table of tables)
        await tx.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
      await tx.$executeRawUnsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO must_booking_app`,
      );
    },
    { timeout: 30000 },
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO "${schema}".bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount,payment_method)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,'CANCELLED','2030-07-10','2030-07-12',100,'POKPAY')`,
    bookingId,
    tenantId,
    propertyId,
    randomUUID(),
    randomUUID(),
    'FAULT-' + bookingId,
  );
  await admin.$executeRawUnsafe(
    `INSERT INTO "${schema}".payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency)
     VALUES ($1::uuid,$2::uuid,$3::uuid,'CHARGE'::public."PaymentKind",'pokpay',$4,'PAID',100,'ALL')`,
    tenantId,
    propertyId,
    bookingId,
    orderId,
  );
  refunds = new PaymentRefundService(
    db,
    new AuditLogService(db),
    { forProvider: () => provider } as never,
    {} as never,
    new NotificationsService(db),
    clock as never,
    new ManualReviewService(db),
  );
});

afterAll(async () => {
  await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.$disconnect();
  await db.$disconnect();
});

describe('a paid refund whose answer cannot be saved', () => {
  it('leaves the attempt stuck and records nothing, while the provider refunded exactly once', async () => {
    failWrites = 5;
    transactionCalls = 0;
    const result = await (
      refunds as unknown as {
        gatewayRefund: (...args: unknown[]) => Promise<{ ok: boolean }>;
      }
    ).gatewayRefund(
      context,
      bookingId,
      { provider: 'pokpay', externalPaymentId: orderId },
      {
        amount: { amount: '100.00', currency: 'ALL' },
        idempotencyKey: 'k1',
        alreadyRefunded: { amount: '0.00', currency: 'ALL' },
      },
      provider,
    );
    expect(result.ok).toBe(true);
    expect(provider.refund).toHaveBeenCalledTimes(1);
    expect(await count('payments', `WHERE kind = 'REFUND'`)).toBe(0);
    expect(await count('integration_operations', `WHERE result->>'stage' = 'PREPARING'`)).toBe(1);
  }, 30_000);

  it('the recovery records the refund once, tells Clock once, and closes the attempt', async () => {
    const operation = await stuckOperation();
    await expect(refunds.recoverStuckRefund(operation)).resolves.toBe('RECOVERED');
    expect(await count('payments', `WHERE kind = 'REFUND' AND status = 'REFUNDED'`)).toBe(1);
    expect(clock.postRefund).toHaveBeenCalledTimes(1);
    expect(clock.postRefund.mock.calls[0]?.[4]).toBe(`must-refund:${orderId}:refund:reconciled`);
    expect(await count('integration_operations', `WHERE status = 'SUCCEEDED'`)).toBe(1);
    expect(provider.refund).toHaveBeenCalledTimes(1);
  });

  it('running the recovery again changes nothing', async () => {
    const operation = await stuckOperation();
    await expect(refunds.recoverStuckRefund(operation)).resolves.toBe('NOTHING_TO_DO');
    expect(await count('payments', `WHERE kind = 'REFUND'`)).toBe(1);
    expect(clock.postRefund).toHaveBeenCalledTimes(1);
  });

  it('a stuck attempt raises exactly one alert item and one notification, however often it is checked', async () => {
    const operation = await stuckOperation();
    const alertItems = () =>
      count(
        'manual_review_items',
        `WHERE reference_id = '${bookingId}' AND message LIKE 'A refund of%was started%'`,
      );
    const notificationsBefore = await count('notifications');
    await expect(refunds.raiseStuckRefundAlert(operation)).resolves.toBe(true);
    await expect(refunds.raiseStuckRefundAlert(operation)).resolves.toBe(false);
    expect(await alertItems()).toBe(1);
    expect((await count('notifications')) - notificationsBefore).toBe(1);
  });
});
