import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const admin = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking' },
  },
});
const app = new PrismaClient({
  datasources: {
    db: { url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking' },
  },
});

const tenantA = randomUUID();
const tenantB = randomUUID();
const property = randomUUID();
const ids = {
  stuck: randomUUID(),
  young: randomUUID(),
  returnedWithRow: randomUUID(),
  returnedNoRow: randomUUID(),
  otherKind: randomUUID(),
  otherTenant: randomUUID(),
};

async function seed(
  key: keyof typeof ids,
  tenant: string,
  result: Record<string, unknown>,
  createdMinutesAgo: number,
  bookingId = randomUUID(),
) {
  await admin.$executeRawUnsafe(
    `INSERT INTO integration_operations (id, tenant_id, property_id, idempotency_key, aggregate_id, request_hash, status, result, created_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, 'hash', 'PENDING', $6::jsonb, now() - make_interval(mins => $7::int))`,
    ids[key],
    tenant,
    property,
    `gateway-refund:test:${ids[key]}`,
    bookingId,
    JSON.stringify(result),
    createdMinutesAgo,
  );
  return bookingId;
}

const refund = (stage: string, extra: Record<string, unknown> = {}) => ({
  kind: 'gateway_refund',
  stage,
  provider: 'pokpay',
  chargeExternalPaymentId: 'order-1',
  amount: { amount: '21560.00', currency: 'ALL' },
  ...extra,
});

async function stuck() {
  const rows = await app.$queryRaw<Array<{ operationId: string; tenantId: string }>>`
    SELECT "operationId", "tenantId" FROM payment_stuck_refund_operations(5, 200)`;
  return rows.map((row) => row.operationId);
}

beforeAll(async () => {
  await seed('stuck', tenantA, refund('PREPARING'), 20);
  await seed('young', tenantA, refund('PREPARING'), 1);
  const paidBooking = await seed(
    'returnedWithRow',
    tenantA,
    refund('RETURNED', { providerResult: { ok: true, value: { id: 'order-1:refund:done' } } }),
    20,
  );
  await seed(
    'returnedNoRow',
    tenantA,
    refund('RETURNED', { providerResult: { ok: true, value: { id: 'order-2:refund:missing' } } }),
    20,
  );
  await seed('otherKind', tenantA, { kind: 'something_else', stage: 'PREPARING' }, 20);
  await seed('otherTenant', tenantB, refund('UNCERTAIN'), 20);
  // The ledger row for the finished one. Foreign keys are skipped for this seed only.
  await admin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await tx.$executeRawUnsafe(
      `INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'REFUND'::"PaymentKind", 'pokpay', 'order-1:refund:done', 'REFUNDED', 21560.00, 'ALL')`,
      tenantA,
      property,
      paidBooking,
    );
  });
});

afterAll(async () => {
  const operationIds = Object.values(ids);
  await admin.$executeRawUnsafe(
    `DELETE FROM payments WHERE external_payment_id = 'order-1:refund:done' AND tenant_id = $1::uuid`,
    tenantA,
  );
  await admin.$executeRawUnsafe(
    `DELETE FROM integration_operations WHERE id = ANY($1::uuid[])`,
    operationIds,
  );
  await admin.$disconnect();
  await app.$disconnect();
});

describe('payment_stuck_refund_operations', () => {
  it('returns a refund attempt that never finished and is older than the minimum age', async () => {
    expect(await stuck()).toContain(ids.stuck);
  });

  it('returns a finished attempt whose REFUND payment is missing, and an unfinished one from another hotel', async () => {
    const found = await stuck();
    expect(found).toContain(ids.returnedNoRow);
    expect(found).toContain(ids.otherTenant);
  });

  it('does not return an attempt younger than the minimum age', async () => {
    expect(await stuck()).not.toContain(ids.young);
  });

  it('does not return a finished attempt whose REFUND payment exists', async () => {
    expect(await stuck()).not.toContain(ids.returnedWithRow);
  });

  it('does not return operations that are not gateway refunds', async () => {
    expect(await stuck()).not.toContain(ids.otherKind);
  });
});
