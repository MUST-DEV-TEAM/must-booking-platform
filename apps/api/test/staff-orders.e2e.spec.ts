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

/** Staff book several rooms for one guest as one order: all rooms or none, one reference, direct source. */
describe('staff multi-room orders', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `staff-orders-${randomUUID()}@example.test`;
  const mail = {
    async sendVerificationEmail(command: { verificationUrl: string }) {
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
  } as unknown as MailProvider;

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

  it('books two room types in one order, holds every room or none, and keeps the optional room guest', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Staff Orders Group',
        propertyName: 'Staff Orders Hotel',
        propertyAddress: '1 Order Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    const propertyId = signup.body.property.id as string;
    userId = signup.body.user.id;
    const cookie = signup.headers['set-cookie'][0] as string;
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(server)
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const garden = await request(server)
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Garden Suite', maxOccupancy: 2 })
      .expect(201);
    const sea = await request(server)
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Sea Suite', maxOccupancy: 2 })
      .expect(201);
    const ratePlan = await request(server)
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    const startsOn = isoDateFromToday(30);
    const endsOn = isoDateFromToday(32);
    for (const [type, units, amount] of [
      [garden, 3, '95.00'],
      [sea, 1, '110.00'],
    ] as const) {
      await request(server)
        .put(`${propertyUrl}/inventory-units`)
        .set('Idempotency-Key', crypto.randomUUID())
        .set('Cookie', cookie)
        .send({ roomTypeId: type.body.id, startsOn, endsOn, availableUnits: units })
        .expect(204);
      await request(server)
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Idempotency-Key', crypto.randomUUID())
        .set('Cookie', cookie)
        .send({ roomTypeId: type.body.id, startsOn: null, endsOn: null, amount })
        .expect(201);
    }
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const order = (rooms: Array<Record<string, unknown>>) =>
      request(server)
        .post(`${propertyUrl}/staff-bookings/orders`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({
          startsOn,
          endsOn,
          paymentMethod: 'pay_at_hotel',
          guest: {
            email: 'order.guest@example.test',
            firstName: 'Order',
            lastName: 'Guest',
            phone: '+355690000000',
          },
          rooms,
        });
    const room = (type: { body: { id: string } }, extra: Record<string, unknown> = {}) => ({
      roomTypeId: type.body.id,
      ratePlanId: ratePlan.body.id,
      adults: 2,
      children: 0,
      ...extra,
    });

    // One room is not an order.
    expect((await order([room(garden)])).status).toBe(400);

    // Two rooms of different types: confirmed together, direct source, the optional room guest kept.
    const created = await order([
      room(garden),
      room(sea, { guest: { firstName: 'Second', lastName: 'Sleeper' } }),
    ]);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.ok, JSON.stringify(created.body)).toBe(true);
    const reference = created.body.value.orderReference as string;
    const rows = await admin.$queryRaw<
      Array<{ status: string; source: string; roomGuest: string | null; total: string }>
    >`SELECT status::text, source::text, room_guest_last_name AS "roomGuest", total_amount::text AS total
      FROM bookings WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${reference}
      ORDER BY order_room_number`;
    expect(rows).toEqual([
      { status: 'CONFIRMED', source: 'DIRECT', roomGuest: 'Guest', total: '190.00' },
      { status: 'CONFIRMED', source: 'DIRECT', roomGuest: 'Sleeper', total: '220.00' },
    ]);

    // The Sea Suite is now sold out, so an order that needs it fails as a whole: nothing is held for the
    // Garden Suite room either.
    const before = await admin.$queryRaw<Array<{ booked: number }>>`
      SELECT COALESCE(SUM(booked_units), 0)::int AS booked FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND room_type_id = ${garden.body.id}::uuid`;
    const refused = await order([room(garden), room(sea)]);
    expect(refused.body.ok).toBe(false);
    const after = await admin.$queryRaw<Array<{ booked: number }>>`
      SELECT COALESCE(SUM(booked_units), 0)::int AS booked FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND room_type_id = ${garden.body.id}::uuid`;
    expect(after[0]!.booked).toBe(before[0]!.booked);

    // The hotel's own limit on rooms per booking applies to staff orders too.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', cookie)
      .send({ maxRoomsPerBooking: 2 })
      .expect(200);
    const tooMany = await order([room(garden), room(garden), room(garden)]);
    expect(tooMany.body.ok === false || tooMany.status >= 400).toBe(true);
  });
});
