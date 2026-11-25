import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { QuoteService } from '../src/booking/quote.service';
import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { ManualPaymentService } from '../src/payments/manual-payment.service';
import { ClockHttpClient } from '../src/integrations/clock/clock-http-client';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { STAY_STARTS_ON, STAY_ENDS_ON } from './helpers/future-stay';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { paceClockRequests } from './helpers/clock-pacing';

const sandboxCredentials = () => {
  const url = new URL(process.env.CLOCK_SANDBOX_PMS_API_URL!);
  const [, , accountId, subscriptionId] = url.pathname.split('/');
  return {
    host: url.host,
    accountId: accountId!,
    subscriptionId: subscriptionId!,
    apiUser: process.env.CLOCK_SANDBOX_API_USER!,
    apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
  };
};

// G-48 against the REAL Clock sandbox: a guest who chose bank transfer has no Clock reservation until staff
// record the transfer; recording it (with the bank's reference) creates the real reservation and posts the
// deposit carrying that reference. Cleans up by cancelling the reservation for real.
const hasSandboxCredentials =
  !!process.env.CLOCK_SANDBOX_API_USER &&
  !!process.env.CLOCK_SANDBOX_API_KEY &&
  !!process.env.CLOCK_SANDBOX_PMS_API_URL;

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe.skipIf(!hasSandboxCredentials)('Clock bank transfer (G-48, real sandbox)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let pmsPlanId: string;
  let cookie: string;
  let verificationToken = '';
  let ratePlanId: string;
  let localRoomTypeId: string;
  const email = `clock-bank-transfer-${randomUUID()}@example.test`;
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

  beforeAll(async () => {
    paceClockRequests();
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
        organizationName: 'Clock Bank Transfer Hotel',
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

    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'Clock Bank Transfer Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const url = new URL(process.env.CLOCK_SANDBOX_PMS_API_URL!);
    const [, , accountId, subscriptionId] = url.pathname.split('/');
    const tenantUrl = `/tenants/${tenantId}`;

    const connection = await request(app.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Bank Transfer Clock',
        credentials: {
          host: url.host,
          accountId,
          subscriptionId,
          apiUser: process.env.CLOCK_SANDBOX_API_USER!,
          apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${connection.body.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    await request(app.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/clock-catalog/sync`)
      .set('Cookie', cookie)
      .expect(201);
    const mappings = await request(app.getHttpServer())
      .get(`${tenantUrl}/properties/${propertyId}/clock-catalog/mappings`)
      .set('Cookie', cookie)
      .expect(200);
    const dblMapping = mappings.body.find(
      (m: { entityType: string; externalName: string }) =>
        m.entityType === 'ROOM_TYPE' && m.externalName === 'DBL',
    );
    expect(dblMapping).toBeDefined();
    await request(app.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/clock-catalog/mappings/${dblMapping.id}/confirm`)
      .set('Cookie', cookie)
      .expect(201);
    const localRoomType = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_types WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid LIMIT 1
    `;
    localRoomTypeId = localRoomType[0]!.id;

    ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency, is_active)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rate', 'EUR', true)
    `;
    await request(app.getHttpServer())
      .patch(propertyUrl())
      .set('Cookie', cookie)
      .send({
        bankTransferEnabled: true,
        bankAccountHolder: 'Clock Bank Transfer Hotel Sh.p.k.',
        bankIban: 'AL35 2021 1109 0000 0000 0123 4567',
        bankTransferDays: 3,
      })
      .expect(200);
  });

  const propertyUrl = () => `/tenants/${tenantId}/properties/${propertyId}`;

  afterAll(async () => {
    // Cleanup real sandbox reservations even when an assertion fails mid-test.
    if (app && tenantId && propertyId) {
      const remaining = await admin.$queryRaw<{ externalBookingId: string }[]>`
        SELECT external_booking_id AS "externalBookingId" FROM bookings
        WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
          AND external_booking_id IS NOT NULL AND status<>'CANCELLED'`;
      for (const row of remaining) {
        const result = await app
          .get(ClockBookingService)
          .cancelRealReservation({ tenantId, propertyId }, row.externalBookingId);
        expect(result.ok).toBe(true);
      }
    }
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('books nothing in Clock until staff record the transfer; then creates the real reservation and posts the deposit with the bank reference', async () => {
    const total = await app!.get(QuoteService).price(tenantId, propertyId, {
      roomTypeId: localRoomTypeId,
      startsOn: STAY_STARTS_ON,
      endsOn: STAY_ENDS_ON,
      adults: 1,
      children: 0,
    });
    const [whole, fraction = ''] = total.amount.split('.');
    const totalCents = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
    const guestId = randomUUID();
    const bookingId = randomUUID();
    const externalReference = `must-bank-transfer-${bookingId}`;
    const bankReference = `TRX-${randomUUID().slice(0, 8).toUpperCase()}`;
    await admin.$executeRaw`
      INSERT INTO guests (id, tenant_id, email, first_name, last_name)
      VALUES (${guestId}::uuid, ${tenantId}::uuid, ${`bank-transfer-${guestId}@example.test`}, 'BankTransfer', 'Guest')
    `;
    // The row a guest's bank-transfer booking leaves behind: waiting for payment, no Clock reservation yet.
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, guest_id, external_reference,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, payment_due_at
      ) VALUES (
        ${bookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${localRoomTypeId}::uuid,
        ${guestId}::uuid, ${externalReference}, 'PAYMENT_PENDING'::"BookingStatus",
        'BANK_TRANSFER'::"BookingPaymentMethod", ${STAY_STARTS_ON}::date, ${STAY_ENDS_ON}::date,
        ${ratePlanId}::uuid, ${total.amount}::numeric, now() + interval '3 days'
      )
    `;
    const before = await admin.$queryRaw<Array<{ externalBookingId: string | null }>>`
      SELECT external_booking_id AS "externalBookingId" FROM bookings WHERE id = ${bookingId}::uuid`;
    expect(before[0]!.externalBookingId).toBeNull();

    // Staff record the transfer the way the dashboard does.
    const context = { tenantId, propertyId };
    const recorded = await app!.get(ManualPaymentService).record(context, {
      bookingId,
      idempotencyKey: `bank-transfer-${randomUUID()}`,
      amount: total,
      method: 'bank_transfer',
      evidence: {
        receivedOn: new Date().toISOString().slice(0, 10),
        reference: bankReference,
        payerName: 'Ana Guest',
      },
      actorUserId: userId,
    });
    expect(recorded.ok, JSON.stringify(recorded)).toBe(true);

    const row = await admin.$queryRaw<Array<{ status: string; externalBookingId: string | null }>>`
      SELECT status, external_booking_id AS "externalBookingId" FROM bookings WHERE id = ${bookingId}::uuid`;
    expect(row[0]?.status).toBe('CONFIRMED');
    expect(row[0]?.externalBookingId).toMatch(/^\d+$/);

    // In Clock: the reservation exists and the deposit nets its balance.
    const credentials = sandboxCredentials();
    const clock = app!.get(ClockHttpClient);
    const externalBookingId = row[0]!.externalBookingId!;
    const clockBooking = await clock.request<{ balance: { cents: number }; status: string }>(
      credentials,
      { api: 'pms_api', method: 'GET', path: `/bookings/${externalBookingId}` },
    );
    expect(clockBooking.status).toBe(200);
    expect((clockBooking.body as { balance: { cents: number } }).balance.cents).toBeLessThanOrEqual(
      0,
    );

    // The deposit carries the bank's reference, the amount and the 'Bank transfer' label.
    const folioIds = await clock.request<number[]>(credentials, {
      api: 'pms_api',
      method: 'GET',
      path: `/bookings/${externalBookingId}/folios/`,
    });
    let credit:
      | {
          reference?: string;
          value_cents?: number;
          currency?: string;
          payment_sub_type?: string;
          payment_type?: string;
        }
      | undefined;
    for (const folioId of folioIds.body) {
      const items = await clock.request<
        Array<{
          reference?: string;
          value_cents?: number;
          currency?: string;
          payment_sub_type?: string;
          payment_type?: string;
        }>
      >(credentials, { api: 'base_api', method: 'GET', path: `/folios/${folioId}/credit_items` });
      credit = items.body.find((item) => item.reference === bankReference);
      if (credit) break;
    }
    expect(credit).toBeDefined();
    expect(credit?.value_cents).toBe(totalCents);
    expect(credit?.currency).toBe('EUR');
    expect(credit?.payment_sub_type).toBe('Bank transfer');

    const ledger = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT external_payment_id AS id FROM payments WHERE booking_id = ${bookingId}::uuid`;
    expect(ledger).toEqual([{ id: `manual:bank_transfer:${bookingId}:${bankReference}` }]);

    // Clean up: cancel the real reservation through MUST and confirm Clock agrees.
    await admin.$executeRaw`UPDATE properties SET free_cancellation_days_before_arrival = 0 WHERE id = ${propertyId}::uuid`;
    const cancelled = await app!.get(LocalPmsProvider).cancelBooking(context, {
      idempotencyKey: `bank-transfer-cancel-${randomUUID()}`,
      bookingId,
      guestSessionId: null as unknown as string,
      staffActorId: userId,
      expectedVersion: 1,
      reason: 'Bank transfer e2e cleanup.',
    });
    expect(cancelled.ok).toBe(true);
    const clockCancelled = await clock.request<{ status: string }>(credentials, {
      api: 'pms_api',
      method: 'GET',
      path: `/bookings/${externalBookingId}`,
    });
    expect((clockCancelled.body as { status: string }).status).toBe('canceled');
  }, 180_000);
});
