import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { StripeBalanceCollectionService } from '../src/payments/stripe-balance-collection.service';
import { StripeWebhookService } from '../src/payments/stripe-webhook.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { connectPaymentProviders } from './helpers/payment-connections';
import { withoutExternalWorkers } from './helpers/without-external-workers';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

/** G-44: a Stripe balance link for a confirmed booking, and its payment recorded instead of refunded. */
describe('Stripe balance links', () => {
  const roomType = randomUUID();
  const ratePlan = randomUUID();
  const booking = randomUUID();
  const sessions: Array<{ amount: string; expiresAt?: number }> = [];
  const refunds: string[] = [];
  // Session ids are unique per run, so a half-cleaned earlier run can never collide with this one.
  const tag = randomUUID().slice(0, 8);
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';

  const fakeStripe = {
    async createCheckoutSession(
      _context: unknown,
      command: { amount: { amount: string }; expiresAt?: number },
    ) {
      sessions.push({ amount: command.amount.amount, expiresAt: command.expiresAt });
      const id = `cs_${tag}_${sessions.length}`;
      return { ok: true as const, value: { id, url: `https://stripe.test/pay/${id}` } };
    },
    async verifyWebhookEvent() {
      return { ok: false as const, error: { code: 'unused', message: 'unused', retryable: false } };
    },
    async refund(_context: unknown, command: { paymentId: string }) {
      refunds.push(command.paymentId);
      return {
        ok: true as const,
        value: {
          id: `refund-${command.paymentId}`,
          bookingId: command.paymentId,
          status: 'REFUNDED',
        },
      };
    },
    async getPayment() {
      return null;
    },
  };

  const scope = () => ({ tenantId, propertyId });
  const ledger = () =>
    admin.$queryRaw<Array<{ kind: string; status: string; amount: string; provider: string }>>`
      SELECT kind::text, status::text, amount::text, provider FROM payments WHERE booking_id=${booking}::uuid ORDER BY created_at`;
  const paidEvent = (id: string) => ({
    id: `evt_${id}`,
    type: 'checkout.session.completed',
    externalPaymentId: id,
    tenantId,
    propertyId,
    bookingId: booking,
  });

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    app = (
      await withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] }))
        .overrideProvider(PAYMENT_PROVIDER)
        .useValue(fakeStripe)
        .compile()
    ).createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Stripe Balance Group',
        propertyName: 'Stripe Balance Hotel',
        propertyAddress: '1 Balance Way',
        propertyTimezone: 'Europe/Tirane',
        email: `stripe-balance-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    await connectPaymentProviders(admin, tenantId, propertyId, ['STRIPE']);
    await admin.$executeRaw`UPDATE properties SET stripe_enabled = true WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Balance room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Balance rate','EUR')`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${booking}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,'BAL-1','CONFIRMED'::"BookingStatus",'2027-03-01','2027-03-03',200)`;
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${booking}::uuid,'CHARGE','manual','cash-1','PAID',50,'EUR')`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('offers a Stripe link for the balance, never longer than Stripe keeps the page open', async () => {
    const service = app.get(StripeBalanceCollectionService);
    expect(await service.options(scope(), booking)).toEqual({ stripe: true, orderBalance: null });
    const link = await service.start(scope(), booking, userId, 'key-1');
    expect(link).toMatchObject({
      checkoutUrl: `https://stripe.test/pay/cs_${tag}_1`,
      orderId: `cs_${tag}_1`,
      amount: { amount: '150.00', currency: 'EUR' },
    });
    const hours = ((sessions[0]!.expiresAt ?? 0) * 1000 - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23);
    expect(hours).toBeLessThanOrEqual(24);

    // The same balance asked again returns the same open link and makes no second Stripe session.
    const again = await service.start(scope(), booking, userId, 'key-2');
    expect(again.orderId).toBe(`cs_${tag}_1`);
    expect(sessions).toHaveLength(1);
  });

  it('records the paid link as a charge, once, and never refunds it', async () => {
    const webhook = app.get(StripeWebhookService);
    const first = await webhook.processPaymentSucceeded(paidEvent(`cs_${tag}_1`));
    expect(first).toEqual({ ok: true, value: { duplicate: false } });
    const rows = await ledger();
    expect(rows).toEqual([
      { kind: 'CHARGE', status: 'PAID', amount: '50.00', provider: 'manual' },
      { kind: 'CHARGE', status: 'PAID', amount: '150.00', provider: 'stripe' },
    ]);
    expect(refunds).toEqual([]);

    const replay = await webhook.processPaymentSucceeded(paidEvent(`cs_${tag}_1`));
    expect(replay).toEqual({ ok: true, value: { duplicate: true } });
    expect(await ledger()).toHaveLength(2);

    // Nothing is left to collect, so no new link is made.
    await expect(
      app.get(StripeBalanceCollectionService).start(scope(), booking, userId, 'key-3'),
    ).rejects.toThrow(/no outstanding balance/i);
    const operation = await admin.$queryRaw<Array<{ stage: string }>>`
      SELECT result->>'stage' AS stage FROM integration_operations WHERE aggregate_id=${booking}::uuid AND result->>'kind'='balance_collection_stripe'`;
    expect(operation.map((row) => row.stage)).toEqual(['PAID']);
  });

  it('leaves a paid session of a booking that is no longer confirmed to the late-payment refund', async () => {
    await admin.$executeRaw`UPDATE bookings SET status='CANCELLED'::"BookingStatus" WHERE id=${booking}::uuid`;
    await admin.$executeRaw`INSERT INTO integration_operations(tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,external_reference,result)
      VALUES(${tenantId}::uuid,${propertyId}::uuid,'collect-stripe:late',${booking}::uuid,'h','COMPLETED','cs_test_late',
        ${JSON.stringify({ kind: 'balance_collection_stripe', provider: 'stripe', amount: '30.00', currency: 'EUR', stage: 'READY', externalPaymentId: 'cs_test_late' })}::jsonb)`;
    const result = await app
      .get(StripeWebhookService)
      .processPaymentSucceeded(paidEvent('cs_test_late'));
    expect(result.ok).toBe(true);
    const rows = await ledger();
    expect(rows.find((row) => row.status === 'LATE_AFTER_EXPIRY')).toBeTruthy();
    expect(refunds).toContain('cs_test_late');
  });

  describe('a multi-room order (G-47)', () => {
    const first = randomUUID();
    const second = randomUUID();
    const insert = (id: string, ref: string, room: number, total: number, extra = '') =>
      admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,order_reference,order_room_number,status,starts_on,ends_on,total_amount)
        VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${ref},'ORD-47',${room},${'CONFIRMED' + extra}::"BookingStatus",'2027-04-01','2027-04-03',${total})`;

    it('collects the whole order through its first room, from either room', async () => {
      await insert(first, 'ORD-47-room1', 1, 200);
      await insert(second, 'ORD-47-room2', 2, 180);
      await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${first}::uuid,'CHARGE','manual','cash-47','PAID',80,'EUR')`;
      const service = app.get(StripeBalanceCollectionService);
      expect(await service.options(scope(), second)).toEqual({
        stripe: true,
        orderBalance: { amount: '300.00', currency: 'EUR' },
      });
      const before = sessions.length;
      const link = await service.start(scope(), second, userId, 'order-key-1');
      expect(link.amount).toEqual({ amount: '300.00', currency: 'EUR' });
      expect(sessions.length).toBe(before + 1);
      const operation = await admin.$queryRaw<Array<{ aggregate: string }>>`
        SELECT aggregate_id::text AS aggregate FROM integration_operations WHERE tenant_id=${tenantId}::uuid AND external_reference=${link.orderId}`;
      expect(operation).toEqual([{ aggregate: first }]);

      // Asking from the other room returns the same open link.
      const again = await service.start(scope(), first, userId, 'order-key-2');
      expect(again.orderId).toBe(link.orderId);
      expect(sessions.length).toBe(before + 1);

      const paid = await app.get(StripeWebhookService).processPaymentSucceeded({
        id: 'evt_order',
        type: 'checkout.session.completed',
        externalPaymentId: link.orderId!,
        tenantId,
        propertyId,
        bookingId: first,
      });
      expect(paid).toEqual({ ok: true, value: { duplicate: false } });
      const charges = await admin.$queryRaw<Array<{ booking: string; amount: string }>>`
        SELECT booking_id::text AS booking, amount::text FROM payments WHERE tenant_id=${tenantId}::uuid AND external_payment_id=${link.orderId}`;
      expect(charges).toEqual([{ booking: first, amount: '300.00' }]);
      expect((await service.options(scope(), second)).orderBalance).toBeNull();
    });

    it('refuses an order with a room held in Clock', async () => {
      const a = randomUUID();
      const b = randomUUID();
      await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,order_reference,order_room_number,status,starts_on,ends_on,total_amount,external_booking_id)
        VALUES(${a}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,'ORD-48-room1','ORD-48',1,'CONFIRMED'::"BookingStatus",'2027-05-01','2027-05-03',100,'clock-1'),
          (${b}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,'ORD-48-room2','ORD-48',2,'CONFIRMED'::"BookingStatus",'2027-05-01','2027-05-03',100,'clock-2')`;
      const service = app.get(StripeBalanceCollectionService);
      expect((await service.options(scope(), b)).orderBalance).toBeNull();
      await expect(service.start(scope(), b, userId, 'order-key-3')).rejects.toThrow(
        /every room confirmed and none held in Clock/,
      );
    });
  });
});
