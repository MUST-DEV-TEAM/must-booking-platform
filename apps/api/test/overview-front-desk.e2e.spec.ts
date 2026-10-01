import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { cleanupTenant } from './helpers/cleanup-tenant';

const database = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('front-desk overview fields', () => {
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let ownerId = '';
  let ownerCookie = '';
  const ownerEmail = `overview-owner-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let verificationToken = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token') ?? '';
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
    process.env.STRIPE_SECRET_KEY = 'sk_test_overview_e2e';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_overview_e2e';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) await database.$transaction((tx) => cleanupTenant(tx, tenantId));
    if (ownerId) await database.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app?.close();
    await database.$disconnect();
  });

  it("surfaces today's arrivals/departures, upcoming arrivals, revenue, balance due, and cancellations", async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Overview E2E Hotel Group',
        propertyName: 'Overview E2E Hotel',
        propertyAddress: '1 Overview Street',
        propertyTimezone: 'UTC',
        email: ownerEmail,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    ownerId = signup.body.user.id;
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;

    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    const today = dateFromToday(0);
    const tomorrow = dateFromToday(1);
    const inThreeDays = dateFromToday(3);
    const inFourDays = dateFromToday(4);
    const inTenDays = dateFromToday(10);
    const inElevenDays = dateFromToday(11);

    const roomType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Overview Suite', maxOccupancy: 3 })
      .expect(201);
    const roomTypeId = roomType.body.id;
    const ratePlan = await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Overview Flexible', currency: 'EUR', freeCancellationUntilHours: 24 })
      .expect(201);
    const ratePlanId = ratePlan.body.id;
    await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', ownerCookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '100.00' })
      .expect(201);
    for (const [startsOn, endsOn] of [[today, inElevenDays]] as const) {
      await request(app.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Cookie', ownerCookie)
        .send({ roomTypeId, startsOn, endsOn, availableUnits: 5 })
        .expect(204);
    }
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    // A guest arriving today, paying at the hotel — should show up in
    // today's arrivals and count toward balance due at the desk.
    const arrivalToday = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: today,
        endsOn: tomorrow,
        paymentMethod: 'pay_at_hotel',
        guest: { email: 'zed@example.test', firstName: 'Zed', lastName: 'Zephyr' },
      })
      .expect(201);
    expect(arrivalToday.body).toMatchObject({ ok: true, value: { status: 'CONFIRMED' } });

    // A second guest arriving today too, alphabetically before the first —
    // proves the alphabetical tie-break within the same date.
    const secondArrivalToday = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: today,
        endsOn: tomorrow,
        paymentMethod: 'pay_at_hotel',
        guest: { email: 'ann@example.test', firstName: 'Ann', lastName: 'Anders' },
      })
      .expect(201);
    expect(secondArrivalToday.body).toMatchObject({ ok: true, value: { status: 'CONFIRMED' } });

    // An upcoming arrival in 3 days.
    await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: inThreeDays,
        endsOn: inFourDays,
        paymentMethod: 'pay_at_hotel',
        guest: { email: 'upcoming@example.test', firstName: 'Uma', lastName: 'Upcoming' },
      })
      .expect(201);

    // A booking far enough out (10 days) that it must NOT appear in the
    // 7-day upcoming-arrivals window.
    await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: inTenDays,
        endsOn: inElevenDays,
        paymentMethod: 'pay_at_hotel',
        guest: { email: 'faroff@example.test', firstName: 'Faye', lastName: 'Faroff' },
      })
      .expect(201);

    // A booking created and immediately cancelled — should show up in
    // recent cancellations and the curated recent-activity feed, but not
    // count toward today's arrivals.
    const toCancel = await request(app.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: inThreeDays,
        endsOn: inFourDays,
        paymentMethod: 'pay_at_hotel',
        guest: { email: 'cancelme@example.test', firstName: 'Cara', lastName: 'Cancelme' },
      })
      .expect(201);
    const cancelBookingId = toCancel.body.value.id as string;
    const cancelResult = await request(app.getHttpServer())
      .delete(`${propertyUrl}/staff-bookings/${cancelBookingId}`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: toCancel.body.value.version })
      .expect(200);
    expect(cancelResult.body).toMatchObject({ ok: true });

    const overview = await request(app.getHttpServer())
      .get(`${propertyUrl}/overview`)
      .set('Cookie', ownerCookie)
      .expect(200);

    // Today's arrivals: Ann before Zed (alphabetical tie-break, same date).
    expect(overview.body.todaysArrivals.map((a: { guestName: string }) => a.guestName)).toEqual([
      'Ann Anders',
      'Zed Zephyr',
    ]);
    expect(overview.body.todaysArrivals[0]).toMatchObject({
      roomTypeName: 'Overview Suite',
      adults: 1,
      children: 0,
      hasSpecialRequests: false,
      paymentMethod: 'PAY_AT_HOTEL',
      totalAmount: '100.00',
      currency: 'EUR',
    });
    expect(overview.body.todaysArrivals[0].externalReference).toBeTruthy();

    // Upcoming arrivals: only the 3-day-out booking, not the 10-day-out one.
    const upcomingNames = overview.body.upcomingArrivals.map(
      (a: { guestName: string }) => a.guestName,
    );
    expect(upcomingNames).toContain('Uma Upcoming');
    expect(upcomingNames).not.toContain('Faye Faroff');

    // Balance due at the desk: sum of today's pay-at-hotel arrivals (2 x 100.00).
    expect(overview.body.balanceDueAtDesk).toMatchObject({ amount: '200.00', currency: 'EUR' });

    // Today's revenue: every non-cancelled booking created today, regardless
    // of arrival date (4 of the 5 bookings created today — the 5th was
    // cancelled and must not count toward revenue).
    expect(overview.body.revenue.today).toMatchObject({ amount: '400.00', currency: 'EUR' });

    // 4, not 5 — same as revenue, the cancelled booking is excluded.
    expect(overview.body.newBookingsSinceYesterday).toBeGreaterThanOrEqual(4);

    // Recent cancellations includes the one we just cancelled.
    expect(overview.body.recentCancellations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ guestName: 'Cara Cancelme', roomTypeName: 'Overview Suite' }),
      ]),
    );

    // Curated recent activity: real booking events in plain language, no
    // internal action strings.
    expect(overview.body.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'booking.created',
          summary: expect.stringContaining('booked'),
        }),
        expect.objectContaining({
          action: 'booking.cancelled',
          summary: expect.stringContaining('cancelled'),
        }),
      ]),
    );

    // Needs attention: the dashboard tab reads this list, not just the count. Nothing
    // needs attention yet; then one booking is stuck in manual review.
    expect(overview.body.needsAttention).toEqual([]);
    expect(overview.body.needsAttentionCount).toBe(0);
    const stuckBookingId = arrivalToday.body.value.id as string;
    await database.$executeRaw`
      UPDATE bookings SET status = 'MANUAL_REVIEW'::"BookingStatus" WHERE id = ${stuckBookingId}::uuid
    `;
    const withStuck = await request(app.getHttpServer())
      .get(`${propertyUrl}/overview`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(withStuck.body.needsAttentionCount).toBe(1);
    expect(withStuck.body.needsAttention).toEqual([
      expect.objectContaining({
        id: stuckBookingId,
        status: 'MANUAL_REVIEW',
        guestName: expect.any(String),
        guestEmail: expect.stringContaining('@'),
        roomTypeName: 'Overview Suite',
      }),
    ]);
  });
});

function dateFromToday(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
