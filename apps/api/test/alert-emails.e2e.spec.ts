import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderedEmailCommand } from '@must/domain-contracts';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { AlertEmailService, alertWindows } from '../src/mail/alert-email.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('alert emails (owner problem alerts, refunds, system owner)', () => {
  let app: INestApplication | undefined;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let cookie = '';
  let verificationToken = '';
  let roomTypeId = '';
  let ratePlanId = '';
  let guestId = '';
  const ownerEmail = `alert-owner-${randomUUID()}@example.test`;
  const opsEmail = 'ops@must.test';
  const sent: RenderedEmailCommand[] = [];
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
    async sendRenderedEmail(command) {
      sent.push(command);
      return { providerMessageId: `msg-${sent.length}` };
    },
  };
  // Far-future timestamps keep these events apart from every other test's data.
  const at = (time: string) => `2031-01-01T${time}Z`;

  const book = async (ref: string, status: string, updatedAt: string) => {
    const id = randomUUID();
    await admin.$executeRaw`
      INSERT INTO bookings (id, tenant_id, property_id, room_type_id, guest_id, external_reference,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, adults, children,
        guest_count, created_at, updated_at)
      VALUES (${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${guestId}::uuid,
        ${ref}, ${status}::"BookingStatus", 'STRIPE_CHECKOUT'::"BookingPaymentMethod", '2031-02-01'::date,
        '2031-02-03'::date, ${ratePlanId}::uuid, 150::numeric, 2, 0, 2,
        ${updatedAt}::timestamptz, ${updatedAt}::timestamptz)
    `;
    return id;
  };

  async function waitForSent(count: number) {
    for (let i = 0; i < 100 && sent.length < count; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  async function clearPlatformRows() {
    await admin.$executeRaw`
      DELETE FROM email_messages WHERE tenant_id IS NULL
        AND (idempotency_key LIKE 'platform-alert/2031-%' OR idempotency_key = 'platform-daily-summary/2030-12-31')
    `;
  }

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    process.env.PLATFORM_ALERT_EMAIL = opsEmail;
    await clearSignupRateLimits();
    await clearPlatformRows();
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
        organizationName: 'Alert Group',
        propertyName: 'Alert Hotel',
        propertyAddress: '1 Beach Road',
        propertyTimezone: 'Europe/Tirane',
        email: ownerEmail,
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

    roomTypeId = randomUUID();
    ratePlanId = randomUUID();
    guestId = randomUUID();
    await admin.$executeRaw`INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy) VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Sea View', 2)`;
    await admin.$executeRaw`INSERT INTO rate_plans (id, tenant_id, property_id, name, currency) VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Flexible', 'EUR')`;
    await admin.$executeRaw`INSERT INTO guests (id, tenant_id, email, first_name, last_name) VALUES (${guestId}::uuid, ${tenantId}::uuid, 'guest@example.test', 'Gia', 'Guest')`;

    // Window 10:00-10:05: the hotel "signs up", a booking Clock did not confirm, a Clock
    // check, a refund, and a failed email. Plus a healthy booking that must not appear.
    await admin.$executeRaw`UPDATE organizations SET created_at = ${at('10:00:30')}::timestamptz WHERE id = ${tenantId}::uuid`;
    await book('ALERT-1', 'PMS_UNKNOWN_RESULT', at('10:01:00'));
    await book('ALERT-OK', 'CONFIRMED', at('10:01:30'));
    await admin.$executeRaw`
      INSERT INTO manual_review_items (tenant_id, property_id, category, reference_type, reference_id, message, created_at)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, 'MISSING_MAPPING', 'room_type', 'RT-9',
        'Clock room type RT-9 is not mapped', ${at('10:02:00')}::timestamptz)
    `;
    const refunded = await book('ALERT-2', 'CANCELLED', at('09:00:00'));
    await admin.$executeRaw`
      INSERT INTO payments (tenant_id, property_id, booking_id, kind, provider, external_payment_id, status, amount, currency, created_at)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${refunded}::uuid, 'REFUND'::"PaymentKind", 'manual',
        ${`manual:refund:${randomUUID()}`}, 'REFUNDED', 40::numeric, 'EUR', ${at('10:03:00')}::timestamptz)
    `;
    await admin.$executeRaw`
      INSERT INTO email_messages (tenant_id, property_id, event_type, recipient_email, subject, idempotency_key, status, last_error, updated_at)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, 'booking.payment_confirmation', 'guest@example.test',
        'Your booking', ${`alert-test-${randomUUID()}`}, 'BOUNCED', 'mailbox does not exist', ${at('10:04:00')}::timestamptz)
    `;
  });

  afterAll(async () => {
    delete process.env.PLATFORM_ALERT_EMAIL;
    if (tenantId) {
      await admin.$executeRaw`DELETE FROM email_messages WHERE tenant_id = ${tenantId}::uuid`;
      await cleanupTenant(admin, tenantId);
    }
    await clearPlatformRows();
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('covers the last three closed 5-minute windows', () => {
    const windows = alertWindows(new Date(at('10:06:30')));
    expect(windows.map((w) => w.start.toISOString())).toEqual([
      '2031-01-01T09:50:00.000Z',
      '2031-01-01T09:55:00.000Z',
      '2031-01-01T10:00:00.000Z',
    ]);
    // Within a minute of a window closing, that window waits for the next sweep.
    expect(
      alertWindows(new Date(at('10:05:30')))
        .at(-1)!
        .start.toISOString(),
    ).toBe('2031-01-01T09:55:00.000Z');
  });

  it('emails the owner and the system owner once per window, and honours the switch', async () => {
    const alerts = app!.get(AlertEmailService);
    await alerts.sweep(new Date(at('10:06:30')));
    await waitForSent(4);

    const owner = sent.filter((e) => e.to === ownerEmail);
    const problem = owner.find((e) => e.eventType === 'owner.alert')!;
    expect(problem.subject).toBe('Action needed at Alert Hotel: 2 problems');
    expect(problem.text).toContain('11:01 · Booking ALERT-1: Clock did not confirm the booking');
    expect(problem.text).toContain('Clock sync needs a check: Clock room type RT-9 is not mapped');
    expect(problem.text).not.toContain('ALERT-OK');
    expect(problem.text).not.toContain('Refund');
    const refund = owner.find((e) => e.eventType === 'owner.refund_alert')!;
    expect(refund.subject).toBe('Alert Hotel: refund of 40.00 EUR for booking ALERT-2');

    const platform = sent.filter((e) => e.to === opsEmail);
    const alert = platform.find((e) => e.eventType === 'platform.alert')!;
    expect(alert.text).toContain('New hotel signed up: Alert Group');
    expect(alert.text).toContain(
      'Alert Group / Alert Hotel: Booking ALERT-1: Clock did not confirm the booking',
    );
    expect(alert.text).toContain(
      'email "booking.payment_confirmation" BOUNCED: mailbox does not exist',
    );
    expect(alert.text).not.toContain('Refund');
    expect(alert.text).not.toContain('guest@example.test');
    // 11:06 in Tirane: yesterday's platform summary goes out too.
    const summary = platform.find((e) => e.eventType === 'platform.daily_summary')!;
    expect(summary.subject).toContain('MUST daily summary for Tuesday, 31 December 2030');

    // The next sweeps re-check the same windows and send nothing new.
    const count = sent.length;
    await alerts.sweep(new Date(at('10:07:30')));
    await alerts.sweep(new Date(at('10:11:30')));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent.length).toBe(count);

    // The owner switches problem alerts off: the system owner still hears about it.
    await request(app!.getHttpServer())
      .put(`/tenants/${tenantId}/properties/${propertyId}/notification-settings/owner_alerts`)
      .set('Cookie', cookie)
      .send({ guestEnabled: false, staffEnabled: false, customStaffRecipients: false, rules: [] })
      .expect(200);
    await book('ALERT-3', 'PMS_REJECTED', at('10:12:00'));
    await alerts.sweep(new Date(at('10:16:30')));
    await waitForSent(count + 1);
    const later = sent.slice(count);
    expect(later.map((e) => e.to)).toEqual([opsEmail]);
    expect(later[0]!.subject).toBe(
      'MUST alert: Alert Group / Alert Hotel: Booking ALERT-3: Clock rejected the booking',
    );
  });
});
