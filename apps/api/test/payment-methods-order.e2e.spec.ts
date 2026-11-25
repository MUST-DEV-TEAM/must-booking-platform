import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { connectPaymentProviders } from './helpers/payment-connections';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

const isoDateFromToday = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

/** G-51 and S7b-2/3: the guest sees the methods in the hotel's order with a default, and what the reception accepts. */
describe('payment methods order and reception', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `pay-order-${randomUUID()}@example.test`;
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
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('lists the methods in the hotel order with its default and exposes what the reception accepts', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Pay Order E2E Group',
        propertyName: 'Pay Order E2E Hotel',
        propertyAddress: '1 Order Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    const propertyId = signup.body.property.id as string;
    userId = signup.body.user.id;
    const ownerCookie = signup.headers['set-cookie'][0] as string;
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(server)
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const roomType = await request(server)
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Garden Suite', maxOccupancy: 2 })
      .expect(201);
    const ratePlan = await request(server)
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    const startsOn = isoDateFromToday(30);
    const endsOn = isoDateFromToday(32);
    await request(server)
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn, endsOn, availableUnits: 5 })
      .expect(204);
    await request(server)
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '95.00' })
      .expect(201);
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    await connectPaymentProviders(admin, tenantId, propertyId, ['STRIPE', 'POKPAY']);
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: true, pokpay: true, payAtHotel: true })
      .expect(200);

    const catalog = () => request(server).get(`${propertyUrl}/public/catalog`).expect(200);

    // Nothing saved: the standard order, the first method pre-selected.
    expect((await catalog()).body).toMatchObject({
      paymentMethods: ['stripe', 'pokpay', 'pay_at_hotel'],
      defaultPaymentMethod: 'stripe',
    });

    // The hotel puts pay-at-the-hotel first and makes PokPay the default.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({
        paymentMethodOrder: ['pay_at_hotel', 'pokpay', 'stripe'],
        paymentDefaultMethod: 'pokpay',
        acceptedAtHotel: ['visa', 'cash'],
      })
      .expect(200);
    expect((await catalog()).body).toMatchObject({
      paymentMethods: ['pay_at_hotel', 'pokpay', 'stripe'],
      defaultPaymentMethod: 'pokpay',
    });

    // A method switched off disappears, and the default falls back to the first one offered.
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: true, pokpay: false, payAtHotel: true })
      .expect(200);
    expect((await catalog()).body).toMatchObject({
      paymentMethods: ['pay_at_hotel', 'stripe'],
      defaultPaymentMethod: 'pay_at_hotel',
    });

    // What the reception accepts reaches the public hotel answer, with readable names.
    const profile = await request(server).get(`${propertyUrl}/public/property`).expect(200);
    expect(profile.body.payment.acceptedAtHotel).toEqual([
      { value: 'cash', label: 'Cash' },
      { value: 'visa', label: 'Visa' },
    ]);
  });
});
