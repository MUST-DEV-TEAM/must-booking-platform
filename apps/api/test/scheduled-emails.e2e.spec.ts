import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderedEmailCommand } from '@must/domain-contracts';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
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

describe('scheduled emails (pre-arrival reminder, owner daily summary)', () => {
  let app: INestApplication | undefined;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let cookie = '';
  let verificationToken = '';
  const ownerEmail = `scheduled-owner-${randomUUID()}@example.test`;
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
  // The property's local date for every call below.
  const today = '2030-05-10';

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
        organizationName: 'Scheduled Hotel',
        propertyName: 'Seaside <Hotel>',
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
    await admin.$executeRaw`UPDATE properties SET check_in_time = '14:00', support_email = 'stay@seaside.test' WHERE id = ${propertyId}::uuid`;

    const roomTypeId = randomUUID();
    const ratePlanId = randomUUID();
    await admin.$executeRaw`INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy) VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Sea View', 2)`;
    await admin.$executeRaw`INSERT INTO rate_plans (id, tenant_id, property_id, name, currency) VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Flexible', 'EUR')`;
    const guest = async (first: string, email: string) => {
      const id = randomUUID();
      await admin.$executeRaw`INSERT INTO guests (id, tenant_id, email, first_name, last_name) VALUES (${id}::uuid, ${tenantId}::uuid, ${email}, ${first}, 'Guest')`;
      return id;
    };
    const ada = await guest('Ada', 'ada@example.test');
    const bob = await guest('Bob', 'bob@example.test');
    const clock = await guest('Clara', 'clara@example.test');
    const today2 = await guest('Dana', 'dana@example.test');
    const book = async (o: {
      guestId: string;
      ref: string;
      startsOn: string;
      endsOn: string;
      status?: string;
      method?: string;
      amount?: string;
      order?: string;
      room?: number;
      createdAt?: string;
      updatedAt?: string;
    }) => admin.$executeRaw`
      INSERT INTO bookings (tenant_id, property_id, room_type_id, guest_id, external_reference,
        order_reference, order_room_number, status, payment_method, starts_on, ends_on, rate_plan_id,
        total_amount, adults, children, guest_count, created_at, updated_at)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${o.guestId}::uuid, ${o.ref},
        ${o.order ?? null}, ${o.room ?? null}, ${o.status ?? 'CONFIRMED'}::"BookingStatus",
        ${o.method ?? 'PAY_AT_HOTEL'}::"BookingPaymentMethod", ${o.startsOn}::date, ${o.endsOn}::date,
        ${ratePlanId}::uuid, ${o.amount ?? '100.00'}::numeric, 2, 0, 2,
        ${o.createdAt ?? '2030-04-01T10:00:00Z'}::timestamptz, ${o.updatedAt ?? '2030-04-01T10:00:00Z'}::timestamptz)
    `;
    // Arriving in 3 days: a two-room pay-at-hotel order (one email, total due)...
    await book({
      guestId: ada,
      ref: 'ORD-1-room1',
      order: 'ORD-1',
      room: 1,
      startsOn: '2030-05-13',
      endsOn: '2030-05-15',
      amount: '120.50',
    });
    await book({
      guestId: ada,
      ref: 'ORD-1-room2',
      order: 'ORD-1',
      room: 2,
      startsOn: '2030-05-13',
      endsOn: '2030-05-15',
      amount: '80.00',
    });
    // ...a prepaid single room...
    await book({
      guestId: bob,
      ref: 'BK-2',
      startsOn: '2030-05-13',
      endsOn: '2030-05-14',
      method: 'POKPAY',
    });
    // ...and three that must not get a reminder: Clock-imported, cancelled, booked today.
    await book({ guestId: clock, ref: 'CLOCK-99', startsOn: '2030-05-13', endsOn: '2030-05-14' });
    await book({
      guestId: bob,
      ref: 'BK-3',
      startsOn: '2030-05-13',
      endsOn: '2030-05-14',
      status: 'CANCELLED',
    });
    await book({
      guestId: today2,
      ref: 'BK-4',
      startsOn: '2030-05-13',
      endsOn: '2030-05-14',
      createdAt: '2030-05-10T07:00:00Z',
    });
    // Today's movements for the owner summary.
    await book({
      guestId: bob,
      ref: 'BK-5',
      startsOn: today,
      endsOn: '2030-05-12',
      createdAt: '2030-05-09T09:00:00Z',
      amount: '200.00',
    });
    await book({ guestId: ada, ref: 'BK-6', startsOn: '2030-05-08', endsOn: today });
    await book({ guestId: ada, ref: 'BK-7', startsOn: '2030-05-09', endsOn: '2030-05-11' });
    // Checked out yesterday, for the post-stay thank-you: only BK-9 qualifies.
    await book({ guestId: ada, ref: 'BK-9', startsOn: '2030-05-06', endsOn: '2030-05-09' });
    await book({ guestId: clock, ref: 'CLOCK-100', startsOn: '2030-05-07', endsOn: '2030-05-09' });
    await book({ guestId: bob, ref: 'BK-10', startsOn: '2030-05-07', endsOn: '2030-05-09' });
    await admin.$executeRaw`UPDATE bookings SET pms_stay_status = 'no_show' WHERE tenant_id = ${tenantId}::uuid AND external_reference = 'BK-10'`;
    await book({
      guestId: today2,
      ref: 'BK-11',
      startsOn: '2030-05-07',
      endsOn: '2030-05-09',
      status: 'CANCELLED',
    });
    await book({
      guestId: bob,
      ref: 'BK-8',
      startsOn: '2030-06-01',
      endsOn: '2030-06-02',
      status: 'CANCELLED',
      updatedAt: '2030-05-09T12:00:00Z',
    });
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  async function waitForSent(count: number) {
    for (let i = 0; i < 100 && sent.length < count; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('sends one reminder per direct booking or order, once, honouring the property switch', async () => {
    const scheduled = app!.get(ScheduledEmailService);
    const context = { tenantId, propertyId };
    await scheduled.sendPreArrival(context, 'Europe/Tirane', today);
    await waitForSent(2);
    const reminders = sent.filter((e) => e.eventType === 'guest.pre_arrival');
    expect(reminders.map((e) => e.to).sort()).toEqual(['ada@example.test', 'bob@example.test']);
    const order = reminders.find((e) => e.to === 'ada@example.test')!;
    expect(order.subject).toContain('See you soon at Seaside <Hotel>');
    expect(order.html).toContain('Seaside &lt;Hotel&gt;');
    expect(order.html).not.toContain('Seaside <Hotel>');
    expect(order.text).toContain('Booking reference: ORD-1');
    expect(order.text).toContain('Due at the hotel: 200.50 EUR');
    expect(order.text).toContain('Check-in from: 14:00');
    expect(order.replyTo).toBe('stay@seaside.test');
    expect(reminders.find((e) => e.to === 'bob@example.test')!.text).not.toContain('Due at');

    // A second sweep the same day sends nothing new.
    await scheduled.sendPreArrival(context, 'Europe/Tirane', today);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent.filter((e) => e.eventType === 'guest.pre_arrival')).toHaveLength(2);

    // Switched off (as for every property that existed before this feature): nothing.
    await request(app!.getHttpServer())
      .put(`/tenants/${tenantId}/properties/${propertyId}/notification-settings/pre_arrival`)
      .set('Cookie', cookie)
      .send({ guestEnabled: false, customStaffRecipients: false, rules: [] })
      .expect(200);
    await scheduled.sendPreArrival(context, 'Europe/Tirane', '2030-05-09'); // would target 05-12
    const before = sent.length;
    await scheduled.sendPreArrival(context, 'Europe/Tirane', '2030-05-10');
    expect(sent.length).toBe(before);
  });

  it('sends the owner one summary per day with arrivals, departures and yesterday’s numbers', async () => {
    const scheduled = app!.get(ScheduledEmailService);
    const context = { tenantId, propertyId };
    await scheduled.sendOwnerSummary(context, 'Europe/Tirane', today);
    await waitForSent(sent.filter((e) => e.eventType !== 'owner.daily_summary').length + 1);
    const summaries = sent.filter((e) => e.eventType === 'owner.daily_summary');
    expect(summaries).toHaveLength(1);
    const summary = summaries[0]!;
    expect(summary.to).toBe(ownerEmail);
    expect(summary.subject).toBe('Seaside <Hotel> today: 1 arrival, 1 departure');
    expect(summary.text).toContain('Arrivals (1): Bob Guest · Sea View · 2 nights');
    expect(summary.text).toContain('Departures (1): Ada Guest · Sea View');
    expect(summary.text).toContain('In-house tonight: 2 bookings');
    expect(summary.text).toContain('New bookings yesterday: 1 · 200.00 EUR');
    expect(summary.text).toContain('Cancellations yesterday: 1');

    await scheduled.sendOwnerSummary(context, 'Europe/Tirane', today);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent.filter((e) => e.eventType === 'owner.daily_summary')).toHaveLength(1);

    // The owner turns it off: no summary the next day.
    await request(app!.getHttpServer())
      .put(
        `/tenants/${tenantId}/properties/${propertyId}/notification-settings/owner_daily_summary`,
      )
      .set('Cookie', cookie)
      .send({ guestEnabled: true, staffEnabled: false, customStaffRecipients: false, rules: [] })
      .expect(200);
    await scheduled.sendOwnerSummary(context, 'Europe/Tirane', '2030-05-11');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent.filter((e) => e.eventType === 'owner.daily_summary')).toHaveLength(1);
  });

  it('thanks guests after check-out with the review links, once', async () => {
    const scheduled = app!.get(ScheduledEmailService);
    const context = { tenantId, propertyId };
    const url = `/tenants/${tenantId}/properties/${propertyId}/review-links`;
    const http = () => request(app!.getHttpServer());
    await http()
      .put(url)
      .set('Cookie', cookie)
      .send({ google: 'http://g.page/seaside' })
      .expect(400);
    await http().put(url).set('Cookie', cookie).send({ yelp: 'https://yelp.test' }).expect(400);
    const saved = await http()
      .put(url)
      .set('Cookie', cookie)
      .send({
        google: 'https://g.page/r/seaside/review',
        booking_com: 'https://www.booking.com/hotel/al/seaside.html',
        facebook: '',
      })
      .expect(200);
    expect(saved.body.links).toEqual({
      google: 'https://g.page/r/seaside/review',
      booking_com: 'https://www.booking.com/hotel/al/seaside.html',
    });
    const read = await http().get(url).set('Cookie', cookie).expect(200);
    expect(read.body.links.google).toBe('https://g.page/r/seaside/review');

    const before = sent.length;
    await scheduled.sendPostStay(context, today);
    await waitForSent(before + 1);
    const thanks = sent.filter((e) => e.eventType === 'guest.post_stay');
    expect(thanks.map((e) => e.to)).toEqual(['ada@example.test']);
    const email = thanks[0]!;
    expect(email.subject).toBe('Thank you for staying at Seaside <Hotel>');
    expect(email.html).toContain('https://g.page/r/seaside/review');
    expect(email.html).toContain('Review us on Booking.com');
    expect(email.html).not.toContain('Facebook');
    expect(email.text).toContain('Review us on Google: https://g.page/r/seaside/review');
    expect(email.replyTo).toBe('stay@seaside.test');

    await scheduled.sendPostStay(context, today);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent.filter((e) => e.eventType === 'guest.post_stay')).toHaveLength(1);

    // Off (as for every property that existed before this feature): nothing.
    await http()
      .put(`/tenants/${tenantId}/properties/${propertyId}/notification-settings/post_stay`)
      .set('Cookie', cookie)
      .send({ guestEnabled: false, customStaffRecipients: false, rules: [] })
      .expect(200);
    await scheduled.sendPostStay(context, '2030-05-11'); // would thank BK-6 (left 05-10)
    await scheduled.sendPostStay(context, '2030-05-12');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent.filter((e) => e.eventType === 'guest.post_stay')).toHaveLength(1);
  });

  it('validates the reminder timing setting', async () => {
    const url = `/tenants/${tenantId}/properties/${propertyId}/notification-settings`;
    const put = (topic: string, body: object) =>
      request(app!.getHttpServer()).put(`${url}/${topic}`).set('Cookie', cookie).send(body);
    const base = { guestEnabled: true, customStaffRecipients: false, rules: [] };
    await put('pre_arrival', { ...base, daysOffset: 0 }).expect(400);
    await put('pre_arrival', { ...base, daysOffset: 2.5 }).expect(400);
    await put('new_booking', { ...base, daysOffset: 2 }).expect(400);
    const saved = await put('pre_arrival', { ...base, daysOffset: 7 }).expect(200);
    expect(saved.body.daysOffset).toEqual({
      value: 7,
      min: 1,
      max: 30,
      label: 'Days before check-in',
    });
  });
});
