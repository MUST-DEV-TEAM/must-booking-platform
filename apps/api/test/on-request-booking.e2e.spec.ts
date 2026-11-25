import { paymentMethodAvailability } from '../src/booking/payment-method-availability';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { connectPaymentProviders } from './helpers/payment-connections';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { PaymentProvider } from '@must/domain-contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { PaymentExpiryService } from '../src/payments/payment-expiry.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { MultiRoomBookingService } from '../src/booking/multi-room-booking.service';
import { StripeWebhookService } from '../src/payments/stripe-webhook.service';
import { requestPaymentLink } from '../src/payments/request-payment-link';
import { PokPayPaymentProvider } from '../src/payments/pokpay-payment.provider';
import { PaymentCollectionService } from '../src/payments/payment-collection.service';

const admin = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.MIGRATION_DATABASE_URL ??
        'postgresql://must_booking:must_booking_dev@localhost:15432/must_booking?schema=public',
    },
  },
});

const day = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

describe('on-request booking lifecycle with real PostgreSQL', () => {
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let planId = '';
  let ownerCookie = '';
  let roomTypeId = '';
  let ratePlanId = '';
  let verificationToken = '';
  const checkouts: Array<{ bookingId: string; amount: string }> = [];
  let verifyProviderLock = false;
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
  const payment: PaymentProvider = {
    async createCheckoutSession(_context, command) {
      if (verifyProviderLock)
        await admin.$transaction(
          (tx) => tx.$queryRaw`SELECT id FROM bookings
          WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${command.bookingId}::uuid FOR UPDATE NOWAIT`,
        );
      checkouts.push({ bookingId: command.bookingId, amount: command.amount.amount });
      return {
        ok: true,
        value: {
          id: `request-${command.bookingId}`,
          url: `https://checkout.example.test/${command.bookingId}`,
        },
      };
    },
    async verifyWebhookEvent() {
      return { ok: false, error: { code: 'UNUSED', message: 'unused', retryable: false } };
    },
    async refund(_context, command) {
      return {
        ok: true,
        value: {
          id: `refund-${command.paymentId}`,
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
  const pokpay: PaymentProvider = {
    ...payment,
    async getPayment(_context, id) {
      const bookingId = id.replace(/^request-/, '');
      const checkout = checkouts.find((item) => item.bookingId === bookingId);
      return checkout
        ? { id, bookingId, status: 'PAID', amount: { amount: checkout.amount, currency: 'EUR' } }
        : null;
    },
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL ??=
      'postgresql://must_booking_app:must_booking_app_dev@localhost:15432/must_booking';
    process.env.REDIS_URL ??= 'redis://localhost:16379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MAIL_PROVIDER)
        .useValue(mail)
        .overrideProvider(PAYMENT_PROVIDER)
        .useValue(payment)
        .overrideProvider(PokPayPaymentProvider)
        .useValue(pokpay),
      { keepExpiry: true },
    ).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.get(PaymentExpiryService).onModuleInit = async () => {};
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'On Request Test',
        propertyName: 'On Request Hotel',
        propertyAddress: '1 Test Lane',
        propertyTimezone: 'Europe/Tirane',
        email: `on-request-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    await connectPaymentProviders(admin, tenantId, propertyId);
    userId = signup.body.user.id;
    ownerCookie = signup.headers['set-cookie'][0];
    planId = randomUUID();
    await admin.$executeRaw`INSERT INTO plans(id,name,max_properties,max_staff_seats,pms_enabled,max_pms_connections_per_property)
      VALUES(${planId}::uuid,${'On Request Test ' + planId},1,5,false,0)`;
    await admin.$executeRaw`UPDATE organizations SET plan_id=${planId}::uuid WHERE id=${tenantId}::uuid`;
    await app.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
    for (let attempt = 0; attempt < 100 && !verificationToken; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    const base = `/tenants/${tenantId}/properties/${propertyId}`;
    const room = await request(app.getHttpServer())
      .post(`${base}/room-types`)
      .set('Cookie', ownerCookie)
      .send({ name: 'Request Suite', maxOccupancy: 2 });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    roomTypeId = room.body.id;
    const plan = await request(app.getHttpServer())
      .post(`${base}/rate-plans`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Request Rate', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    ratePlanId = plan.body.id;
    await request(app.getHttpServer())
      .post(`${base}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '95.00' })
      .expect(201);
    await admin.$executeRaw`UPDATE properties SET stripe_enabled=true, pokpay_enabled=true, confirmation_mode='on_request', on_request_hours=2
      WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    if (planId) await admin.$executeRaw`DELETE FROM plans WHERE id=${planId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  async function create(days: number, method: 'stripe' | 'pokpay' = 'stripe') {
    // Each case has its own booking attempt; clear only this fixture's loopback limiter keys.
    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    try {
      const keys = ['127.0.0.1', '::ffff:127.0.0.1', '::1'].map(
        (ip) =>
          `rate-limit:public:booking-mutation:${createHash('sha256').update(['booking-mutation', ip, tenantId, propertyId].join('|')).digest('hex')}`,
      );
      await redis.del(keys);
    } finally {
      await redis.quit();
    }
    const base = `/tenants/${tenantId}/properties/${propertyId}`;
    const startsOn = day(days),
      endsOn = day(days + 2);
    await request(app.getHttpServer())
      .put(`${base}/inventory-units`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ roomTypeId, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    const quote = await request(app.getHttpServer())
      .post(`${base}/quotes`)
      .send({ roomTypeId, ratePlanId, startsOn, endsOn })
      .expect(201);
    const cookie = quote.headers['set-cookie'][0];
    const created = await request(app.getHttpServer())
      .post(`${base}/bookings`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        ratePlanId,
        startsOn,
        endsOn,
        quoteToken: quote.body.quoteToken,
        total: quote.body.total,
        paymentMethod: method,
        guest: {
          email: `guest-${randomUUID()}@example.test`,
          firstName: 'Test',
          lastName: 'Guest',
        },
      })
      .expect(201);
    expect(created.body.value.status).toBe('ON_REQUEST_PENDING');
    expect(created.body.value.onRequestDeadlineAt).toEqual(expect.any(String));
    expect(created.body.value.cancellationToken).toEqual(expect.any(String));
    expect(created.body.value.checkoutUrl).toBeUndefined();
    return {
      id: created.body.value.id as string,
      total: quote.body.total.amount as string,
      startsOn,
      endsOn,
      cookie,
    };
  }

  async function state(id: string) {
    const rows = await admin.$queryRaw<
      Array<{
        status: string;
        pendingAt: Date | null;
        dueAt: Date | null;
        deadline: Date | null;
        checkoutUrl: string | null;
      }>
    >`
      SELECT status::text AS status,payment_pending_at AS "pendingAt",payment_due_at AS "dueAt",on_request_deadline_at AS deadline,
        on_request_checkout_url AS "checkoutUrl" FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    return rows[0]!;
  }

  it('holds the room without charging, then accepts and starts a fresh payment window', async () => {
    const booking = await create(110);
    expect(checkouts).toHaveLength(0);
    expect((await state(booking.id)).pendingAt).toBeNull();
    const decision = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    expect(decision.body.value.status).toBe('PAYMENT_PENDING');
    expect(decision.body.value.checkoutUrl).toContain('/request-payment?token=');
    const repeated = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    expect(repeated.body.value.checkoutUrl).toBe(decision.body.value.checkoutUrl);
    expect(checkouts).toHaveLength(0);
    const link = new URL(decision.body.value.checkoutUrl);
    const path = link.pathname.replace(/^\/api/, '') + link.search;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 86_400_000);
    let first, second;
    try {
      [first, second] = await Promise.all([
        request(app.getHttpServer()).get(path),
        request(app.getHttpServer()).get(path),
      ]);
    } finally {
      clock.mockRestore();
    }
    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    expect(first.headers.location).toBe(`https://checkout.example.test/${booking.id}`);
    expect(second.headers.location).toBe(first.headers.location);
    expect(checkouts).toEqual([{ bookingId: booking.id, amount: booking.total }]);
    const acceptedState = await state(booking.id);
    expect(acceptedState.pendingAt).toBeInstanceOf(Date);
    expect(acceptedState.dueAt!.getTime() - acceptedState.pendingAt!.getTime()).toBe(
      7 * 86_400_000,
    );
    const sessions = await admin.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM payment_provider_sessions
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid`;
    expect(sessions).toHaveLength(1);
    const emails = await admin.$queryRaw<
      Array<{ eventType: string }>
    >`SELECT event_type AS "eventType" FROM email_messages
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid`;
    expect(emails.map((email) => email.eventType)).toContain('guest.booking_request_accepted');
    await admin.$executeRaw`UPDATE bookings SET payment_pending_at=now()-interval '4 days'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    await app.get(PaymentCollectionService).sendDueReminders();
    await app.get(PaymentCollectionService).sendDueReminders();
    const reminders = await admin.$queryRaw<
      Array<{ eventType: string }>
    >`SELECT event_type AS "eventType" FROM email_messages
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid
        AND event_type='guest.payment_reminder'`;
    expect(reminders).toHaveLength(1);
    const audits = await admin.$queryRaw<Array<{ before: string; after: string }>>`
      SELECT details->'before'->>'status' AS before,details->'after'->>'status' AS after
      FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND action='booking.request_accepted' AND target_id=${booking.id}`;
    expect(audits).toEqual([{ before: 'ON_REQUEST_PENDING', after: 'PAYMENT_PENDING' }]);
    const captured = await app.get(StripeWebhookService).processPaymentSucceeded({
      id: `evt-${booking.id}`,
      type: 'checkout.session.completed',
      externalPaymentId: `request-${booking.id}`,
      tenantId,
      propertyId,
      bookingId: booking.id,
      paymentStatus: 'paid',
    });
    expect(captured).toEqual({ ok: true, value: { duplicate: false } });
    expect((await state(booking.id)).status).toBe('CONFIRMED');
    const charges = await admin.$queryRaw<Array<{ amount: string; status: string }>>`
      SELECT amount::text AS amount,status FROM payments WHERE tenant_id=${tenantId}::uuid
        AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid AND kind='CHARGE'`;
    expect(charges).toEqual([{ amount: booking.total, status: 'PAID' }]);
    const extra = await app.get(StripeWebhookService).processPaymentSucceeded({
      id: `evt-extra-${booking.id}`,
      type: 'checkout.session.completed',
      externalPaymentId: `extra-${booking.id}`,
      tenantId,
      propertyId,
      bookingId: booking.id,
      paymentStatus: 'paid',
    });
    expect(extra.ok).toBe(true);
    expect((await state(booking.id)).status).toBe('CONFIRMED');
    const duplicateCharges = await admin.$queryRaw<
      Array<{ status: string }>
    >`SELECT status FROM payments
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND external_payment_id=${'extra-' + booking.id}`;
    expect(duplicateCharges).toEqual([{ status: 'LATE_AFTER_EXPIRY' }]);
  });

  it('refuses the expired link and releases the room only once', async () => {
    const booking = await create(190);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    const due = new Date(Date.now() - 1000);
    await admin.$executeRaw`UPDATE bookings SET payment_due_at=${due}::timestamptz
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    const link = new URL(
      requestPaymentLink({ tenantId, propertyId, bookingId: booking.id, dueAt: due.toISOString() }),
    );
    const path = link.pathname.replace(/^\/api/, '') + link.search;
    const before = checkouts.length;
    await request(app.getHttpServer()).get(path).expect(410);
    await request(app.getHttpServer()).get(path).expect(410);
    expect(checkouts).toHaveLength(before);
    expect((await state(booking.id)).status).toBe('EXPIRED');
    const [stock] = await admin.$queryRaw<
      Array<{ units: number }>
    >`SELECT booked_units AS units FROM inventory_units
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid
        AND stays_on=${booking.startsOn}::date`;
    expect(stock?.units).toBe(0);
  });

  it('does not retry an orphaned checkout creation', async () => {
    const booking = await create(200);
    const accepted = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_operations(id,tenant_id,property_id,idempotency_key,aggregate_id,request_hash,status,result)
      VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${'orphan-' + id},${booking.id}::uuid,${'a'.repeat(64)},'PENDING',
        ${JSON.stringify({ kind: 'request_checkout', stage: 'PREPARING', provider: 'stripe' })}::jsonb)`;
    const link = new URL(accepted.body.value.checkoutUrl);
    const before = checkouts.length;
    await request(app.getHttpServer())
      .get(link.pathname.replace(/^\/api/, '') + link.search)
      .expect(409);
    expect(checkouts).toHaveLength(before);
  }, 30_000);

  it('uses the hotel payment-link validity at acceptance', async () => {
    await admin.$executeRaw`UPDATE properties SET payment_link_valid_days=4 WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    try {
      const booking = await create(230);
      await request(app.getHttpServer())
        .post(
          `/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`,
        )
        .set('Cookie', ownerCookie)
        .send({ decision: 'accept', expectedVersion: 1 })
        .expect(200);
      const saved = await state(booking.id);
      expect(saved.dueAt!.getTime() - saved.pendingAt!.getTime()).toBe(4 * 86_400_000);
    } finally {
      await admin.$executeRaw`UPDATE properties SET payment_link_valid_days=7 WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    }
  });

  it('confirms an accepted PokPay request through the poll', async () => {
    const booking = await create(210, 'pokpay');
    const accepted = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    const link = new URL(accepted.body.value.checkoutUrl);
    verifyProviderLock = true;
    try {
      await request(app.getHttpServer())
        .get(link.pathname.replace(/^\/api/, '') + link.search)
        .expect(303);
    } finally {
      verifyProviderLock = false;
    }
    await app.get(PaymentExpiryService).sweep();
    expect((await state(booking.id)).status).toBe('CONFIRMED');
    const charges = await admin.$queryRaw<
      Array<{ status: string; amount: string }>
    >`SELECT status,amount::text AS amount FROM payments
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid AND kind='CHARGE'`;
    expect(charges).toEqual([{ status: 'PAID', amount: booking.total }]);
  });

  it('routes a paid PokPay order after the deadline to the late-payment flow', async () => {
    const booking = await create(220, 'pokpay');
    const accepted = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    const link = new URL(accepted.body.value.checkoutUrl);
    await request(app.getHttpServer())
      .get(link.pathname.replace(/^\/api/, '') + link.search)
      .expect(303);
    await admin.$executeRaw`UPDATE bookings SET payment_due_at=now()-interval '1 second'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    await app.get(PaymentExpiryService).sweep();
    expect((await state(booking.id)).status).toBe('EXPIRED');
    const flows = await admin.$queryRaw<Array<{ kind: string }>>`SELECT kind FROM booking_flows
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid AND kind='LATE_PAYMENT'`;
    expect(flows).toHaveLength(1);
  });

  it('keeps a payment finished before the deadline even when it is reported after it', async () => {
    const booking = await create(225, 'pokpay');
    const accepted = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    const link = new URL(accepted.body.value.checkoutUrl);
    verifyProviderLock = true;
    try {
      await request(app.getHttpServer())
        .get(link.pathname.replace(/^\/api/, '') + link.search)
        .expect(303);
    } finally {
      verifyProviderLock = false;
    }
    // The payment page was created to close a minute before the deadline; the deadline then passes
    // before the poll sees the payment.
    await admin.$executeRaw`UPDATE bookings SET payment_due_at=now()-interval '1 second'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    await admin.$executeRaw`UPDATE integration_operations SET result=jsonb_set(result,'{expiresAt}',to_jsonb((now()-interval '1 minute')::text))
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND aggregate_id=${booking.id}::uuid AND result->>'kind'='request_checkout'`;
    await app.get(PaymentExpiryService).sweep();
    expect((await state(booking.id)).status).toBe('CONFIRMED');
  });

  it('offers a card method only when it is switched on and its connection works', async () => {
    const available = () =>
      app
        .get(TenantDatabaseService)
        .withTenantTransaction({ tenantId, propertyId }, (tx) =>
          paymentMethodAvailability(tx, { tenantId, propertyId }),
        );
    expect(await available()).toMatchObject({ stripe: true, pokpay: true });
    await admin.$executeRaw`UPDATE integration_connections SET status='PENDING'
      WHERE tenant_id=${tenantId}::uuid AND provider='STRIPE'`;
    try {
      expect(await available()).toMatchObject({ stripe: false, pokpay: true });
    } finally {
      await admin.$executeRaw`UPDATE integration_connections SET status='CONNECTED'
        WHERE tenant_id=${tenantId}::uuid AND provider='STRIPE'`;
    }
  });

  it('declines manually and automatically after the saved deadline, releasing stock', async () => {
    const manual = await create(120);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${manual.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'decline', expectedVersion: 1 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${manual.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'decline', expectedVersion: 1 })
      .expect(200);
    expect((await state(manual.id)).status).toBe('DECLINED');
    const refused = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${manual.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const manualStock = await admin.$queryRaw<
      Array<{ units: number }>
    >`SELECT booked_units AS units FROM inventory_units
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid
        AND stays_on=${manual.startsOn}::date`;
    expect(manualStock[0]?.units).toBe(0);
    const automatic = await create(130);
    await admin.$executeRaw`UPDATE bookings SET on_request_deadline_at=now()-interval '1 minute'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${automatic.id}::uuid`;
    const late = await request(app.getHttpServer())
      .post(
        `/tenants/${tenantId}/properties/${propertyId}/bookings/${automatic.id}/request-decision`,
      )
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 });
    expect(JSON.stringify(late.body)).toContain('REQUEST_DEADLINE_PASSED');
    await app.get(PaymentExpiryService).sweep();
    await app.get(PaymentExpiryService).sweep();
    expect((await state(automatic.id)).status).toBe('DECLINED');
    const emails = await admin.$queryRaw<
      Array<{ eventType: string }>
    >`SELECT event_type AS "eventType" FROM email_messages
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${automatic.id}::uuid`;
    expect(emails.map((email) => email.eventType)).toContain('guest.booking_request_declined');
    const stock = await admin.$queryRaw<
      Array<{ units: number }>
    >`SELECT booked_units AS units FROM inventory_units
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid
        AND stays_on=${automatic.startsOn}::date`;
    expect(stock[0]?.units).toBe(0);
    const declines = await admin.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*)::bigint AS count FROM audit_logs
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
        AND target_id IN (${manual.id}, ${automatic.id}) AND action='booking.request_declined'`;
    expect(Number(declines[0]?.count)).toBe(2);
  });

  it('lets the guest and staff cancel a waiting request and releases each room', async () => {
    const guestBooking = await create(150);
    const base = `/tenants/${tenantId}/properties/${propertyId}/bookings`;
    const guestCancel = await request(app.getHttpServer())
      .delete(`${base}/${guestBooking.id}`)
      .set('Cookie', guestBooking.cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(guestCancel.body).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    const staffBooking = await create(160);
    await request(app.getHttpServer())
      .post(`${base}/${staffBooking.id}/request-cancel`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedVersion: 1 })
      .expect(200);
    expect((await state(staffBooking.id)).status).toBe('CANCELLED');
    const stock = await admin.$queryRaw<
      Array<{ units: number }>
    >`SELECT booked_units AS units FROM inventory_units
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid
        AND stays_on IN (${guestBooking.startsOn}::date,${staffBooking.startsOn}::date)`;
    expect(stock).toHaveLength(2);
    expect(stock.every((night) => night.units === 0)).toBe(true);
  });

  it('serializes acceptance against expiry so exactly one decision takes effect', async () => {
    const booking = await create(170);
    const deadline = new Date(Date.now() + 10_000);
    await admin.$executeRaw`UPDATE bookings SET on_request_deadline_at=${deadline}::timestamptz
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    const [decision] = await Promise.all([
      request(app.getHttpServer())
        .post(
          `/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`,
        )
        .set('Cookie', ownerCookie)
        .send({ decision: 'accept', expectedVersion: 1 }),
      app.get(PaymentExpiryService).sweep(new Date(deadline.getTime() + 1)),
    ]);
    const current = await state(booking.id);
    expect(['PAYMENT_PENDING', 'DECLINED']).toContain(current.status);
    expect(decision.status === 200).toBe(current.status === 'PAYMENT_PENDING');
    const audits = await admin.$queryRaw<Array<{ action: string }>>`SELECT action FROM audit_logs
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_id=${booking.id}
      AND action IN ('booking.request_accepted','booking.request_declined')`;
    expect(audits).toHaveLength(1);
    const stock = await admin.$queryRaw<
      Array<{ units: number }>
    >`SELECT booked_units AS units FROM inventory_units
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid
        AND stays_on=${booking.startsOn}::date`;
    expect(stock[0]?.units).toBe(current.status === 'DECLINED' ? 0 : 1);
  });

  it('holds inventory until the saved payment due time and expires it once', async () => {
    const booking = await create(180);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    const due = new Date(Date.now() + 86_400_000);
    await admin.$executeRaw`UPDATE bookings SET payment_due_at=${due}::timestamptz,
      payment_pending_at=now()-interval '1 day' WHERE tenant_id=${tenantId}::uuid
      AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    let warnings = await admin.$queryRaw<Array<{ bookingId: string }>>`SELECT "bookingId"
      FROM payment_pending_expiring_candidates(10,1000) WHERE "bookingId"=${booking.id}::uuid`;
    expect(warnings).toHaveLength(0);
    await admin.$executeRaw`UPDATE bookings SET payment_due_at=now()+interval '5 minutes'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    warnings = await admin.$queryRaw<Array<{ bookingId: string }>>`SELECT "bookingId"
      FROM payment_pending_expiring_candidates(10,1000) WHERE "bookingId"=${booking.id}::uuid`;
    expect(warnings).toHaveLength(1);
    await admin.$executeRaw`UPDATE bookings SET payment_due_at=${due}::timestamptz
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking.id}::uuid`;
    await app.get(PaymentExpiryService).sweep();
    expect((await state(booking.id)).status).toBe('PAYMENT_PENDING');
    const afterDue = new Date(due.getTime() + 1000);
    await app.get(PaymentExpiryService).sweep(afterDue);
    await app.get(PaymentExpiryService).sweep(afterDue);
    expect((await state(booking.id)).status).toBe('EXPIRED');
    const stock = await admin.$queryRaw<
      Array<{ units: number }>
    >`SELECT booked_units AS units FROM inventory_units
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid
        AND stays_on=${booking.startsOn}::date`;
    expect(stock[0]?.units).toBe(0);
  });

  it('accepts a multi-room request as one payment for both held rooms', async () => {
    const base = `/tenants/${tenantId}/properties/${propertyId}`;
    const startsOn = day(140),
      endsOn = day(142);
    await request(app.getHttpServer())
      .put(`${base}/inventory-units`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ roomTypeId, startsOn, endsOn, availableUnits: 2 })
      .expect(204);
    const first = await request(app.getHttpServer())
      .post(`${base}/quotes`)
      .send({ roomTypeId, ratePlanId, startsOn, endsOn })
      .expect(201);
    const guestCookie = first.headers['set-cookie'][0] as string;
    const second = await request(app.getHttpServer())
      .post(`${base}/quotes`)
      .set('Cookie', guestCookie)
      .send({ roomTypeId, ratePlanId, startsOn, endsOn })
      .expect(201);
    const sessionId = guestCookie.split(';')[0]!.split('=')[1]!;
    const created = await app.get(MultiRoomBookingService).create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        quoteSessionId: sessionId,
        startsOn,
        endsOn,
        paymentMethod: 'stripe',
        guest: {
          email: `order-${randomUUID()}@example.test`,
          firstName: 'Order',
          lastName: 'Guest',
          phone: null,
        },
        rooms: [first, second].map((quote) => ({
          roomTypeId,
          ratePlanId,
          total: quote.body.total,
          quoteToken: quote.body.quoteToken,
        })),
      },
    );
    expect(created).toMatchObject({
      ok: true,
      value: { bookings: [{ status: 'ON_REQUEST_PENDING' }, { status: 'ON_REQUEST_PENDING' }] },
    });
    if (!created.ok) throw new Error('Expected an on-request order.');
    const anchorId = created.value.bookings[0]!.id;
    const secondId = created.value.bookings[1]!.id;
    const countBefore = checkouts.length;
    const accepted = await request(app.getHttpServer())
      .post(`${base}/bookings/${secondId}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    expect(accepted.body.value.checkoutUrl).toBeTruthy();
    const replay = await request(app.getHttpServer())
      .post(`${base}/bookings/${anchorId}/request-decision`)
      .set('Cookie', ownerCookie)
      .send({ decision: 'accept', expectedVersion: 1 })
      .expect(200);
    expect(replay.body.value.checkoutUrl).toBe(accepted.body.value.checkoutUrl);
    expect(checkouts).toHaveLength(countBefore);
    const link = new URL(accepted.body.value.checkoutUrl);
    await request(app.getHttpServer())
      .get(link.pathname.replace(/^\/api/, '') + link.search)
      .expect(303);
    expect(checkouts).toHaveLength(countBefore + 1);
    expect(checkouts.at(-1)).toEqual({ bookingId: anchorId, amount: '380.00' });
    const rows = await admin.$queryRaw<Array<{ status: string; pendingAt: Date | null }>>`
      SELECT status::text AS status,payment_pending_at AS "pendingAt" FROM bookings
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
        AND order_reference=${created.value.orderReference} ORDER BY order_room_number`;
    expect(rows).toHaveLength(2);
    expect(
      rows.every((row) => row.status === 'PAYMENT_PENDING' && row.pendingAt instanceof Date),
    ).toBe(true);
  });
});
