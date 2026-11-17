import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { LatePaymentFlowService } from '../src/payments/late-payment-flow.service';
import { PaymentRefundService } from '../src/payments/payment-refund.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

const refundCharge = vi.fn();

describe('Late payment flow (ADR-0043)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let connectionId: string;
  let pmsPlanId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `late-flow-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
    async sendRenderedEmail() {},
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(PaymentRefundService)
      .useValue({ refundCharge })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Late Flow Hotel',
        propertyName: 'Main Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'Late Flow Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const connection = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Cancel Test Clock',
        credentials: { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' },
      })
      .expect(201);
    connectionId = connection.body.id;
    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/integration-connections/${connectionId}`,
      )
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    roomTypeId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rooms', 2)
    `;
    ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Test Plan', 'EUR')
    `;
    await admin.$executeRaw`UPDATE integration_connections SET status = 'CONNECTED' WHERE id = ${connectionId}::uuid`;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  const scope = () => ({ tenantId, propertyId });

  beforeEach(() => {
    refundCharge.mockReset();
    refundCharge.mockResolvedValue({
      result: { ok: true, value: { id: 'refund-1' } },
      confirmation: null,
      clockRefund: null,
    });
  });

  async function bookingWithPayments(status: string, orders: string[]) {
    const id = randomUUID();
    await admin.$executeRaw`
      INSERT INTO bookings (id, tenant_id, property_id, room_type_id, external_reference, status, payment_method,
        starts_on, ends_on, rate_plan_id, total_amount, adults, children, guest_count)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${'LATE-' + id.slice(0, 8)},
        ${status}::"BookingStatus", 'POKPAY', current_date + 30, current_date + 32, ${ratePlanId}::uuid, 200.00, 2, 0, 2)`;
    for (const [index, order] of orders.entries())
      await admin.$executeRaw`
        INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency, created_at)
        VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${id}::uuid, 'CHARGE', 'pokpay', ${order}, 'PAID', 200.00, 'EUR',
          now() - make_interval(mins => ${10 - index}::int))`;
    return id;
  }

  function startFlow(bookingId: string, orderId: string, status: string) {
    return app!.get(TenantDatabaseService).withTenantTransaction(scope(), (tx) =>
      app!.get(LatePaymentFlowService).start(tx, scope(), {
        bookingId,
        orderId,
        amount: '200.00',
        currency: 'EUR',
        bookingStatusAtPayment: status,
      }),
    );
  }

  const flow = (id: string) =>
    admin.$queryRaw<
      Array<{ state: string; status: string; nextRunAt: Date; leaseToken: string | null }>
    >`SELECT state, status, next_run_at AS "nextRunAt", lease_token AS "leaseToken" FROM booking_flows WHERE id = ${id}::uuid`;
  const events = (id: string) =>
    admin.$queryRaw<Array<{ step: string; outcome: string }>>`
      SELECT step, outcome FROM booking_flow_events WHERE flow_id = ${id}::uuid ORDER BY created_at, id`;
  const reviews = (bookingId: string) =>
    admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM manual_review_items WHERE tenant_id = ${tenantId}::uuid AND reference_id = ${bookingId} AND status = 'OPEN'`;

  it('refunds a payment that arrived after the hold expired, once, with a step history', async () => {
    const order = `order-${randomUUID()}`;
    const bookingId = await bookingWithPayments('EXPIRED', [order]);
    const flowId = (await startFlow(bookingId, order, 'EXPIRED'))!;
    expect(flowId).toBeTruthy();
    expect(await startFlow(bookingId, order, 'EXPIRED')).toBeNull();

    const service = app!.get(LatePaymentFlowService);
    expect(await service.run(scope(), flowId)).toBe('REFUNDED');
    expect(refundCharge).toHaveBeenCalledTimes(1);
    expect(refundCharge.mock.calls[0]![3]).toMatchObject({
      externalPaymentId: order,
      chargeCount: 1,
    });
    expect(refundCharge.mock.calls[0]![4]).toMatchObject({
      idempotencyKey: `flow:${flowId}:refund`,
      reasonCode: 'other',
    });
    expect(await flow(flowId)).toMatchObject([
      { state: 'REFUNDED', status: 'DONE', leaseToken: null },
    ]);
    expect(await events(flowId)).toEqual([
      { step: 'PAYMENT_RECORDED', outcome: 'DONE' },
      { step: 'REFUND', outcome: 'STARTED' },
      { step: 'REFUND', outcome: 'DONE' },
    ]);
    // A finished flow is never run again.
    expect(await service.run(scope(), flowId)).toBe('NOT_CLAIMED');
    expect(refundCharge).toHaveBeenCalledTimes(1);
  });

  it('refunds a second payment on a confirmed booking as a duplicate', async () => {
    const first = `order-${randomUUID()}`;
    const second = `order-${randomUUID()}`;
    const bookingId = await bookingWithPayments('CONFIRMED', [first, second]);
    const flowId = (await startFlow(bookingId, second, 'CONFIRMED'))!;
    expect(await app!.get(LatePaymentFlowService).run(scope(), flowId)).toBe('REFUNDED');
    expect(refundCharge.mock.calls[0]![3]).toMatchObject({ externalPaymentId: second });
    expect(refundCharge.mock.calls[0]![4]).toMatchObject({ reasonCode: 'duplicate_payment' });
  });

  it('hands the original payment of a confirmed booking to a person, never refunding it', async () => {
    const order = `order-${randomUUID()}`;
    const bookingId = await bookingWithPayments('CONFIRMED', [order]);
    const flowId = (await startFlow(bookingId, order, 'CONFIRMED'))!;
    expect(await app!.get(LatePaymentFlowService).run(scope(), flowId)).toBe('NEEDS_PERSON');
    expect(refundCharge).not.toHaveBeenCalled();
    expect(await flow(flowId)).toMatchObject([{ status: 'NEEDS_PERSON' }]);
    expect(await reviews(bookingId)).toHaveLength(1);
  });

  it('raises exactly one review item when the refund cannot be made', async () => {
    refundCharge.mockResolvedValue({
      result: {
        ok: false,
        error: { code: 'REFUND_FAILED', message: 'PokPay refused the refund.' },
      },
      confirmation: null,
      clockRefund: null,
    });
    const order = `order-${randomUUID()}`;
    const bookingId = await bookingWithPayments('CANCELLED', [order]);
    const flowId = (await startFlow(bookingId, order, 'CANCELLED'))!;
    expect(await app!.get(LatePaymentFlowService).run(scope(), flowId)).toBe('NEEDS_PERSON');
    expect(await reviews(bookingId)).toHaveLength(1);
  });

  it('retries later after an unexpected error and keeps the step history', async () => {
    refundCharge.mockRejectedValue(new Error('connection reset'));
    const order = `order-${randomUUID()}`;
    const bookingId = await bookingWithPayments('EXPIRED', [order]);
    const flowId = (await startFlow(bookingId, order, 'EXPIRED'))!;
    const service = app!.get(LatePaymentFlowService);
    expect(await service.run(scope(), flowId)).toBe('RETRY');
    const [row] = await flow(flowId);
    expect(row).toMatchObject({ status: 'RUNNING', state: 'PAYMENT_RECORDED', leaseToken: null });
    expect(row!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect((await events(flowId)).at(-1)).toEqual({ step: 'PAYMENT_RECORDED', outcome: 'RETRY' });
    // Not due yet: nothing runs it again before its time.
    expect(await service.run(scope(), flowId)).toBe('NOT_CLAIMED');
  });
});
