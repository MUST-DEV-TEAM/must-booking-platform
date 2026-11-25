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

/** G-96: the guest sees where the confirmation went (masked) and it can be sent again, by the guest or by staff. */
describe('sending a confirmation again', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const email = `confirmation-resend-${randomUUID()}@example.test`;
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

  it('masks the address, resends to the booking or another address, limits it to 3 a day, and refuses an unconfirmed booking', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Resend Group',
        propertyName: 'Resend Hotel',
        propertyAddress: '1 Resend Way',
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
    const roomType = await request(server)
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Garden Suite', maxOccupancy: 2 })
      .expect(201);
    const ratePlan = await request(server)
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    const startsOn = isoDateFromToday(30);
    const endsOn = isoDateFromToday(32);
    await request(server)
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId: roomType.body.id, startsOn, endsOn, availableUnits: 3 })
      .expect(204);
    await request(server)
      .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId: roomType.body.id, startsOn: null, endsOn: null, amount: '95.00' })
      .expect(201);
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const first = await request(server).get(`${propertyUrl}/public/catalog`).expect(200);
    const guestCookie = first.headers['set-cookie'][0] as string;
    const quote = await request(server)
      .post(`${propertyUrl}/quotes`)
      .set('Cookie', guestCookie)
      .send({ roomTypeId: roomType.body.id, ratePlanId: ratePlan.body.id, startsOn, endsOn })
      .expect(201);
    const created = await request(server)
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId: roomType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
        guest: {
          email: 'ada.lovelace@example.test',
          firstName: 'Ada',
          lastName: 'Lovelace',
          phone: null,
        },
        total: quote.body.total,
        quoteToken: quote.body.quoteToken,
        paymentMethod: 'pay_at_hotel',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const booking = created.body.value;
    expect(booking.status).toBe('CONFIRMED');

    // The guest's own view says where the emails go, without giving the address away.
    const view = await request(server)
      .get(`${propertyUrl}/public/bookings/${booking.id}`)
      .set('Cookie', guestCookie)
      .expect(200);
    expect(view.body.emailHint).toBe('a***@example.test');
    expect(JSON.stringify(view.body)).not.toContain('ada.lovelace');

    // Staff send it again to the address on the booking, then to another one.
    const sent = () =>
      admin.$queryRaw<Array<{ to: string }>>`
        SELECT recipient_email AS "to" FROM email_messages
        WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${booking.id}::uuid
          AND idempotency_key LIKE 'payment-confirmation/resend:%' ORDER BY created_at`;
    const resend = (body: object, auth = true) =>
      request(server)
        .post(`${propertyUrl}/bookings/${booking.id}/resend-confirmation`)
        .set('Cookie', auth ? cookie : guestCookie)
        .send(body);
    const one = await resend({}).expect(200);
    expect(one.body).toEqual({ sent: true, sentTo: 'a***@example.test' });
    const two = await resend({ email: 'someone.else@example.test' }).expect(200);
    expect(two.body.sentTo).toBe('s***@example.test');
    expect((await sent()).map((row) => row.to)).toEqual([
      'ada.lovelace@example.test',
      'someone.else@example.test',
    ]);
    // A bad address is refused; the audit trail records who did it.
    await resend({ email: 'not an address' }).expect(400);
    const audits = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND action = 'booking.confirmation_resent'`;
    expect(Number(audits[0]!.count)).toBe(2);

    // The guest's manage link can do it too; the fourth resend of the day is refused.
    const manage = `${propertyUrl}/bookings/${booking.id}/manage`;
    const guestToken = created.body.value.cancellationToken as string;
    const three = await request(server)
      .post(`${manage}/resend-confirmation`)
      .send({ token: guestToken })
      .expect(200);
    expect(three.body.sentTo).toBe('a***@example.test');
    await request(server)
      .post(`${manage}/resend-confirmation`)
      .send({ token: guestToken })
      .expect(429);
    await request(server)
      .post(`${manage}/resend-confirmation`)
      .send({ token: 'nonsense' })
      .expect(400);

    // A guest who sends it to another address cannot use one address over and over: a second booking may send to
    // an address once more, and then it is refused for that address (2 a day), though the booking has slots left.
    const q2 = await request(server)
      .post(`${propertyUrl}/quotes`)
      .set('Cookie', guestCookie)
      .send({ roomTypeId: roomType.body.id, ratePlanId: ratePlan.body.id, startsOn, endsOn })
      .expect(201);
    const second = await request(server)
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId: roomType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
        guest: {
          email: 'grace.hopper@example.test',
          firstName: 'Grace',
          lastName: 'Hopper',
          phone: null,
        },
        total: q2.body.total,
        quoteToken: q2.body.quoteToken,
        paymentMethod: 'pay_at_hotel',
      })
      .expect(201);
    const manage2 = `${propertyUrl}/bookings/${second.body.value.id}/manage/resend-confirmation`;
    const token2 = second.body.value.cancellationToken as string;
    await request(server)
      .post(manage2)
      .send({ token: token2, email: 'someone.else@example.test' })
      .expect(200);
    await request(server)
      .post(manage2)
      .send({ token: token2, email: 'someone.else@example.test' })
      .expect(429);
    // To the address on the booking is still fine.
    await request(server).post(manage2).send({ token: token2 }).expect(200);

    // An unconfirmed booking has nothing to resend.
    await admin.$executeRaw`UPDATE bookings SET status = 'CANCELLED'::"BookingStatus"
      WHERE id = ${booking.id}::uuid AND tenant_id = ${tenantId}::uuid`;
    await resend({}).expect(409);
  });
});
