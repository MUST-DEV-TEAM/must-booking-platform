import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { QuoteService } from '../src/booking/quote.service';
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

describe('mixed-mode room auto-assignment', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let ownerId: string;
  let cookie: string;
  let verificationToken = '';
  const startsOn = '2035-09-10';
  const endsOn = '2035-09-12';
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

  async function createRoom(
    propertyUrl: string,
    roomTypeId: string,
    name: string,
  ): Promise<{ id: string }> {
    const response = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .send({ name })
      .expect(201);
    return response.body as { id: string };
  }

  async function setOverride(
    propertyUrl: string,
    ratePlanId: string,
    roomId: string,
    amount: string,
  ) {
    await request(app.getHttpServer())
      .patch(`${propertyUrl}/rate-plans/${ratePlanId}/rooms/${roomId}/price-override`)
      .set('Cookie', cookie)
      .send({ amount })
      .expect(200);
  }

  it('assigns only rooms whose effective price matches the quote', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Mixed Auto Assignment Group',
        propertyName: 'Mixed Auto Assignment Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `mixed-auto-assignment-${randomUUID()}@example.test`,
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
      .send({ bookingMode: 'MIXED' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const matchingType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Matching Price', maxOccupancy: 2 })
      .expect(201);
    const differentRoom = await createRoom(
      propertyUrl,
      matchingType.body.id,
      'Different Price Room',
    );
    const matchingOverrideRoom = await createRoom(
      propertyUrl,
      matchingType.body.id,
      'Matching Override Room',
    );
    const baseRateRoom = await createRoom(propertyUrl, matchingType.body.id, 'Base Rate Room');
    const noMatchType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'No Matching Price', maxOccupancy: 2 })
      .expect(201);
    const noMatchRooms = await Promise.all(
      ['No Match 1', 'No Match 2', 'No Match 3'].map((name) =>
        createRoom(propertyUrl, noMatchType.body.id, name),
      ),
    );
    const ratePlan = await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR' })
      .expect(201);
    for (const roomTypeId of [matchingType.body.id, noMatchType.body.id])
      await request(app.getHttpServer())
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId, startsOn: null, endsOn: null, amount: '100.00' })
        .expect(201);

    await setOverride(propertyUrl, ratePlan.body.id, differentRoom.id, '125.00');
    await setOverride(propertyUrl, ratePlan.body.id, matchingOverrideRoom.id, '100.00');
    await setOverride(propertyUrl, ratePlan.body.id, noMatchRooms[0].id, '110.00');
    await setOverride(propertyUrl, ratePlan.body.id, noMatchRooms[1].id, '120.00');
    await setOverride(propertyUrl, ratePlan.body.id, noMatchRooms[2].id, '130.00');

    const quotes = app.get(QuoteService);
    const provider = app.get(LocalPmsProvider);
    const context = { tenantId, propertyId };
    const bookAnyRoom = async (roomTypeId: string) => {
      const sessionId = randomUUID();
      const quote = await quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      });
      return provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: `must-${randomUUID()}`,
        roomTypeId,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
        guest: {
          email: `guest-${randomUUID()}@example.test`,
          firstName: 'Mixed',
          lastName: 'Guest',
          phone: null,
        },
        total: quote.total,
        quoteToken: quote.quoteToken,
        quoteSessionId: sessionId,
        paymentMethod: 'pay_at_hotel',
      });
    };

    await expect(bookAnyRoom(matchingType.body.id)).resolves.toMatchObject({
      ok: true,
      value: { roomId: matchingOverrideRoom.id, status: 'CONFIRMED' },
    });
    await expect(bookAnyRoom(matchingType.body.id)).resolves.toMatchObject({
      ok: true,
      value: { roomId: baseRateRoom.id, status: 'CONFIRMED' },
    });
    await expect(bookAnyRoom(noMatchType.body.id)).resolves.toMatchObject({
      ok: false,
      error: { code: 'AUTO_ASSIGNMENT_UNAVAILABLE' },
    });
  });
});
