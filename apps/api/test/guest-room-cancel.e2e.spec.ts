import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { MultiRoomBookingService } from '../src/booking/multi-room-booking.service';
import { QuoteService } from '../src/booking/quote.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { StripeWebhookService } from '../src/payments/stripe-webhook.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

/** A guest cancels one room of a paid two-room order: only that room goes and only its share is refunded. */
describe('guest cancels one room of an order', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  const refunds: Array<{ paymentId: string; amount: { amount: string; currency: string } }> = [];
  const email = `guest-room-cancel-${randomUUID()}@example.test`;
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
  const payments = {
    async createCheckoutSession(_context: unknown, command: { bookingId: string }) {
      return {
        ok: true as const,
        value: {
          id: `cs_test_${command.bookingId}`,
          url: `https://checkout.test/${command.bookingId}`,
        },
      };
    },
    async verifyWebhookEvent() {
      return { ok: false as const, error: { code: 'NOT_USED', message: '', retryable: false } };
    },
    async refund(
      _context: unknown,
      command: { paymentId: string; amount: { amount: string; currency: string } },
    ) {
      refunds.push(command);
      return {
        ok: true as const,
        value: {
          id: `refund-${refunds.length}`,
          bookingId: command.paymentId,
          amount: command.amount,
          status: 'REFUNDED',
        },
      };
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(payments)
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

  it('cancels only the chosen room, frees only its rooms and refunds only its share', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Room Cancel Group',
        propertyName: 'Room Cancel Hotel',
        propertyAddress: '1 Cancel Way',
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
    await request(server)
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: false, payAtHotel: true })
      .expect(200);
    const types = [] as Array<{ body: { id: string } }>;
    for (const name of ['Garden Suite', 'Sea Suite']) {
      types.push(
        await request(server)
          .post(`${propertyUrl}/room-types`)
          .set('Cookie', cookie)
          .send({ name, maxOccupancy: 2 })
          .expect(201),
      );
    }
    const ratePlan = await request(server)
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const startsOn = day(60);
    const endsOn = day(62);
    for (const [index, amount] of ['95.00', '120.00'].entries()) {
      await request(server)
        .put(`${propertyUrl}/inventory-units`)
        .set('Idempotency-Key', crypto.randomUUID())
        .set('Cookie', cookie)
        .send({ roomTypeId: types[index]!.body.id, startsOn, endsOn, availableUnits: 1 })
        .expect(204);
      await request(server)
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Idempotency-Key', crypto.randomUUID())
        .set('Cookie', cookie)
        .send({ roomTypeId: types[index]!.body.id, startsOn: null, endsOn: null, amount })
        .expect(201);
    }

    const sessionId = randomUUID();
    const quotes = app!.get(QuoteService);
    const quoted = await Promise.all(
      types.map((type) =>
        quotes.create(tenantId, propertyId, sessionId, {
          roomTypeId: type.body.id,
          ratePlanId: ratePlan.body.id,
          startsOn,
          endsOn,
        }),
      ),
    );
    const order = await app!.get(MultiRoomBookingService).create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        externalReference: `must-order-${randomUUID()}`,
        startsOn,
        endsOn,
        quoteSessionId: sessionId,
        paymentMethod: 'stripe',
        guest: {
          email: 'guest@example.test',
          firstName: 'Room',
          lastName: 'Canceller',
          phone: null,
        },
        rooms: types.map((type, index) => ({
          roomTypeId: type.body.id,
          ratePlanId: ratePlan.body.id,
          total: quoted[index]!.total,
          quoteToken: quoted[index]!.quoteToken,
        })),
      },
    );
    expect(order.ok, JSON.stringify(order)).toBe(true);
    if (!order.ok) return;
    const [first, second] = order.value.bookings;
    await app!.get(StripeWebhookService).processPaymentSucceeded({
      id: randomUUID(),
      type: 'checkout.session.completed',
      externalPaymentId: `cs_test_${first!.id}`,
      tenantId,
      propertyId,
      bookingId: first!.id,
    });
    const before = await admin.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM bookings WHERE id = ${second!.id}::uuid AND tenant_id = ${tenantId}::uuid`;

    // The guest cancels room 2 only.
    const cancelled = await app!.get(LocalPmsProvider).cancelBooking(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        bookingId: second!.id,
        guestSessionId: sessionId,
        expectedVersion: before[0]!.version,
        reason: 'One room is no longer needed.',
        singleBooking: true,
      },
    );
    expect(cancelled).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    const rows = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${order.value.orderReference}
      ORDER BY order_room_number`;
    expect(rows).toEqual([{ status: 'CONFIRMED' }, { status: 'CANCELLED' }]);
    // Only the second room's price comes back, from the order's one payment.
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      paymentId: `cs_test_${first!.id}`,
      amount: { amount: '240.00', currency: 'EUR' },
    });
    const sea = await admin.$queryRaw<Array<{ booked: number }>>`
      SELECT COALESCE(SUM(booked_units), 0)::int AS booked FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND room_type_id = ${types[1]!.body.id}::uuid`;
    expect(sea[0]!.booked).toBe(0);
    const garden = await admin.$queryRaw<Array<{ booked: number }>>`
      SELECT COALESCE(SUM(booked_units), 0)::int AS booked FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND room_type_id = ${types[0]!.body.id}::uuid`;
    expect(garden[0]!.booked).toBeGreaterThan(0);
  });
});
