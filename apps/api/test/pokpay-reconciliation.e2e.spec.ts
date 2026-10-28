import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { withoutExternalWorkers } from './helpers/without-external-workers';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('the nightly check of PokPay against our payment records', () => {
  const roomType = randomUUID();
  const ratePlan = randomUUID();
  const bookings = {
    fine: randomUUID(),
    lateGuest: randomUUID(),
    refundedThere: randomUUID(),
    unreadable: randomUUID(),
  };
  const orders = {
    fine: `order-fine-${randomUUID()}`,
    lateGuest: `order-late-${randomUUID()}`,
    refundedThere: `order-refund-${randomUUID()}`,
    unreadable: `order-unreadable-${randomUUID()}`,
  };
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  /** What "PokPay" answers for each order; an order not listed cannot be read. */
  const providerAnswers: Record<string, { status: string; amount: string; currency: string }> = {};

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    app = (
      await withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] })).compile()
    ).createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Reconcile Group',
        propertyName: 'Reconcile Hotel',
        propertyAddress: '1 Check Way',
        propertyTimezone: 'Europe/Tirane',
        email: `reconcile-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Check room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Check rate','EUR')`;
    for (const [key, id] of Object.entries(bookings)) {
      const order = orders[key as keyof typeof orders];
      await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${`REC-${key}`},'CONFIRMED'::"BookingStatus",'2027-03-01','2027-03-03',100)`;
      await admin.$executeRaw`INSERT INTO payment_provider_sessions(tenant_id,property_id,booking_id,provider,external_payment_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'pokpay',${order})`;
    }
    // Recorded: a payment for three orders; the "late guest" order has no payment recorded at all.
    for (const key of ['fine', 'refundedThere', 'unreadable'] as const)
      await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${bookings[key]}::uuid,'CHARGE','pokpay',${orders[key]},'PAID',100,'EUR')`;
    providerAnswers[orders.fine] = { status: 'COMPLETED', amount: '100.00', currency: 'EUR' };
    providerAnswers[orders.lateGuest] = { status: 'COMPLETED', amount: '100.00', currency: 'EUR' };
    providerAnswers[orders.refundedThere] = {
      status: 'REFUNDED',
      amount: '100.00',
      currency: 'EUR',
    };
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  async function runCheck() {
    const { PokPayReconciliationService } =
      await import('../src/payments/pokpay-reconciliation.service');
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const provider = {
      getPayment: async (_scope: unknown, orderId: string) => {
        const answer = providerAnswers[orderId];
        return answer
          ? {
              id: orderId,
              bookingId: orderId,
              status: answer.status,
              amount: { amount: answer.amount, currency: answer.currency },
            }
          : null;
      },
    };
    const service = new PokPayReconciliationService(
      app.get(TenantDatabaseService),
      provider as never,
    );
    try {
      return await service.run();
    } finally {
      await service.onModuleDestroy();
    }
  }

  const openItems = () =>
    admin.$queryRaw<
      Array<{ reference_id: string; kind: string; message: string }>
    >`SELECT reference_id, context->>'kind' AS kind, message FROM manual_review_items WHERE tenant_id=${tenantId}::uuid AND status='OPEN' AND context->>'source'='pokpay_reconciliation' ORDER BY kind`;

  it('flags what differs, once, and says nothing about what agrees or cannot be read', async () => {
    await runCheck();
    let items = await openItems();
    expect(items.map((item) => [item.reference_id, item.kind])).toEqual([
      [bookings.lateGuest, 'PAID_AT_PROVIDER_ONLY'],
      [bookings.refundedThere, 'REFUNDED_AT_PROVIDER_ONLY'],
    ]);
    expect(items[0]!.message).toContain('100.00 EUR');
    // Running again the next night does not pile up duplicates.
    await runCheck();
    items = await openItems();
    expect(items).toHaveLength(2);
  });

  it('closes a difference by itself once the two sides agree again, and never touches the money', async () => {
    // We now record the late payment and the refund.
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${bookings.lateGuest}::uuid,'CHARGE','pokpay',${orders.lateGuest},'PAID',100,'EUR')`;
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${bookings.refundedThere}::uuid,'REFUND','pokpay',${`${orders.refundedThere}:refund:k1`},'REFUNDED',100,'EUR')`;
    const before = await admin.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT count(*) AS n FROM payments WHERE tenant_id=${tenantId}::uuid`;
    const summary = await runCheck();
    expect(await openItems()).toEqual([]);
    expect(summary.resolved).toBeGreaterThanOrEqual(2);
    const after = await admin.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT count(*) AS n FROM payments WHERE tenant_id=${tenantId}::uuid`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
