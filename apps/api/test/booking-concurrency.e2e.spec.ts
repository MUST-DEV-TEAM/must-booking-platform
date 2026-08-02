import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { QuoteService } from '../src/booking/quote.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import type { PaymentProvider } from '@must/domain-contracts';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('LocalPmsProvider concurrent booking creation', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let verificationToken = '';
  const email = `booking-concurrency-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
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
      return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: '', retryable: false } };
    },
    async refund() {
      return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: '', retryable: false } };
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
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) {
      await admin.$executeRaw`DELETE FROM integration_operations WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM bookings WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM guests WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM inventory_units WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM rate_rules WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM rate_plans WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_role_template_capabilities WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM property_role_templates WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM capabilities WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM notifications WHERE tenant_id = ${tenantId}::uuid`;
    }
    if (propertyId) await admin.$executeRaw`DELETE FROM properties WHERE id = ${propertyId}::uuid`;
    if (tenantId) await admin.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('confirms exactly one simultaneous booking for the final unit', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Concurrency Hotel Group',
        propertyName: 'Concurrency Property',
        propertyAddress: '1 Lock Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    const cookie = signup.headers['set-cookie'][0];
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;

    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: false, payAtHotel: false })
      .expect(200);
    const roomType = await request(app!.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Last Unit Suite', maxOccupancy: 2 })
      .expect(201);
    const ratePlan = await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Last Unit Flexible', currency: 'EUR' })
      .expect(201);
    const roomTypeId = roomType.body.id as string;
    const ratePlanId = ratePlan.body.id as string;
    const startsOn = '2026-10-01';
    const endsOn = '2026-10-03';
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '90.00' })
      .expect(201);

    const provider = app!.get(LocalPmsProvider);
    const quotes = app!.get(QuoteService);
    const context = { tenantId, propertyId };
    const firstSessionId = randomUUID();
    const secondSessionId = randomUUID();
    const [firstQuote, secondQuote] = await Promise.all([
      quotes.create(tenantId, propertyId, firstSessionId, {
        roomTypeId,
        ratePlanId,
        startsOn,
        endsOn,
      }),
      quotes.create(tenantId, propertyId, secondSessionId, {
        roomTypeId,
        ratePlanId,
        startsOn,
        endsOn,
      }),
    ]);

    const results = await Promise.all([
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: `must-${randomUUID()}`,
        roomTypeId,
        ratePlanId,
        startsOn,
        endsOn,
        guest: {
          email: `first-${randomUUID()}@example.test`,
          firstName: 'First',
          lastName: 'Guest',
          phone: null,
        },
        total: firstQuote.total,
        quoteToken: firstQuote.quoteToken,
        quoteSessionId: firstSessionId,
        paymentMethod: 'stripe',
      }),
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: `must-${randomUUID()}`,
        roomTypeId,
        ratePlanId,
        startsOn,
        endsOn,
        guest: {
          email: `second-${randomUUID()}@example.test`,
          firstName: 'Second',
          lastName: 'Guest',
          phone: null,
        },
        total: secondQuote.total,
        quoteToken: secondQuote.quoteToken,
        quoteSessionId: secondSessionId,
        paymentMethod: 'stripe',
      }),
    ]);

    expect(
      results.map((result) => (result.ok ? result.value.status : result.error.code)).sort(),
    ).toEqual(['AVAILABILITY_FAILED', 'PAYMENT_PENDING']);
    const inventory = await admin.$queryRaw<Array<{ availableUnits: number; bookedUnits: number }>>`
      SELECT available_units AS "availableUnits", booked_units AS "bookedUnits"
      FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND room_type_id = ${roomTypeId}::uuid
      ORDER BY stays_on
    `;
    expect(inventory).toEqual([
      { availableUnits: 1, bookedUnits: 1 },
      { availableUnits: 1, bookedUnits: 1 },
    ]);
  });
});
