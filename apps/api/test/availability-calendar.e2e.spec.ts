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

// The walk-in booking calendar's disabled-dates display needs one query per
// month instead of one per day — this proves the new local SQL (generate_series
// joined against inventory_units, correctly excluding blocked days) for real
// against a real DB, since it's genuinely new logic, not a refactor of
// something already covered elsewhere.
describe('availability calendar (local)', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let cookie: string;
  let roomTypeId: string;
  let roomId: string;
  let ratePlanId: string;
  let verificationToken = '';
  const email = `availability-calendar-${randomUUID()}@example.test`;
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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Availability Calendar Hotel',
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

    const roomType = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Calendar Test Room', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;
    const room = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Calendar Room 1' })
      .expect(201);
    roomId = room.body.id;
    const ratePlan = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Calendar Flexible', currency: 'EUR' })
      .expect(201);
    ratePlanId = ratePlan.body.id;

    // Available every day of March 2027 except the 10th (0 units), with the
    // 15th deliberately left unset (no inventory_units row at all).
    for (let day = 1; day <= 31; day++) {
      if (day === 15) continue;
      const date = `2027-03-${String(day).padStart(2, '0')}`;
      const nextDate = day === 31 ? '2027-04-01' : `2027-03-${String(day + 1).padStart(2, '0')}`;
      await request(app.getHttpServer())
        .put(`/tenants/${tenantId}/properties/${propertyId}/inventory-units`)
        .set('Cookie', cookie)
        .send({ roomTypeId, startsOn: date, endsOn: nextDate, availableUnits: day === 10 ? 0 : 3 })
        .expect(204);
    }
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('returns one entry per day of the month, correctly reflecting zero-inventory and unset days', async () => {
    const response = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/availability-calendar`)
      .query({ roomTypeId, month: '2027-03' })
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.days).toHaveLength(31);
    expect(response.body.days[0]).toEqual({ date: '2027-03-01', isAvailable: true });
    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-10')).toEqual({
      date: '2027-03-10',
      isAvailable: false,
    });
    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-15')).toEqual({
      date: '2027-03-15',
      isAvailable: false,
    });
    expect(response.body.days.at(-1)).toEqual({ date: '2027-03-31', isAvailable: true });
  });

  it('lists every room across every room type via the flat property-wide endpoint', async () => {
    const response = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/rooms`)
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Calendar Room 1',
          roomTypeId,
          roomTypeName: 'Calendar Test Room',
        }),
      ]),
    );
  });

  it('exposes the selected physical room calendar to guests without staff credentials', async () => {
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}`)
      .set('Cookie', cookie)
      .send({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/tenants/${tenantId}/properties/${propertyId}/rooms/${roomId}/availability`)
      .set('Cookie', cookie)
      .send({ startsOn: '2027-03-10', endsOn: '2027-03-11', isAvailable: false })
      .expect(204);

    const response = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/public/availability-calendar`)
      .query({ roomTypeId, roomId, month: '2027-03' })
      .expect(200);

    expect(response.body.days).toHaveLength(31);
    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-09')).toEqual({
      date: '2027-03-09',
      isAvailable: true,
    });
    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-10')).toEqual({
      date: '2027-03-10',
      isAvailable: false,
    });
  });

  it('marks dates occupied by an existing confirmed booking for the selected physical room unavailable', async () => {
    await admin.$executeRaw`
      INSERT INTO bookings (
        tenant_id, property_id, room_type_id, room_id, external_reference,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES (
        ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${roomId}::uuid,
        ${`availability-calendar-${randomUUID()}`},
        'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
        '2027-03-20'::date, '2027-03-22'::date, ${ratePlanId}::uuid, 100.00::numeric
      )
    `;

    const response = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${propertyId}/public/availability-calendar`)
      .query({ roomTypeId, roomId, month: '2027-03' })
      .expect(200);

    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-19')).toEqual({
      date: '2027-03-19',
      isAvailable: true,
    });
    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-20')).toEqual({
      date: '2027-03-20',
      isAvailable: false,
    });
    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-21')).toEqual({
      date: '2027-03-21',
      isAvailable: false,
    });
    expect(response.body.days.find((d: { date: string }) => d.date === '2027-03-22')).toEqual({
      date: '2027-03-22',
      isAvailable: true,
    });
  });
});
