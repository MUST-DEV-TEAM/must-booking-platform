import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockPaymentReconciliationService } from '../src/integrations/clock/clock-payment-reconciliation.service';
import { ClockHttpClient, type ClockResponse } from '../src/integrations/clock/clock-http-client';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('Clock payment reconciliation (read-only)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let connectionId: string;
  let pmsPlanId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-payment-reconciliation-${randomUUID()}@example.test`;
  let queuedResponses: ClockResponse[] = [];
  const httpClientStub: Pick<ClockHttpClient, 'request'> = {
    request: async <T = unknown>() => {
      const next = queuedResponses.shift();
      if (!next) throw new Error('No stubbed Clock response queued.');
      return next as ClockResponse<T>;
    },
  };
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
      .overrideProvider(ClockHttpClient)
      .useValue(httpClientStub)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Payment Reconciliation Hotel',
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
      VALUES (${pmsPlanId}::uuid, ${'Payment Reconciliation Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const connection = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Payment Reconciliation Test Clock',
        credentials: { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' },
      })
      .expect(201);
    connectionId = connection.body.id;
    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/integration-connections/${connectionId}`,
      )
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    roomTypeId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rooms', 2)
    `;
    ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Test Plan', 'EUR')
    `;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  async function insertPaidClockBooking(
    externalBookingId: string,
    externalReference: string,
    chargedAmount: string,
  ): Promise<string> {
    const bookingId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, external_reference, external_booking_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, guest_count
      ) VALUES (
        ${bookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
        ${externalReference}, ${externalBookingId},
        'CONFIRMED', 'STRIPE_CHECKOUT', '2026-09-30', '2026-10-01', ${ratePlanId}::uuid, ${chargedAmount}::decimal, 2
      )
    `;
    await admin.$executeRaw`
      INSERT INTO payments (
        tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency
      ) VALUES (
        ${tenantId}::uuid, ${propertyId}::uuid, ${bookingId}::uuid,
        'CHARGE'::"PaymentKind", 'stripe', ${'pi-' + bookingId}, 'succeeded', ${chargedAmount}::decimal, 'EUR'
      )
    `;
    return bookingId;
  }

  async function manualReviewItemsFor(bookingId: string) {
    return admin.$queryRaw<Array<{ category: string; message: string }>>`
      SELECT category, message FROM manual_review_items
      WHERE tenant_id = ${tenantId}::uuid AND reference_type = 'booking' AND reference_id = ${bookingId}
    `;
  }

  // check() scans every paid, Clock-attached booking on the property — each
  // test's booking must be gone before the next runs, or a later test's
  // check() would also re-process an earlier test's booking against a stub
  // queue that only has responses for the one booking it's testing.
  async function deleteBooking(bookingId: string): Promise<void> {
    await admin.$executeRaw`DELETE FROM manual_review_items WHERE tenant_id = ${tenantId}::uuid AND reference_id = ${bookingId}`;
    await admin.$executeRaw`DELETE FROM payments WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${bookingId}::uuid`;
    await admin.$executeRaw`DELETE FROM bookings WHERE tenant_id = ${tenantId}::uuid AND id = ${bookingId}::uuid`;
  }

  it('records no mismatch when the deposit folio credit_item matches what MUST actually charged', async () => {
    const bookingId = await insertPaidClockBooking('90000001', 'must-recon-match', '250.00');
    queuedResponses = [
      { status: 200, body: [55000001] },
      { status: 200, body: { id: 55000001, deposit: true } },
      {
        status: 200,
        body: [{ id: 1, reference: 'must-recon-match', value_cents: 25000, currency: 'EUR' }],
      },
    ];
    const service = app!.get(ClockPaymentReconciliationService);

    const result = await service.check(tenantId, propertyId, new Date('2026-01-01T00:00:00Z'));
    expect(result.bookingsChecked).toBe(1);
    expect(result.findings).toEqual([]);
    expect(await manualReviewItemsFor(bookingId)).toEqual([]);
    await deleteBooking(bookingId);
  });

  it('records a real, real-time PAYMENT_BOOKING_MISMATCH alert when the posted amount does not match what MUST charged', async () => {
    const bookingId = await insertPaidClockBooking('90000002', 'must-recon-mismatch', '250.00');
    queuedResponses = [
      { status: 200, body: [55000002] },
      { status: 200, body: { id: 55000002, deposit: true } },
      {
        status: 200,
        // Real gotcha this booking exercises: Clock only ever has €100.00
        // posted against a booking MUST actually charged €250.00 for.
        body: [{ id: 2, reference: 'must-recon-mismatch', value_cents: 10000, currency: 'EUR' }],
      },
    ];
    const service = app!.get(ClockPaymentReconciliationService);

    const result = await service.check(tenantId, propertyId, new Date('2026-01-01T00:00:00Z'));
    expect(result.findings).toEqual([
      {
        type: 'CREDIT_ITEM_AMOUNT_MISMATCH',
        bookingId,
        expectedAmount: '250.00',
        expectedCurrency: 'EUR',
        postedAmount: '100.00',
        postedCurrency: 'EUR',
      },
    ]);
    const items = await manualReviewItemsFor(bookingId);
    expect(items).toHaveLength(1);
    expect(items[0]!.category).toBe('PAYMENT_BOOKING_MISMATCH');
    await deleteBooking(bookingId);
  });

  it('records a mismatch when a paid, Clock-attached booking has no deposit folio at all', async () => {
    const bookingId = await insertPaidClockBooking('90000003', 'must-recon-no-folio', '180.00');
    queuedResponses = [{ status: 200, body: [] }];
    const service = app!.get(ClockPaymentReconciliationService);

    const result = await service.check(tenantId, propertyId, new Date('2026-01-01T00:00:00Z'));
    expect(result.findings).toEqual([{ type: 'DEPOSIT_FOLIO_MISSING', bookingId }]);
    expect(await manualReviewItemsFor(bookingId)).toHaveLength(1);
    await deleteBooking(bookingId);
  });
});
