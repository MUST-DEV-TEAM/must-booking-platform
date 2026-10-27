import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RenderedEmailCommand } from '@must/domain-contracts';

import { EmailMessageArchiveService } from '../src/mail/email-message-archive.service';
import { ResendMailProvider } from '../src/mail/resend-mail.provider';
import { withMailAttempt } from '../src/mail/mail-attempt-context';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { EmailActivityService } from '../src/tenancy/email-activity.service';
import { ResendWebhookService } from '../src/mail/resend-webhook.service';
import { MailDeliveryError } from '../src/mail/mail-delivery-error';
import { isolatedMailDelivery } from './helpers/isolated-mail-delivery';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PaymentNotificationService } from '../src/mail/payment-notification.service';
import { ScheduledEmailService } from '../src/mail/scheduled-email.service';
import { withoutExternalWorkers } from './helpers/without-external-workers';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('email templates (a property’s own wording for guest emails)', () => {
  let app: INestApplication | undefined;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let cookie = '';
  let verificationToken = '';
  const ownerEmail = `templates-owner-${randomUUID()}@example.test`;
  const rendered: RenderedEmailCommand[] = [];
  let failRendered = false;
  const confirmations: Array<Parameters<MailProvider['sendPaymentConfirmationEmail']>[0]> = [];
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail(command) {
      confirmations.push(command);
    },
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
    async sendRenderedEmail(command) {
      rendered.push(command);
      if (failRendered) throw new MailDeliveryError('Test provider rejected this message.', false);
    },
  };

  async function waitFor(check: () => boolean) {
    for (let i = 0; i < 100 && !check(); i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
  }

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(MailDeliveryService)
      .useFactory(isolatedMailDelivery);
    const moduleRef = await withoutExternalWorkers(moduleBuilder).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Template Hotel',
        propertyName: 'Villa <Mare>',
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
  });

  afterAll(async () => {
    if (tenantId) {
      await admin.$executeRaw`DELETE FROM email_messages WHERE tenant_id = ${tenantId}::uuid`;
      await cleanupTenant(admin, tenantId);
    }
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  const url = () => `/tenants/${tenantId}/properties/${propertyId}/email-templates`;

  it('lists the defaults, validates, saves, previews safely, sends a test and resets', async () => {
    const http = () => request(app!.getHttpServer());
    const list = await http().get(url()).set('Cookie', cookie).expect(200);
    expect(list.body.map((t: { key: string }) => t.key)).toEqual([
      'booking_confirmed',
      'booking_cancelled',
      'refund_processed',
      'pre_arrival',
      'booking_changed',
      'payment_not_completed',
      'post_stay',
      'booking_confirmed_pay_at_hotel',
      'payment_pending',
      'payment_reminder',
      'payment_link_expiring',
      'payment_received',
      'payment_failed',
      'check_in_day',
      'no_show_notice',
      'staff_new_booking',
      'staff_booking_changed',
      'staff_booking_cancelled',
      'staff_payment_received',
      'staff_payment_failed',
      'staff_refund_processed',
      'owner_alerts',
      'owner_daily_summary',
      'owner_weekly_summary',
      'staff_invitation',
      'staff_account_created',
    ]);
    expect(list.body[3]).toMatchObject({
      key: 'pre_arrival',
      custom: false,
      language: 'en',
      subject: 'See you soon at {hotel_name} — {check_in}',
    });

    await http()
      .put(`${url()}/nope`)
      .set('Cookie', cookie)
      .send({ subject: 'a', body: 'b' })
      .expect(404);
    const unknown = await http()
      .put(`${url()}/pre_arrival`)
      .set('Cookie', cookie)
      .send({ subject: 'Hi {guest_name}', body: 'Your code is {door_code}.' })
      .expect(400);
    expect(unknown.body.message).toContain('{door_code}');
    await http()
      .put(`${url()}/pre_arrival`)
      .set('Cookie', cookie)
      .send({ subject: '', body: 'x' })
      .expect(400);

    const draft = {
      subject: 'Almost time, {guest_name}!',
      body: 'Dear {guest_name},\n\nyour {room} is ready on {check_in}. <script>alert(1)</script>',
    };
    const preview = await http()
      .post(`${url()}/pre_arrival/preview`)
      .set('Cookie', cookie)
      .send(draft)
      .expect(200);
    expect(preview.body.subject).toBe('Almost time, Ana Smith!');
    expect(preview.body.html).toContain('Dear Ana Smith,');
    expect(preview.body.html).toContain('&lt;script&gt;');
    expect(preview.body.html).not.toContain('<script>');
    expect(preview.body.text).toContain(
      'your Double Room with Sea View is ready on Tuesday, 14 July 2026.',
    );

    const test = await http()
      .post(`${url()}/pre_arrival/test`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...draft, version: 0, reason: 'Check the wording' })
      .expect(200);
    expect(test.body).toEqual({ sentTo: ownerEmail });
    await waitFor(() => rendered.length > 0);
    expect(rendered[0]).toMatchObject({
      to: ownerEmail,
      subject: '[TEST] Almost time, Ana Smith!',
      eventType: 'template.test',
    });

    const saved = await http()
      .put(`${url()}/pre_arrival`)
      .set('Cookie', cookie)
      .send(draft)
      .expect(200);
    expect(saved.body).toMatchObject({ custom: true, subject: draft.subject });

    const reset = await http().delete(`${url()}/pre_arrival`).set('Cookie', cookie).expect(200);
    expect(reset.body).toMatchObject({
      custom: false,
      subject: 'See you soon at {hotel_name} — {check_in}',
    });
  });

  it('uses the saved wording in real guest emails, escaping guest data', async () => {
    const http = () => request(app!.getHttpServer());
    await http()
      .put(`${url()}/pre_arrival`)
      .set('Cookie', cookie)
      .send({
        subject: 'Your {nights}-night stay at {hotel_name}',
        body: 'Ciao {guest_name}! See you on {check_in}.',
      })
      .expect(200);
    const roomTypeId = randomUUID();
    const ratePlanId = randomUUID();
    const guestId = randomUUID();
    await admin.$executeRaw`INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy) VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Suite', 2)`;
    await admin.$executeRaw`INSERT INTO rate_plans (id, tenant_id, property_id, name, currency) VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Flexible', 'EUR')`;
    await admin.$executeRaw`INSERT INTO guests (id, tenant_id, email, first_name, last_name) VALUES (${guestId}::uuid, ${tenantId}::uuid, 'eve@example.test', '<b>Eve</b>', 'Guest')`;
    const bookingId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO bookings (id, tenant_id, property_id, room_type_id, guest_id, external_reference,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, adults, children,
        guest_count, created_at, updated_at)
      VALUES (${bookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${guestId}::uuid,
        'TPL-1', 'CONFIRMED'::"BookingStatus", 'PAY_AT_HOTEL'::"BookingPaymentMethod", '2030-08-04'::date,
        '2030-08-06'::date, ${ratePlanId}::uuid, 100::numeric, 2, 0, 2, '2030-07-01T10:00:00Z', '2030-07-01T10:00:00Z')
    `;
    await app!
      .get(ScheduledEmailService)
      .sendPreArrival({ tenantId, propertyId }, 'Europe/Tirane', '2030-08-01');
    await waitFor(() => rendered.some((e) => e.eventType === 'guest.pre_arrival'));
    const reminder = rendered.find((e) => e.eventType === 'guest.pre_arrival')!;
    expect(reminder.subject).toBe('Your 2-night stay at Villa <Mare>');
    expect(reminder.html).toContain(
      'Ciao &lt;b&gt;Eve&lt;/b&gt; Guest! See you on Sunday, 4 August 2030.',
    );
    expect(reminder.html).not.toContain('<b>Eve</b>');
    expect(reminder.text).toContain('Booking reference: TPL-1');

    // A built-in email (booking confirmed) carries the saved wording to the provider.
    await http()
      .put(`${url()}/booking_confirmed`)
      .set('Cookie', cookie)
      .send({
        subject: 'Welcome, {guest_name} — {booking_reference}',
        body: 'Grazie! {payment_note}',
      })
      .expect(200);
    await app!.get(PaymentNotificationService).sendPaymentConfirmationEmailSafely(
      {
        bookingId,
        bookingReference: 'TPL-1',
        paymentId: `pay-${randomUUID()}`,
        to: 'eve@example.test',
        amount: { amount: '100.00', currency: 'EUR' },
        brand: { name: 'Villa <Mare>' },
        paymentMethod: 'pay_at_hotel',
        guest: { name: 'Eve Guest' },
        stay: { startsOn: '2030-08-04', endsOn: '2030-08-06' },
        roomName: 'Suite',
        guestCount: 2,
      },
      { tenantId, propertyId },
    );
    await waitFor(() => confirmations.length > 0);
    expect(confirmations[0]!.template).toMatchObject({
      subject: 'Welcome, Eve Guest — TPL-1',
      text: 'Grazie! Payment will be collected at the hotel on arrival.',
    });
    const [logged] = await admin.$queryRaw<Array<{ subject: string }>>`
      SELECT subject FROM email_messages WHERE tenant_id = ${tenantId}::uuid AND event_type = 'booking.confirmed'
    `;
    expect(logged!.subject).toBe('Welcome, Eve Guest — TPL-1');
  });

  it('refuses other hotels', async () => {
    const otherEmail = `templates-other-${randomUUID()}@example.test`;
    const other = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Other Hotel',
        propertyName: 'Other',
        propertyAddress: '2 Road',
        propertyTimezone: 'Europe/Tirane',
        email: otherEmail,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    try {
      await request(app!.getHttpServer())
        .get(url())
        .set('Cookie', other.headers['set-cookie'][0])
        .expect(403);
    } finally {
      await cleanupTenant(admin, other.body.organization.id);
      await admin.$executeRaw`DELETE FROM users WHERE id = ${other.body.user.id}::uuid`;
    }
  });
  it('keeps drafts out of live mail, serializes actual version races and replays receipts', async () => {
    const endpoint = `${url().replace('email-templates', 'email-template-versions')}/post_stay`;
    const http = () => request(app!.getHttpServer());
    const first = await http().get(endpoint).set('Cookie', cookie).expect(200);
    expect(first.body).toMatchObject({ version: 0, draft: null, history: [] });
    const draft = {
      language: 'en',
      version: 0,
      subject: 'Hello {guest_name}',
      body: '{hotel_name} thanks you. Reference {booking_reference}.',
    };
    const operationKey = randomUUID();
    const results = await Promise.all(
      [1, 2].map(() =>
        http()
          .put(`${endpoint}/draft`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', operationKey)
          .send(draft),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(results[0]!.body).toMatchObject({
      version: 1,
      live: first.body.live,
      draft: { revision: 1, subject: draft.subject },
    });
    const counts = await admin.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='email_template.draft'`;
    expect(Number(counts[0]!.count)).toBe(1);
    await http()
      .put(`${endpoint}/draft`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', operationKey)
      .send({ ...draft, body: 'Changed' })
      .expect(409);
    const races = await Promise.all(
      ['A', 'B'].map((name) =>
        http()
          .put(`${endpoint}/draft`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', randomUUID())
          .send({ ...draft, version: 1, subject: `${name} {guest_name}` }),
      ),
    );
    expect(races.map((result) => result.status).sort()).toEqual([200, 409]);
    const published = await http()
      .post(`${endpoint}/publish`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ language: 'en', version: 2 })
      .expect(201);
    expect(published.body).toMatchObject({ version: 3, draft: null, live: { body: draft.body } });
    const [saved] = await admin.$queryRaw<
      { subject: string }[]
    >`SELECT subject FROM email_templates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND template_key='post_stay' AND language='en'`;
    expect(saved!.subject).toBe(published.body.live.subject);
    const restored = await http()
      .post(`${endpoint}/restore`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 3, language: 'en', revision: 1 })
      .expect(201);
    expect(restored.body).toMatchObject({
      version: 4,
      live: published.body.live,
      draft: { subject: draft.subject, revision: 4 },
    });
    await http()
      .put(`${endpoint}/draft`)
      .set('Cookie', cookie)
      .send({ ...draft, version: 4 })
      .expect(400);
    await http().get(`${endpoint}?language=de`).set('Cookie', cookie).expect(400);
    const sq = await http().get(`${endpoint}?language=sq`).set('Cookie', cookie).expect(200);
    expect(sq.body).toMatchObject({ version: 0, live: null, draft: null });
  });

  it('refuses publication with missing semantic variables and isolates a second property', async () => {
    const endpoint = `${url().replace('email-templates', 'email-template-versions')}/refund_processed`;
    const http = () => request(app!.getHttpServer());
    await http()
      .put(`${endpoint}/draft`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 0, subject: 'Refund', body: 'Hello {guest_name}' })
      .expect(200);
    const invalid = await http()
      .post(`${endpoint}/publish`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 1 })
      .expect(400);
    expect(invalid.body.message).toContain('{refund_amount}');
    const unchanged = await http().get(endpoint).set('Cookie', cookie).expect(200);
    expect(unchanged.body.version).toBe(1);
    await http().get(endpoint.replace(propertyId, randomUUID())).set('Cookie', cookie).expect(403);
    const rls = app!.get(
      (await import('../src/tenancy/tenant-database.service')).TenantDatabaseService,
    );
    const hidden = await rls.withTenantTransaction(
      { tenantId, propertyId: randomUUID() },
      (tx) => tx.$queryRaw<object[]>`SELECT * FROM email_template_heads`,
    );
    expect(hidden).toEqual([]);
    const crossTenant = await rls.withTenantTransaction(
      { tenantId: randomUUID(), propertyId },
      (tx) => tx.$queryRaw<object[]>`SELECT * FROM email_template_heads`,
    );
    expect(crossTenant).toEqual([]);
  });

  it('audits configuration edits, replays identical saves and rejects actual stale races', async () => {
    const base = url().replace('/email-templates', '');
    const http = () => request(app!.getHttpServer());
    const config = await http()
      .get(base + '/email-configuration')
      .set('Cookie', cookie)
      .expect(200);
    const body = {
      version: config.body.version,
      senderName: 'Hotel reservations',
      replyTo: 'team@example.test',
      defaultLanguage: 'en',
    };
    const key = randomUUID();
    const both = await Promise.all(
      [1, 2].map(() =>
        http()
          .put(base + '/email-configuration')
          .set('Cookie', cookie)
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );
    expect(both.map((row) => row.status)).toEqual([200, 200]);
    expect(both[0]!.body).toEqual(both[1]!.body);
    const races = await Promise.all(
      ['A', 'B'].map((name) =>
        http()
          .put(base + '/email-configuration')
          .set('Cookie', cookie)
          .set('Idempotency-Key', randomUUID())
          .send({ ...body, version: both[0]!.body.version, senderName: name }),
      ),
    );
    expect(races.map((row) => row.status).sort()).toEqual([200, 409]);
    const now = await http()
      .get(base + '/email-configuration')
      .set('Cookie', cookie)
      .expect(200);
    await http()
      .put(base + '/email-configuration')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, version: now.body.version, defaultLanguage: 'sq' })
      .expect(400);
    await http()
      .put(base + '/email-configuration')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, version: now.body.version, replyTo: 'invalid\nBcc: attacker@example.test' })
      .expect(400);
    await http()
      .put(base + '/email-configuration/topics/post_stay')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        version: now.body.version,
        guestEnabled: false,
        customStaffRecipients: false,
        rules: [],
        daysOffset: 2,
      })
      .expect(200);
    await http()
      .put(base + '/email-configuration/review-links')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: now.body.version, links: {} })
      .expect(409);
    const readiness = await http().get(url()).set('Cookie', cookie).expect(200);
    expect(readiness.body.find((row: { key: string }) => row.key === 'post_stay').enabled).toBe(
      false,
    );
    const overview = await http()
      .get(base + '/email-activity/overview')
      .set('Cookie', cookie)
      .expect(200);
    expect(overview.body).toMatchObject({
      testTrafficExcluded: true,
      domainAuthentication: 'UNKNOWN',
    });
  });

  it('limits audited test requests, ignores supplied guest addresses and safely replays a lost response', async () => {
    const http = () => request(app!.getHttpServer());
    const base = url().replace('/email-templates', '');
    const current = await http()
      .get(`${base}/email-template-versions/pre_arrival`)
      .set('Cookie', cookie)
      .expect(200);
    const key = randomUUID(),
      body = {
        version: current.body.version,
        reason: 'Review safe wording',
        to: 'never-send-to-guest@example.test',
      };
    const before = rendered.length;
    const replies = await Promise.all(
      [1, 2].map(() =>
        http()
          .post(`${url()}/pre_arrival/test`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );
    expect(replies.map((row) => row.status)).toEqual([200, 200]);
    await waitFor(() => rendered.length > before);
    expect(rendered.slice(before)).toHaveLength(1);
    expect(rendered.at(-1)).toMatchObject({ to: ownerEmail, eventType: 'template.test' });
    expect(rendered.at(-1)!.subject).toMatch(/^\[TEST\]/);
    for (let i = 0; i < 3; i++)
      await http()
        .post(`${url()}/pre_arrival/test`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(200);
    await http()
      .post(`${url()}/pre_arrival/test`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(429);
    await http()
      .post(`${url()}/pre_arrival/test`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 0, reason: '' })
      .expect(400);
    const log = await http()
      .get(base + '/email-activity?pageSize=100')
      .set('Cookie', cookie)
      .expect(200);
    expect(
      log.body.items.some((row: { eventType: string }) => row.eventType === 'template.test'),
    ).toBe(true);
  });

  it('suppresses hard bounces, clears with concurrency protection and ignores an old event replay', async () => {
    const recipient = 'bounced@example.test';
    const providerId = randomUUID();
    const messageId = randomUUID();
    const c = { tenantId, propertyId };
    await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,idempotency_key,status,provider_message_id) VALUES(${messageId}::uuid,${tenantId}::uuid,${propertyId}::uuid,'guest.post_stay',${recipient},'Original message',${randomUUID()},'SENT',${providerId})`;
    const webhook = app!.get(ResendWebhookService);
    const event = {
      type: 'email.bounced',
      data: {
        email_id: providerId,
        bounce: { type: 'Permanent', message: 'Mailbox does not exist' },
      },
    };
    await webhook.apply(event);
    const base = url().replace('/email-templates', '');
    const http = () => request(app!.getHttpServer());
    const list = await http()
      .get(base + '/email-suppressions')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ recipient, active: true, reason: 'hard_bounce', version: 1 }),
    ]);
    const deliveredBefore = rendered.length;
    await app!.get(MailDeliveryService).dispatch(
      'rendered',
      {
        to: recipient,
        subject: 'Suppressed followup',
        html: '<p>Safe</p>',
        text: 'Safe',
        eventType: 'guest.post_stay',
        idempotencyKey: randomUUID(),
        bookingId: null,
      },
      c,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(rendered.length).toBe(deliveredBefore);
    const suppressed = await admin.$queryRaw<
      { status: string }[]
    >`SELECT status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND subject='Suppressed followup'`;
    expect(suppressed[0]!.status).toBe('SUPPRESSED');
    const key = randomUUID(),
      body = { recipient, version: 1, reason: 'Mailbox issue resolved with owner' };
    const both = await Promise.all(
      [1, 2].map(() =>
        http()
          .post(base + '/email-suppressions/clear')
          .set('Cookie', cookie)
          .set('Idempotency-Key', key)
          .send(body),
      ),
    );
    expect(both.map((row) => row.status)).toEqual([201, 201]);
    expect(both[0]!.body).toEqual(both[1]!.body);
    await http()
      .post(base + '/email-suppressions/clear')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(409);
    await webhook.apply(event);
    const cleared = await http()
      .get(base + '/email-suppressions')
      .set('Cookie', cookie)
      .expect(200);
    expect(cleared.body).toEqual([]);
    const activations = await admin.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='email.suppression.activated' AND target_id=${recipient}`;
    expect(Number(activations[0]!.count)).toBe(1);
  });

  it('retries the original approved command once under concurrent identical requests', async () => {
    const base = url().replace('/email-templates', '');
    const http = () => request(app!.getHttpServer());
    const operation = randomUUID();
    const recipient = 'retry@example.test';
    failRendered = true;
    await app!.get(MailDeliveryService).dispatch(
      'rendered',
      {
        to: recipient,
        subject: 'Approved original',
        html: '<p>Original</p>',
        text: 'Original',
        eventType: 'guest.post_stay',
        idempotencyKey: operation,
        bookingId: null,
      },
      { tenantId, propertyId },
    );
    let id = '';
    for (let i = 0; i < 100; i++) {
      const rows = await admin.$queryRaw<
        { id: string; status: string }[]
      >`SELECT id,status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${operation}`;
      if (rows[0]?.status === 'FAILED') {
        id = rows[0].id;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(id).not.toBe('');
    failRendered = false;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const detail = await http()
      .get(base + '/email-activity/' + id)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.canResend).toBe(true);
    const key = randomUUID(),
      before = rendered.length;
    const responses = await Promise.all(
      [1, 2].map(() =>
        http()
          .post(base + '/email-activity/' + id + '/retry')
          .set('Cookie', cookie)
          .set('Idempotency-Key', key)
          .send({ version: detail.body.version, reason: 'Retry recovered delivery' }),
      ),
    );
    expect(responses.map((row) => row.status)).toEqual([200, 200]);
    expect(responses[0]!.body).toEqual(responses[1]!.body);
    await waitFor(() => rendered.length > before);
    expect(rendered.slice(before)).toHaveLength(1);
    expect(rendered.at(-1)).toMatchObject({
      to: recipient,
      subject: 'Approved original',
      text: 'Original',
    });
    await http()
      .post(base + '/email-activity/' + id + '/retry')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: detail.body.version, reason: 'Retry recovered delivery' })
      .expect(409);
    const audits = await admin.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_id=${id} AND action='email.retry.requested'`;
    expect(Number(audits[0]!.count)).toBe(1);
  });

  it('selects published Albanian wording only after complete coverage, with safe English fallback', async () => {
    const base = url().replace('/email-templates', '');
    const http = () => request(app!.getHttpServer());
    for (const key of [
      'booking_confirmed',
      'booking_confirmed_pay_at_hotel',
      'booking_cancelled',
      'refund_processed',
      'pre_arrival',
      'booking_changed',
      'payment_not_completed',
      'post_stay',
      'payment_pending',
      'payment_reminder',
      'payment_link_expiring',
      'payment_received',
      'check_in_day',
      'no_show_notice',
    ]) {
      const endpoint = `${base}/email-template-versions/${key}`;
      const wording = {
        subject: 'Pershendetje {guest_name}',
        body:
          '{hotel_name}: {booking_reference}' +
          (['booking_confirmed', 'booking_confirmed_pay_at_hotel'].includes(key)
            ? ' {payment_note}'
            : '') +
          (key === 'refund_processed' ? ' {refund_amount}' : '') +
          (['payment_pending', 'payment_reminder', 'payment_link_expiring'].includes(key)
            ? ' {payment_link}'
            : '') +
          (key === 'payment_received' ? ' {payment_amount}' : ''),
      };
      await http()
        .put(endpoint + '/draft')
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ ...wording, language: 'sq', version: 0 })
        .expect(200);
      await http()
        .post(endpoint + '/publish')
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ language: 'sq', version: 1 })
        .expect(201);
    }
    const config = await http()
      .get(base + '/email-configuration')
      .set('Cookie', cookie)
      .expect(200);
    await http()
      .put(base + '/email-configuration')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        version: config.body.version,
        senderName: null,
        replyTo: null,
        defaultLanguage: 'sq',
      })
      .expect(200);
    const preview = await http()
      .post(url() + '/pre_arrival/preview')
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    expect(preview.body.subject).toBe('Pershendetje Ana Smith');
    await expect(
      admin.$executeRaw`UPDATE email_template_revisions SET subject='Mutated' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND template_key='pre_arrival' AND language='sq' AND revision=1`,
    ).rejects.toThrow('Email revisions are immutable');
    const db = app!.get(TenantDatabaseService);
    const { savedTemplate } = await import('../src/mail/email-templates');
    await admin.$executeRaw`DELETE FROM email_templates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND template_key='pre_arrival' AND language='sq'`;
    const fallback = await db.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      savedTemplate(tx, { tenantId, propertyId }, 'pre_arrival'),
    );
    expect(fallback?.subject).toBe('Your {nights}-night stay at {hotel_name}');
  });

  it('enforces the property hourly cap under real concurrent queued sends and reuses retry slots', async () => {
    const isolatedProperty = randomUUID(),
      prefix = randomUUID(),
      service = app!.get(MailDeliveryService),
      oldPolicy = service.retryPolicy,
      oldCap = process.env.EMAIL_PROPERTY_HOURLY_CAP;
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug) VALUES(${isolatedProperty}::uuid,${tenantId}::uuid,'Cap test',${isolatedProperty})`;
    process.env.EMAIL_PROPERTY_HOURLY_CAP = '2';
    service.retryPolicy = { attempts: 1, backoffMs: 5 };
    const commands = [0, 1, 2].map((index) => ({
      to: `cap-${index}@example.test`,
      subject: `Cap ${prefix} ${index}`,
      html: '<p>Cap test</p>',
      text: 'Cap test',
      eventType: 'guest.post_stay',
      idempotencyKey: `${prefix}-${index}`,
      bookingId: null,
    }));
    try {
      await Promise.all(
        commands.map((command) =>
          service.dispatch('rendered', command, { tenantId, propertyId: isolatedProperty }),
        ),
      );
      let rows: { id: string; status: string; key: string }[] = [];
      for (let i = 0; i < 100; i++) {
        rows =
          await admin.$queryRaw`SELECT id,status::text AS status,idempotency_key AS key FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${isolatedProperty}::uuid`;
        if (rows.length === 3 && rows.every((row) => row.status !== 'QUEUED')) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(rows.filter((row) => row.status === 'SENT')).toHaveLength(2);
      expect(rows.filter((row) => row.status === 'FAILED')).toHaveLength(1);
      const slots = await admin.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM email_delivery_slots WHERE tenant_id=${tenantId}::uuid AND property_id=${isolatedProperty}::uuid`;
      expect(Number(slots[0]!.count)).toBe(2);
      const sent = rows.find((row) => row.status === 'SENT')!;
      await service.dispatch(
        'rendered',
        commands.find((command) => command.idempotencyKey === sent.key)!,
        { tenantId, propertyId: isolatedProperty },
      );
      await admin.$executeRaw`UPDATE email_delivery_slots SET created_at=now()-interval '26 hours' WHERE tenant_id=${tenantId}::uuid AND property_id=${isolatedProperty}::uuid`;
      const failed = rows.find((row) => row.status === 'FAILED')!;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await service.resend(failed.id, { tenantId, propertyId: isolatedProperty })).toBe(
        'queued',
      );
      let status = 'QUEUED';
      for (let i = 0; i < 100; i++) {
        const current = await admin.$queryRaw<
          { status: string }[]
        >`SELECT status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${isolatedProperty}::uuid AND id=${failed.id}::uuid`;
        status = current[0]!.status;
        if (status === 'SENT') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(status).toBe('SENT');
      const retained = await admin.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM email_delivery_slots WHERE tenant_id=${tenantId}::uuid AND property_id=${isolatedProperty}::uuid`;
      expect(Number(retained[0]!.count)).toBe(1);
    } finally {
      service.retryPolicy = oldPolicy;
      if (oldCap === undefined) delete process.env.EMAIL_PROPERTY_HOURLY_CAP;
      else process.env.EMAIL_PROPERTY_HOURLY_CAP = oldCap;
    }
  });

  it('records production reserved addresses as suppressed without calling the provider', async () => {
    const old = process.env.NODE_ENV,
      operation = randomUUID(),
      before = rendered.length;
    try {
      process.env.NODE_ENV = 'production';
      await app!.get(MailDeliveryService).dispatch(
        'rendered',
        {
          to: 'reserved@example.test',
          subject: 'Production reserved boundary',
          html: '<p>Never send</p>',
          text: 'Never send',
          eventType: 'guest.post_stay',
          idempotencyKey: operation,
          bookingId: null,
        },
        { tenantId, propertyId },
      );
      let status = '';
      for (let i = 0; i < 100; i++) {
        const rows = await admin.$queryRaw<
          { status: string }[]
        >`SELECT status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${operation}`;
        status = rows[0]?.status ?? '';
        if (status === 'SUPPRESSED') break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(status).toBe('SUPPRESSED');
      expect(rendered.length).toBe(before);
    } finally {
      if (old === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = old;
    }
  });

  it('fails closed without settings.manage or verified email, while Clock email settings remain local', async () => {
    const base = url().replace('/email-templates', '');
    const http = () => request(app!.getHttpServer());
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    try {
      for (const path of [
        '/email-template-versions/pre_arrival',
        '/email-configuration',
        '/email-suppressions',
        '/email-activity/overview',
      ])
        await http()
          .get(base + path)
          .set('Cookie', cookie)
          .expect(403);
      await http()
        .put(base + '/email-configuration')
        .set('Cookie', cookie)
        .send({})
        .expect(403);
    } finally {
      await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    }
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    try {
      await http()
        .put(base + '/email-configuration')
        .set('Cookie', cookie)
        .send({})
        .expect(403);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    }
    const connection = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Read-only fixture','not-real-credentials','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(id,tenant_id,property_id,connection_id,kind,enabled) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS',true)`;
    const config = await http()
      .get(base + '/email-configuration')
      .set('Cookie', cookie)
      .expect(200);
    await http()
      .put(base + '/email-configuration')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        version: config.body.version,
        senderName: null,
        replyTo: null,
        defaultLanguage: 'en',
      })
      .expect(200);
  });
  it('computes actionable email health from real scoped outcomes and rolling windows, excluding tests', async () => {
    const property = randomUUID(),
      other = randomUUID(),
      empty = randomUUID();
    for (const id of [property, other, empty])
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${id}::uuid,${tenantId}::uuid,'Health fixture',${id},'Pacific/Kiritimati')`;
    const records = [
      { status: 'QUEUED', days: 8, hours: 0, attempts: 0 },
      { status: 'QUEUED', days: 0, hours: 1, attempts: 0 },
      { status: 'SENT', days: 0, hours: 6, attempts: 1 },
      { status: 'BOUNCED', days: 2, hours: 0, attempts: 1 },
      { status: 'COMPLAINED', days: 6, hours: 0, attempts: 1 },
      { status: 'FAILED', days: 8, hours: 0, attempts: 1 },
    ];
    for (const row of records)
      await admin.$executeRaw`INSERT INTO email_messages(tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key,attempt_count,created_at) VALUES(${tenantId}::uuid,${property}::uuid,'owner.alert','health@example.test','Health fixture',${row.status}::"EmailMessageStatus",${randomUUID()},${row.attempts},now()-make_interval(days=>${row.days}::int,hours=>${row.hours}::int))`;
    for (const [id, event] of [
      [property, 'template.test'],
      [other, 'owner.alert'],
    ])
      await admin.$executeRaw`INSERT INTO email_messages(tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key,attempt_count) VALUES(${tenantId}::uuid,${id}::uuid,${event},'test@example.test','Excluded','FAILED',${randomUUID()},1)`;
    await admin.$executeRaw`INSERT INTO email_suppressions(tenant_id,property_id,recipient,reason,latest_event_at) VALUES(${tenantId}::uuid,${property}::uuid,'suppressed@example.test','hard_bounce',now())`;
    const base = `/tenants/${tenantId}/properties/${property}/email-activity`;
    const result = await request(app!.getHttpServer())
      .get(base + '/overview')
      .set('Cookie', cookie)
      .expect(200);
    expect(result.body).toMatchObject({
      volume24h: 2,
      volume7d: 4,
      attempted7d: 3,
      queued: 2,
      suppressedAddresses: 1,
    });
    expect(result.body.bounceRate).toBeCloseTo(100 / 3);
    expect(result.body.complaintRate).toBeCloseTo(100 / 3);
    expect(result.body.oldestQueued).toBeTruthy();
    expect(result.body.actionNeeded).toHaveLength(3);
    expect(result.body.failingTopics).toEqual([
      { topic: 'owner.alert', label: 'Alert (owner)', count: 2 },
    ]);
    const filtered = await request(app!.getHttpServer())
      .get(base + '?filter=bounced&topic=owner.alert')
      .set('Cookie', cookie)
      .expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].status).toBe('BOUNCED');
    const recent = await request(app!.getHttpServer())
      .get(base + '?hours=24')
      .set('Cookie', cookie)
      .expect(200);
    expect(recent.body.total).toBe(3); // Includes controlled tests in Delivery, but not health.
    await request(app!.getHttpServer())
      .get(base + '?hours=25')
      .set('Cookie', cookie)
      .expect(400);
    const zero = await request(app!.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${empty}/email-activity/overview`)
      .set('Cookie', cookie)
      .expect(200);
    expect(zero.body).toMatchObject({
      volume24h: 0,
      volume7d: 0,
      bounceRate: null,
      complaintRate: null,
      oldestQueued: null,
      suppressedAddresses: 0,
      actionNeeded: [],
      failingTopics: [],
    });
  });
  it('versions inbox preview text, rejects secret-link metadata, and refuses unsupported live triggers', async () => {
    const base = url().replace('/email-templates', ''),
      http = () => request(app!.getHttpServer());
    // A wording with no sending trigger yet (the guest "Payment failed" wording is deliberately not wired).
    const endpoint = base + '/email-template-versions/payment_failed';
    const draft = await http()
      .put(endpoint + '/draft')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        version: 0,
        subject: 'Payment for {guest_name}',
        body: '{guest_name}: {hotel_name}',
        previewText: 'Stay at {hotel_name}',
      })
      .expect(200);
    expect(draft.body.draft.previewText).toBe('Stay at {hotel_name}');
    await http()
      .post(endpoint + '/publish')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: draft.body.version })
      .expect(400);
    await http()
      .post(base + '/email-templates/staff_invitation/preview')
      .set('Cookie', cookie)
      .send({ subject: '{invitation_link}', body: 'Hello {staff_name}' })
      .expect(400);
    const preview = await http()
      .post(base + '/email-templates/pre_arrival/preview')
      .set('Cookie', cookie)
      .send({
        subject: 'Stay {hotel_name}',
        body: '{stay_range}\n\n{stay_nights}',
        previewText: 'For {guest_name}',
        language: 'sq',
      })
      .expect(200);
    expect(preview.body.html).toContain('korrik');
    expect(preview.body.text).toContain('100.00 EUR');
    expect(preview.body.text).toContain('120.00 EUR');
    expect(preview.body.html).toContain('For Ana Smith');
    await http()
      .post(base + '/email-templates/pre_arrival/preview')
      .set('Cookie', cookie)
      .send({ subject: 'Hello', body: '{unknown_field}', previewText: '' })
      .expect(400);
  });
  it('filters and sorts the whole delivery log with property-local DST edges and isolated topic choices', async () => {
    const property = randomUUID(),
      other = randomUUID();
    for (const id of [property, other])
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${id}::uuid,${tenantId}::uuid,'Directory fixture',${id},'Europe/Tirane')`;
    const dates = [
      '2026-03-28T22:59:59Z',
      '2026-03-28T23:00:00Z',
      '2026-03-29T01:00:00Z',
      '2026-03-29T21:59:59Z',
      '2026-03-29T22:00:00Z',
    ];
    const ids: string[] = [];
    for (let i = 0; i < dates.length; i++) {
      const id = randomUUID();
      ids.push(id);
      await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key,created_at) VALUES(${id}::uuid,${tenantId}::uuid,${property}::uuid,'owner.alert',${`staff${i}@example.test`},${`Literal_% ${i}`},'FAILED',${randomUUID()},${new Date(dates[i])})`;
    }
    await admin.$executeRaw`INSERT INTO email_messages(tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key,created_at) VALUES(${tenantId}::uuid,${other}::uuid,'foreign.topic','foreign@example.test','Never included','FAILED',${randomUUID()},'2026-03-29T12:00:00Z'::timestamptz)`;
    const base = `/tenants/${tenantId}/properties/${property}/email-activity`;
    const get = (query: string) =>
      request(app!.getHttpServer())
        .get(base + query)
        .set('Cookie', cookie);
    const result = await get(
      '?from=2026-03-29&to=2026-03-29&pageSize=1&sort=recipient&direction=asc',
    ).expect(200);
    expect(result.body.total).toBe(3);
    expect(result.body.timezone).toBe('Europe/Tirane');
    expect(result.body.items.map((r: { id: string }) => r.id)).toEqual([ids[1]]);
    expect(result.body.topics).toEqual([{ value: 'owner.alert', label: 'Alert (owner)' }]);
    const next = await get(
      '?from=2026-03-29&to=2026-03-29&pageSize=1&page=3&sort=recipient&direction=asc',
    ).expect(200);
    expect(next.body.items.map((r: { id: string }) => r.id)).toEqual([ids[3]]);
    const descending = await get(
      '?from=2026-03-29&to=2026-03-29&sort=recipient&direction=desc&status=FAILED&recipient=STAFF&topic=owner.alert&search=Literal_%25',
    ).expect(200);
    expect(descending.body.items.map((r: { id: string }) => r.id)).toEqual([
      ids[3],
      ids[2],
      ids[1],
    ]);
    expect((await get('?search=%25').expect(200)).body.total).toBe(5); // Literal percent, not SQL wildcard.
    expect((await get('?search=NoMatchingTerm').expect(200)).body.total).toBe(0);
    expect((await get('?filter=problems&status=SENT').expect(200)).body.total).toBe(0);
    for (const query of [
      '?from=2026-02-29',
      '?sort=not-a-column',
      '?direction=SIDEWAYS',
      '?from=2024-01-01&to=2025-01-01',
    ])
      await get(query).expect(400);
    await request(app!.getHttpServer())
      .get(`/tenants/${randomUUID()}/properties/${property}/email-activity`)
      .set('Cookie', cookie)
      .expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    try {
      await get('').expect(403);
    } finally {
      await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    }
    await app!
      .get(TenantDatabaseService)
      .withTenantTransaction({ tenantId: randomUUID(), propertyId: property }, async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${property}::uuid`;
        expect(rows).toEqual([]);
      });
  });
  it('records actual delivery transitions atomically, ignores no-op webhooks, and never invents earlier history', async () => {
    const id = randomUUID(),
      providerId = randomUUID();
    await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,'owner.alert','ledger@example.test','Observed delivery','QUEUED',${randomUUID()})`;
    const database = app!.get(TenantDatabaseService),
      context = { tenantId, propertyId };
    await database.withTenantTransaction(context, async (tx) => {
      await tx.$executeRaw`UPDATE email_messages SET attempt_count=attempt_count+1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
      await tx.$executeRaw`UPDATE email_messages SET last_error='Do not retain secret-token=fixture' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
      await tx.$executeRaw`UPDATE email_messages SET status='SENT',provider='resend',provider_message_id=${providerId},sent_at=now() WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    });
    const webhook = app!.get(ResendWebhookService);
    const delivered = {
      type: 'email.delivered',
      data: { email_id: providerId },
      created_at: '2026-10-19T10:00:00Z',
    };
    expect(await webhook.apply(delivered)).toBe('applied');
    expect(await webhook.apply(delivered)).toBe('ignored');
    const read = () =>
      request(app!.getHttpServer())
        .get(url().replace('/email-templates', '/email-activity/') + id)
        .set('Cookie', cookie);
    const detail = await read().expect(200);
    expect(detail.body.timeline.map((e: { kind: string }) => e.kind)).toEqual([
      'QUEUED',
      'ATTEMPT',
      'RETRY_WAIT',
      'SENT',
      'DELIVERED',
    ]);
    expect(detail.body).toMatchObject({
      timelineHasCreation: true,
      timelineTruncated: false,
      provider: 'resend',
      providerMessageId: providerId,
    });
    expect(JSON.stringify(detail.body.timeline)).not.toContain('secret-token');
    await expect(
      database.withTenantTransaction(context, async (tx) => {
        await tx.$executeRaw`UPDATE email_messages SET status='COMPLAINED' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
        throw new Error('Rollback the whole observation');
      }),
    ).rejects.toThrow('Rollback');
    expect((await read().expect(200)).body.timeline).toHaveLength(5);
    await database.withTenantTransaction({ tenantId, propertyId: randomUUID() }, async (tx) => {
      expect(
        await tx.$queryRaw`SELECT id FROM email_delivery_events WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${id}::uuid`,
      ).toEqual([]);
    });
    // A retained old row with no observations must not get a fabricated queued/sent timeline.
    await admin.$executeRaw`DELETE FROM email_delivery_events WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${id}::uuid`;
    const old = await read().expect(200);
    expect(old.body).toMatchObject({ timeline: [], timelineHasCreation: false });
  });
  it('bulk retry is atomic, versioned and idempotent under concurrent requests and a lost enqueue', async () => {
    const dispatch = app!.get(MailDeliveryService),
      base = url().replace('/email-templates', '/email-activity');
    const subjects = [`Bulk A ${randomUUID()}`, `Bulk B ${randomUUID()}`];
    failRendered = true;
    try {
      for (const subject of subjects)
        await dispatch.dispatch(
          'rendered',
          {
            to: 'bulk@example.test',
            subject,
            html: '<p>Original approved content</p>',
            text: 'Original approved content',
            eventType: 'owner.alert',
            idempotencyKey: randomUUID(),
            bookingId: null,
          },
          { tenantId, propertyId },
        );
      await waitFor(() =>
        subjects.every((subject) => rendered.some((command) => command.subject === subject)),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      failRendered = false;
    }
    const rows = await admin.$queryRaw<
      { id: string; version: number; status: string }[]
    >`SELECT id,workspace_version AS version,status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND subject=ANY(${subjects}::text[]) ORDER BY id`;
    expect(rows.map((row) => row.status)).toEqual(['FAILED', 'FAILED']);
    const messages = rows.map(({ id, version }) => ({ id, version }));
    const post = (selection: typeof messages, key = randomUUID()) =>
      request(app!.getHttpServer())
        .post(base + '/bulk-retry')
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send({ messages: selection, reason: 'Retry after provider recovery' });
    await post([messages[0], { id: randomUUID(), version: 1 }]).expect(404);
    await post([messages[0], { ...messages[1], version: 999 }]).expect(409);
    await post([messages[0], messages[0]]).expect(400);
    expect(
      (
        await admin.$queryRaw<
          { status: string }[]
        >`SELECT status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=ANY(${rows.map((r) => r.id)}::uuid[])`
      ).map((r) => r.status),
    ).toEqual(['FAILED', 'FAILED']);
    const key = randomUUID(),
      enqueue = vi
        .spyOn(dispatch, 'enqueueApproved')
        .mockRejectedValueOnce(new Error('Test queue interruption'));
    try {
      await post(messages, key).expect(503);
    } finally {
      enqueue.mockRestore();
    }
    const receipt = await admin.$queryRaw<
      { response: unknown }[]
    >`SELECT response FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${key}`;
    expect(receipt[0].response).toEqual({
      status: 'QUEUED',
      messages: messages.map((m) => ({ id: m.id, version: m.version + 1 })),
    });
    const before = rendered.filter((command) => subjects.includes(command.subject)).length;
    const responses = await Promise.all([post(messages, key), post([...messages].reverse(), key)]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
    await waitFor(
      () => rendered.filter((command) => subjects.includes(command.subject)).length >= before + 2,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(rendered.filter((command) => subjects.includes(command.subject)).length).toBe(
      before + 2,
    );
    await post(messages, key).expect(200);
    await post(messages).expect(409);
    const audits = await admin.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='email.bulk_retry.requested'`;
    expect(audits[0].count).toBe(1);
  });
  it('exports exact filtered delivery evidence with audited idempotency, atomic selection, BOM and formula protection', async () => {
    const property = randomUUID(),
      other = randomUUID();
    for (const id of [property, other])
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${id}::uuid,${tenantId}::uuid,'Export fixture',${id},'Pacific/Kiritimati')`;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < ids.length; i++)
      await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key) VALUES(${ids[i]}::uuid,${tenantId}::uuid,${i === 2 ? other : property}::uuid,'owner.alert','export@example.test',${' \t=CSV-fixture ' + i},'FAILED',${randomUUID()})`;
    const base = `/tenants/${tenantId}/properties/${property}/email-activity`,
      http = () => request(app!.getHttpServer());
    const page = await http()
      .get(base + '?search=CSV-fixture&sort=subject&direction=asc&pageSize=1')
      .set('Cookie', cookie)
      .expect(200);
    expect(page.body).toMatchObject({ total: 2, exportVersion: 0, timezone: 'Pacific/Kiritimati' });
    const body = {
      version: page.body.exportVersion,
      through: page.body.observedAt,
      filters: { search: 'CSV-fixture', sort: 'subject', direction: 'asc' },
      reason: 'Review delivery failures',
    };
    const key = randomUUID(),
      post = (input: object = body, operation = key) =>
        http()
          .post(base + '/export')
          .set('Cookie', cookie)
          .set('Idempotency-Key', operation)
          .send(input);
    await post({ ...body, ids: [ids[0], ids[2]] }).expect(404);
    const exported = await Promise.all([post(), post()]);
    expect(exported.map((r) => r.status)).toEqual([200, 200]);
    expect(exported[0].body).toEqual(exported[1].body);
    expect(exported[0].body).toMatchObject({ count: 2, version: 1 });
    const csv = exported[0].body.csv as string;
    expect([...Buffer.from(csv).subarray(0, 3)]).toEqual([239, 187, 191]);
    expect(csv).toContain('"\' \t=CSV-fixture');
    expect(csv).not.toContain(ids[2]);
    expect(csv).not.toContain('CSV-fixture 2');
    await post({ ...body, reason: 'Different intent' }).expect(409);
    await post(body, randomUUID()).expect(409);
    const selected = await post({ ...body, version: 1, ids: [ids[0]] }, randomUUID()).expect(200);
    expect(selected.body.count).toBe(1);
    const rows = await admin.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${property}::uuid AND action='email.delivery.exported'`;
    expect(rows[0].count).toBe(2);
    const service = app!.get(EmailActivityService);
    await service.cleanupExports(
      { tenantId, propertyId: other },
      new Date(Date.now() + 25 * 3600000),
    );
    expect(
      (
        await admin.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM email_delivery_exports WHERE tenant_id=${tenantId}::uuid AND property_id=${property}::uuid`
      )[0].count,
    ).toBe(2);
    await service.cleanupExports(
      { tenantId, propertyId: property },
      new Date(Date.now() + 25 * 3600000),
    );
    expect(
      (
        await admin.$queryRaw<
          { count: number }[]
        >`SELECT count(*)::int AS count FROM email_delivery_exports WHERE tenant_id=${tenantId}::uuid AND property_id=${property}::uuid`
      )[0].count,
    ).toBe(0);
    await post({ ...body, through: '2020-01-01T00:00:00Z' }, randomUUID()).expect(400);
    await post(
      { ...body, through: new Date(Date.now() + 60000).toISOString() },
      randomUUID(),
    ).expect(400);
  });
  it('rejects oversized delivery exports without an audit, version change or partial receipt', async () => {
    const property = randomUUID();
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${property}::uuid,${tenantId}::uuid,'Export limits',${property},'Europe/Tirane')`;
    await admin.$executeRaw`INSERT INTO email_messages(tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key) SELECT ${tenantId}::uuid,${property}::uuid,'owner.alert','limits@example.test',repeat('x',490),'FAILED',gen_random_uuid()::text FROM generate_series(1,5001)`;
    const base = `/tenants/${tenantId}/properties/${property}/email-activity`,
      http = () => request(app!.getHttpServer());
    const page = await http().get(base).set('Cookie', cookie).expect(200);
    const body = {
      version: 0,
      through: page.body.observedAt,
      filters: {},
      reason: 'Test bounded export',
    };
    const count = await http()
      .post(base + '/export')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(400);
    expect(count.body.message).toContain('5,000');
    await admin.$executeRaw`DELETE FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${property}::uuid AND id IN(SELECT id FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${property}::uuid LIMIT 1)`;
    const size = await http()
      .post(base + '/export')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(400);
    expect(size.body.message).toContain('2 MB');
    const unchanged = await http().get(base).set('Cookie', cookie).expect(200);
    expect(unchanged.body.exportVersion).toBe(0);
    const receipts = await admin.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM email_delivery_exports WHERE tenant_id=${tenantId}::uuid AND property_id=${property}::uuid`;
    expect(receipts[0].count).toBe(0);
  });
  it('retains only an encrypted redacted prepared preview, with exact scope, first-write and expiry protection', async () => {
    const names = ['INTEGRATION_CREDENTIALS_KEY', 'RESEND_API_KEY', 'MAIL_FROM_EMAIL'] as const;
    const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const database = app!.get(TenantDatabaseService),
      archive = app!.get(EmailMessageArchiveService);
    const actual = app!.get(ResendMailProvider),
      direct = new MailDeliveryService(database, actual);
    const operation = randomUUID(),
      other = randomUUID(),
      otherProperty = randomUUID();
    try {
      process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64');
      process.env.RESEND_API_KEY = 'mock-archive-transport';
      process.env.MAIL_FROM_EMAIL = 'MUST <sender@example.test>';
      const transport = vi.fn(async () => Response.json({ id: randomUUID() }));
      vi.stubGlobal('fetch', transport);
      await direct.dispatch(
        'rendered',
        {
          to: 'archive@example.test',
          subject: 'Prepared message',
          html: '<p>Recorded stay 120.00 EUR</p><a href="https://hotel.test/cancel?token=guest-action-example">Manage stay</a>',
          text: 'Recorded stay 120.00 EUR https://hotel.test/cancel?token=guest-action-example',
          eventType: 'owner.alert',
          idempotencyKey: operation,
          bookingId: null,
        },
        { tenantId, propertyId },
      );
      const records = await admin.$queryRaw<
        { id: string; status: string }[]
      >`SELECT id,status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${operation}`;
      expect(records[0].status).toBe('SENT');
      expect(transport).toHaveBeenCalledTimes(1);
      const messageId = records[0].id;
      const stored = await admin.$queryRaw<
        { encrypted: string }[]
      >`SELECT encrypted_preview AS encrypted FROM email_message_previews WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${messageId}::uuid`;
      expect(stored[0].encrypted).not.toContain('Recorded stay');
      expect(stored[0].encrypted).not.toContain('guest-action-example');
      const read = await archive.read({ tenantId, propertyId }, messageId);
      expect(read?.text).toBe('Recorded stay 120.00 EUR [link removed]');
      expect(read?.html).not.toContain('href=');
      expect(read!.expiresAt.getTime() - read!.capturedAt.getTime()).toBeLessThanOrEqual(
        7 * 86400000,
      );
      const detail = await request(app!.getHttpServer())
        .get(url().replace('/email-templates', '/email-activity/') + messageId)
        .set('Cookie', cookie)
        .expect(200);
      expect(detail.body.renderedPreview.text).toBe(read?.text);
      await withMailAttempt({ tenantId, propertyId, messageId, sensitive: false }, () =>
        archive.capture({
          subject: 'Changed later',
          text: 'Do not replace',
          html: '<p>Do not replace</p>',
        }),
      );
      expect((await archive.read({ tenantId, propertyId }, messageId))?.subject).toBe(
        'Prepared message',
      );
      expect(await archive.read({ tenantId, propertyId: otherProperty }, messageId)).toBeNull();
      expect(await archive.read({ tenantId: randomUUID(), propertyId }, messageId)).toBeNull();
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug) VALUES(${otherProperty}::uuid,${tenantId}::uuid,'Other preview hotel',${otherProperty})`;
      await admin.$executeRaw`INSERT INTO email_messages(id,tenant_id,property_id,event_type,recipient_email,subject,idempotency_key) VALUES(${other}::uuid,${tenantId}::uuid,${otherProperty}::uuid,'owner.alert','other@example.test','Other scope',${randomUUID()})`;
      await admin.$executeRaw`INSERT INTO email_message_previews(tenant_id,property_id,message_id,encrypted_preview,expires_at) VALUES(${tenantId}::uuid,${otherProperty}::uuid,${other}::uuid,${stored[0].encrypted},now()+interval '1 day')`;
      expect(await archive.read({ tenantId, propertyId: otherProperty }, other)).toBeNull(); // Authenticated payload cannot be transplanted.
      await admin.$executeRaw`UPDATE email_message_previews SET captured_at=now()-interval '8 days',expires_at=now()-interval '2 days' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND message_id=${messageId}::uuid`;
      expect(await archive.read({ tenantId, propertyId }, messageId)).toBeNull();
      await archive.cleanup({ tenantId, propertyId });
      expect(
        (
          await admin.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM email_message_previews WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`
        )[0].count,
      ).toBe(0);
      expect(
        (
          await admin.$queryRaw<
            { count: number }[]
          >`SELECT count(*)::int AS count FROM email_message_previews WHERE tenant_id=${tenantId}::uuid AND property_id=${otherProperty}::uuid`
        )[0].count,
      ).toBe(1);
      delete process.env.INTEGRATION_CREDENTIALS_KEY;
      const noKey = randomUUID();
      await direct.dispatch(
        'rendered',
        {
          to: 'archive@example.test',
          subject: 'Retention unavailable',
          html: '<p>Still send</p>',
          text: 'Still send',
          eventType: 'owner.alert',
          idempotencyKey: noKey,
          bookingId: null,
        },
        { tenantId, propertyId },
      );
      expect(transport).toHaveBeenCalledTimes(2);
      const sent = await admin.$queryRaw<
        { status: string }[]
      >`SELECT status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${noKey}`;
      expect(sent[0].status).toBe('SENT');
    } finally {
      vi.unstubAllGlobals();
      for (const name of names) {
        if (original[name] === undefined) delete process.env[name];
        else process.env[name] = original[name];
      }
    }
  });
  it('never archives property invitations containing security links', async () => {
    const names = ['INTEGRATION_CREDENTIALS_KEY', 'RESEND_API_KEY', 'MAIL_FROM_EMAIL'] as const,
      original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.INTEGRATION_CREDENTIALS_KEY = Buffer.alloc(32, 8).toString('base64');
      process.env.RESEND_API_KEY = 'mock-security-transport';
      process.env.MAIL_FROM_EMAIL = 'MUST <sender@example.test>';
      const transport = vi.fn(async () => Response.json({ id: randomUUID() }));
      vi.stubGlobal('fetch', transport);
      const direct = new MailDeliveryService(
        app!.get(TenantDatabaseService),
        app!.get(ResendMailProvider),
      );
      const before = await admin.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM email_message_previews WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
      await direct.dispatch(
        'staffInvitation',
        {
          to: 'sensitive-archive@example.test',
          organizationName: 'Test hotel',
          invitedByEmail: 'owner@example.test',
          assignments: [{ propertyName: 'Test hotel', roleTemplateName: 'Receptionist' }],
          invitationUrl: 'http://localhost:3001/accept-invitation?token=' + randomUUID(),
        },
        { tenantId, propertyId },
      );
      expect(transport).toHaveBeenCalledTimes(1);
      const after = await admin.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM email_message_previews WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
      expect(after).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
      for (const name of names) {
        if (original[name] === undefined) delete process.env[name];
        else process.env[name] = original[name];
      }
    }
  });
  it('creates one deliberate copy under concurrent retries and queue interruption, preserving the original content and outcome', async () => {
    const dispatch = app!.get(MailDeliveryService),
      operation = randomUUID(),
      subject = 'Deliberate copy ' + randomUUID();
    const command = {
      to: 'copy@example.test',
      subject,
      html: '<p>Original frozen wording</p>',
      text: 'Original frozen wording',
      eventType: 'owner.alert',
      idempotencyKey: operation,
      bookingId: null,
    };
    await dispatch.dispatch('rendered', command, { tenantId, propertyId });
    let source: { id: string; version: number; status: string } | undefined;
    for (let i = 0; i < 100; i++) {
      source = (
        await admin.$queryRaw<
          { id: string; version: number; status: string }[]
        >`SELECT id,workspace_version AS version,status::text AS status FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${operation}`
      )[0];
      if (
        source?.status === 'SENT' &&
        (await dispatch.retainedCommand(source.id, { tenantId, propertyId }))
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(source?.status).toBe('SENT');
    const id = source!.id,
      version = source!.version,
      key = randomUUID(),
      base = url().replace('/email-templates', '/email-activity');
    const post = (intent = key, current = version) =>
      request(app!.getHttpServer())
        .post(base + '/' + id + '/resend-copy')
        .set('Cookie', cookie)
        .set('Idempotency-Key', intent)
        .send({ version: current, reason: 'Guest requested another copy' });
    const detail = await request(app!.getHttpServer())
      .get(base + '/' + id)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.canSendCopy).toBe(true);
    const auditFailure = vi
      .spyOn(app!.get(AuditLogService), 'recordInTransaction')
      .mockRejectedValueOnce(new Error('Controlled audit rollback'));
    try {
      await post().expect(500);
    } finally {
      auditFailure.mockRestore();
    }
    const untouched = await admin.$queryRaw<
      { version: number; copies: number }[]
    >`SELECT workspace_version AS version,(SELECT count(*)::int FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND resend_of_message_id=${id}::uuid) AS copies FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    expect(untouched[0]).toEqual({ version, copies: 0 });
    const enqueue = vi
      .spyOn(dispatch, 'enqueueApproved')
      .mockRejectedValueOnce(new Error('Controlled queue interruption'));
    try {
      await post().expect(503);
    } finally {
      enqueue.mockRestore();
    }
    const results = await Promise.all([post(), post()]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0].body).toEqual(results[1].body);
    const copyId = results[0].body.messageId;
    expect(copyId).not.toBe(id);
    for (let i = 0; i < 100; i++) {
      if (await dispatch.retainedCommand(copyId, { tenantId, propertyId })) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const retained = await dispatch.retainedCommand(copyId, { tenantId, propertyId });
    expect(retained?.idempotencyKeyOverride).toBe('manual-resend/' + copyId);
    expect(retained?.command).toMatchObject(command);
    expect(rendered.filter((c) => c.subject === subject)).toHaveLength(2);
    const original = await request(app!.getHttpServer())
      .get(base + '/' + id)
      .set('Cookie', cookie)
      .expect(200);
    expect(original.body).toMatchObject({ version: version + 1, status: 'SENT' });
    const copy = await request(app!.getHttpServer())
      .get(base + '/' + copyId)
      .set('Cookie', cookie)
      .expect(200);
    expect(copy.body).toMatchObject({
      resendOfMessageId: id,
      status: 'SENT',
      subject,
      recipient: command.to,
    });
    await post(randomUUID()).expect(409);
    const receipts = await admin.$queryRaw<
      { response: unknown }[]
    >`SELECT response FROM email_workspace_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${key}`;
    expect(receipts[0].response).toEqual(results[0].body);
    expect(JSON.stringify(receipts[0].response)).not.toContain('Original frozen wording');
    await admin.$executeRaw`INSERT INTO email_suppressions(tenant_id,property_id,recipient,reason,latest_event_at) VALUES(${tenantId}::uuid,${propertyId}::uuid,${command.to},'complaint',now())`;
    try {
      await post(randomUUID(), version + 1).expect(409);
    } finally {
      await admin.$executeRaw`DELETE FROM email_suppressions WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND recipient=${command.to}`;
    }
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    try {
      await post().expect(403);
    } finally {
      await admin.$executeRaw`UPDATE users SET email_verified_at=now() WHERE id=${userId}::uuid`;
    }
    const audits = await admin.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_id=${id} AND action='email.copy.requested'`;
    expect(audits[0].count).toBe(1);
  });
  it('does not let deliberate copies bypass the controlled-test recipient and hourly cap', async () => {
    const delivery = app!.get(MailDeliveryService),
      operation = randomUUID();
    await delivery.dispatch(
      'rendered',
      {
        to: ownerEmail,
        subject: 'Controlled sample copy boundary',
        html: '<p>Sample</p>',
        text: 'Sample',
        eventType: 'template.test',
        idempotencyKey: operation,
        bookingId: null,
      },
      { tenantId, propertyId },
    );
    let row: { id: string; version: number } | undefined;
    for (let i = 0; i < 100; i++) {
      row = (
        await admin.$queryRaw<
          { id: string; version: number }[]
        >`SELECT id,workspace_version AS version FROM email_messages WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND idempotency_key=${operation}`
      )[0];
      if (row && (await delivery.retainedCommand(row.id, { tenantId, propertyId }))) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(await delivery.retainedCommand(row!.id, { tenantId, propertyId })).not.toBeNull();
    const base = url().replace('/email-templates', '/email-activity/');
    const detail = await request(app!.getHttpServer())
      .get(base + row!.id)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.canSendCopy).toBe(false);
    const blocked = await request(app!.getHttpServer())
      .post(base + row!.id + '/resend-copy')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: row!.version, reason: 'Try another sample' })
      .expect(409);
    expect(blocked.body.message).toContain('Send controlled test');
  });
});
