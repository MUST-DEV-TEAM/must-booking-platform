import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('room price overrides', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let ownerId: string;
  let cookie: string;
  let verificationToken = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
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
    if (tenantId) {
      await cleanupTenant(admin, tenantId);
    }
    if (ownerId) await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  it('prices a selected room at its override and falls back to the room-type base rate', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Room Price Overrides Group',
        propertyName: 'Room Price Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `room-price-overrides-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    ownerId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    await request(app.getHttpServer())
      .patch(propertyUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200);

    const roomType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe', maxOccupancy: 2 })
      .expect(201);
    const overriddenRoom = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe 101' })
      .expect(201);
    const baseRateRoom = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe 102' })
      .expect(201);
    const ratePlan = await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '100.00' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(
        `${propertyUrl}/rate-plans/${ratePlan.body.id}/rooms/${overriddenRoom.body.id}/price-override`,
      )
      .set('Cookie', cookie)
      .send({ amount: '125.50' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({ roomId: overriddenRoom.body.id, amount: '125.50' });
      });
    await request(app.getHttpServer())
      .get(`${propertyUrl}/rate-plans/${ratePlan.body.id}/room-price-overrides`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual([{ roomId: overriddenRoom.body.id, amount: '125.50' }]);
      });

    const quote = (roomId: string) =>
      request(app.getHttpServer()).post(`${propertyUrl}/quotes`).send({
        roomTypeId: roomType.body.id,
        roomId,
        ratePlanId: ratePlan.body.id,
        startsOn: '2035-08-10',
        endsOn: '2035-08-12',
      });
    await quote(overriddenRoom.body.id)
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          roomId: overriddenRoom.body.id,
          total: { amount: '251.00', currency: 'EUR' },
        });
      });
    await quote(baseRateRoom.body.id)
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          roomId: baseRateRoom.body.id,
          total: { amount: '200.00', currency: 'EUR' },
        });
      });

    await request(app.getHttpServer())
      .patch(
        `/tenants/${randomUUID()}/properties/${propertyId}/rate-plans/${ratePlan.body.id}/rooms/${overriddenRoom.body.id}/price-override`,
      )
      .set('Cookie', cookie)
      .send({ amount: '1.00' })
      .expect(403);
  });
});
