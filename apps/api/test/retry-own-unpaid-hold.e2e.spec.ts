import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentProvider } from '@must/domain-contracts';

import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { QuoteService } from '../src/booking/quote.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { withoutExternalWorkers } from './helpers/without-external-workers';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

// A guest who leaves the online payment page and starts again must not be refused by their own unpaid hold.
describe('retry after an abandoned online payment', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let ownerId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let verificationToken = '';
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
    async sendRenderedEmail() {},
  };
  const payments: PaymentProvider = {
    async createCheckoutSession(_context, command) {
      return {
        ok: true,
        value: {
          id: `cs_test_${command.bookingId}`,
          url: `https://checkout.stripe.test/${command.bookingId}`,
        },
      };
    },
    async verifyWebhookEvent() {
      return {
        ok: false,
        error: { code: 'NOT_USED', message: 'Not used here.', retryable: false },
      };
    },
    async refund() {
      return { ok: false, error: { code: 'NOT_USED', message: 'Not used here.', retryable: false } };
    },
    async getPayment() {
      return null;
    },
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const builder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(payments);
    const moduleRef = await withoutExternalWorkers(builder).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Retry Hold Group',
        propertyName: 'Retry Hold Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `retry-hold-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    ownerId = signup.body.user.id;
    const cookie = signup.headers['set-cookie'][0];
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
      .send({ stripe: true, pokpay: false, payAtHotel: true })
      .expect(200);
    // One room only, so a second booking for the same dates can only succeed if the first hold is released.
    const roomType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Only Room Type', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;
    await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Only Room' })
      .expect(201);
    const ratePlan = await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR' })
      .expect(201);
    ratePlanId = ratePlan.body.id;
    await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlanId}/rules`)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '100.00' })
      .expect(201);
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (ownerId) await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  const context = () => ({ tenantId, propertyId });
  const statusOf = async (id: string) =>
    (
      await admin.$queryRaw<Array<{ status: string }>>`
        SELECT status::text AS status FROM bookings WHERE id = ${id}::uuid`
    )[0]?.status;

  async function bookOnline(options: {
    sessionId: string;
    email: string;
    startsOn: string;
    endsOn: string;
  }) {
    const quote = await app.get(QuoteService).create(tenantId, propertyId, options.sessionId, {
      roomTypeId,
      ratePlanId,
      startsOn: options.startsOn,
      endsOn: options.endsOn,
    });
    return app.get(LocalPmsProvider).createBooking(context(), {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: options.startsOn,
      endsOn: options.endsOn,
      guest: { email: options.email, firstName: 'Retry', lastName: 'Guest', phone: null },
      total: quote.total,
      quoteToken: quote.quoteToken,
      quoteSessionId: options.sessionId,
      paymentMethod: 'stripe',
    });
  }

  it('releases the guest’s own unpaid hold when the same browser session tries again', async () => {
    const sessionId = randomUUID();
    const first = await bookOnline({
      sessionId,
      email: `same-session-${randomUUID()}@example.test`,
      startsOn: '2035-03-10',
      endsOn: '2035-03-12',
    });
    if (!first.ok) throw new Error(`First attempt failed: ${first.error.code}`);
    expect(first.value.status).toBe('PAYMENT_PENDING');

    // Same session, a different email typed this time.
    const second = await bookOnline({
      sessionId,
      email: `other-${randomUUID()}@example.test`,
      startsOn: '2035-03-10',
      endsOn: '2035-03-12',
    });
    expect(second).toMatchObject({ ok: true, value: { status: 'PAYMENT_PENDING' } });
    expect(await statusOf(first.value.id)).toBe('EXPIRED');
    const audit = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND action = 'booking.payment_superseded'
        AND target_id = ${first.value.id}::text`;
    expect(audit[0]!.count).toBe(1n);
  });

  it('does not release a hold from another session just because the email matches', async () => {
    const email = `same-email-${randomUUID()}@example.test`;
    const first = await bookOnline({
      sessionId: randomUUID(),
      email,
      startsOn: '2035-04-10',
      endsOn: '2035-04-12',
    });
    if (!first.ok) throw new Error(`First attempt failed: ${first.error.code}`);

    // Anyone can type someone else's email, so it must not let them cancel that person's hold.
    const second = await bookOnline({
      sessionId: randomUUID(),
      email,
      startsOn: '2035-04-10',
      endsOn: '2035-04-12',
    });
    expect(second).toMatchObject({ ok: false, error: { code: 'ROOM_HELD_FOR_PAYMENT' } });
    expect(await statusOf(first.value.id)).toBe('PAYMENT_PENDING');
  });

  it('keeps the old hold when the new attempt fails the quote check', async () => {
    const sessionId = randomUUID();
    const first = await bookOnline({
      sessionId,
      email: `bad-quote-${randomUUID()}@example.test`,
      startsOn: '2035-08-10',
      endsOn: '2035-08-12',
    });
    if (!first.ok) throw new Error(`First attempt failed: ${first.error.code}`);
    const quote = await app.get(QuoteService).create(tenantId, propertyId, sessionId, {
      roomTypeId,
      ratePlanId,
      startsOn: '2035-08-10',
      endsOn: '2035-08-12',
    });
    const retry = await app.get(LocalPmsProvider).createBooking(context(), {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2035-08-10',
      endsOn: '2035-08-12',
      guest: { email: `bad-quote-${randomUUID()}@example.test`, firstName: 'Retry', lastName: 'Guest', phone: null },
      total: quote.total,
      quoteToken: `${quote.quoteToken}x`,
      quoteSessionId: sessionId,
      paymentMethod: 'stripe',
    });
    expect(retry).toMatchObject({ ok: false, error: { code: 'QUOTE_INVALID' } });
    expect(await statusOf(first.value.id)).toBe('PAYMENT_PENDING');
  });

  it('keeps another guest’s hold and says the room is held, and for how long', async () => {
    const first = await bookOnline({
      sessionId: randomUUID(),
      email: `holder-${randomUUID()}@example.test`,
      startsOn: '2035-05-10',
      endsOn: '2035-05-12',
    });
    if (!first.ok) throw new Error(`First attempt failed: ${first.error.code}`);

    const other = await bookOnline({
      sessionId: randomUUID(),
      email: `someone-else-${randomUUID()}@example.test`,
      startsOn: '2035-05-11',
      endsOn: '2035-05-13',
    });
    expect(other).toMatchObject({
      ok: false,
      error: {
        code: 'ROOM_HELD_FOR_PAYMENT',
        message: expect.stringMatching(/held for another guest.*about \d+ minutes?/),
      },
    });
    expect(await statusOf(first.value.id)).toBe('PAYMENT_PENDING');
  });

  it('leaves the guest’s own hold alone when the new stay does not overlap it', async () => {
    const sessionId = randomUUID();
    const email = `later-dates-${randomUUID()}@example.test`;
    const first = await bookOnline({
      sessionId,
      email,
      startsOn: '2035-06-10',
      endsOn: '2035-06-12',
    });
    if (!first.ok) throw new Error(`First attempt failed: ${first.error.code}`);
    const second = await bookOnline({
      sessionId,
      email,
      startsOn: '2035-06-20',
      endsOn: '2035-06-22',
    });
    expect(second).toMatchObject({ ok: true, value: { status: 'PAYMENT_PENDING' } });
    expect(await statusOf(first.value.id)).toBe('PAYMENT_PENDING');
  });

  it('does not release a hold that already has a payment recorded', async () => {
    const sessionId = randomUUID();
    const email = `paid-${randomUUID()}@example.test`;
    const first = await bookOnline({
      sessionId,
      email,
      startsOn: '2035-07-10',
      endsOn: '2035-07-12',
    });
    if (!first.ok) throw new Error(`First attempt failed: ${first.error.code}`);
    await admin.$executeRaw`
      INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${first.value.id}::uuid, 'CHARGE'::"PaymentKind",
        'stripe', ${`pi_${randomUUID()}`}, 'PAID', 200, 'EUR')`;

    const second = await bookOnline({
      sessionId,
      email,
      startsOn: '2035-07-10',
      endsOn: '2035-07-12',
    });
    expect(second).toMatchObject({ ok: false });
    expect(await statusOf(first.value.id)).toBe('PAYMENT_PENDING');
  });
});
