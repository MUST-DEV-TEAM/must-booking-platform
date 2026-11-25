import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
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

/** G-14: a multi-room order confirmed at the hotel gets the same "Booking created" notice as a single booking. */
describe('multi-room order notice', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `multi-notice-${randomUUID()}@example.test`;
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

  it('writes one Booking created notice per confirmed room, once', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Multi Notice E2E Group',
        propertyName: 'Multi Notice E2E Hotel',
        propertyAddress: '1 Notice Way',
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
    const secondType = await request(server)
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Sea Suite', maxOccupancy: 2 })
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
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: secondType.body.id, startsOn, endsOn, availableUnits: 5 })
      .expect(204);
    await request(server)
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '95.00' })
      .expect(201);
    await request(server)
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: secondType.body.id, startsOn: null, endsOn: null, amount: '110.00' })
      .expect(201);
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const catalog = await request(server).get(`${propertyUrl}/public/catalog`).expect(200);
    const guestCookie = catalog.headers['set-cookie'][0] as string;
    const quoteFor = async (typeId: string) =>
      (
        await request(server)
          .post(`${propertyUrl}/quotes`)
          .set('Cookie', guestCookie)
          .send({ roomTypeId: typeId, ratePlanId: ratePlan.body.id, startsOn, endsOn })
          .expect(201)
      ).body;
    const first = await quoteFor(roomType.body.id);
    const second = await quoteFor(secondType.body.id);
    const order = await request(server)
      .post(`${propertyUrl}/bookings/orders`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        startsOn,
        endsOn,
        guest: {
          email: 'order.guest@example.test',
          firstName: 'Order',
          lastName: 'Guest',
          phone: '+355690000000',
        },
        paymentMethod: 'pay_at_hotel',
        rooms: [
          {
            roomTypeId: roomType.body.id,
            ratePlanId: ratePlan.body.id,
            total: first.total,
            quoteToken: first.quoteToken,
          },
          {
            roomTypeId: secondType.body.id,
            ratePlanId: ratePlan.body.id,
            total: second.total,
            quoteToken: second.quoteToken,
          },
        ],
      });
    expect(order.status).toBe(201);
    const ids = (order.body.value.bookings as Array<{ id: string; status: string }>).map(
      (booking) => booking.id,
    );
    expect(ids).toHaveLength(2);

    const notices = await admin.$queryRaw<Array<{ bookingId: string }>>`
      SELECT payload ->> 'bookingId' AS "bookingId" FROM notifications
      WHERE tenant_id = ${tenantId}::uuid AND type = 'BOOKING_CREATED'`;
    expect(notices.map((notice) => notice.bookingId).sort()).toEqual([...ids].sort());
  });
});
