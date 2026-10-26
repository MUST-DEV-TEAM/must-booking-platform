import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import Stripe from 'stripe';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LocalPmsProvider, PMS_PROVIDER } from '../src/booking/local-pms.provider';
import { QuoteService } from '../src/booking/quote.service';
import { MAIL_QUEUE_NAME } from '../src/mail/mail-delivery.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { PaymentExpiryService } from '../src/payments/payment-expiry.service';
import { PokPayPaymentProvider } from '../src/payments/pokpay-payment.provider';
import { PaymentProviderRegistry } from '../src/payments/payment-provider-registry';
import { StripePaymentProvider } from '../src/payments/stripe-payment.provider';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import type { PaymentProvider } from '@must/domain-contracts';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { PublicRateLimiterService } from '../src/tenancy/public-rate-limiter.service';

// Real BullMQ behavior under a unique test namespace: no live dev worker can consume these jobs.
const { testQueuePrefix } = vi.hoisted(() => ({
  testQueuePrefix: `test-local-pms-${Date.now()}-${Math.random().toString(36).slice(2)}`,
}));
vi.mock('bullmq', async (importOriginal) => {
  const original = await importOriginal<typeof import('bullmq')>();
  return {
    ...original,
    Queue: class extends original.Queue {
      constructor(name: string, options?: ConstructorParameters<typeof original.Queue>[1]) {
        super(name, { ...options, connection: options?.connection ?? {}, prefix: testQueuePrefix });
      }
    },
    Worker: class extends original.Worker {
      constructor(
        name: string,
        processor: ConstructorParameters<typeof original.Worker>[1],
        options: ConstructorParameters<typeof original.Worker>[2],
      ) {
        super(name, processor, {
          ...options,
          connection: options?.connection ?? {},
          prefix: testQueuePrefix,
        });
      }
    },
  };
});

const isoDateFromToday = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

const stripeSecretKey = 'sk_test_webhook_e2e';
const stripeWebhookSecret = 'whsec_webhook_e2e';

let mailRedis: IORedis | undefined;
let mailQueue: Queue | undefined;

/** Booking emails go through the durable mail queue, so wait until it has
 * delivered (or given up on) everything before asserting on the mailbox. */
async function settleMail(): Promise<void> {
  mailRedis ??= new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
  mailQueue ??= new Queue(MAIL_QUEUE_NAME, { connection: mailRedis });
  const queue = mailQueue;
  await vi.waitFor(
    async () => {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    },
    { timeout: 30_000, interval: 50 },
  );
}

describe('LocalPmsProvider', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let notificationStaffUserId: string;
  let propertyStaffUserId: string;
  let crossPropertyStaffUserId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let cookie: string;
  let verificationToken = '';
  let failPaymentConfirmationDelivery = false;
  const paymentConfirmationEmails: Parameters<MailProvider['sendPaymentConfirmationEmail']>[0][] =
    [];
  const staffBookingEmails: Parameters<MailProvider['sendNewBookingStaffNotification']>[0][] = [];
  const refundConfirmationEmails: Parameters<MailProvider['sendRefundConfirmationEmail']>[0][] = [];
  const cancelledGuestEmails: Parameters<MailProvider['sendBookingCancelledEmail']>[0][] = [];
  const cancelledStaffEmails: Parameters<
    MailProvider['sendBookingCancelledStaffNotification']
  >[0][] = [];
  const refundCommands: Parameters<PaymentProvider['refund']>[1][] = [];
  const pokpayOrders = new Map<string, { amount: string; currency: string; status: string }>();
  let pokpayAmountOverride: string | undefined;
  let pokpayInitialStatus = 'COMPLETED';
  let failAutomaticRefund = false;
  // Only used below for verifyWebhookEvent's signature parsing, which stays
  // environment-based (not tenant-owned) — the injected service is never
  // called in that path, so a stub is sufficient here.
  const stripe = new StripePaymentProvider({} as never);
  const email = `local-pms-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail(command) {
      if (failPaymentConfirmationDelivery) throw new Error('simulated payment email failure');
      paymentConfirmationEmails.push(command);
    },
    async sendNewBookingStaffNotification(command) {
      staffBookingEmails.push(command);
    },
    async sendRefundConfirmationEmail(command) {
      refundConfirmationEmails.push(command);
    },
    async sendBookingCancelledEmail(command) {
      cancelledGuestEmails.push(command);
    },
    async sendBookingCancelledStaffNotification(command) {
      cancelledStaffEmails.push(command);
    },
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
    async verifyWebhookEvent(context, rawBody, signature) {
      return stripe.verifyWebhookEvent(context, rawBody, signature);
    },
    async refund(_context, command) {
      refundCommands.push(command);
      if (failAutomaticRefund)
        return {
          ok: false as const,
          error: {
            code: 'REFUND_GATEWAY_UNAVAILABLE',
            message: 'Forced refund gateway failure.',
            retryable: true,
          },
        };
      return {
        ok: true,
        value: {
          id: `re_test_${command.idempotencyKey}`,
          bookingId: command.paymentId,
          amount: command.amount,
          status: 'succeeded',
        },
      };
    },
    async getPayment() {
      return null;
    },
  };
  const pokpay: PaymentProvider = {
    async createCheckoutSession(_context, command) {
      const id = `pok_test_${command.bookingId}`;
      pokpayOrders.set(id, {
        amount: command.amount.amount,
        currency: command.amount.currency,
        status: pokpayInitialStatus,
      });
      return { ok: true, value: { id, url: `https://pay.pokpay.test/${id}` } };
    },
    async verifyWebhookEvent() {
      return {
        ok: false,
        error: {
          code: 'NOT_USED',
          message: 'PokPay uses an authoritative re-read.',
          retryable: false,
        },
      };
    },
    async refund(_context, command) {
      return {
        ok: true,
        value: {
          id: `${command.paymentId}:refund`,
          bookingId: command.paymentId,
          amount: command.amount,
          status: 'REFUNDED',
        },
      };
    },
    async getPayment(_context, paymentId) {
      const order = pokpayOrders.get(paymentId);
      return order
        ? {
            id: paymentId,
            bookingId: paymentId,
            amount: { amount: pokpayAmountOverride ?? order.amount, currency: order.currency },
            status: order.status,
          }
        : null;
    },
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    process.env.STRIPE_SECRET_KEY = stripeSecretKey;
    process.env.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(payments)
      .overrideProvider(PokPayPaymentProvider)
      .useValue(pokpay)
      .overrideProvider(PublicRateLimiterService)
      .useValue({ consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) });
    const moduleRef = await withoutExternalWorkers(moduleBuilder, { keepExpiry: true }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    // Keep explicit expiry behavior tests, but no automatic sweep of the shared dev database.
    app.get(PaymentExpiryService).onModuleInit = async () => {};
    const fixtureDb = app.get(TenantDatabaseService),
      raw = fixtureDb.$queryRaw;
    fixtureDb.$queryRaw = async function (this: TenantDatabaseService, query, ...values) {
      const result = await raw.call(this, query, ...values);
      const sql = Array.isArray(query) ? query.join('') : '';
      return /payment_pending_(expiry|pokpay)_candidates/.test(sql) && Array.isArray(result)
        ? result.filter((candidate: { tenantId: string }) => candidate.tenantId === tenantId)
        : result;
    } as typeof fixtureDb.$queryRaw;
    await app.init();
    app.get(PaymentProviderRegistry).pokpay = pokpay as PokPayPaymentProvider;
  });

  afterAll(async () => {
    // Only the queue created in this unique test namespace is removed.
    await mailQueue?.obliterate({ force: true });
    await mailQueue?.close();
    mailRedis?.disconnect();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (notificationStaffUserId)
      await admin.$executeRaw`DELETE FROM users WHERE id = ${notificationStaffUserId}::uuid`;
    if (propertyStaffUserId)
      await admin.$executeRaw`DELETE FROM users WHERE id = ${propertyStaffUserId}::uuid`;
    if (crossPropertyStaffUserId)
      await admin.$executeRaw`DELETE FROM users WHERE id = ${crossPropertyStaffUserId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('creates a checkout session and leaves paid bookings payment-pending', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Local PMS Hotel Group',
        propertyName: 'Local PMS Property',
        propertyAddress: '1 Provider Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await app!.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
    for (let attempt = 0; attempt < 100 && !verificationToken; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    await request(app!.getHttpServer())
      .get(`${propertyUrl}/role-templates`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Front Desk',
              kind: 'BUILT_IN',
              capabilities: expect.arrayContaining([
                'bookings.view',
                'calendar.view',
                'guests.view',
              ]),
            }),
            expect.objectContaining({
              name: 'Property Manager',
              kind: 'BUILT_IN',
              capabilities: expect.arrayContaining([
                'accommodations.manage',
                'bookings.view',
                'calendar.view',
                'guests.view',
                'payments.refund',
                'photos.manage',
                'rates.manage',
                'reports.view',
                'settings.manage',
                'staff.create',
                'staff.manage_permissions',
              ]),
            }),
          ]),
        );
      });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/role-templates`)
      .set('Cookie', cookie)
      .send({ name: 'Invalid template', capabilities: ['does.not.exist'] })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('Unknown permission(s): does.not.exist.');
      });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/role-templates`)
      .set('Cookie', cookie)
      .send({ name: 'Night Auditor', capabilities: ['bookings.view', 'guests.view'] })
      .expect(201);
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/role-templates`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: 'Night Auditor',
              kind: 'CUSTOM',
              capabilities: expect.arrayContaining(['bookings.view', 'guests.view']),
            }),
          ]),
        );
      });

    const roomType = await request(app!.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Provider Suite', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;
    const assignableRoom = await request(app!.getHttpServer())
      .post(`${propertyUrl}/room-types/${roomTypeId}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Provider Room 101' })
      .expect(201);
    const ratePlan = await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', globalThis.crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Provider Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    ratePlanId = ratePlan.body.id;
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2027-09-01', endsOn: '2027-09-03', availableUnits: 1 })
      .expect(204);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlanId}/rules`)
      .set('Idempotency-Key', globalThis.crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '90.00' })
      .expect(201);
    const reportGuestId = randomUUID();
    const reportBookingOneId = randomUUID();
    const reportBookingTwoId = randomUUID();
    const reportCancelledBookingId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO guests (id, tenant_id, email)
      VALUES (${reportGuestId}::uuid, ${tenantId}::uuid, 'reports@example.test')
    `;
    await admin.$executeRaw`
      INSERT INTO inventory_units (tenant_id, property_id, room_type_id, stays_on, available_units)
      VALUES
        (${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, '2040-01-01'::date, 2),
        (${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, '2040-01-02'::date, 4),
        (${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, '2040-01-03'::date, 2)
    `;
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, guest_id, external_reference, guest_session_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, created_at
      ) VALUES
        (
          ${reportBookingOneId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${reportGuestId}::uuid, 'report-one', NULL, 'CONFIRMED'::"BookingStatus",
          'PAY_AT_HOTEL'::"BookingPaymentMethod", '2040-01-01'::date, '2040-01-03'::date,
          ${ratePlanId}::uuid, 100.00, '2040-01-01T12:00:00Z'::timestamptz
        ), (
          ${reportBookingTwoId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${reportGuestId}::uuid, 'report-two', NULL, 'CONFIRMED'::"BookingStatus",
          'PAY_AT_HOTEL'::"BookingPaymentMethod", '2040-01-02'::date, '2040-01-04'::date,
          ${ratePlanId}::uuid, 50.00, '2040-01-02T12:00:00Z'::timestamptz
        ), (
          ${reportCancelledBookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${reportGuestId}::uuid, 'report-cancelled', NULL, 'CANCELLED'::"BookingStatus",
          'PAY_AT_HOTEL'::"BookingPaymentMethod", '2040-01-03'::date, '2040-01-04'::date,
          ${ratePlanId}::uuid, 50.00, '2040-01-03T12:00:00Z'::timestamptz
        )
    `;
    await admin.$executeRaw`
      INSERT INTO payments (
        tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency, created_at
      ) VALUES
        (${tenantId}::uuid, ${propertyId}::uuid, ${reportBookingOneId}::uuid,
          'CHARGE'::"PaymentKind", 'manual', 'report-charge-one', 'succeeded', 100.00, 'EUR', '2040-01-01T13:00:00Z'::timestamptz),
        (${tenantId}::uuid, ${propertyId}::uuid, ${reportBookingTwoId}::uuid,
          'CHARGE'::"PaymentKind", 'manual', 'report-charge-two', 'succeeded', 50.00, 'EUR', '2040-01-02T13:00:00Z'::timestamptz),
        (${tenantId}::uuid, ${propertyId}::uuid, ${reportBookingOneId}::uuid,
          'REFUND'::"PaymentKind", 'manual', 'report-refund', 'succeeded', 25.00, 'EUR', '2040-01-03T13:00:00Z'::timestamptz)
    `;
    const reports = await request(app!.getHttpServer())
      .get(`${propertyUrl}/reports?from=2040-01-01&to=2040-01-03`)
      .set('Cookie', cookie)
      .expect(200);
    expect(reports.body).toMatchObject({
      from: '2040-01-01',
      to: '2040-01-03',
      occupancy: [
        { date: '2040-01-01', bookedRoomNights: 1, availableRoomNights: 2, rate: 50 },
        { date: '2040-01-02', bookedRoomNights: 2, availableRoomNights: 4, rate: 50 },
        { date: '2040-01-03', bookedRoomNights: 1, availableRoomNights: 2, rate: 50 },
      ],
      bookingsCreated: [
        { date: '2040-01-01', count: 1 },
        { date: '2040-01-02', count: 1 },
        { date: '2040-01-03', count: 1 },
      ],
      revenue: [
        { date: '2040-01-01', currency: 'EUR', amount: '100.00' },
        { date: '2040-01-02', currency: 'EUR', amount: '50.00' },
        { date: '2040-01-03', currency: 'EUR', amount: '-25.00' },
      ],
      cancellationRate: { createdBookings: 3, cancelledBookings: 1 },
    });
    expect(reports.body.cancellationRate.rate).toBeCloseTo(100 / 3);

    const overviewToday = isoDateFromToday(0);
    const overviewYesterday = isoDateFromToday(-1);
    const overviewTomorrow = isoDateFromToday(1);
    const overviewArrivalId = randomUUID();
    const overviewDepartureId = randomUUID();
    const overviewInHouseId = randomUUID();
    const overviewAttentionId = randomUUID();
    await admin.$executeRaw`
      UPDATE properties SET timezone = 'UTC'
      WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    await admin.$executeRaw`
      INSERT INTO inventory_units (tenant_id, property_id, room_type_id, stays_on, available_units)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${overviewToday}::date, 3)
      ON CONFLICT (tenant_id, property_id, room_type_id, stays_on)
      DO UPDATE SET available_units = EXCLUDED.available_units
    `;
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, guest_id, external_reference, guest_session_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES
        (${overviewArrivalId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${reportGuestId}::uuid, ${`overview-arrival-${overviewArrivalId}`}, NULL,
          'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
          ${overviewToday}::date, ${overviewTomorrow}::date, ${ratePlanId}::uuid, 90.00),
        (${overviewDepartureId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${reportGuestId}::uuid, ${`overview-departure-${overviewDepartureId}`}, NULL,
          'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
          ${overviewYesterday}::date, ${overviewToday}::date, ${ratePlanId}::uuid, 90.00),
        (${overviewInHouseId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${reportGuestId}::uuid, ${`overview-in-house-${overviewInHouseId}`}, NULL,
          'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
          ${overviewYesterday}::date, ${overviewTomorrow}::date, ${ratePlanId}::uuid, 90.00),
        (${overviewAttentionId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
          ${reportGuestId}::uuid, ${`overview-attention-${overviewAttentionId}`}, NULL,
          'PAYMENT_FAILED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
          ${overviewToday}::date, ${overviewTomorrow}::date, ${ratePlanId}::uuid, 90.00)
    `;
    await admin.$executeRaw`
      INSERT INTO audit_logs (tenant_id, property_id, actor_user_id, actor_type, action, target_type, target_id)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${userId}::uuid, 'TENANT_USER'::"AuditActorType",
        'booking.created', 'booking', ${overviewArrivalId})
    `;
    const overview = await request(app!.getHttpServer())
      .get(`${propertyUrl}/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(overview.body.kpis).toEqual({
      date: overviewToday,
      arrivals: 1,
      departures: 1,
      inHouse: 2,
      bookedRoomNights: 2,
      availableRoomNights: 3,
      occupancyRate: (2 / 3) * 100,
    });
    expect(overview.body.needsAttention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: overviewAttentionId, status: 'PAYMENT_FAILED' }),
      ]),
    );
    expect(overview.body.needsAttention).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: overviewArrivalId })]),
    );
    expect(overview.body.recentActivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'booking.created',
          summary: expect.stringContaining(`${overviewToday} to ${overviewTomorrow}`),
        }),
      ]),
    );

    const provider = app!.get(LocalPmsProvider);
    const quotes = app!.get(QuoteService);
    expect(app!.get<LocalPmsProvider>(PMS_PROVIDER)).toBe(provider);
    const context = { tenantId, propertyId };
    await expect(provider.testConnection(context)).resolves.toEqual({ ok: true, value: undefined });
    const catalog = await provider.syncCatalog(context);
    expect(catalog.nextCursor).toBeNull();
    expect(catalog.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'room_type', id: roomTypeId }),
        expect.objectContaining({ kind: 'rate_plan', id: ratePlanId, currency: 'EUR' }),
      ]),
    );
    await expect(
      provider.getAvailability(context, {
        roomTypeId,
        startsOn: '2027-09-01',
        endsOn: '2027-09-03',
      }),
    ).resolves.toMatchObject({ ok: true, value: { availableUnits: 1, isAvailable: true } });

    await request(app!.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .send({ roomTypeId, ratePlanId, startsOn: '2027-09-01', endsOn: '2027-09-03', guestCount: 0 })
      .expect(400);

    const quote = await request(app!.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2027-09-01',
        endsOn: '2027-09-03',
        adults: 1,
        children: 1,
      })
      .expect(201);
    const guestCookie = quote.headers['set-cookie'][0] as string;
    expect(guestCookie).toContain('must_guest_session=');
    expect(quote.body).toMatchObject({
      roomTypeId,
      ratePlanId,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
      guestCount: 2,
      total: { amount: '180.00', currency: 'EUR' },
      nightlyRates: [
        { date: '2027-09-01', amount: '90.00' },
        { date: '2027-09-02', amount: '90.00' },
      ],
    });
    expect(quote.body.quoteToken).toEqual(expect.any(String));
    expect(new Date(quote.body.expiresAt).valueOf()).toBeGreaterThan(Date.now());
    const quoteSessionId = guestCookie
      .split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === 'must_guest_session')?.[1];
    if (!quoteSessionId) throw new Error('Expected anonymous guest session cookie.');

    const bookingRequest = {
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
      guest: {
        email: 'guest@example.test',
        firstName: 'Guest',
        lastName: 'Example',
        phone: null,
        streetAddress: '1 Guest Street',
        addressLine2: 'Apartment 2',
        city: 'Tirana',
        county: 'Tirana County',
        postcode: '1001',
        specialRequests: 'Late arrival after 22:00.\nPlease prepare a baby cot.',
      },
      total: quote.body.total,
      quoteToken: quote.body.quoteToken,
      adults: 1,
      children: 1,
      guestCount: 2,
      paymentMethod: 'stripe' as const,
    };
    await admin.$executeRaw`
      UPDATE properties SET booking_mode = 'MIXED', pay_at_hotel_enabled = true
      WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    await admin.$executeRaw`
      UPDATE rooms SET is_active = false
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND id = ${assignableRoom.body.id}::uuid
    `;
    const inactiveAutoAssignment = await provider.createBooking(context, {
      ...bookingRequest,
      idempotencyKey: randomUUID(),
      externalReference: `inactive-auto-${randomUUID()}`,
      paymentMethod: 'pay_at_hotel',
      staffActorId: userId,
      skipQuoteValidation: true,
    });
    expect(inactiveAutoAssignment).toMatchObject({
      ok: false,
      error: { code: 'AUTO_ASSIGNMENT_UNAVAILABLE' },
    });
    const inactiveExplicitSelection = await provider.createBooking(context, {
      ...bookingRequest,
      idempotencyKey: randomUUID(),
      externalReference: `inactive-explicit-${randomUUID()}`,
      paymentMethod: 'pay_at_hotel',
      roomId: assignableRoom.body.id,
      staffActorId: userId,
      skipQuoteValidation: true,
    });
    expect(inactiveExplicitSelection).toMatchObject({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND' },
    });
    await admin.$executeRaw`
      UPDATE rooms SET is_active = true
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND id = ${assignableRoom.body.id}::uuid
    `;
    await admin.$executeRaw`
      UPDATE properties SET booking_mode = 'ROOM_TYPE_ONLY', pay_at_hotel_enabled = false
      WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send(bookingRequest)
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          ok: false,
          error: { code: 'PAYMENT_METHOD_NOT_ENABLED' },
        });
      });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...bookingRequest,
        guest: { ...bookingRequest.guest, specialRequests: 'x'.repeat(2001) },
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('Special requests must be 2,000 characters or fewer.');
      });
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: false, payAtHotel: false })
      .expect(200)
      .expect((response) => {
        expect(response.body.paymentGateways).toEqual({
          stripe: true,
          pokpay: false,
          payAtHotel: false,
        });
      });
    // Milestone 6 Task 24: public/catalog only advertises stripe/pokpay to
    // guests when the property also has a real, connected integration --
    // the enabled toggle alone (above) is no longer enough. The payment
    // *provider* stays mocked for this test (see PAYMENT_PROVIDER override),
    // so a direct row insert is sufficient; nothing here ever decrypts it.
    const stripeConnectionId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO integration_connections
        (id, tenant_id, kind, provider, name, encrypted_credentials, status)
      VALUES (
        ${stripeConnectionId}::uuid, ${tenantId}::uuid, 'PAYMENT', 'STRIPE',
        'Stripe (e2e)', 'not-decrypted-in-this-test', 'CONNECTED'
      )
    `;
    await admin.$executeRaw`
      INSERT INTO property_integration_connections
        (tenant_id, property_id, connection_id, kind, enabled)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${stripeConnectionId}::uuid, 'PAYMENT', true)
    `;
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/public/catalog`)
      .set('Cookie', guestCookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.paymentMethods).toEqual(['stripe']);
      });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...bookingRequest, adults: 0 })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          ok: false,
          error: { code: 'INVALID_BOOKING_COMMAND' },
        });
      });
    const bookingIdempotencyKey = randomUUID();
    const createdResponse = await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', bookingIdempotencyKey)
      .send(bookingRequest)
      .expect(201);
    const created = createdResponse.body;
    expect(created).toMatchObject({
      ok: true,
      value: {
        status: 'PAYMENT_PENDING',
        paymentMethod: 'STRIPE_CHECKOUT',
        adults: 1,
        children: 1,
        guestCount: 2,
        nightlyRates: [
          { date: '2027-09-01', amount: '90.00' },
          { date: '2027-09-02', amount: '90.00' },
        ],
        version: 1,
        checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//),
      },
    });
    if (!created.ok) throw new Error('Expected local booking creation to succeed.');
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/public/bookings/${created.value.id}`)
      .set('Cookie', guestCookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.adults).toBe(1);
        expect(response.body.children).toBe(1);
        expect(response.body.guestCount).toBe(2);
        // Pricing v2 adds a `components` breakdown; date and amount stay the stable contract.
        expect(response.body.nightlyRates).toMatchObject([
          { date: '2027-09-01', amount: '90.00' },
          { date: '2027-09-02', amount: '90.00' },
        ]);
      });
    const createdNotifications = await admin.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM notifications
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND type = 'BOOKING_CREATED' AND payload->>'bookingId' = ${created.value.id}
    `;
    expect(createdNotifications).toEqual([{ type: 'BOOKING_CREATED' }]);
    const notificationPage = await request(app!.getHttpServer())
      .get(`${propertyUrl}/notifications?page=1&pageSize=20`)
      .set('Cookie', cookie)
      .expect(200);
    const createdNotification = notificationPage.body.items.find(
      (item: { type: string; booking: { id?: string } | null }) =>
        item.type === 'BOOKING_CREATED' && item.booking?.id === created.value.id,
    );
    expect(createdNotification).toEqual(expect.objectContaining({ readAt: null }));
    if (!createdNotification) throw new Error('Expected booking-created notification.');
    const notificationReadKey = randomUUID();
    const firstMarkRead = await request(app!.getHttpServer())
      .patch(`${propertyUrl}/notifications/${createdNotification.id}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', notificationReadKey)
      .send({ version: notificationPage.body.version })
      .expect(200);
    const secondMarkRead = await request(app!.getHttpServer())
      .patch(`${propertyUrl}/notifications/${createdNotification.id}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', notificationReadKey)
      .send({ version: notificationPage.body.version })
      .expect(200);
    expect(secondMarkRead.body).toEqual(firstMarkRead.body);
    expect(firstMarkRead.body.updated).toBe(1);
    const otherGuestQuote = await request(app!.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .send({ roomTypeId, ratePlanId, startsOn: '2027-09-01', endsOn: '2027-09-03' })
      .expect(201);
    const otherGuestCookie = otherGuestQuote.headers['set-cookie'][0] as string;
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/bookings/${created.value.id}`)
      .set('Cookie', otherGuestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: created.value.version })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ ok: false, error: { code: 'BOOKING_NOT_FOUND' } });
      });
    await request(app!.getHttpServer())
      .delete(`${propertyUrl}/bookings/${created.value.id}`)
      .set('Cookie', otherGuestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: created.value.version })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ ok: false, error: { code: 'BOOKING_NOT_FOUND' } });
      });
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2031-01-01',
        endsOn: '2031-02-03',
        availableUnits: 1,
      })
      .expect(204);
    const directoryGuest = {
      ...bookingRequest.guest,
      email: 'guest@example.test',
      firstName: 'Updated',
      lastName: 'Directory',
    };
    const directoryBookingOne = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2031-01-01',
      endsOn: '2031-01-03',
      guest: directoryGuest,
      total: quote.body.total,
      paymentMethod: 'stripe',
      quoteSessionId,
      skipQuoteValidation: true,
    });
    const directoryBookingTwo = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2031-01-05',
      endsOn: '2031-01-07',
      guest: directoryGuest,
      total: quote.body.total,
      paymentMethod: 'stripe',
      quoteSessionId,
      skipQuoteValidation: true,
    });
    const phoneGuestBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2031-02-01',
      endsOn: '2031-02-03',
      guest: {
        ...bookingRequest.guest,
        email: 'phone-directory@example.test',
        firstName: 'Phone',
        lastName: 'Directory',
        phone: '+355-555-0101',
      },
      total: quote.body.total,
      paymentMethod: 'stripe',
      quoteSessionId,
      skipQuoteValidation: true,
    });
    expect(directoryBookingOne).toMatchObject({ ok: true });
    expect(directoryBookingTwo).toMatchObject({ ok: true });
    expect(phoneGuestBooking).toMatchObject({ ok: true });
    const phoneCandidateId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO guests (id, tenant_id, email, first_name, last_name, phone)
      VALUES (
        ${phoneCandidateId}::uuid, ${tenantId}::uuid, 'phone-candidate@example.test',
        'Phone', 'Candidate', '+355-555-0202'
      )
    `;
    const partialMatchQuote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId,
      ratePlanId,
      startsOn: '2031-01-12',
      endsOn: '2031-01-14',
    });
    const partialMatchBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2031-01-12',
      endsOn: '2031-01-14',
      guest: {
        ...bookingRequest.guest,
        email: 'phone-only-directory@example.test',
        firstName: 'Phone Only',
        lastName: 'Directory',
        phone: '+355-555-0202',
      },
      total: partialMatchQuote.total,
      quoteToken: partialMatchQuote.quoteToken,
      quoteSessionId,
      skipQuoteValidation: true,
      paymentMethod: 'stripe',
    });
    expect(partialMatchBooking).toMatchObject({ ok: true });
    if (!partialMatchBooking.ok) throw new Error('Expected partial-match booking to succeed.');
    const partialMatchGuest = await admin.$queryRaw<
      Array<{ id: string; suspectedDuplicateOfGuestId: string | null }>
    >`
      SELECT id, suspected_duplicate_of_guest_id AS "suspectedDuplicateOfGuestId"
      FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND email = 'phone-only-directory@example.test'
    `;
    expect(partialMatchGuest).toEqual([
      { id: partialMatchBooking.value.guestId, suspectedDuplicateOfGuestId: phoneCandidateId },
    ]);
    const partialMatchBookingGuest = await admin.$queryRaw<Array<{ guestId: string | null }>>`
      SELECT guest_id AS "guestId" FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND id = ${partialMatchBooking.value.id}::uuid
    `;
    expect(partialMatchBookingGuest).toEqual([{ guestId: partialMatchBooking.value.guestId }]);
    expect(partialMatchBooking.value.guestId).not.toBe(phoneCandidateId);
    const refreshedGuest = await admin.$queryRaw<
      Array<{ id: string; firstName: string | null; lastName: string | null }>
    >`
      SELECT id, first_name AS "firstName", last_name AS "lastName"
      FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND email = 'guest@example.test'
    `;
    expect(refreshedGuest).toEqual([
      { id: created.value.guestId, firstName: 'Updated', lastName: 'Directory' },
    ]);
    const otherPropertyId = randomUUID();
    const otherRoomTypeId = randomUUID();
    const otherRatePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug)
      VALUES (${otherPropertyId}::uuid, ${tenantId}::uuid, 'Other Directory Property', ${`other-${otherPropertyId}`})
    `;
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${otherRoomTypeId}::uuid, ${tenantId}::uuid, ${otherPropertyId}::uuid, 'Other room', 2)
    `;
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency)
      VALUES (${otherRatePlanId}::uuid, ${tenantId}::uuid, ${otherPropertyId}::uuid, 'Other rate', 'EUR')
    `;
    const otherPropertyNotification = await admin.$queryRaw<Array<{ id: string }>>`
      INSERT INTO notifications (tenant_id, property_id, type, payload)
      VALUES (${tenantId}::uuid, ${otherPropertyId}::uuid, 'BOOKING_CREATED', '{"bookingId":"other"}'::jsonb)
      RETURNING id
    `;
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/notifications`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body.items).not.toContainEqual(
          expect.objectContaining({ id: otherPropertyNotification[0].id }),
        );
      });
    await admin.$executeRaw`
      INSERT INTO bookings (
        tenant_id, property_id, room_type_id, guest_id, external_reference, guest_session_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES (
        ${tenantId}::uuid, ${otherPropertyId}::uuid, ${otherRoomTypeId}::uuid,
        ${created.value.guestId}::uuid, ${`other-${randomUUID()}`}, NULL,
        'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
        '2031-03-01'::date, '2031-03-03'::date, ${otherRatePlanId}::uuid, 180.00
      )
    `;
    const otherOnlyGuestId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO guests (id, tenant_id, email, first_name, last_name, phone)
      VALUES (
        ${otherOnlyGuestId}::uuid, ${tenantId}::uuid, 'other-only@example.test',
        'Other', 'Only', '+355-555-0999'
      )
    `;
    await admin.$executeRaw`
      INSERT INTO bookings (
        tenant_id, property_id, room_type_id, guest_id, external_reference, guest_session_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES (
        ${tenantId}::uuid, ${otherPropertyId}::uuid, ${otherRoomTypeId}::uuid,
        ${otherOnlyGuestId}::uuid, ${`other-only-${randomUUID()}`}, NULL,
        'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod",
        '2031-04-01'::date, '2031-04-03'::date, ${otherRatePlanId}::uuid, 180.00
      )
    `;
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/guests?search=updated`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: created.value.guestId,
              email: 'guest@example.test',
              firstName: 'Updated',
              lastName: 'Directory',
              phone: null,
              // Initial booking + two directory bookings + the persisted failed auto-assignment fixture.
              bookingCount: 4,
              mostRecentStartsOn: '2031-01-05',
              mostRecentEndsOn: '2031-01-07',
            }),
          ]),
        );
      });
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/guests?search=guest@example`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: created.value.guestId })]),
        );
      });
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/guests?search=other-only`)
      .set('Cookie', cookie)
      .expect(200)
      .expect([]);
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/guests?search=555-0101`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual([
          expect.objectContaining({
            email: 'phone-directory@example.test',
            firstName: 'Phone',
            phone: '+355-555-0101',
          }),
        ]);
      });
    const blankNameRepeat = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2031-01-08',
      endsOn: '2031-01-10',
      guest: { ...directoryGuest, firstName: '', lastName: '' },
      total: quote.body.total,
      paymentMethod: 'stripe',
      quoteSessionId,
      skipQuoteValidation: true,
    });
    expect(blankNameRepeat).toMatchObject({ ok: true });
    const nameAfterBlankRepeat = await admin.$queryRaw<
      Array<{ firstName: string | null; lastName: string | null }>
    >`
      SELECT first_name AS "firstName", last_name AS "lastName"
      FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND id = ${created.value.guestId}::uuid
    `;
    expect(nameAfterBlankRepeat).toEqual([{ firstName: 'Updated', lastName: 'Directory' }]);
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/bookings`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: created.value.id,
              guestId: created.value.guestId,
              guestFirstName: 'Updated',
              guestLastName: 'Directory',
              guestEmail: 'guest@example.test',
              guestPhone: null,
              guestStreetAddress: '1 Guest Street',
              guestAddressLine2: 'Apartment 2',
              guestCity: 'Tirana',
              guestCounty: 'Tirana County',
              guestPostcode: '1001',
              specialRequests: 'Late arrival after 22:00.\nPlease prepare a baby cot.',
              roomTypeId,
              roomTypeName: 'Provider Suite',
              ratePlanId,
              ratePlanName: 'Provider Flexible',
              startsOn: '2027-09-01',
              endsOn: '2027-09-03',
              status: 'PAYMENT_PENDING',
              paymentMethod: 'STRIPE_CHECKOUT',
              total: { amount: '180.00', currency: 'EUR' },
            }),
          ]),
        );
      });
    await expect(
      provider.createBooking(context, {
        ...bookingRequest,
        idempotencyKey: randomUUID(),
        guest: { ...bookingRequest.guest, email: '   ' },
        quoteSessionId,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_GUEST_EMAIL' } });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', bookingIdempotencyKey)
      .send(bookingRequest)
      .expect(201)
      .expect(created);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', bookingIdempotencyKey)
      .send({ ...bookingRequest, externalReference: `must-${randomUUID()}` })
      .expect(409);
    const operationRows = await admin.$queryRaw<Array<{ attempts: number; bookingCount: bigint }>>`
      SELECT io.attempts, (
        SELECT count(*)::bigint FROM bookings WHERE tenant_id = ${tenantId}::uuid
          AND external_reference = ${bookingRequest.externalReference}
      ) AS "bookingCount"
      FROM integration_operations io
      WHERE io.tenant_id = ${tenantId}::uuid AND io.idempotency_key = ${bookingIdempotencyKey}
    `;
    expect(operationRows).toEqual([{ attempts: 2, bookingCount: 1n }]);

    const {
      checkoutUrl: _checkoutUrl,
      cancellationToken: _cancellationToken,
      checkoutOrderId: _checkoutOrderId,
      ...createdBooking
    } = created.value;
    void _checkoutUrl;
    void _cancellationToken;
    // The checkout order id is only returned when a booking is created, like the URL and token.
    void _checkoutOrderId;
    await expect(provider.getBooking(context, created.value.externalBookingId!)).resolves.toEqual(
      createdBooking,
    );
    await expect(
      provider.findBookingByExternalReference(context, created.value.externalReference),
    ).resolves.toEqual(createdBooking);

    await expect(
      provider.updateBooking(context, {
        idempotencyKey: randomUUID(),
        bookingId: created.value.id,
        guestSessionId: quoteSessionId,
        expectedVersion: created.value.version,
      }),
    ).resolves.toEqual({ ok: true, value: createdBooking });
    await expect(
      provider.updateBooking(context, {
        idempotencyKey: randomUUID(),
        bookingId: created.value.id,
        guestSessionId: quoteSessionId,
        expectedVersion: created.value.version,
        total: { amount: '190.00', currency: 'EUR' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_UPDATE' } });

    const webhookPayload = JSON.stringify({
      id: `evt_test_${randomUUID()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${created.value.id}`,
          object: 'checkout.session',
          payment_status: 'paid',
          metadata: {
            tenantId,
            propertyId,
            bookingId: created.value.id,
          },
        },
      },
    });
    const stripeSignature = new Stripe(stripeSecretKey).webhooks.generateTestHeaderString({
      payload: webhookPayload,
      secret: stripeWebhookSecret,
    });
    failPaymentConfirmationDelivery = true;
    await request(app!.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', stripeSignature)
      .send(webhookPayload)
      .expect(200)
      .expect({ received: true });
    failPaymentConfirmationDelivery = false;
    await expect(provider.getBooking(context, created.value.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
      total: { amount: '180.00', currency: 'EUR' },
    });
    // A failed send no longer blocks confirmation: the durable mail queue
    // (Milestone 22) retries it, and it is delivered exactly once.
    await settleMail();
    expect(paymentConfirmationEmails).toHaveLength(1);
    const paymentRows = await admin.$queryRaw<
      Array<{
        kind: string;
        provider: string;
        externalPaymentId: string;
        status: string;
        amount: string;
        currency: string;
      }>
    >`
      SELECT kind::text AS kind, provider, external_payment_id AS "externalPaymentId", status,
        amount::text AS amount, currency
      FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${created.value.id}::uuid
    `;
    expect(paymentRows).toEqual([
      {
        kind: 'CHARGE',
        provider: 'stripe',
        externalPaymentId: `cs_test_${created.value.id}`,
        status: 'PAID',
        amount: '180.00',
        currency: 'EUR',
      },
    ]);

    await request(app!.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', stripeSignature)
      .send(webhookPayload)
      .expect(200)
      .expect({ received: true });
    const duplicatePaymentRows = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${created.value.id}::uuid
    `;
    expect(duplicatePaymentRows).toEqual([{ count: 1n }]);
    await expect(provider.getBooking(context, created.value.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    const bookingAuditRows = await admin.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND target_id = ${created.value.id}::text
      ORDER BY action
    `;
    expect(bookingAuditRows).toEqual([{ action: 'booking.created' }]);

    const cancelIdempotencyKey = randomUUID();
    const cancellationEligibility = await admin.$queryRaw<Array<{ isFree: boolean }>>`
      SELECT rp.free_cancellation_until_hours IS NOT NULL
        AND CURRENT_TIMESTAMP <= (b.starts_on::timestamp AT TIME ZONE p.timezone)
          - make_interval(hours => rp.free_cancellation_until_hours) AS "isFree"
      FROM bookings b
      JOIN rate_plans rp
        ON rp.tenant_id = b.tenant_id AND rp.property_id = b.property_id AND rp.id = b.rate_plan_id
      JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
      WHERE b.id = ${created.value.id}::uuid
    `;
    expect(cancellationEligibility).toEqual([{ isFree: true }]);
    const cancelCommand = {
      idempotencyKey: cancelIdempotencyKey,
      bookingId: created.value.id,
      guestSessionId: quoteSessionId,
      expectedVersion: created.value.version,
      reason: null,
    };
    // Nobody is assigned to this property, so staff cancellation mail falls
    // back to the organization owner.
    await expect(
      admin.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count FROM property_staff_assignments
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
      `,
    ).resolves.toEqual([{ count: 0n }]);
    const cancelled = await provider.cancelBooking(context, cancelCommand);
    expect(cancelled).toMatchObject({ ok: true, value: { status: 'CANCELLED', version: 2 } });
    await settleMail();
    expect(cancelledGuestEmails).toContainEqual(
      expect.objectContaining({
        bookingId: created.value.id,
        roomName: 'Provider Suite',
        guestCount: 2,
      }),
    );
    expect(cancelledStaffEmails).toContainEqual(
      expect.objectContaining({
        bookingId: created.value.id,
        staffUserId: userId,
        to: email,
        guestCount: 2,
        refund: expect.objectContaining({
          status: 'processed',
          amount: { amount: '180.00', currency: 'EUR' },
        }),
      }),
    );
    await expect(provider.cancelBooking(context, cancelCommand)).resolves.toEqual(cancelled);
    const automaticRefundRows = await admin.$queryRaw<
      Array<{ kind: string; status: string; amount: string }>
    >`
      SELECT kind::text AS kind, status, amount::text AS amount
      FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${created.value.id}::uuid
      ORDER BY kind
    `;
    expect(automaticRefundRows).toEqual([
      { kind: 'CHARGE', status: 'PAID', amount: '180.00' },
      { kind: 'REFUND', status: 'REFUNDED', amount: '180.00' },
    ]);
    expect(
      refundCommands.filter(({ paymentId }) => paymentId === `cs_test_${created.value.id}`),
    ).toHaveLength(1);
    await settleMail();
    expect(refundConfirmationEmails).toEqual([
      expect.objectContaining({
        bookingId: created.value.id,
        to: 'guest@example.test',
        amount: { amount: '180.00', currency: 'EUR' },
        guestCount: 2,
      }),
    ]);

    const failedRefundQuote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId,
      ratePlanId,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
      adults: 1,
      children: 1,
    });
    const failedRefundBooking = await provider.createBooking(context, {
      ...bookingRequest,
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      total: failedRefundQuote.total,
      quoteToken: failedRefundQuote.quoteToken,
      quoteSessionId,
    });
    expect(failedRefundBooking).toMatchObject({ ok: true, value: { status: 'PAYMENT_PENDING' } });
    if (!failedRefundBooking.ok) throw new Error('Expected failed-refund booking to be created.');
    const failedRefundWebhookPayload = JSON.stringify({
      id: `evt_test_refund_failure_${randomUUID()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${failedRefundBooking.value.id}`,
          object: 'checkout.session',
          payment_status: 'paid',
          metadata: { tenantId, propertyId, bookingId: failedRefundBooking.value.id },
        },
      },
    });
    const failedRefundWebhookSignature = new Stripe(
      stripeSecretKey,
    ).webhooks.generateTestHeaderString({
      payload: failedRefundWebhookPayload,
      secret: stripeWebhookSecret,
    });
    await request(app!.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', failedRefundWebhookSignature)
      .send(failedRefundWebhookPayload)
      .expect(200)
      .expect({ received: true });
    const failedRefundConfirmed = await provider.getBooking(context, failedRefundBooking.value.id);
    expect(failedRefundConfirmed).toMatchObject({ status: 'CONFIRMED' });
    failAutomaticRefund = true;
    const failedRefundCancellation = await provider.cancelBooking(context, {
      idempotencyKey: randomUUID(),
      bookingId: failedRefundBooking.value.id,
      guestSessionId: quoteSessionId,
      expectedVersion: failedRefundConfirmed!.version,
      reason: 'Force the automatic refund to fail.',
    });
    failAutomaticRefund = false;
    expect(failedRefundCancellation).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    await expect(provider.getBooking(context, failedRefundBooking.value.id)).resolves.toMatchObject(
      {
        status: 'CANCELLED',
      },
    );
    const failedRefundReview = await admin.$queryRaw<
      Array<{
        category: string;
        referenceType: string;
        referenceId: string;
        message: string;
        context: unknown;
      }>
    >`
      SELECT category::text AS category, reference_type AS "referenceType", reference_id AS "referenceId",
        message, context
      FROM manual_review_items
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND reference_id = ${failedRefundBooking.value.id}
    `;
    // A refund that cannot be confirmed also records a payment/booking mismatch item that
    // blocks automatic retries (payment-refund.service.ts), next to the unknown-result item.
    expect(failedRefundReview).toHaveLength(2);
    expect(failedRefundReview).toContainEqual(
      expect.objectContaining({
        category: 'PAYMENT_BOOKING_MISMATCH',
        referenceId: failedRefundBooking.value.id,
      }),
    );
    expect(failedRefundReview).toContainEqual(
      expect.objectContaining({
        category: 'UNKNOWN_RESULT',
        referenceType: 'booking',
        referenceId: failedRefundBooking.value.id,
        message:
          'Automatic cancellation refund needs manual action: Forced refund gateway failure.',
        context: expect.objectContaining({
          automaticRefund: true,
          errorCode: 'REFUND_GATEWAY_UNAVAILABLE',
          retryable: true,
        }),
      }),
    );
    await settleMail();
    expect(cancelledStaffEmails).toContainEqual(
      expect.objectContaining({
        bookingId: failedRefundBooking.value.id,
        refund: expect.objectContaining({
          status: 'manual_action',
          amount: { amount: '180.00', currency: 'EUR' },
        }),
      }),
    );
    // Stock writes must target future dates; this fixture must not age into the past.
    const concurrentStartsOn = isoDateFromToday(60);
    const concurrentEndsOn = isoDateFromToday(62);
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: concurrentStartsOn,
        endsOn: concurrentEndsOn,
        availableUnits: 1,
      })
      .expect(204);
    const concurrentQuote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId,
      ratePlanId,
      startsOn: concurrentStartsOn,
      endsOn: concurrentEndsOn,
    });
    const concurrentWebhookBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: concurrentStartsOn,
      endsOn: concurrentEndsOn,
      guest: {
        email: `concurrent-webhook-${randomUUID()}@example.test`,
        firstName: 'Concurrent',
        lastName: 'Webhook',
        phone: null,
      },
      total: concurrentQuote.total,
      quoteToken: concurrentQuote.quoteToken,
      quoteSessionId,
      paymentMethod: 'stripe',
    });
    expect(concurrentWebhookBooking).toMatchObject({
      ok: true,
      value: { status: 'PAYMENT_PENDING' },
    });
    if (!concurrentWebhookBooking.ok) throw new Error('Expected concurrent webhook booking.');
    const concurrentWebhookPayload = JSON.stringify({
      id: `evt_test_concurrent_${randomUUID()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${concurrentWebhookBooking.value.id}`,
          object: 'checkout.session',
          payment_status: 'paid',
          metadata: { tenantId, propertyId, bookingId: concurrentWebhookBooking.value.id },
        },
      },
    });
    const concurrentWebhookSignature = new Stripe(
      stripeSecretKey,
    ).webhooks.generateTestHeaderString({
      payload: concurrentWebhookPayload,
      secret: stripeWebhookSecret,
    });
    await Promise.all(
      [1, 2].map(() =>
        request(app!.getHttpServer())
          .post('/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', concurrentWebhookSignature)
          .send(concurrentWebhookPayload)
          .expect(200)
          .expect({ received: true }),
      ),
    );
    await expect(
      provider.getBooking(context, concurrentWebhookBooking.value.id),
    ).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    const concurrentChargeRows = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM payments
      WHERE tenant_id = ${tenantId}::uuid
        AND booking_id = ${concurrentWebhookBooking.value.id}::uuid
        AND kind = 'CHARGE'::"PaymentKind"
    `;
    expect(concurrentChargeRows).toEqual([{ count: 1n }]);

    const bookingAuditEntries = await admin.$queryRaw<
      Array<{
        action: string;
        targetId: string;
        actorUserId: string | null;
        details: {
          guestId: string;
          cancellation?: {
            isFree: boolean;
            freeCancellationUntilHours: number | null;
            cutoffAt: string | null;
          };
        };
      }>
    >`
      SELECT action, target_id AS "targetId", actor_user_id AS "actorUserId", details
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND target_id = ${created.value.id}
      ORDER BY action
    `;
    expect(bookingAuditEntries).toEqual([
      expect.objectContaining({
        action: 'booking.cancelled',
        targetId: created.value.id,
        actorUserId: null,
        details: expect.objectContaining({
          guestId: created.value.guestId,
          cancellation: expect.objectContaining({
            isFree: true,
            freeCancellationUntilHours: 48,
            cutoffAt: expect.any(String),
          }),
        }),
      }),
      {
        action: 'booking.created',
        targetId: created.value.id,
        actorUserId: null,
        // Audit evidence (ADR-0037) adds an `_audit` block with the outcome and source.
        details: {
          guestId: created.value.guestId,
          _audit: expect.objectContaining({ result: 'completed', source: 'GUEST' }),
        },
      },
      expect.objectContaining({
        action: 'payment.refunded',
        targetId: created.value.id,
        actorUserId: null,
        details: expect.objectContaining({
          chargeExternalPaymentId: `cs_test_${created.value.id}`,
          amount: { amount: '180.00', currency: 'EUR' },
        }),
      }),
    ]);
    const freeCancellationPolicy = await admin.$queryRaw<
      Array<{ isFree: boolean; freeUntilHours: number | null; cutoffAt: Date | null }>
    >`
      SELECT cancellation_is_free AS "isFree",
        cancellation_free_until_hours AS "freeUntilHours",
        cancellation_cutoff_at AS "cutoffAt"
      FROM bookings WHERE id = ${created.value.id}::uuid
    `;
    expect(freeCancellationPolicy).toEqual([
      { isFree: true, freeUntilHours: 48, cutoffAt: expect.any(Date) },
    ]);

    const availableAfterCancellation = await provider.getAvailability(context, {
      roomTypeId,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
    });
    expect(availableAfterCancellation).toMatchObject({ ok: true, value: { availableUnits: 1 } });

    const updatedGuestQuote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId,
      ratePlanId,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
      adults: 1,
      children: 1,
    });
    const updatedGuestBooking = await provider.createBooking(context, {
      ...bookingRequest,
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      guest: {
        ...bookingRequest.guest,
        streetAddress: '99 Updated Avenue',
        addressLine2: null,
        city: 'Durrës',
        county: 'Durrës County',
        postcode: '2001',
      },
      total: updatedGuestQuote.total,
      quoteToken: updatedGuestQuote.quoteToken,
      quoteSessionId,
    });
    expect(updatedGuestBooking).toMatchObject({
      ok: true,
      value: { guestId: created.value.guestId },
    });
    const updatedGuestDetails = await admin.$queryRaw<
      Array<{
        streetAddress: string | null;
        addressLine2: string | null;
        city: string | null;
        county: string | null;
        postcode: string | null;
      }>
    >`
      SELECT street_address AS "streetAddress", address_line_2 AS "addressLine2", city, county, postcode
      FROM guests WHERE id = ${created.value.guestId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
    expect(updatedGuestDetails).toEqual([
      {
        streetAddress: '99 Updated Avenue',
        addressLine2: null,
        city: 'Durrës',
        county: 'Durrës County',
        postcode: '2001',
      },
    ]);
    if (!updatedGuestBooking.ok) throw new Error('Expected updated guest booking to succeed.');
    await provider.cancelBooking(context, {
      idempotencyKey: randomUUID(),
      bookingId: updatedGuestBooking.value.id,
      guestSessionId: quoteSessionId,
      expectedVersion: updatedGuestBooking.value.version,
      reason: null,
    });
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: false })
      .expect(200);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...bookingRequest,
        externalReference: `must-${randomUUID()}`,
        paymentMethod: undefined,
      })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          ok: false,
          error: { code: 'PAYMENT_METHOD_REQUIRED' },
        });
      });

    const zeroRatePlan = await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', globalThis.crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Provider Complimentary', currency: 'EUR' })
      .expect(201);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${zeroRatePlan.body.id}/rules`)
      .set('Idempotency-Key', globalThis.crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '0.00' })
      .expect(201);
    const zeroQuote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId,
      ratePlanId: zeroRatePlan.body.id,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
    });
    const zeroBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId: zeroRatePlan.body.id,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
      guest: {
        email: `complimentary-${randomUUID()}@example.test`,
        firstName: 'Complimentary',
        lastName: 'Guest',
        phone: null,
      },
      total: zeroQuote.total,
      quoteToken: zeroQuote.quoteToken,
      quoteSessionId,
    });
    expect(zeroBooking).toMatchObject({
      ok: true,
      value: { status: 'CONFIRMED', paymentMethod: 'FREE' },
    });
    if (!zeroBooking.ok) throw new Error('Expected zero-amount booking to succeed.');
    expect(zeroBooking.value).not.toHaveProperty('checkoutUrl');
    await provider.cancelBooking(context, {
      idempotencyKey: randomUUID(),
      bookingId: zeroBooking.value.id,
      guestSessionId: quoteSessionId,
      expectedVersion: zeroBooking.value.version,
      reason: null,
    });

    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: false, payAtHotel: true })
      .expect(200);
    await admin.$executeRaw`
      UPDATE properties SET public_website_origin = 'https://hotel.example.test'
      WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    notificationStaffUserId = randomUUID();
    const notificationStaffEmail = `booking-staff-${notificationStaffUserId}@example.test`;
    await admin.$executeRaw`
      INSERT INTO users ("id", "email", "email_verified_at")
      VALUES (${notificationStaffUserId}::uuid, ${notificationStaffEmail}, CURRENT_TIMESTAMP)
    `;
    await admin.$executeRaw`
      INSERT INTO tenant_memberships ("tenant_id", "user_id", "role")
      VALUES (${tenantId}::uuid, ${notificationStaffUserId}::uuid, 'STAFF')
    `;
    const frontDeskTemplate = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM property_role_templates
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
        AND "name" = 'Front Desk'
    `;
    expect(frontDeskTemplate).toHaveLength(1);
    await admin.$executeRaw`
      INSERT INTO property_staff_assignments ("tenant_id", "property_id", "user_id", "role_template_id")
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${notificationStaffUserId}::uuid, ${frontDeskTemplate[0].id}::uuid)
    `;
    const propertyStaffRecipients = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM property_staff_assignments
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    const payAtHotelEmailCount = paymentConfirmationEmails.length;
    const payAtHotelStaffEmailCount = staffBookingEmails.length;
    const payAtHotelIdempotencyKey = randomUUID();
    const payAtHotelRequest = {
      ...bookingRequest,
      externalReference: `must-${randomUUID()}`,
      guest: {
        email: `pay-at-hotel-${randomUUID()}@example.test`,
        firstName: 'Pay',
        lastName: 'At Hotel',
        phone: null,
      },
      payAtHotel: true,
      paymentMethod: 'pay_at_hotel',
      returnUrl: 'https://hotel.example.test/booking-confirmation',
    };
    const payAtHotelBooking = await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', payAtHotelIdempotencyKey)
      .send(payAtHotelRequest)
      .expect(201);
    expect(payAtHotelBooking.body).toMatchObject({
      ok: true,
      value: { status: 'CONFIRMED', paymentMethod: 'PAY_AT_HOTEL', guestCount: 2 },
    });
    expect(payAtHotelBooking.body.value).not.toHaveProperty('checkoutUrl');
    await settleMail();
    expect(paymentConfirmationEmails).toHaveLength(payAtHotelEmailCount + 1);
    expect(paymentConfirmationEmails.at(-1)).toMatchObject({
      bookingId: payAtHotelBooking.body.value.id,
      paymentId: `pay-at-hotel:${payAtHotelBooking.body.value.id}`,
      guestCount: 2,
    });
    expect(paymentConfirmationEmails.at(-1)?.cancellationUrl).toContain('/booking/manage?');
    expect(staffBookingEmails).toHaveLength(
      payAtHotelStaffEmailCount + Number(propertyStaffRecipients[0].count),
    );
    expect(staffBookingEmails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookingId: payAtHotelBooking.body.value.id,
          paymentId: `pay-at-hotel:${payAtHotelBooking.body.value.id}`,
          staffUserId: notificationStaffUserId,
          to: notificationStaffEmail,
          guest: { name: 'Pay At Hotel', email: payAtHotelRequest.guest.email, phone: null },
          stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
          roomName: 'Provider Suite',
          amount: { amount: '180.00', currency: 'EUR' },
          guestCount: 2,
        }),
      ]),
    );
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', payAtHotelIdempotencyKey)
      .send(payAtHotelRequest)
      .expect(201);
    await settleMail();
    expect(paymentConfirmationEmails).toHaveLength(payAtHotelEmailCount + 1);
    expect(staffBookingEmails).toHaveLength(
      payAtHotelStaffEmailCount + Number(propertyStaffRecipients[0].count),
    );
    const payAtHotelPayments = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${payAtHotelBooking.body.value.id}::uuid
    `;
    expect(payAtHotelPayments).toEqual([{ count: 0n }]);
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/bookings`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: payAtHotelBooking.body.value.id,
              status: 'CONFIRMED',
              paymentMethod: 'PAY_AT_HOTEL',
              total: { amount: '180.00', currency: 'EUR' },
            }),
          ]),
        );
      });
    const payAtHotelCancellation = await provider.cancelBooking(context, {
      idempotencyKey: randomUUID(),
      bookingId: payAtHotelBooking.body.value.id,
      guestSessionId: quoteSessionId,
      expectedVersion: payAtHotelBooking.body.value.version,
      reason: null,
    });
    expect(payAtHotelCancellation).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    await settleMail();
    expect(cancelledGuestEmails).toContainEqual(
      expect.objectContaining({ bookingId: payAtHotelBooking.body.value.id, guestCount: 2 }),
    );
    expect(cancelledStaffEmails).toContainEqual(
      expect.objectContaining({ bookingId: payAtHotelBooking.body.value.id, guestCount: 2 }),
    );

    const draftBookingId = randomUUID();
    const draftGuestId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO guests (id, tenant_id, email, phone)
      VALUES (${draftGuestId}::uuid, ${tenantId}::uuid, ${`draft-${randomUUID()}@example.test`}, NULL)
    `;
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, guest_id, external_reference,
        guest_session_id, status, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES (
        ${draftBookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
        ${draftGuestId}::uuid, ${`must-${randomUUID()}`}, ${quoteSessionId}::uuid,
        'DRAFT'::"BookingStatus",
        '2027-09-01'::date, '2027-09-03'::date, ${ratePlanId}::uuid, 180.00
      )
    `;
    await expect(
      provider.cancelBooking(context, {
        idempotencyKey: randomUUID(),
        bookingId: draftBookingId,
        guestSessionId: quoteSessionId,
        expectedVersion: 1,
        reason: null,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: 'CANCELLED', version: 2 } });

    const availabilityAfterDraftCancellation = await provider.getAvailability(context, {
      roomTypeId,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
    });
    expect(availabilityAfterDraftCancellation).toMatchObject({
      ok: true,
      value: { availableUnits: 1 },
    });

    const expiredQuote = await quotes.create(
      tenantId,
      propertyId,
      quoteSessionId,
      { roomTypeId, ratePlanId, startsOn: '2027-09-01', endsOn: '2027-09-03' },
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const expiredReference = `must-${randomUUID()}`;
    await expect(
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: expiredReference,
        roomTypeId,
        ratePlanId,
        startsOn: '2027-09-01',
        endsOn: '2027-09-03',
        guest: {
          email: 'expired@example.test',
          firstName: 'Expired',
          lastName: 'Quote',
          phone: null,
        },
        total: expiredQuote.total,
        quoteToken: expiredQuote.quoteToken,
        quoteSessionId,
        paymentMethod: 'stripe',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'QUOTE_EXPIRED' } });
    await expect(
      provider.findBookingByExternalReference(context, expiredReference),
    ).resolves.toMatchObject({
      status: 'AVAILABILITY_FAILED',
    });
    const attentionNotifications = await admin.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM notifications
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND type = 'BOOKING_NEEDS_ATTENTION' AND payload->>'status' = 'AVAILABILITY_FAILED'
        AND payload->>'bookingId' = (SELECT id::text FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND external_reference=${expiredReference})
    `;
    expect(attentionNotifications).toHaveLength(1);

    const tamperedReference = `must-${randomUUID()}`;
    await expect(
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: tamperedReference,
        roomTypeId,
        ratePlanId,
        startsOn: '2027-09-01',
        endsOn: '2027-09-03',
        guest: {
          email: 'tampered@example.test',
          firstName: 'Tampered',
          lastName: 'Quote',
          phone: null,
        },
        total: quote.body.total,
        quoteToken: `${quote.body.quoteToken}x`,
        quoteSessionId,
        paymentMethod: 'stripe',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'QUOTE_INVALID' } });
    await expect(
      provider.findBookingByExternalReference(context, tamperedReference),
    ).resolves.toMatchObject({
      status: 'AVAILABILITY_FAILED',
    });

    const firstBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2027-09-01',
      endsOn: '2027-09-03',
      guest: {
        email: 'GUEST@example.test',
        firstName: 'Different',
        lastName: 'Name',
        phone: '+355000000',
        specialRequests: 'Please provide an accessible room.',
      },
      total: quote.body.total,
      quoteToken: quote.body.quoteToken,
      quoteSessionId,
      adults: 1,
      children: 1,
      paymentMethod: 'stripe',
    });
    expect(firstBooking).toMatchObject({ ok: true, value: { status: 'PAYMENT_PENDING' } });
    if (!firstBooking.ok) throw new Error('Expected matching guest booking to succeed.');
    expect(firstBooking.value.guestId).toBe(created.value.guestId);

    const manualRefundWebhookPayload = JSON.stringify({
      id: `evt_test_manual_refund_${randomUUID()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${firstBooking.value.id}`,
          object: 'checkout.session',
          payment_status: 'paid',
          metadata: { tenantId, propertyId, bookingId: firstBooking.value.id },
        },
      },
    });
    const manualRefundSignature = new Stripe(stripeSecretKey).webhooks.generateTestHeaderString({
      payload: manualRefundWebhookPayload,
      secret: stripeWebhookSecret,
    });
    await request(app!.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', manualRefundSignature)
      .send(manualRefundWebhookPayload)
      .expect(200);
    await settleMail();
    // E4 adds a rendered template to the delivery command. Match this booking,
    // rather than comparing a legacy command shape against the entire mailbox.
    const matchingConfirmation = paymentConfirmationEmails.filter(
      ({ bookingId }) => bookingId === firstBooking.value.id,
    );
    expect(matchingConfirmation).toHaveLength(1);
    expect(matchingConfirmation[0]).toMatchObject({
      bookingId: firstBooking.value.id,
      bookingReference: expect.any(String),
      paymentId: `cs_test_${firstBooking.value.id}`,
      to: 'guest@example.test',
      amount: { amount: '180.00', currency: 'EUR' },
      brand: {
        name: 'Local PMS Property',
        logoUrl: null,
        supportEmail: null,
        phone: null,
        websiteUrl: 'https://hotel.example.test',
        address: '1 Provider Way',
      },
      paymentMethod: 'stripe',
      guest: { name: 'Different Name' },
      stay: { startsOn: '2027-09-01', endsOn: '2027-09-03' },
      roomName: 'Provider Suite',
      guestCount: 2,
      nightlyRates: [
        expect.objectContaining({
          date: '2027-09-01',
          amount: '90.00',
          components: expect.arrayContaining([
            expect.objectContaining({ kind: 'base', amount: '90.00' }),
          ]),
        }),
        expect.objectContaining({
          date: '2027-09-02',
          amount: '90.00',
          components: expect.arrayContaining([
            expect.objectContaining({ kind: 'base', amount: '90.00' }),
          ]),
        }),
      ],
      specialRequests: 'Please provide an accessible room.',
      template: expect.objectContaining({
        subject: expect.stringContaining('Local PMS Property'),
        text: expect.stringContaining('Hello Different Name'),
      }),
    });
    expect(
      paymentConfirmationEmails.filter(
        ({ bookingId }) => bookingId === concurrentWebhookBooking.value.id,
      ),
    ).toHaveLength(1);
    expect(
      staffBookingEmails.filter(({ bookingId }) => bookingId === firstBooking.value.id),
    ).toHaveLength(Number(propertyStaffRecipients[0].count));
    expect(
      staffBookingEmails.filter(({ bookingId }) => bookingId === firstBooking.value.id),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paymentId: `cs_test_${firstBooking.value.id}`,
          staffUserId: notificationStaffUserId,
          to: `booking-staff-${notificationStaffUserId}@example.test`,
          guest: {
            name: 'Different Name',
            email: 'guest@example.test',
            phone: null,
          },
          specialRequests: 'Please provide an accessible room.',
        }),
      ]),
    );
    const manualRefundKey = randomUUID();
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/payments/refunds`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', manualRefundKey)
      .send({ bookingId: firstBooking.value.id, amount: { amount: '50.00', currency: 'EUR' } })
      .expect(401);
    propertyStaffUserId = randomUUID();
    const propertyStaffEmail = `refund-staff-${propertyStaffUserId}@example.test`;
    const propertyStaffPassword = 'correct-horse-battery-staple';
    const propertyStaffPasswordHash = await bcrypt.hash(propertyStaffPassword, 12);
    await admin.$executeRaw`
      INSERT INTO users ("id", "email", "password_hash", "email_verified_at")
      VALUES (${propertyStaffUserId}::uuid, ${propertyStaffEmail}, ${propertyStaffPasswordHash}, CURRENT_TIMESTAMP)
    `;
    await admin.$executeRaw`
      INSERT INTO tenant_memberships ("tenant_id", "user_id", "role")
      VALUES (${tenantId}::uuid, ${propertyStaffUserId}::uuid, 'STAFF')
    `;
    await app!
      .get(PropertyRoleTemplatesService)
      .createCustomTemplate(tenantId, propertyId, 'Restricted Desk', ['guests.manage']);
    const builtInTemplates = await admin.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM property_role_templates
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
        AND "name" IN ('Front Desk', 'Property Manager', 'Restricted Desk')
    `;
    const restrictedDeskTemplateId = builtInTemplates.find(
      ({ name }) => name === 'Restricted Desk',
    )?.id;
    const propertyManagerTemplateId = builtInTemplates.find(
      ({ name }) => name === 'Property Manager',
    )?.id;
    expect(restrictedDeskTemplateId).toEqual(expect.any(String));
    expect(propertyManagerTemplateId).toEqual(expect.any(String));
    await admin.$executeRaw`
      INSERT INTO property_staff_assignments ("tenant_id", "property_id", "user_id", "role_template_id")
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${propertyStaffUserId}::uuid, ${restrictedDeskTemplateId}::uuid)
    `;
    const propertyStaffCookie = (
      await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: propertyStaffEmail, password: propertyStaffPassword })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    await app!.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, otherPropertyId);
    const otherFrontDeskTemplate = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM property_role_templates
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${otherPropertyId}::uuid
        AND "name" = 'Front Desk'
    `;
    expect(otherFrontDeskTemplate).toHaveLength(1);
    crossPropertyStaffUserId = randomUUID();
    const crossPropertyStaffEmail = `notifications-staff-${crossPropertyStaffUserId}@example.test`;
    const crossPropertyStaffPassword = 'correct-horse-battery-staple';
    const crossPropertyStaffPasswordHash = await bcrypt.hash(crossPropertyStaffPassword, 12);
    await admin.$executeRaw`
      INSERT INTO users ("id", "email", "password_hash", "email_verified_at")
      VALUES (${crossPropertyStaffUserId}::uuid, ${crossPropertyStaffEmail}, ${crossPropertyStaffPasswordHash}, CURRENT_TIMESTAMP)
    `;
    await admin.$executeRaw`
      INSERT INTO tenant_memberships ("tenant_id", "user_id", "role")
      VALUES (${tenantId}::uuid, ${crossPropertyStaffUserId}::uuid, 'STAFF')
    `;
    await admin.$executeRaw`
      INSERT INTO property_staff_assignments ("tenant_id", "property_id", "user_id", "role_template_id")
      VALUES (${tenantId}::uuid, ${otherPropertyId}::uuid, ${crossPropertyStaffUserId}::uuid, ${otherFrontDeskTemplate[0].id}::uuid)
    `;
    const crossPropertyStaffCookie = (
      await request(app!.getHttpServer())
        .post('/auth/login')
        .send({ email: crossPropertyStaffEmail, password: crossPropertyStaffPassword })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/notifications`)
      .set('Cookie', crossPropertyStaffCookie)
      .expect(403);
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/notifications/${createdNotification.id}`)
      .set('Cookie', crossPropertyStaffCookie)
      .expect(403);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/payments/refunds`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ bookingId: firstBooking.value.id, amount: { amount: '20.00', currency: 'EUR' } })
      .expect(403);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings/${payAtHotelBooking.body.value.id}/manual-payment`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash' })
      .expect(403);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: '2030-12-01',
        endsOn: '2030-12-03',
        guest: {
          email: `staff-denied-${randomUUID()}@example.test`,
          firstName: 'Denied',
          lastName: 'Staff',
        },
      })
      .expect(403);
    await admin.$executeRaw`
      UPDATE property_staff_assignments
      SET "role_template_id" = ${propertyManagerTemplateId}::uuid
      WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid
        AND "user_id" = ${propertyStaffUserId}::uuid
    `;
    await admin.$executeRaw`
      UPDATE properties SET min_stay_nights = 2
      WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2030-12-01',
        endsOn: '2030-12-03',
        availableUnits: 1,
      })
      .expect(204);
    const staffBookingRequest = {
      roomTypeId,
      ratePlanId,
      startsOn: '2030-12-01',
      endsOn: '2030-12-03',
      paymentMethod: 'pay_at_hotel',
      guest: {
        email: `staff-booking-${randomUUID()}@example.test`,
        firstName: 'Staff',
        lastName: 'Booking',
        phone: '+355000001',
      },
    };
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...staffBookingRequest, endsOn: '2030-12-02' })
      .expect(400)
      .expect((response) => {
        expect(response.body.message).toBe('A minimum stay of 2 nights is required.');
      });
    const staffBookingKey = randomUUID();
    const staffBooking = await request(app!.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', staffBookingKey)
      .send(staffBookingRequest)
      .expect(201);
    expect(staffBooking.body).toMatchObject({
      ok: true,
      value: { status: 'CONFIRMED', paymentMethod: 'PAY_AT_HOTEL', guestCount: 1 },
    });
    expect(staffBooking.body.value).not.toHaveProperty('checkoutUrl');
    const staffBookingGuestSession = await admin.$queryRaw<
      Array<{ guestSessionId: string | null }>
    >`
      SELECT guest_session_id AS "guestSessionId"
      FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND id = ${staffBooking.body.value.id}::uuid
    `;
    expect(staffBookingGuestSession).toEqual([{ guestSessionId: expect.any(String) }]);
    expect(staffBookingGuestSession[0].guestSessionId).not.toBe(propertyStaffUserId);
    const forgedGuestCookie = `must_guest_session=${propertyStaffUserId}`;
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/bookings/${staffBooking.body.value.id}`)
      .set('Cookie', forgedGuestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: staffBooking.body.value.version })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ ok: false, error: { code: 'BOOKING_NOT_FOUND' } });
      });
    await request(app!.getHttpServer())
      .delete(`${propertyUrl}/bookings/${staffBooking.body.value.id}`)
      .set('Cookie', forgedGuestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: staffBooking.body.value.version })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ ok: false, error: { code: 'BOOKING_NOT_FOUND' } });
      });
    // Cancellation coverage below runs against its own booking/date range so it
    // doesn't free up staffBooking's inventory slot out from under the
    // pre-existing idempotent-replay/availability/manual-payment assertions
    // that follow, which assume staffBooking is still CONFIRMED.
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: '2030-12-05',
        endsOn: '2030-12-07',
        availableUnits: 1,
      })
      .expect(204);
    const cancellableStaffBooking = await request(app!.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...staffBookingRequest,
        startsOn: '2030-12-05',
        endsOn: '2030-12-07',
        guest: {
          email: `staff-cancel-${randomUUID()}@example.test`,
          firstName: 'Staff',
          lastName: 'Cancel',
          phone: '+355000002',
        },
      })
      .expect(201);
    await request(app!.getHttpServer())
      .delete(`${propertyUrl}/staff-bookings/${cancellableStaffBooking.body.value.id}`)
      .set('Cookie', crossPropertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: cancellableStaffBooking.body.value.version })
      .expect(403);
    const staffCancelPreview = await request(app!.getHttpServer())
      .get(`${propertyUrl}/bookings/${cancellableStaffBooking.body.value.id}/cancellation-preview`)
      .set('Cookie', propertyStaffCookie)
      .expect(200);
    const staffCancellation = await request(app!.getHttpServer())
      .delete(`${propertyUrl}/staff-bookings/${cancellableStaffBooking.body.value.id}`)
      .set('Cookie', propertyStaffCookie)
      .send({
        expectedVersion: staffCancelPreview.body.version,
        previewHash: staffCancelPreview.body.previewHash,
        reasonCategory: 'guest_request',
        details: 'Guest requested cancellation.',
      })
      .expect(200);
    expect(staffCancellation.body).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    await settleMail();
    expect(cancelledGuestEmails).toContainEqual(
      expect.objectContaining({ bookingId: cancellableStaffBooking.body.value.id }),
    );
    const staffCancellationAudit = await admin.$queryRaw<Array<{ actorUserId: string | null }>>`
      SELECT actor_user_id AS "actorUserId" FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND target_id = ${cancellableStaffBooking.body.value.id} AND action = 'booking.cancelled'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(staffCancellationAudit).toEqual([{ actorUserId: propertyStaffUserId }]);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', staffBookingKey)
      .send(staffBookingRequest)
      .expect(201)
      .expect(staffBooking.body);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...staffBookingRequest, externalReference: `must-${randomUUID()}` })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({ ok: false, error: { code: 'AVAILABILITY_FAILED' } });
      });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings/${staffBooking.body.value.id}/manual-payment`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'bank_transfer' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          ok: true,
          value: {
            bookingId: staffBooking.body.value.id,
            amount: { amount: '180.00', currency: 'EUR' },
          },
        });
      });
    await admin.$executeRaw`
      UPDATE properties SET min_stay_nights = NULL
      WHERE tenant_id = ${tenantId}::uuid AND id = ${propertyId}::uuid
    `;
    // The earlier pay-at-hotel reservation was cancelled in its own scenario.
    // It must reject collection; use a separate confirmed fixture for payment evidence.
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings/${payAtHotelBooking.body.value.id}/manual-payment`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash', amount: { amount: '150.00', currency: 'EUR' } })
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({
          ok: false,
          error: { code: 'INVALID_BOOKING_STATE' },
        }),
      );
    const manualPaymentBookingId = randomUUID();
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,external_reference,status,payment_method,starts_on,ends_on,total_amount)
      SELECT ${manualPaymentBookingId}::uuid,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,${'manual-' + manualPaymentBookingId},'CONFIRMED','PAY_AT_HOTEL',starts_on,ends_on,total_amount
      FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${payAtHotelBooking.body.value.id}::uuid`;
    const manualPaymentKey = randomUUID();
    const manualPayment = await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings/${manualPaymentBookingId}/manual-payment`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', manualPaymentKey)
      .send({ method: 'cash', amount: { amount: '150.00', currency: 'EUR' } })
      .expect(200);
    expect(manualPayment.body.error).toBeUndefined();
    expect(manualPayment.body).toMatchObject({
      ok: true,
      value: {
        bookingId: manualPaymentBookingId,
        amount: { amount: '150.00', currency: 'EUR' },
        provider: 'manual',
        method: 'cash',
        status: 'succeeded',
        externalPaymentId: expect.stringMatching(/^manual:cash:/),
      },
    });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings/${manualPaymentBookingId}/manual-payment`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', manualPaymentKey)
      .send({ method: 'cash', amount: { amount: '150.00', currency: 'EUR' } })
      .expect(200)
      .expect(manualPayment.body);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings/${manualPaymentBookingId}/manual-payment`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash', amount: { amount: '50.00', currency: 'EUR' } })
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual({
          ok: false,
          error: {
            code: 'INVALID_PAYMENT_AMOUNT',
            message:
              'Payment amount must be a positive amount no greater than the remaining booking balance.',
            retryable: false,
          },
        });
      });
    const manualPayments = await admin.$queryRaw<
      Array<{
        kind: string;
        provider: string;
        method: string | null;
        status: string;
        amount: string;
        currency: string;
        externalPaymentId: string;
      }>
    >`
      SELECT kind::text AS "kind", provider, method, status, amount::text AS amount, currency,
        external_payment_id AS "externalPaymentId"
      FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND booking_id = ${manualPaymentBookingId}::uuid AND provider = 'manual'
    `;
    expect(manualPayments).toEqual([
      {
        kind: 'CHARGE',
        provider: 'manual',
        method: 'cash',
        status: 'succeeded',
        amount: '150.00',
        currency: 'EUR',
        externalPaymentId: manualPayment.body.value.externalPaymentId,
      },
    ]);
    const manualPaymentAudit = await admin.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND target_id = ${manualPaymentBookingId} AND action = 'payment.manual_recorded'
    `;
    expect(manualPaymentAudit).toEqual([{ action: 'payment.manual_recorded' }]);
    await request(app!.getHttpServer())
      .post(
        `/tenants/${randomUUID()}/properties/${propertyId}/bookings/${manualPaymentBookingId}/manual-payment`,
      )
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash' })
      .expect(403);
    await request(app!.getHttpServer())
      .post(
        `/tenants/${tenantId}/properties/${randomUUID()}/bookings/${manualPaymentBookingId}/manual-payment`,
      )
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ method: 'cash' })
      .expect(403);
    const propertyStaffRefund = await request(app!.getHttpServer())
      .post(`${propertyUrl}/payments/refunds`)
      .set('Cookie', propertyStaffCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        bookingId: firstBooking.value.id,
        percentage: 25,
        note: 'Guest services approval',
      })
      .expect(200);
    expect(propertyStaffRefund.body).toMatchObject({
      ok: true,
      value: { amount: { amount: '45.00', currency: 'EUR' } },
    });
    const manualRefund = await request(app!.getHttpServer())
      .post(`${propertyUrl}/payments/refunds`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', manualRefundKey)
      .send({
        bookingId: firstBooking.value.id,
        amount: { amount: '50.00', currency: 'EUR' },
        note: 'Fixed adjustment approved',
      })
      .expect(200);
    expect(manualRefund.body).toMatchObject({
      ok: true,
      value: { amount: { amount: '50.00', currency: 'EUR' }, status: 'succeeded' },
    });
    // A request above what remains is refused (no silent capping); staff re-enter the exact amount.
    const oversizedRefund = await request(app!.getHttpServer())
      .post(`${propertyUrl}/payments/refunds`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        bookingId: firstBooking.value.id,
        amount: { amount: '100.00', currency: 'EUR' },
        note: 'Close remaining balance',
      })
      .expect(200);
    expect(oversizedRefund.body).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REFUND_AMOUNT' },
    });
    const cappedRefund = await request(app!.getHttpServer())
      .post(`${propertyUrl}/payments/refunds`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        bookingId: firstBooking.value.id,
        amount: { amount: '85.00', currency: 'EUR' },
        note: 'Close remaining balance',
      })
      .expect(200);
    expect(cappedRefund.body).toMatchObject({
      ok: true,
      value: { amount: { amount: '85.00', currency: 'EUR' }, status: 'succeeded' },
    });
    const refundRows = await admin.$queryRaw<Array<{ amount: string; note: string | null }>>`
      SELECT amount::text AS amount, note
      FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND booking_id = ${firstBooking.value.id}::uuid AND kind = 'REFUND'::"PaymentKind"
      ORDER BY created_at
    `;
    expect(refundRows).toEqual([
      { amount: '45.00', note: 'Guest services approval' },
      { amount: '50.00', note: 'Fixed adjustment approved' },
      { amount: '85.00', note: 'Close remaining balance' },
    ]);
    const refundAuditDetails = await admin.$queryRaw<Array<{ details: Record<string, unknown> }>>`
      SELECT details
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND target_id = ${firstBooking.value.id} AND action = 'payment.refunded'
      ORDER BY created_at
    `;
    expect(refundAuditDetails.map(({ details }) => details.note)).toEqual([
      'Guest services approval',
      'Fixed adjustment approved',
      'Close remaining balance',
    ]);
    expect(
      refundConfirmationEmails
        .filter((email) => email.bookingId === firstBooking.value.id)
        .some((email) => JSON.stringify(email).includes('Guest services approval')),
    ).toBe(false);
    const refundNotifications = await admin.$queryRaw<Array<{ type: string }>>`
      SELECT type FROM notifications
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND type = 'PAYMENT_REFUNDED' AND payload->>'bookingId' = ${firstBooking.value.id}
    `;
    expect(refundNotifications).toHaveLength(3);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/payments/refunds`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', manualRefundKey)
      .send({
        bookingId: firstBooking.value.id,
        amount: { amount: '50.00', currency: 'EUR' },
        note: 'Fixed adjustment approved',
      })
      .expect(200)
      .expect(manualRefund.body);
    await settleMail();
    expect(refundConfirmationEmails).toEqual([
      expect.objectContaining({
        bookingId: created.value.id,
        amount: { amount: '180.00', currency: 'EUR' },
      }),
      expect.objectContaining({
        bookingId: firstBooking.value.id,
        to: 'guest@example.test',
        amount: { amount: '45.00', currency: 'EUR' },
        guestCount: 2,
      }),
      expect.objectContaining({
        bookingId: firstBooking.value.id,
        to: 'guest@example.test',
        amount: { amount: '50.00', currency: 'EUR' },
        guestCount: 2,
      }),
      expect.objectContaining({
        bookingId: firstBooking.value.id,
        to: 'guest@example.test',
        amount: { amount: '85.00', currency: 'EUR' },
        guestCount: 2,
      }),
    ]);

    const expiryStartsOn = '2026-11-01';
    const expiryEndsOn = '2026-11-03';
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: expiryStartsOn,
        endsOn: expiryEndsOn,
        availableUnits: 1,
      })
      .expect(204);
    const expiryQuote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId,
      ratePlanId,
      startsOn: expiryStartsOn,
      endsOn: expiryEndsOn,
    });
    const expiringBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: expiryStartsOn,
      endsOn: expiryEndsOn,
      guest: {
        email: `expiry-${randomUUID()}@example.test`,
        firstName: 'Expiry',
        lastName: 'Guest',
        phone: null,
      },
      total: expiryQuote.total,
      quoteToken: expiryQuote.quoteToken,
      quoteSessionId,
      paymentMethod: 'stripe',
    });
    expect(expiringBooking).toMatchObject({ ok: true, value: { status: 'PAYMENT_PENDING' } });
    if (!expiringBooking.ok) throw new Error('Expected expiring booking to succeed.');
    await admin.$executeRaw`
      UPDATE bookings
      SET created_at = CURRENT_TIMESTAMP - INTERVAL '31 minutes'
      WHERE id = ${expiringBooking.value.id}::uuid
    `;

    const expiry = app!.get(PaymentExpiryService);
    await expect(expiry.sweep()).resolves.toEqual({ expired: 1 });
    await expect(provider.getBooking(context, expiringBooking.value.id)).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    // The guest is told the booking was not made (email plan Step 2c).
    const notCompleted = await admin.$queryRaw<Array<{ recipient: string; subject: string }>>`
      SELECT recipient_email AS recipient, subject FROM email_messages
      WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${expiringBooking.value.id}::uuid
        AND event_type = 'guest.payment_not_completed'
    `;
    expect(notCompleted).toHaveLength(1);
    expect(notCompleted[0]!.recipient).toMatch(/^expiry-.*@example\.test$/);
    expect(notCompleted[0]!.subject).toMatch(/^Your booking at .+ was not completed$/);
    await expect(
      provider.getAvailability(context, {
        roomTypeId,
        startsOn: expiryStartsOn,
        endsOn: expiryEndsOn,
      }),
    ).resolves.toMatchObject({ ok: true, value: { availableUnits: 1 } });

    const lateWebhookPayload = JSON.stringify({
      id: `evt_test_late_${randomUUID()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_${expiringBooking.value.id}`,
          object: 'checkout.session',
          payment_status: 'paid',
          metadata: {
            tenantId,
            propertyId,
            bookingId: expiringBooking.value.id,
          },
        },
      },
    });
    const lateStripeSignature = new Stripe(stripeSecretKey).webhooks.generateTestHeaderString({
      payload: lateWebhookPayload,
      secret: stripeWebhookSecret,
    });
    await request(app!.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', lateStripeSignature)
      .send(lateWebhookPayload)
      .expect(200)
      .expect({ received: true });
    await request(app!.getHttpServer())
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', lateStripeSignature)
      .send(lateWebhookPayload)
      .expect(200)
      .expect({ received: true });
    await expect(provider.getBooking(context, expiringBooking.value.id)).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    const latePaymentRows = await admin.$queryRaw<
      Array<{ status: string; count: bigint; expiryAction: string; lateWebhookAction: string }>
    >`
      SELECT p.status, count(*)::bigint AS count,
        (SELECT action FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
          AND target_id = ${expiringBooking.value.id}::text
          AND action = 'booking.payment_expired') AS "expiryAction",
        (SELECT action FROM audit_logs WHERE tenant_id = ${tenantId}::uuid
          AND target_id = ${expiringBooking.value.id}::text
          AND action = 'payment.late_webhook_rejected') AS "lateWebhookAction"
      FROM payments p
      WHERE p.tenant_id = ${tenantId}::uuid AND p.booking_id = ${expiringBooking.value.id}::uuid
      GROUP BY p.status
      ORDER BY p.status
    `;
    expect(latePaymentRows).toEqual([
      {
        status: 'LATE_AFTER_EXPIRY',
        count: 1n,
        expiryAction: 'booking.payment_expired',
        lateWebhookAction: 'payment.late_webhook_rejected',
      },
      {
        status: 'REFUNDED',
        count: 1n,
        expiryAction: 'booking.payment_expired',
        lateWebhookAction: 'payment.late_webhook_rejected',
      },
    ]);
    await settleMail();
    expect(
      refundConfirmationEmails.filter((email) => email.bookingId === expiringBooking.value.id),
    ).toHaveLength(1);

    const pastStartsOn = isoDateFromToday(-1);
    const pastEndsOn = isoDateFromToday(0);
    const pastCutoffRatePlan = await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Idempotency-Key', globalThis.crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Provider Past Cutoff', currency: 'EUR', freeCancellationUntilHours: 0 })
      .expect(201);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${pastCutoffRatePlan.body.id}/rules`)
      .set('Idempotency-Key', globalThis.crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '90.00' })
      .expect(201);
    // Historical cancellation fixture: current quote/stock routes correctly reject past dates.
    const pastGuestId = randomUUID();
    const pastCutoffBooking = { value: { id: randomUUID(), version: 1 } };
    await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email,first_name,last_name) VALUES(${pastGuestId}::uuid,${tenantId}::uuid,${`past-cutoff-${randomUUID()}@example.test`},'Past','Cutoff')`;
    await admin.$executeRaw`INSERT INTO inventory_units(tenant_id,property_id,room_type_id,stays_on,available_units,booked_units)
      VALUES(${tenantId}::uuid,${propertyId}::uuid,${roomTypeId}::uuid,${pastStartsOn}::date,1,1)
      ON CONFLICT(tenant_id,property_id,room_type_id,stays_on) DO UPDATE SET available_units=GREATEST(inventory_units.available_units,1),booked_units=1`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,guest_session_id,external_reference,status,payment_method,starts_on,ends_on,total_amount,nightly_rates,cancellation_is_free,cancellation_cutoff_at)
      VALUES(${pastCutoffBooking.value.id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomTypeId}::uuid,${pastCutoffRatePlan.body.id}::uuid,${pastGuestId}::uuid,${quoteSessionId}::uuid,${`past-cutoff-${randomUUID()}`},'PAYMENT_PENDING','STRIPE_CHECKOUT',${pastStartsOn}::date,${pastEndsOn}::date,90,${JSON.stringify([{ date: pastStartsOn, amount: '90.00' }])}::jsonb,true,${pastStartsOn + 'T00:00:00Z'}::timestamptz)`;
    // Milestone 11.5 Task 6: this stay already started (arrival yesterday),
    // so it's well within the property's self-service cancellation window
    // (default 21 days before arrival) — self-service cancellation is
    // blocked regardless of the rate plan's own refund-eligibility policy,
    // and the guest is directed to contact the hotel.
    await expect(
      provider.cancelBooking(context, {
        idempotencyKey: randomUUID(),
        bookingId: pastCutoffBooking.value.id,
        guestSessionId: quoteSessionId,
        expectedVersion: pastCutoffBooking.value.version,
        reason: null,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'CANCELLATION_WINDOW_CLOSED' } });
    const pastCutoffStatus = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings WHERE id = ${pastCutoffBooking.value.id}::uuid
    `;
    expect(pastCutoffStatus).toEqual([{ status: 'PAYMENT_PENDING' }]);

    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: true, payAtHotel: true })
      .expect(200);
    const createPokpayBooking = async (startsOn: string, endsOn: string) => {
      await request(app!.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Idempotency-Key', crypto.randomUUID())
        .set('Cookie', cookie)
        .send({ roomTypeId, startsOn, endsOn, availableUnits: 1 })
        .expect(204);
      const quote = await quotes.create(tenantId, propertyId, quoteSessionId, {
        roomTypeId,
        ratePlanId,
        startsOn,
        endsOn,
      });
      const booking = await provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: `must-${randomUUID()}`,
        roomTypeId,
        ratePlanId,
        startsOn,
        endsOn,
        guest: {
          email: `pokpay-${randomUUID()}@example.test`,
          firstName: 'Pok',
          lastName: 'Pay',
          phone: null,
        },
        total: quote.total,
        quoteToken: quote.quoteToken,
        quoteSessionId,
        paymentMethod: 'pokpay',
      });
      if (!booking.ok) throw new Error(`Expected PokPay booking to succeed: ${booking.error.code}`);
      expect(booking.value).toMatchObject({ status: 'PAYMENT_PENDING', paymentMethod: 'POKPAY' });
      return booking.value;
    };

    await request(app!.getHttpServer())
      .post('/webhooks/pokpay')
      .send({ orderId: `pok_test_unbound_${randomUUID()}` })
      .expect(400);

    const mismatchedPokpayBooking = await createPokpayBooking('2026-12-01', '2026-12-03');
    pokpayAmountOverride = '1.00';
    await request(app!.getHttpServer())
      .post('/webhooks/pokpay')
      .send({ orderId: `pok_test_${mismatchedPokpayBooking.id}` })
      .expect(400);
    pokpayAmountOverride = undefined;
    await expect(provider.getBooking(context, mismatchedPokpayBooking.id)).resolves.toMatchObject({
      status: 'PAYMENT_PENDING',
    });

    const duplicatePokpayBooking = await createPokpayBooking('2026-12-04', '2026-12-06');
    const duplicateOrderId = `pok_test_${duplicatePokpayBooking.id}`;
    await request(app!.getHttpServer())
      .post('/webhooks/pokpay')
      .send({ orderId: duplicateOrderId })
      .expect(200);
    await request(app!.getHttpServer())
      .post('/webhooks/pokpay')
      .send({ orderId: duplicateOrderId })
      .expect(200);
    await expect(provider.getBooking(context, duplicatePokpayBooking.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    const duplicatePokpayCharges = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND booking_id = ${duplicatePokpayBooking.id}::uuid
        AND provider = 'pokpay' AND kind = 'CHARGE'::"PaymentKind"
    `;
    expect(duplicatePokpayCharges).toEqual([{ count: 1n }]);
    expect(
      paymentConfirmationEmails.filter((email) => email.bookingId === duplicatePokpayBooking.id),
    ).toHaveLength(1);

    const polledPokpayBooking = await createPokpayBooking('2026-12-07', '2026-12-09');
    await expect(app!.get(PaymentExpiryService).sweep()).resolves.toEqual({ expired: 0 });
    await expect(provider.getBooking(context, polledPokpayBooking.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });
    expect(
      paymentConfirmationEmails.filter((email) => email.bookingId === polledPokpayBooking.id),
    ).toHaveLength(1);

    // Milestone 21, Task 20: an abandoned PokPay checkout is a local inventory
    // hold only. The staff Quick Booking calendar and the WordPress room-type
    // listing use different API routes, so cover each before and after the
    // expiry worker releases the held nights.
    const abandonedPokpayStartsOn = '2026-12-10';
    const abandonedPokpayEndsOn = '2026-12-12';
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: abandonedPokpayStartsOn,
        endsOn: abandonedPokpayEndsOn,
        availableUnits: 1,
      })
      .expect(204);
    pokpayInitialStatus = 'PENDING';
    const abandonedPokpayQuickBooking = await request(app!.getHttpServer())
      .post(`${propertyUrl}/staff-bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `abandoned-pokpay-${randomUUID()}`)
      .send({
        roomTypeId,
        ratePlanId,
        startsOn: abandonedPokpayStartsOn,
        endsOn: abandonedPokpayEndsOn,
        paymentMethod: 'pokpay',
        guest: {
          email: `abandoned-pokpay-${randomUUID()}@example.test`,
          firstName: 'Abandoned',
          lastName: 'PokPay',
        },
      })
      .expect(201);
    pokpayInitialStatus = 'COMPLETED';
    expect(abandonedPokpayQuickBooking.body).toMatchObject({
      ok: true,
      value: { checkoutUrl: expect.stringMatching(/^https:\/\/pay\.pokpay\.test\//) },
    });
    const abandonedPokpayBooking = abandonedPokpayQuickBooking.body.value as { id: string };
    const abandonedPokpayOrderId = `pok_test_${abandonedPokpayBooking.id}`;
    const abandonedPokpayOrder = pokpayOrders.get(abandonedPokpayOrderId);
    if (!abandonedPokpayOrder) throw new Error('Expected the PokPay checkout order to exist.');
    expect(abandonedPokpayOrder.status).toBe('PENDING');

    const pendingHold = await admin.$queryRaw<
      Array<{
        status: string;
        externalBookingId: string | null;
        clockFolioCount: bigint;
        paymentCount: bigint;
      }>
    >`
      SELECT b.status, b.external_booking_id AS "externalBookingId",
        (SELECT COUNT(*)::bigint FROM clock_folios cf
          WHERE cf.tenant_id = b.tenant_id AND cf.property_id = b.property_id AND cf.booking_id = b.id
        ) AS "clockFolioCount",
        (SELECT COUNT(*)::bigint FROM payments p
          WHERE p.tenant_id = b.tenant_id AND p.property_id = b.property_id AND p.booking_id = b.id
        ) AS "paymentCount"
      FROM bookings b
      WHERE b.tenant_id = ${tenantId}::uuid AND b.property_id = ${propertyId}::uuid
        AND b.id = ${abandonedPokpayBooking.id}::uuid
    `;
    expect(pendingHold).toEqual([
      {
        status: 'PAYMENT_PENDING',
        externalBookingId: null,
        clockFolioCount: 0n,
        paymentCount: 0n,
      },
    ]);

    const quickBookingWhileHeld = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability-calendar?roomTypeId=${roomTypeId}&month=2026-12`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      quickBookingWhileHeld.body.days.filter(
        (day: { date: string }) =>
          day.date === abandonedPokpayStartsOn || day.date === '2026-12-11',
      ),
    ).toMatchObject([
      {
        date: abandonedPokpayStartsOn,
        isAvailable: false,
        status: 'unavailable',
        pricing: { valid: true, total: { amount: '90.00', currency: 'EUR' } },
      },
      {
        date: '2026-12-11',
        isAvailable: false,
        status: 'unavailable',
        pricing: { valid: true, total: { amount: '90.00', currency: 'EUR' } },
      },
    ]);
    const wordpressWhileHeld = await request(app!.getHttpServer())
      .get(
        `${propertyUrl}/public/availability?roomTypeId=${roomTypeId}&startsOn=${abandonedPokpayStartsOn}&endsOn=${abandonedPokpayEndsOn}`,
      )
      .expect(200);
    expect(wordpressWhileHeld.body).toMatchObject({ isAvailable: false, availableUnits: 0 });

    // Payment arriving after the 30-minute threshold but before this sweep is
    // intentionally honored: polling happens before expiry, so a provider's
    // authoritative completed state wins over a stale local hold.
    pokpayInitialStatus = 'PENDING';
    const completedBeforeSweep = await createPokpayBooking('2026-12-13', '2026-12-15');
    pokpayInitialStatus = 'COMPLETED';
    await admin.$executeRaw`
      UPDATE bookings
      SET created_at = CURRENT_TIMESTAMP - INTERVAL '31 minutes'
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND id = ${abandonedPokpayBooking.id}::uuid
    `;
    await admin.$executeRaw`
      UPDATE bookings
      SET created_at = CURRENT_TIMESTAMP - INTERVAL '31 minutes'
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND id = ${completedBeforeSweep.id}::uuid
    `;
    const completedBeforeSweepOrder = pokpayOrders.get(`pok_test_${completedBeforeSweep.id}`);
    if (!completedBeforeSweepOrder) throw new Error('Expected the PokPay checkout order to exist.');
    completedBeforeSweepOrder.status = 'COMPLETED';

    await expect(app!.get(PaymentExpiryService).sweep()).resolves.toEqual({ expired: 1 });
    await expect(provider.getBooking(context, abandonedPokpayBooking.id)).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    await expect(provider.getBooking(context, completedBeforeSweep.id)).resolves.toMatchObject({
      status: 'CONFIRMED',
    });

    const quickBookingAfterExpiry = await request(app!.getHttpServer())
      .get(`${propertyUrl}/availability-calendar?roomTypeId=${roomTypeId}&month=2026-12`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      quickBookingAfterExpiry.body.days.filter(
        (day: { date: string }) =>
          day.date === abandonedPokpayStartsOn || day.date === '2026-12-11',
      ),
    ).toMatchObject([
      {
        date: abandonedPokpayStartsOn,
        isAvailable: true,
        status: 'available',
        pricing: { valid: true, total: { amount: '90.00', currency: 'EUR' } },
      },
      {
        date: '2026-12-11',
        isAvailable: true,
        status: 'available',
        pricing: { valid: true, total: { amount: '90.00', currency: 'EUR' } },
      },
    ]);
    const wordpressAfterExpiry = await request(app!.getHttpServer())
      .get(
        `${propertyUrl}/public/availability?roomTypeId=${roomTypeId}&startsOn=${abandonedPokpayStartsOn}&endsOn=${abandonedPokpayEndsOn}`,
      )
      .expect(200);
    expect(wordpressAfterExpiry.body).toMatchObject({ isAvailable: true, availableUnits: 1 });

    const unavailableReference = `must-${randomUUID()}`;
    const unavailableQuote = await request(app!.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .set('Cookie', guestCookie)
      .send({ roomTypeId, ratePlanId, startsOn: '2027-09-01', endsOn: '2027-09-03' })
      .expect(201);
    await expect(
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: unavailableReference,
        roomTypeId,
        ratePlanId,
        startsOn: '2027-09-01',
        endsOn: '2027-09-03',
        guest: {
          email: 'second@example.test',
          firstName: 'Second',
          lastName: 'Guest',
          phone: '+355000000',
        },
        total: unavailableQuote.body.total,
        quoteToken: unavailableQuote.body.quoteToken,
        quoteSessionId,
        paymentMethod: 'stripe',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AVAILABILITY_FAILED' } });
    await expect(
      provider.findBookingByExternalReference(context, unavailableReference),
    ).resolves.toMatchObject({
      status: 'AVAILABILITY_FAILED',
    });
    const matchedGuests = await admin.$queryRaw<Array<{ email: string; phone: string | null }>>`
      SELECT email, phone FROM guests
      WHERE tenant_id = ${tenantId}::uuid
        AND lower(email) IN ('guest@example.test', 'second@example.test')
      ORDER BY email
    `;
    expect(matchedGuests).toEqual([
      { email: 'guest@example.test', phone: null },
      { email: 'second@example.test', phone: '+355000000' },
    ]);
  });
});
