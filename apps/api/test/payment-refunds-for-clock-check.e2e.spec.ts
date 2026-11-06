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

const tenant = randomUUID();
const property = randomUUID();
const inClock = randomUUID();
const notInClock = randomUUID();
const alreadyFlagged = randomUUID();

type Db = Pick<PrismaClient, '$executeRawUnsafe'>;

async function seedBooking(db: Db, id: string, externalBookingId: string | null) {
  await db.$executeRawUnsafe(
    `INSERT INTO bookings (id, tenant_id, property_id, room_type_id, external_reference, external_booking_id, status, payment_method, starts_on, ends_on, rate_plan_id, total_amount)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'CANCELLED', 'POKPAY', '2027-01-01', '2027-01-02', $7::uuid, 100)`,
    id,
    tenant,
    property,
    randomUUID(),
    `EBR-${id}`,
    externalBookingId,
    randomUUID(),
  );
}

async function seedRefund(db: Db, bookingId: string, provider: string, externalId: string) {
  await db.$executeRawUnsafe(
    `INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'REFUND'::"PaymentKind", $4, $5, 'REFUNDED', 100, 'ALL')`,
    tenant,
    property,
    bookingId,
    provider,
    externalId,
  );
}

async function listed() {
  const rows = await app.$queryRaw<Array<{ bookingId: string; refundExternalPaymentId: string }>>`
    SELECT "bookingId", "refundExternalPaymentId" FROM payment_refunds_for_clock_check(45, 500)`;
  return rows.filter((row) => [inClock, notInClock, alreadyFlagged].includes(row.bookingId));
}

beforeAll(async () => {
  // Foreign keys are skipped for this seed only: the function reads three tables and needs no other rows.
  await admin.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
    await seedBooking(tx, inClock, '111');
    await seedBooking(tx, notInClock, null);
    await seedBooking(tx, alreadyFlagged, '333');
    await seedRefund(tx, inClock, 'pokpay', `${inClock}:refund:a`);
    await seedRefund(tx, inClock, 'manual', `${inClock}:cash`);
    await seedRefund(tx, notInClock, 'pokpay', `${notInClock}:refund:a`);
    await seedRefund(tx, alreadyFlagged, 'stripe', `${alreadyFlagged}:refund:a`);
    await tx.$executeRawUnsafe(
      `INSERT INTO manual_review_items (tenant_id, property_id, category, reference_type, reference_id, message)
       VALUES ($1::uuid, $2::uuid, 'PAYMENT_BOOKING_MISMATCH', 'booking', $3, 'A refund recorded here was not found in Clock: 100 ALL.')`,
      tenant,
      property,
      alreadyFlagged,
    );
  });
});

afterAll(async () => {
  await admin.$executeRawUnsafe(
    `DELETE FROM manual_review_items WHERE tenant_id = $1::uuid`,
    tenant,
  );
  await admin.$executeRawUnsafe(`DELETE FROM payments WHERE tenant_id = $1::uuid`, tenant);
  await admin.$executeRawUnsafe(`DELETE FROM bookings WHERE tenant_id = $1::uuid`, tenant);
  await admin.$disconnect();
  await app.$disconnect();
});

describe('payment_refunds_for_clock_check', () => {
  it('lists a gateway refund on a Clock booking', async () => {
    expect((await listed()).map((row) => row.refundExternalPaymentId)).toContain(
      `${inClock}:refund:a`,
    );
  });

  it('leaves out manual (cash) refunds, bookings that are not in Clock, and bookings already flagged', async () => {
    const found = (await listed()).map((row) => row.refundExternalPaymentId);
    expect(found).not.toContain(`${inClock}:cash`);
    expect(found).not.toContain(`${notInClock}:refund:a`);
    expect(found).not.toContain(`${alreadyFlagged}:refund:a`);
  });
});
