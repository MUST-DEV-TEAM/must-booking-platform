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

describe('individual-room booking creation', () => {
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
    async sendRefundConfirmationEmail() {},
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

  it('enforces booking mode, quote room matching, and one reservation for a selected room', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Individual Room Booking Group',
        propertyName: 'Individual Room Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `individual-room-booking-${randomUUID()}@example.test`,
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
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const roomType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe', maxOccupancy: 2 })
      .expect(201);
    const firstRoom = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe 101' })
      .expect(201);
    const secondRoom = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe 102' })
      .expect(201);
    const apiRoom = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Deluxe 103' })
      .expect(201);
    const ratePlan = await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR' })
      .expect(201);
    const startsOn = '2035-08-10';
    const endsOn = '2035-08-12';
    await request(app.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId: roomType.body.id, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '90.00' })
      .expect(201);

    const provider = app.get(LocalPmsProvider);
    const quotes = app.get(QuoteService);
    const context = { tenantId, propertyId };
    const quote = (sessionId: string, roomId?: string) =>
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: roomType.body.id,
        roomId,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      });
    const booking = async (
      quoteValue: Awaited<ReturnType<typeof quote>>,
      sessionId: string,
      roomId?: string,
    ) =>
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: `must-${randomUUID()}`,
        roomTypeId: roomType.body.id,
        roomId,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
        guest: {
          email: `guest-${randomUUID()}@example.test`,
          firstName: 'Room',
          lastName: 'Guest',
          phone: null,
        },
        total: quoteValue.total,
        quoteToken: quoteValue.quoteToken,
        quoteSessionId: sessionId,
        paymentMethod: 'pay_at_hotel',
      });

    const roomTypeOnlySession = randomUUID();
    const roomTypeOnlyQuote = await quote(roomTypeOnlySession, firstRoom.body.id);
    await expect(
      booking(roomTypeOnlyQuote, roomTypeOnlySession, firstRoom.body.id),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROOM_ID_NOT_ALLOWED' },
    });

    await request(app.getHttpServer())
      .patch(propertyUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'MIXED' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${propertyUrl}/rooms/${firstRoom.body.id}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn, endsOn, isAvailable: false })
      .expect(204);
    const mixedSession = randomUUID();
    const mixedQuote = await quote(mixedSession);
    await expect(booking(mixedQuote, mixedSession)).resolves.toMatchObject({
      ok: true,
      value: { roomId: secondRoom.body.id },
    });
    await request(app.getHttpServer())
      .put(`${propertyUrl}/rooms/${firstRoom.body.id}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn, endsOn, isAvailable: true })
      .expect(204);

    await request(app.getHttpServer())
      .patch(propertyUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200);
    const missingRoomSession = randomUUID();
    const missingRoomQuote = await quote(missingRoomSession);
    await expect(booking(missingRoomQuote, missingRoomSession)).resolves.toMatchObject({
      ok: false,
      error: { code: 'ROOM_ID_REQUIRED' },
    });

    const mismatchedQuoteSession = randomUUID();
    const mismatchedQuote = await quote(mismatchedQuoteSession, firstRoom.body.id);
    await expect(
      booking(mismatchedQuote, mismatchedQuoteSession, secondRoom.body.id),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'QUOTE_MISMATCH' },
    });

    const guestQuote = await request(app.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .send({
        roomTypeId: roomType.body.id,
        roomId: apiRoom.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      })
      .expect(201);
    const guestCookie = guestQuote.headers['set-cookie'][0] as string;
    await request(app.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId: roomType.body.id,
        roomId: apiRoom.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
        guest: {
          email: `api-guest-${randomUUID()}@example.test`,
          firstName: 'API',
          lastName: 'Guest',
          phone: null,
        },
        total: guestQuote.body.total,
        quoteToken: guestQuote.body.quoteToken,
        paymentMethod: 'pay_at_hotel',
      })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          ok: true,
          value: { roomId: apiRoom.body.id, status: 'CONFIRMED' },
        });
      });

    await request(app.getHttpServer())
      .put(`${propertyUrl}/rooms/${secondRoom.body.id}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn, endsOn, isAvailable: false })
      .expect(204);
    const blockedRoomSession = randomUUID();
    const blockedRoomQuote = await quote(blockedRoomSession, secondRoom.body.id);
    await expect(
      booking(blockedRoomQuote, blockedRoomSession, secondRoom.body.id),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'AVAILABILITY_FAILED' },
    });

    const firstSession = randomUUID();
    const secondSession = randomUUID();
    const [firstQuote, secondQuote] = await Promise.all([
      quote(firstSession, firstRoom.body.id),
      quote(secondSession, firstRoom.body.id),
    ]);
    const results = await Promise.all([
      booking(firstQuote, firstSession, firstRoom.body.id),
      booking(secondQuote, secondSession, firstRoom.body.id),
    ]);
    expect(
      results.map((result) => (result.ok ? result.value.status : result.error.code)).sort(),
    ).toEqual(['AVAILABILITY_FAILED', 'CONFIRMED']);

    await request(app.getHttpServer())
      .get(`${propertyUrl}/rooms/${firstRoom.body.id}/availability`)
      .set('Cookie', cookie)
      .query({ startsOn, endsOn })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ isAvailable: false });
      });
    const selectedBookings = await admin.$queryRaw<Array<{ roomId: string }>>`
      SELECT room_id AS "roomId"
      FROM bookings
      WHERE tenant_id = ${tenantId}::uuid
        AND property_id = ${propertyId}::uuid
        AND room_id = ${firstRoom.body.id}::uuid
        AND status = 'CONFIRMED'::"BookingStatus"
    `;
    expect(selectedBookings).toHaveLength(1);
  });
});
