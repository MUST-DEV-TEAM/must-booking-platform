import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { ClockFinancialService } from '../src/integrations/clock/clock-financial.service';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
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

/** G-48: on a hotel connected to Clock, recording the transfer creates the real Clock reservation and the deposit. */
describe('bank transfer on a Clock hotel', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let userId: string;
  let verificationToken = '';
  let clockConnected = false;
  const attached: string[] = [];
  const deposits: Array<{
    bookingId: string;
    amount: { amount: string; currency: string };
    subType: string;
    reference: string;
    type: string | undefined;
  }> = [];
  const email = `bank-clock-${randomUUID()}@example.test`;
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
      .overrideProvider(IntegrationConnectionsService)
      .useValue({
        activePmsConnectionCredentials: async () =>
          clockConnected ? { provider: 'CLOCK_PMS' } : null,
      })
      .overrideProvider(ClockFinancialService)
      .useValue({ refresh: async () => null })
      .overrideProvider(ClockBookingService)
      .useValue({
        async attachRealReservation(
          tx: PrismaClient,
          context: { tenantId: string; propertyId: string },
          bookingId: string,
        ) {
          attached.push(bookingId);
          await tx.$executeRaw`UPDATE bookings SET external_booking_id = ${`clock-${bookingId}`}, status = 'CONFIRMED'::"BookingStatus"
            WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid AND property_id = ${context.propertyId}::uuid`;
          return { ok: true as const, value: { id: bookingId, status: 'CONFIRMED' } };
        },
        async postDeposit(
          _tx: unknown,
          _context: unknown,
          bookingId: string,
          amount: { amount: string; currency: string },
          subType: string,
          reference: string,
          type?: string,
        ) {
          deposits.push({ bookingId, amount, subType, reference, type });
          return { ok: true as const, value: undefined };
        },
      })
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

  it('creates the Clock reservation and posts the deposit only when staff record the transfer, with the bank reference', async () => {
    const server = app!.getHttpServer();
    const signup = await request(server)
      .post('/auth/signup')
      .send({
        organizationName: 'Bank Clock E2E Group',
        propertyName: 'Bank Clock E2E Hotel',
        propertyAddress: '1 Clock Way',
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
      .patch(propertyUrl)
      .set('Cookie', ownerCookie)
      .send({
        bankTransferEnabled: true,
        bankAccountHolder: 'Bank Clock E2E Hotel Sh.p.k.',
        bankIban: 'AL35 2021 1109 0000 0000 0123 4567',
        bankTransferDays: 2,
      })
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
          email: 'clock.guest@example.test',
          firstName: 'Clock',
          lastName: 'Guest',
          phone: '+355690000000',
        },
        total: quote.body.total,
        quoteToken: quote.body.quoteToken,
        paymentMethod: 'bank_transfer',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const booking = created.body.value;
    expect(booking.status).toBe('PAYMENT_PENDING');

    // Nothing reaches Clock while the guest has not paid.
    clockConnected = true;
    expect(attached).toEqual([]);
    const pay = (evidence: Record<string, unknown> | undefined) =>
      request(server)
        .post(`${propertyUrl}/bookings/${booking.id}/manual-payment`)
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', randomUUID())
        .send({
          amount: booking.bankTransfer.amount,
          method: 'bank_transfer',
          ...(evidence ? { evidence } : {}),
        });

    // The bank reference is required: without it the transfer is not recorded and Clock is not touched.
    const withoutReference = await pay(undefined);
    // The record endpoint answers 200 with the refusal in the body.
    expect(withoutReference.body.ok).toBe(false);
    expect(JSON.stringify(withoutReference.body)).toContain('bank transaction reference');
    expect(attached).toEqual([]);
    expect(deposits).toEqual([]);

    const recorded = await pay({
      receivedOn: isoDateFromToday(0),
      reference: 'TRX-7788',
      payerName: 'Ana Guest',
    });
    expect(recorded.body.ok, JSON.stringify(recorded.body)).toBe(true);

    // Now the real Clock reservation exists, and the deposit is posted with the bank's reference.
    expect(attached).toEqual([booking.id]);
    expect(deposits).toEqual([
      {
        bookingId: booking.id,
        amount: { amount: '190.00', currency: 'EUR' },
        subType: 'Bank transfer',
        reference: 'TRX-7788',
        type: 'bank',
      },
    ]);
    const stored = await admin.$queryRaw<
      Array<{ status: string; external: string | null; payment: string }>
    >`SELECT b.status::text, b.external_booking_id AS external, p.external_payment_id AS payment
      FROM bookings b JOIN payments p ON p.booking_id = b.id WHERE b.id = ${booking.id}::uuid`;
    expect(stored).toEqual([
      {
        status: 'CONFIRMED',
        external: `clock-${booking.id}`,
        payment: `manual:bank_transfer:${booking.id}:TRX-7788`,
      },
    ]);
  });
});
