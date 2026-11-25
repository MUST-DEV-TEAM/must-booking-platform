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

/** G-48: a guest pays by bank transfer; the room is held until the hotel's deadline; staff confirm the transfer. */
describe('bank transfer bookings', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `bank-transfer-${randomUUID()}@example.test`;
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

  it('offers the method once the bank details exist, holds the room and confirms on the recorded transfer', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Bank Transfer E2E Group',
        propertyName: 'Bank Transfer E2E Hotel',
        propertyAddress: '1 Transfer Way',
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
      .send({ roomTypeId: roomType.body.id, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    await request(server)
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '95.00' })
      .expect(201);
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', ownerCookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const catalog = async () =>
      (await request(server).get(`${propertyUrl}/public/catalog`).expect(200)).body;
    const book = async (paymentMethod: string, guestEmail = 'transfer.guest@example.test') => {
      const first = await request(server).get(`${propertyUrl}/public/catalog`).expect(200);
      const guestCookie = first.headers['set-cookie'][0] as string;
      const quote = await request(server)
        .post(`${propertyUrl}/quotes`)
        .set('Cookie', guestCookie)
        .send({ roomTypeId: roomType.body.id, ratePlanId: ratePlan.body.id, startsOn, endsOn })
        .expect(201);
      return request(server)
        .post(`${propertyUrl}/bookings`)
        .set('Cookie', guestCookie)
        .set('Idempotency-Key', randomUUID())
        .send({
          roomTypeId: roomType.body.id,
          ratePlanId: ratePlan.body.id,
          startsOn,
          endsOn,
          guest: {
            email: guestEmail,
            firstName: 'Transfer',
            lastName: 'Guest',
            phone: '+355690000000',
          },
          total: quote.body.total,
          quoteToken: quote.body.quoteToken,
          paymentMethod,
        });
    };

    // Switched on without bank details: not offered, and a booking for it is refused.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({ bankTransferEnabled: true })
      .expect(200);
    expect((await catalog()).paymentMethods).toEqual(['pay_at_hotel']);
    expect((await book('bank_transfer')).status).toBeGreaterThanOrEqual(400);

    // A wrong IBAN is refused, a right one (typed with spaces) is saved without them.
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({ bankIban: 'AL35 2021 1109 0000 0000 0123 4568' })
      .expect(400);
    await request(server)
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({
        bankAccountHolder: 'Bank Transfer E2E Hotel Sh.p.k.',
        bankIban: 'AL35 2021 1109 0000 0000 0123 4567',
        bankBic: 'SGSBALTX',
        bankName: 'Societe Generale Albania',
        bankTransferDays: 2,
      })
      .expect(200);
    expect((await catalog()).paymentMethods).toEqual(['pay_at_hotel', 'bank_transfer']);

    const created = await book('bank_transfer');
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const booking = created.body.value;
    expect(booking.status).toBe('PAYMENT_PENDING');
    expect(booking.bankTransfer).toMatchObject({
      accountHolder: 'Bank Transfer E2E Hotel Sh.p.k.',
      iban: 'AL35202111090000000001234567',
      bic: 'SGSBALTX',
      reference: booking.externalReference,
      amount: { amount: '190.00', currency: 'EUR' },
    });
    const hours = (new Date(booking.bankTransfer.dueAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47);
    expect(hours).toBeLessThanOrEqual(48);
    // The guest is emailed the instructions (queued in the email log with its own event type).
    const instructions = await admin.$queryRaw<Array<{ subject: string }>>`
      SELECT subject FROM email_messages
      WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${booking.id}::uuid
        AND event_type = 'guest.booking_awaiting_transfer'`;
    expect(instructions).toHaveLength(1);
    expect(instructions[0]!.subject).toContain('Transfer to confirm');

    // The only room is held for the guest who is waiting to transfer.
    const second = await book('pay_at_hotel', 'someone.else@example.test');
    expect(second.status).toBeGreaterThanOrEqual(400);

    // Staff record the transfer: the booking is confirmed.
    await request(server)
      .post(`${propertyUrl}/bookings/${booking.id}/manual-payment`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        amount: booking.bankTransfer.amount,
        method: 'bank_transfer',
        evidence: { receivedOn: isoDateFromToday(0), reference: 'TRX-123456' },
      })
      .expect(200)
      .then((response) => expect(response.body.ok, JSON.stringify(response.body)).toBe(true));
    const confirmed = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM bookings WHERE id = ${booking.id}::uuid`;
    expect(confirmed[0]!.status).toBe('CONFIRMED');
  });

  it('releases the room when the transfer deadline passes', async () => {
    const server = app!.getHttpServer();
    const propertyRow = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM properties WHERE tenant_id = ${tenantId}::uuid LIMIT 1`;
    const propertyId = propertyRow[0]!.id;
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    const cookie = (
      await request(server)
        .post('/auth/login')
        .send({ email, password: 'correct-horse-battery-staple' })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    void cookie;
    // A second hotel date range, booked by transfer and then left past its deadline.
    const roomType = await admin.$queryRaw<Array<{ id: string; ratePlan: string }>>`
      SELECT rt.id::text, rp.id::text AS "ratePlan" FROM room_types rt
      JOIN rate_plans rp ON rp.tenant_id = rt.tenant_id AND rp.property_id = rt.property_id
      WHERE rt.tenant_id = ${tenantId}::uuid LIMIT 1`;
    const startsOn = isoDateFromToday(50);
    const endsOn = isoDateFromToday(51);
    const owner = await request(server)
      .post('/auth/login')
      .send({ email, password: 'correct-horse-battery-staple' })
      .expect(201);
    const ownerCookie = owner.headers['set-cookie'][0] as string;
    await request(server)
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', ownerCookie)
      .send({ roomTypeId: roomType[0]!.id, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    const first = await request(server).get(`${propertyUrl}/public/catalog`).expect(200);
    const guestCookie = first.headers['set-cookie'][0] as string;
    const quote = await request(server)
      .post(`${propertyUrl}/quotes`)
      .set('Cookie', guestCookie)
      .send({ roomTypeId: roomType[0]!.id, ratePlanId: roomType[0]!.ratePlan, startsOn, endsOn })
      .expect(201);
    const created = await request(server)
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId: roomType[0]!.id,
        ratePlanId: roomType[0]!.ratePlan,
        startsOn,
        endsOn,
        guest: {
          email: 'late.guest@example.test',
          firstName: 'Late',
          lastName: 'Guest',
          phone: '+355690000000',
        },
        total: quote.body.total,
        quoteToken: quote.body.quoteToken,
        paymentMethod: 'bank_transfer',
      })
      .expect(201);
    const bookingId = created.body.value.id as string;
    await admin.$executeRaw`UPDATE bookings SET payment_due_at = now() - interval '1 hour' WHERE id = ${bookingId}::uuid`;

    const { PaymentExpiryService } = await import('../src/payments/payment-expiry.service');
    await app!.get(PaymentExpiryService).sweep(new Date());
    const after = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM bookings WHERE id = ${bookingId}::uuid`;
    expect(after[0]!.status).toBe('EXPIRED');
  });
});
