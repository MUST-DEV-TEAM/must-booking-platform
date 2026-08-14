import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MultiRoomBookingService } from '../src/booking/multi-room-booking.service';
import { QuoteService } from '../src/booking/quote.service';
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

describe('Multi-room booking orders', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let verificationToken = '';
  const email = `multi-room-${randomUUID()}@example.test`;
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
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('rejects the whole order and leaves no hold when any requested room is unavailable', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Multi Room Hotel Group',
        propertyName: 'Multi Room Property',
        propertyAddress: '1 Atomic Way',
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
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const [firstType, secondType, ratePlan] = await Promise.all([
      request(app!.getHttpServer())
        .post(`${propertyUrl}/room-types`)
        .set('Cookie', cookie)
        .send({ name: 'Available Suite', maxOccupancy: 2 }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/room-types`)
        .set('Cookie', cookie)
        .send({ name: 'Unavailable Suite', maxOccupancy: 2 }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/rate-plans`)
        .set('Cookie', cookie)
        .send({ name: 'Flexible', currency: 'EUR' }),
    ]);
    expect(firstType.status).toBe(201);
    expect(secondType.status).toBe(201);
    expect(ratePlan.status).toBe(201);
    const startsOn = '2026-11-01';
    const endsOn = '2026-11-03';
    await Promise.all([
      request(app!.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Cookie', cookie)
        .send({ roomTypeId: firstType.body.id, startsOn, endsOn, availableUnits: 1 }),
      request(app!.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Cookie', cookie)
        .send({ roomTypeId: secondType.body.id, startsOn, endsOn, availableUnits: 0 }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId: firstType.body.id, startsOn: null, endsOn: null, amount: '100.00' }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId: secondType.body.id, startsOn: null, endsOn: null, amount: '110.00' }),
    ]);

    const quotes = app!.get(QuoteService);
    const sessionId = randomUUID();
    const [firstQuote, secondQuote] = await Promise.all([
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: firstType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: secondType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
    ]);
    const orders = app!.get(MultiRoomBookingService);
    const result = await orders.create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        startsOn,
        endsOn,
        quoteSessionId: sessionId,
        paymentMethod: 'pay_at_hotel',
        guest: {
          email: `guest-${randomUUID()}@example.test`,
          firstName: 'Primary',
          lastName: 'Guest',
          phone: null,
        },
        rooms: [
          {
            roomTypeId: firstType.body.id,
            ratePlanId: ratePlan.body.id,
            total: firstQuote.total,
            quoteToken: firstQuote.quoteToken,
          },
          {
            roomTypeId: secondType.body.id,
            ratePlanId: ratePlan.body.id,
            total: secondQuote.total,
            quoteToken: secondQuote.quoteToken,
            guest: { firstName: 'Second', lastName: 'Guest' },
          },
        ],
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'AVAILABILITY_FAILED' } });

    const inventory = await admin.$queryRaw<Array<{ roomTypeId: string; bookedUnits: number }>>`
      SELECT room_type_id AS "roomTypeId", booked_units AS "bookedUnits"
      FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
      ORDER BY room_type_id, stays_on
    `;
    expect(inventory.every((row) => row.bookedUnits === 0)).toBe(true);
    const bookings = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    expect(bookings[0]!.count).toBe(0n);

    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId: secondType.body.id, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    const [availableFirstQuote, availableSecondQuote] = await Promise.all([
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: firstType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: secondType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
    ]);
    const held = await orders.create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        externalReference: `must-order-${randomUUID()}`,
        startsOn,
        endsOn,
        quoteSessionId: sessionId,
        paymentMethod: 'pay_at_hotel',
        guest: {
          email: `second-guest-${randomUUID()}@example.test`,
          firstName: 'Primary',
          lastName: 'Guest',
          phone: null,
        },
        rooms: [
          {
            roomTypeId: firstType.body.id,
            ratePlanId: ratePlan.body.id,
            total: availableFirstQuote.total,
            quoteToken: availableFirstQuote.quoteToken,
          },
          {
            roomTypeId: secondType.body.id,
            ratePlanId: ratePlan.body.id,
            total: availableSecondQuote.total,
            quoteToken: availableSecondQuote.quoteToken,
            guest: { firstName: 'Second', lastName: 'Guest' },
          },
        ],
      },
    );
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.value.bookings.map((booking) => booking.status)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
    ]);
    const roomGuests = await admin.$queryRaw<
      Array<{ orderReference: string; orderRoomNumber: number; firstName: string | null; lastName: string | null }>
    >`
      SELECT order_reference AS "orderReference", order_room_number AS "orderRoomNumber",
        room_guest_first_name AS "firstName", room_guest_last_name AS "lastName"
      FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND order_reference = ${held.value.orderReference}
      ORDER BY order_room_number
    `;
    expect(roomGuests).toEqual([
      {
        orderReference: held.value.orderReference,
        orderRoomNumber: 1,
        firstName: 'Primary',
        lastName: 'Guest',
      },
      {
        orderReference: held.value.orderReference,
        orderRoomNumber: 2,
        firstName: 'Second',
        lastName: 'Guest',
      },
    ]);
  });
});
