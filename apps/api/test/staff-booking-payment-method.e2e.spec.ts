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
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
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
      return {
        ok: true,
        value: {
          id: `pok_test_${command.bookingId}`,
          url: `https://pay.pokpay.test/${command.bookingId}`,
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
});
