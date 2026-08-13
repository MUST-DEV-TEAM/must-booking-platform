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

/**
 * Covers the public requests made by the retrofitted WordPress guest flow.
 *
 * The plugin keeps its selection in a first-party WordPress transient, but its
 * server-side MustApiClient makes the requests below in the same order.  The
 * cancellation token is deliberately read from the booking API response rather
 * than an inbox: it is the signed token that the confirmation email carries.
 */
describe('guest journey', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let ownerCookie: string;
  let verificationToken = '';
  const email = `guest-journey-${randomUUID()}@example.test`;
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
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('searches, selects, checks out, confirms, and cancels through the public guest API', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Guest Journey E2E Group',
        propertyName: 'Guest Journey E2E Hotel',
        propertyAddress: '1 Journey Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    ownerCookie = signup.headers['set-cookie'][0] as string;
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;

    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const roomType = await request(app!.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Garden Suite', maxOccupancy: 2 })
      .expect(201);
    const ratePlan = await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);

    const startsOn = isoDateFromToday(30);
    const endsOn = isoDateFromToday(32);
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '95.00' })
      .expect(201);
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    // Search / select: the plugin loads catalog, then checks the selected stay.
    const catalog = await request(app!.getHttpServer()).get(`${propertyUrl}/public/catalog`).expect(200);
    const guestCookie = catalog.headers['set-cookie'][0] as string;
    expect(guestCookie).toContain('must_guest_session=');
    expect(catalog.body).toMatchObject({
      paymentMethods: ['pay_at_hotel'],
      roomTypes: [
        expect.objectContaining({
          id: roomType.body.id,
          name: 'Garden Suite',
          ratePlans: [expect.objectContaining({ id: ratePlan.body.id, name: 'Flexible' })],
        }),
      ],
    });
    const availability = await request(app!.getHttpServer())
      .get(`${propertyUrl}/public/availability`)
      .set('Cookie', guestCookie)
      .query({ roomTypeId: roomType.body.id, startsOn, endsOn })
      .expect(200);
    expect(availability.body).toMatchObject({ isAvailable: true, availableUnits: 1 });

    // Checkout: selection becomes a signed quote, then a pay-at-hotel booking.
    const quote = await request(app!.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .set('Cookie', guestCookie)
      .send({ roomTypeId: roomType.body.id, ratePlanId: ratePlan.body.id, startsOn, endsOn })
      .expect(201);
    expect(quote.body).toMatchObject({
      roomTypeId: roomType.body.id,
      ratePlanId: ratePlan.body.id,
      startsOn,
      endsOn,
      total: { amount: '190.00', currency: 'EUR' },
      nightlyRates: [
        { date: startsOn, amount: '95.00' },
        { date: isoDateFromToday(31), amount: '95.00' },
      ],
    });

    const created = await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId: roomType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
        guest: {
          email: 'journey.guest@example.test',
          firstName: 'Journey',
          lastName: 'Guest',
          phone: '+355690000000',
        },
        total: quote.body.total,
        quoteToken: quote.body.quoteToken,
        paymentMethod: 'pay_at_hotel',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      ok: true,
      value: {
        status: 'CONFIRMED',
        paymentMethod: 'PAY_AT_HOTEL',
        nightlyRates: quote.body.nightlyRates,
        cancellationToken: expect.any(String),
      },
    });

    const bookingId = created.body.value.id as string;
    const cancellationToken = created.body.value.cancellationToken as string;

    // Confirmation: same anonymous session can retrieve the persisted booking.
    const confirmation = await request(app!.getHttpServer())
      .get(`${propertyUrl}/public/bookings/${bookingId}`)
      .set('Cookie', guestCookie)
      .expect(200);
    expect(confirmation.body).toMatchObject({
      id: bookingId,
      status: 'CONFIRMED',
      roomTypeId: roomType.body.id,
      startsOn,
      endsOn,
      nightlyRates: quote.body.nightlyRates,
    });

    // The email link works even after the original browser session is gone:
    // cancellation verifies the signed token and restores its guest identity.
    const cancelled = await request(app!.getHttpServer())
      .delete(`${propertyUrl}/bookings/${bookingId}`)
      .query({ cancellationToken })
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: confirmation.body.version, reason: 'E2E cancellation' })
      .expect(200);
    expect(cancelled.body).toMatchObject({ ok: true, value: { id: bookingId, status: 'CANCELLED' } });

    const cancelledConfirmation = await request(app!.getHttpServer())
      .get(`${propertyUrl}/public/bookings/${bookingId}`)
      .set('Cookie', guestCookie)
      .expect(200);
    expect(cancelledConfirmation.body).toMatchObject({ id: bookingId, status: 'CANCELLED' });

    const restoredAvailability = await request(app!.getHttpServer())
      .get(`${propertyUrl}/public/availability`)
      .set('Cookie', guestCookie)
      .query({ roomTypeId: roomType.body.id, startsOn, endsOn })
      .expect(200);
    expect(restoredAvailability.body).toMatchObject({ isAvailable: true, availableUnits: 1 });
  });
});
