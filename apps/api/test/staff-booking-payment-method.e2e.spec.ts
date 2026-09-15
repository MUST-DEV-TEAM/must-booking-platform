import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentProvider } from '@must/domain-contracts';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { PokPayPaymentProvider } from '../src/payments/pokpay-payment.provider';
import { PokPayPaymentService } from '../src/payments/pokpay-payment.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider-registry';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

// Milestone: walk-in booking redesign sub-project 3 — staff-booking.controller.ts
// used to hardcode paymentMethod: 'pay_at_hotel'. This proves the new pass-through
// actually reaches LocalPmsProvider's existing (already real-tested elsewhere)
// payment-method resolution: an online method returns a real checkoutUrl, a
// disabled method is rejected, and an omitted method on a non-zero total is
// rejected — none of that behavior is new, only staff-bookings' access to it is.
describe('staff-bookings: payment method selection', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let cookie: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let verificationToken = '';
  const email = `staff-booking-payment-${randomUUID()}@example.test`;
  const pokpayCheckoutAttempts = new Map<string, number>();
  const pokpayOrders = new Map<string, { amount: string; currency: string }>();
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
  };
  const payments: PaymentProvider = {
    async createCheckoutSession(_context, command) {
      return {
        ok: true,
        value: {
          id: `cs_test_${command.bookingId}`,
          url: `https://checkout.stripe.test/${command.bookingId}`,
        },
      };
    },
    async verifyWebhookEvent() {
      return { ok: false, error: { code: 'NOT_USED', message: 'unused', retryable: false } };
    },
    async refund() {
      throw new Error('unused');
    },
    async getPayment() {
      return null;
    },
  };
  const pokpay: PaymentProvider = {
    async createCheckoutSession(_context, command) {
      const attempt = (pokpayCheckoutAttempts.get(command.bookingId) ?? 0) + 1;
      pokpayCheckoutAttempts.set(command.bookingId, attempt);
      const id = `pok_test_${command.bookingId}_${attempt}`;
      pokpayOrders.set(id, command.amount);
      return {
        ok: true,
        value: {
          id,
          url: `https://pay.pokpay.test/${command.bookingId}/${attempt}`,
        },
      };
    },
    async verifyWebhookEvent() {
      return { ok: false, error: { code: 'NOT_USED', message: 'unused', retryable: false } };
    },
    async refund() {
      throw new Error('unused');
    },
    async getPayment(_context, paymentId) {
      const order = pokpayOrders.get(paymentId);
      return order ? { id: paymentId, bookingId: paymentId, amount: order, status: 'PAID' } : null;
    },
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
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(payments)
      .overrideProvider(PokPayPaymentProvider)
      .useValue(pokpay)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    app.get(PaymentProviderRegistry).pokpay = pokpay as PokPayPaymentProvider;

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Staff Booking Payment Hotel',
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

    const tenantUrl = `/tenants/${tenantId}`;
    const roomType = await request(app.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Standard', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;
    const ratePlan = await request(app.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Standard Rate', currency: 'EUR' })
      .expect(201);
    ratePlanId = ratePlan.body.id;
    await request(app.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '100.00' })
      .expect(201);
    await request(app.getHttpServer())
      .put(`${tenantUrl}/properties/${propertyId}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2026-09-01', endsOn: '2026-09-10', availableUnits: 5 })
      .expect(204);
    await request(app.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: false, payAtHotel: true })
      .expect(200);
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('creates a real checkout session and leaves the booking payment-pending for an enabled online method', async () => {
    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `stripe-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-01',
        endsOn: '2026-09-03',
        paymentMethod: 'stripe',
        guest: { email: 'stripe-guest@example.test', firstName: 'Stripe', lastName: 'Guest' },
      })
      .expect(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.value.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const row = await admin.$queryRaw<
      Array<{ status: string; paymentMethod: string; externalReference: string }>
    >`
      SELECT status, payment_method AS "paymentMethod", external_reference AS "externalReference"
      FROM bookings WHERE id = ${created.body.value.id}::uuid
    `;
    expect(row[0]).toMatchObject({ status: 'PAYMENT_PENDING', paymentMethod: 'STRIPE_CHECKOUT' });
    // No client-supplied externalReference: the server must generate one from the
    // property's own name ("Main Property" -> "MP"), not a fixed "MUST"/hash string.
    expect(row[0]?.externalReference).toMatch(/^MP-\d{6}-\d{4}-[A-Z0-9]{2}$/);
  });

  it('rejects a payment method the property has not enabled', async () => {
    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `pokpay-disabled-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-04',
        endsOn: '2026-09-06',
        paymentMethod: 'pokpay',
        guest: { email: 'pokpay-guest@example.test', firstName: 'PokPay', lastName: 'Guest' },
      })
      .expect(201);
    expect(created.body).toMatchObject({
      ok: false,
      error: { code: 'PAYMENT_METHOD_NOT_ENABLED' },
    });
  });

  it('rejects an omitted payment method for a non-zero-total booking', async () => {
    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `no-method-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-06',
        endsOn: '2026-09-08',
        guest: { email: 'no-method-guest@example.test', firstName: 'No', lastName: 'Method' },
      })
      .expect(201);
    expect(created.body).toMatchObject({ ok: false, error: { code: 'PAYMENT_METHOD_REQUIRED' } });
  });

  it('pay_at_hotel still confirms immediately, matching existing behavior', async () => {
    const created = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `pay-at-hotel-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-08',
        endsOn: '2026-09-10',
        paymentMethod: 'pay_at_hotel',
        guest: { email: 'pay-at-hotel-guest@example.test', firstName: 'PayAt', lastName: 'Hotel' },
      })
      .expect(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.value.checkoutUrl).toBeUndefined();
    const row = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings WHERE id = ${created.body.value.id}::uuid
    `;
    expect(row[0]?.status).toBe('CONFIRMED');
  });

  it('lets staff resend a pending PokPay checkout or settle a pending reservation with an audited manual payment', async () => {
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(app.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: true, payAtHotel: true })
      .expect(200);

    const pendingOriginalLink = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `pending-original-pokpay-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-02',
        endsOn: '2026-09-04',
        paymentMethod: 'pokpay',
        guest: { email: 'original-link@example.test', firstName: 'Original', lastName: 'Link' },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${propertyUrl}/bookings/${pendingOriginalLink.body.value.id}/resend-pokpay-checkout`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `resend-original-pokpay-${randomUUID()}`)
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({
          ok: true,
          value: { checkoutUrl: expect.stringMatching(/\/2$/) },
        }),
      );
    // A guest can complete the original link after staff has sent a new one.
    // Its retained session binding must still reach the normal confirmation path.
    const originalOrderId = `pok_test_${pendingOriginalLink.body.value.id}_1`;
    await expect(
      app.get(PokPayPaymentService).processAuthoritativeOrder(originalOrderId),
    ).resolves.toEqual({ ok: true, value: { duplicate: false } });
    const confirmedOriginalLink = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND id = ${pendingOriginalLink.body.value.id}::uuid
    `;
    expect(confirmedOriginalLink).toEqual([{ status: 'CONFIRMED' }]);

    const pendingPokpay = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `pending-pokpay-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-04',
        endsOn: '2026-09-06',
        paymentMethod: 'pokpay',
        guest: { email: 'pending-pokpay@example.test', firstName: 'Pending', lastName: 'PokPay' },
      })
      .expect(201);
    expect(pendingPokpay.body).toMatchObject({
      ok: true,
      value: { status: 'PAYMENT_PENDING', checkoutUrl: expect.stringMatching(/\/1$/) },
    });

    const resent = await request(app.getHttpServer())
      .post(`${propertyUrl}/bookings/${pendingPokpay.body.value.id}/resend-pokpay-checkout`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `resend-pokpay-${randomUUID()}`)
      .expect(200);
    expect(resent.body).toMatchObject({
      ok: true,
      value: { status: 'PAYMENT_PENDING', checkoutUrl: expect.stringMatching(/\/2$/) },
    });
    const pokpaySessions = await admin.$queryRaw<Array<{ externalPaymentId: string }>>`
      SELECT external_payment_id AS "externalPaymentId"
      FROM payment_provider_sessions
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND booking_id = ${pendingPokpay.body.value.id}::uuid AND provider = 'pokpay'
      ORDER BY created_at, id
    `;
    expect(pokpaySessions).toEqual([
      { externalPaymentId: `pok_test_${pendingPokpay.body.value.id}_1` },
      { externalPaymentId: `pok_test_${pendingPokpay.body.value.id}_2` },
    ]);
    const resendAudit = await admin.$queryRaw<
      Array<{ actorUserId: string | null; action: string }>
    >`
      SELECT actor_user_id AS "actorUserId", action
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND target_id = ${pendingPokpay.body.value.id}::text
        AND action = 'payment.pokpay_checkout_resent'
    `;
    expect(resendAudit).toEqual([
      { actorUserId: userId, action: 'payment.pokpay_checkout_resent' },
    ]);
    const freshOrderId = `pok_test_${pendingPokpay.body.value.id}_2`;
    await expect(
      app.get(PokPayPaymentService).processAuthoritativeOrder(freshOrderId),
    ).resolves.toEqual({ ok: true, value: { duplicate: false } });
    const confirmedPokpay = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND id = ${pendingPokpay.body.value.id}::uuid
    `;
    expect(confirmedPokpay).toEqual([{ status: 'CONFIRMED' }]);

    const pendingManual = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `pending-manual-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-06',
        endsOn: '2026-09-08',
        paymentMethod: 'stripe',
        guest: { email: 'pending-manual@example.test', firstName: 'Pending', lastName: 'Manual' },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${propertyUrl}/bookings/${pendingManual.body.value.id}/manual-payment`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `manual-settlement-${randomUUID()}`)
      .send({ method: 'card_in_person' })
      .expect(200)
      .expect((response) => expect(response.body.ok).toBe(true));
    const manualSettlement = await admin.$queryRaw<
      Array<{
        status: string;
        provider: string;
        method: string;
        externalPaymentId: string;
        actorUserId: string | null;
      }>
    >`
      SELECT b.status, p.provider, p.method, p.external_payment_id AS "externalPaymentId",
        a.actor_user_id AS "actorUserId"
      FROM bookings b
      JOIN payments p
        ON p.tenant_id = b.tenant_id AND p.property_id = b.property_id AND p.booking_id = b.id
      JOIN audit_logs a
        ON a.tenant_id = b.tenant_id AND a.property_id = b.property_id AND a.target_id = b.id::text
          AND a.action = 'payment.manual_recorded'
      WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
        AND b.id = ${pendingManual.body.value.id}::uuid
    `;
    expect(manualSettlement).toEqual([
      expect.objectContaining({
        status: 'CONFIRMED',
        provider: 'manual',
        method: 'card_in_person',
        externalPaymentId: expect.stringMatching(/^manual:card_in_person:/),
        actorUserId: userId,
      }),
    ]);

    const unpaid = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `unpaid-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-03',
        endsOn: '2026-09-05',
        paymentMethod: 'stripe',
        guest: { email: 'unpaid@example.test', firstName: 'Unpaid', lastName: 'Guest' },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${propertyUrl}/bookings/${unpaid.body.value.id}/manual-payment`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `reject-unpaid-${randomUUID()}`)
      .send({ amount: { amount: '0.00', currency: 'EUR' }, method: 'cash' })
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({
          ok: false,
          error: { code: 'INVALID_PAYMENT_AMOUNT' },
        }),
      );
    const rejectedSettlement = await admin.$queryRaw<
      Array<{ status: string; paymentCount: bigint }>
    >`
      SELECT b.status, (
        SELECT COUNT(*)::bigint FROM payments p
        WHERE p.tenant_id = b.tenant_id AND p.property_id = b.property_id AND p.booking_id = b.id
      ) AS "paymentCount"
      FROM bookings b
      WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
        AND b.id = ${unpaid.body.value.id}::uuid
    `;
    expect(rejectedSettlement).toEqual([{ status: 'PAYMENT_PENDING', paymentCount: 0n }]);
  });
});
