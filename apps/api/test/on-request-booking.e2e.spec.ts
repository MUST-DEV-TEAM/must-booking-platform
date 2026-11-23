import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { PaymentProvider } from '@must/domain-contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { PaymentExpiryService } from '../src/payments/payment-expiry.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { MultiRoomBookingService } from '../src/booking/multi-room-booking.service';
import { StripeWebhookService } from '../src/payments/stripe-webhook.service';

const admin = new PrismaClient({ datasources: { db: {
  url: process.env.MIGRATION_DATABASE_URL ?? 'postgresql://must_booking:must_booking_dev@localhost:15432/must_booking?schema=public',
} } });

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
  const mail: MailProvider = {
    async sendVerificationEmail(command) { verificationToken = new URL(command.verificationUrl).searchParams.get('token')!; },
    async sendWelcomeEmail() {}, async sendPasswordResetEmail() {}, async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {}, async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {}, async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {}, async sendRenderedEmail() {},
  };
  const payment: PaymentProvider = {
    async createCheckoutSession(_context, command) {
      checkouts.push({ bookingId: command.bookingId, amount: command.amount.amount });
      return { ok: true, value: { id: `request-${command.bookingId}`, url: `https://checkout.example.test/${command.bookingId}` } };
    },
    async verifyWebhookEvent() { return { ok: false, error: { code: 'UNUSED', message: 'unused', retryable: false } }; },
    async refund() { return { ok: false, error: { code: 'UNUSED', message: 'unused', retryable: false } }; },
    async getPayment() { return null; },
  };

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL ??= 'postgresql://must_booking_app:must_booking_app_dev@localhost:15432/must_booking';
    process.env.REDIS_URL ??= 'redis://localhost:16379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER).useValue(mail)
      .overrideProvider(PAYMENT_PROVIDER).useValue(payment), { keepExpiry: true }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.get(PaymentExpiryService).onModuleInit = async () => {};
    await app.init();
    const signup = await request(app.getHttpServer()).post('/auth/signup').send({
      organizationName: 'On Request Test', propertyName: 'On Request Hotel',
      propertyAddress: '1 Test Lane', propertyTimezone: 'Europe/Tirane',
      email: `on-request-${randomUUID()}@example.test`, password: 'correct-horse-battery-staple',
    }).expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    ownerCookie = signup.headers['set-cookie'][0];
    planId = randomUUID();
    await admin.$executeRaw`INSERT INTO plans(id,name,max_properties,max_staff_seats,pms_enabled,max_pms_connections_per_property)
      VALUES(${planId}::uuid,${'On Request Test ' + planId},1,5,false,0)`;
    await admin.$executeRaw`UPDATE organizations SET plan_id=${planId}::uuid WHERE id=${tenantId}::uuid`;
    await app.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
    for (let attempt = 0; attempt < 100 && !verificationToken; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await request(app.getHttpServer()).post('/auth/email-verification/confirm')
      .send({ token: verificationToken }).expect(204);
    const base = `/tenants/${tenantId}/properties/${propertyId}`;
    const room = await request(app.getHttpServer()).post(`${base}/room-types`)
      .set('Cookie', ownerCookie).send({ name: 'Request Suite', maxOccupancy: 2 });
    expect(room.status, JSON.stringify(room.body)).toBe(201);
    roomTypeId = room.body.id;
    const plan = await request(app.getHttpServer()).post(`${base}/rate-plans`)
      .set('Cookie', ownerCookie).set('Idempotency-Key', randomUUID())
      .send({ name: 'Request Rate', currency: 'EUR', freeCancellationUntilHours: 48 }).expect(201);
    ratePlanId = plan.body.id;
    await request(app.getHttpServer()).post(`${base}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', ownerCookie).set('Idempotency-Key', randomUUID())
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '95.00' }).expect(201);
    await admin.$executeRaw`UPDATE properties SET stripe_enabled=true, confirmation_mode='on_request', on_request_hours=2
      WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    if (planId) await admin.$executeRaw`DELETE FROM plans WHERE id=${planId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  async function create(days: number) {
    const base = `/tenants/${tenantId}/properties/${propertyId}`;
    const startsOn = day(days), endsOn = day(days + 2);
    await request(app.getHttpServer()).put(`${base}/inventory-units`)
      .set('Cookie', ownerCookie).set('Idempotency-Key', randomUUID())
      .send({ roomTypeId, startsOn, endsOn, availableUnits: 1 }).expect(204);
    const quote = await request(app.getHttpServer()).post(`${base}/quotes`)
      .send({ roomTypeId, ratePlanId, startsOn, endsOn }).expect(201);
    const cookie = quote.headers['set-cookie'][0];
    const created = await request(app.getHttpServer()).post(`${base}/bookings`)
      .set('Cookie', cookie).set('Idempotency-Key', randomUUID())
      .send({ roomTypeId, ratePlanId, startsOn, endsOn, quoteToken: quote.body.quoteToken,
        total: quote.body.total, paymentMethod: 'stripe',
        guest: { email: `guest-${randomUUID()}@example.test`, firstName: 'Test', lastName: 'Guest' },
      }).expect(201);
    expect(created.body.value.status).toBe('ON_REQUEST_PENDING');
    return { id: created.body.value.id as string, total: quote.body.total.amount as string, startsOn, endsOn };
  }

  async function state(id: string) {
    const rows = await admin.$queryRaw<Array<{ status: string; pendingAt: Date | null; deadline: Date | null; checkoutUrl: string | null }>>`
      SELECT status::text AS status,payment_pending_at AS "pendingAt",on_request_deadline_at AS deadline,
        on_request_checkout_url AS "checkoutUrl" FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    return rows[0]!;
  }

  it('holds the room without charging, then accepts and starts a fresh payment window', async () => {
    const booking = await create(110);
    expect(checkouts).toHaveLength(0);
    expect((await state(booking.id)).pendingAt).toBeNull();
    const decision = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${booking.id}/request-decision`)
      .set('Cookie', ownerCookie).send({ decision: 'accept', expectedVersion: 1 }).expect(200);
    expect(decision.body.value).toMatchObject({ status: 'PAYMENT_PENDING', checkoutUrl: `https://checkout.example.test/${booking.id}` });
    expect(checkouts).toEqual([{ bookingId: booking.id, amount: booking.total }]);
    expect((await state(booking.id)).pendingAt).toBeInstanceOf(Date);
    const sessions = await admin.$queryRaw<Array<{ id: string }>>`SELECT id FROM payment_provider_sessions
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid`;
    expect(sessions).toHaveLength(1);
    const emails = await admin.$queryRaw<Array<{ eventType: string }>>`SELECT event_type AS "eventType" FROM email_messages
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid`;
    expect(emails.map((email) => email.eventType)).toContain('guest.booking_request_accepted');
    const audits = await admin.$queryRaw<Array<{ before: string; after: string }>>`
      SELECT details->'before'->>'status' AS before,details->'after'->>'status' AS after
      FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND action='booking.request_accepted' AND target_id=${booking.id}`;
    expect(audits).toEqual([{ before: 'ON_REQUEST_PENDING', after: 'PAYMENT_PENDING' }]);
    const captured = await app.get(StripeWebhookService).processPaymentSucceeded({
      id: `evt-${booking.id}`, type: 'checkout.session.completed',
      externalPaymentId: `request-${booking.id}`, tenantId, propertyId, bookingId: booking.id,
      paymentStatus: 'paid',
    });
    expect(captured).toEqual({ ok: true, value: { duplicate: false } });
    expect((await state(booking.id)).status).toBe('CONFIRMED');
    const charges = await admin.$queryRaw<Array<{ amount: string; status: string }>>`
      SELECT amount::text AS amount,status FROM payments WHERE tenant_id=${tenantId}::uuid
        AND property_id=${propertyId}::uuid AND booking_id=${booking.id}::uuid AND kind='CHARGE'`;
    expect(charges).toEqual([{ amount: booking.total, status: 'PAID' }]);
  });

  it('declines manually and automatically after the saved deadline, releasing stock', async () => {
    const manual = await create(120);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/bookings/${manual.id}/request-decision`)
      .set('Cookie', ownerCookie).send({ decision: 'decline', expectedVersion: 1 }).expect(200);
    expect((await state(manual.id)).status).toBe('DECLINED');
    const automatic = await create(130);
    await admin.$executeRaw`UPDATE bookings SET on_request_deadline_at=now()-interval '1 minute'
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${automatic.id}::uuid`;
    await app.get(PaymentExpiryService).sweep();
    expect((await state(automatic.id)).status).toBe('DECLINED');
    const emails = await admin.$queryRaw<Array<{ eventType: string }>>`SELECT event_type AS "eventType" FROM email_messages
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND booking_id=${automatic.id}::uuid`;
    expect(emails.map((email) => email.eventType)).toContain('guest.booking_request_declined');
    const stock = await admin.$queryRaw<Array<{ units: number }>>`SELECT booked_units AS units FROM inventory_units
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid
        AND stays_on=${automatic.startsOn}::date`;
    expect(stock[0]?.units).toBe(0);
  });

  it('accepts a multi-room request as one payment for both held rooms', async () => {
    const base = `/tenants/${tenantId}/properties/${propertyId}`;
    const startsOn = day(140), endsOn = day(142);
    await request(app.getHttpServer()).put(`${base}/inventory-units`)
      .set('Cookie', ownerCookie).set('Idempotency-Key', randomUUID())
      .send({ roomTypeId, startsOn, endsOn, availableUnits: 2 }).expect(204);
    const first = await request(app.getHttpServer()).post(`${base}/quotes`)
      .send({ roomTypeId, ratePlanId, startsOn, endsOn }).expect(201);
    const guestCookie = first.headers['set-cookie'][0] as string;
    const second = await request(app.getHttpServer()).post(`${base}/quotes`)
      .set('Cookie', guestCookie).send({ roomTypeId, ratePlanId, startsOn, endsOn }).expect(201);
    const sessionId = guestCookie.split(';')[0]!.split('=')[1]!;
    const created = await app.get(MultiRoomBookingService).create({ tenantId, propertyId }, {
      idempotencyKey: randomUUID(), quoteSessionId: sessionId,
      startsOn, endsOn, paymentMethod: 'stripe',
      guest: { email: `order-${randomUUID()}@example.test`, firstName: 'Order', lastName: 'Guest', phone: null },
      rooms: [first, second].map((quote) => ({ roomTypeId, ratePlanId, total: quote.body.total, quoteToken: quote.body.quoteToken })),
    });
    expect(created).toMatchObject({ ok: true, value: { bookings: [{ status: 'ON_REQUEST_PENDING' }, { status: 'ON_REQUEST_PENDING' }] } });
    if (!created.ok) throw new Error('Expected an on-request order.');
    const anchorId = created.value.bookings[0]!.id;
    const secondId = created.value.bookings[1]!.id;
    const countBefore = checkouts.length;
    const accepted = await request(app.getHttpServer()).post(`${base}/bookings/${secondId}/request-decision`)
      .set('Cookie', ownerCookie).send({ decision: 'accept', expectedVersion: 1 }).expect(200);
    expect(accepted.body.value.checkoutUrl).toBeTruthy();
    const replay = await request(app.getHttpServer()).post(`${base}/bookings/${anchorId}/request-decision`)
      .set('Cookie', ownerCookie).send({ decision: 'accept', expectedVersion: 1 }).expect(200);
    expect(replay.body.value.checkoutUrl).toBe(accepted.body.value.checkoutUrl);
    expect(checkouts).toHaveLength(countBefore + 1);
    expect(checkouts.at(-1)).toEqual({ bookingId: anchorId, amount: '380.00' });
    const rows = await admin.$queryRaw<Array<{ status: string; pendingAt: Date | null }>>`
      SELECT status::text AS status,payment_pending_at AS "pendingAt" FROM bookings
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
        AND order_reference=${created.value.orderReference} ORDER BY order_room_number`;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'PAYMENT_PENDING' && row.pendingAt instanceof Date)).toBe(true);
  });
});
