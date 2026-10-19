import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderedEmailCommand } from '@must/domain-contracts';

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
      'booking_cancelled',
      'refund_processed',
      'pre_arrival',
      'booking_changed',
      'payment_not_completed',
      'post_stay',
    ]) {
      const endpoint = `${base}/email-template-versions/${key}`;
      const wording = {
        subject: 'Pershendetje {guest_name}',
        body:
          '{hotel_name}: {booking_reference}' +
          (key === 'booking_confirmed' ? ' {payment_note}' : '') +
          (key === 'refund_processed' ? ' {refund_amount}' : ''),
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
});
