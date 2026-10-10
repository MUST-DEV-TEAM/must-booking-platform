import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderedEmailCommand } from '@must/domain-contracts';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PaymentNotificationService } from '../src/mail/payment-notification.service';
import { ScheduledEmailService } from '../src/mail/scheduled-email.service';
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
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
      .send(draft)
      .expect(200);
    expect(test.body).toEqual({ sentTo: ownerEmail });
    await waitFor(() => rendered.length > 0);
    expect(rendered[0]).toMatchObject({
      to: ownerEmail,
      subject: '[Test] Almost time, Ana Smith!',
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
});
