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

/** G-105: a guest pays a whole multi-room order by one bank transfer; every room is held, then confirmed together. */
describe('bank transfer for a multi-room order', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `bank-transfer-order-${randomUUID()}@example.test`;
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

  it('holds every room until the deadline, confirms them all on the recorded transfer, and releases them all when it passes', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Bank Order Group',
        propertyName: 'Bank Order Hotel',
        propertyAddress: '1 Transfer Way',
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

    const types = [] as Array<{ body: { id: string } }>;
    for (const name of ['Garden Suite', 'Sea Suite'])
      types.push(
        await request(server)
          .post(`${propertyUrl}/room-types`)
          .set('Cookie', cookie)
          .send({ name, maxOccupancy: 2 })
          .expect(201),
      );
    const ratePlan = await request(server)
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    const startsOn = isoDateFromToday(40);
    const endsOn = isoDateFromToday(42);
    for (const [index, amount] of ['95.00', '110.00'].entries()) {
      await request(server)
        .put(`${propertyUrl}/inventory-units`)
        .set('Idempotency-Key', crypto.randomUUID())
        .set('Cookie', cookie)
        .send({ roomTypeId: types[index]!.body.id, startsOn, endsOn, availableUnits: 2 })
        .expect(204);
      await request(server)
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Idempotency-Key', crypto.randomUUID())
        .set('Cookie', cookie)
        .send({ roomTypeId: types[index]!.body.id, startsOn: null, endsOn: null, amount })
        .expect(201);
    }
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const order = async (guestEmail: string) => {
      const first = await request(server).get(`${propertyUrl}/public/catalog`).expect(200);
      const guestCookie = first.headers['set-cookie'][0] as string;
      const quotes = [];
      for (const type of types)
        quotes.push(
          (
            await request(server)
              .post(`${propertyUrl}/quotes`)
              .set('Cookie', guestCookie)
              .send({ roomTypeId: type.body.id, ratePlanId: ratePlan.body.id, startsOn, endsOn })
              .expect(201)
          ).body,
        );
      return request(server)
        .post(`${propertyUrl}/bookings/orders`)
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', randomUUID())
        .send({
          startsOn,
          endsOn,
          paymentMethod: 'bank_transfer',
          guest: { email: guestEmail, firstName: 'Transfer', lastName: 'Order', phone: null },
          rooms: types.map((type, index) => ({
            roomTypeId: type.body.id,
            ratePlanId: ratePlan.body.id,
            total: quotes[index].total,
            quoteToken: quotes[index].quoteToken,
          })),
        });
    };

    // Not offered until the hotel enters its bank details.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', cookie)
      .send({ bankTransferEnabled: true })
      .expect(200);
    expect((await order('early@example.test')).body.ok).toBe(false);
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', cookie)
      .send({
        bankAccountHolder: 'Bank Order Hotel Sh.p.k.',
        bankIban: 'AL35 2021 1109 0000 0000 0123 4567',
        bankTransferDays: 2,
      })
      .expect(200);

    const created = await order('transfer.order@example.test');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const value = created.body.value;
    expect(value.bankTransfer).toMatchObject({
      accountHolder: 'Bank Order Hotel Sh.p.k.',
      iban: 'AL35202111090000000001234567',
      reference: value.orderReference,
      amount: { amount: '410.00', currency: 'EUR' },
    });
    const rooms = await admin.$queryRaw<Array<{ status: string; due: boolean }>>`
      SELECT status::text, (payment_due_at IS NOT NULL) AS due FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${value.orderReference}
      ORDER BY order_room_number`;
    expect(rooms).toEqual([
      { status: 'PAYMENT_PENDING', due: true },
      { status: 'PAYMENT_PENDING', due: true },
    ]);
    const emails = await admin.$queryRaw<Array<{ subject: string }>>`
      SELECT subject FROM email_messages
      WHERE tenant_id = ${tenantId}::uuid AND event_type = 'guest.booking_awaiting_transfer'`;
    expect(emails).toHaveLength(1);

    // Staff record the one transfer on the first room: both rooms are confirmed.
    await request(server)
      .post(`${propertyUrl}/bookings/${value.bookings[0].id}/manual-payment`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        amount: value.bankTransfer.amount,
        method: 'bank_transfer',
        evidence: { receivedOn: isoDateFromToday(0), reference: 'TRX-ORDER-1' },
      })
      .expect(200)
      .then((response) => expect(response.body.ok, JSON.stringify(response.body)).toBe(true));
    const confirmed = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${value.orderReference}
      ORDER BY order_room_number`;
    expect(confirmed).toEqual([{ status: 'CONFIRMED' }, { status: 'CONFIRMED' }]);

    // A second order that is never paid: past its deadline, both rooms are released.
    const late = await order('late.order@example.test');
    expect(late.status, JSON.stringify(late.body)).toBe(201);
    await admin.$executeRaw`UPDATE bookings SET payment_due_at = now() - interval '1 hour'
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${late.body.value.orderReference}`;
    const { PaymentExpiryService } = await import('../src/payments/payment-expiry.service');
    await app!.get(PaymentExpiryService).sweep(new Date());
    const released = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${late.body.value.orderReference}
      ORDER BY order_room_number`;
    expect(released.every((room) => room.status !== 'PAYMENT_PENDING')).toBe(true);
    const held = await admin.$queryRaw<Array<{ booked: number }>>`
      SELECT COALESCE(SUM(booked_units), 0)::int AS booked FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND room_type_id = ${types[0]!.body.id}::uuid`;
    // Only the confirmed order still holds a Garden Suite.
    expect(held[0]!.booked).toBe(2);
  });
});
