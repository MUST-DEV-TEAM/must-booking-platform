import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PaymentNotificationService } from '../src/mail/payment-notification.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

type TopicBody = {
  topic: string;
  guestEnabled: boolean;
  customStaffRecipients: boolean;
  staffRecipients: Array<{ email: string }>;
};

describe('notification settings (who receives which email)', () => {
  let app: INestApplication | undefined;
  let tenantId = '';
  let otherTenantId = '';
  let propertyId = '';
  let ownerId = '';
  let otherOwnerId = '';
  const staffId = randomUUID();
  let cookie = '';
  let verificationToken = '';
  const ownerEmail = `notify-owner-${randomUUID()}@example.test`;
  const staffEmail = `notify-staff-${randomUUID()}@example.test`;
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
  });

  afterAll(async () => {
    for (const id of [tenantId, otherTenantId]) if (id) await cleanupTenant(admin, id);
    for (const id of [ownerId, otherOwnerId, staffId])
      if (id) await admin.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  async function signup(email: string, organizationName: string) {
    const response = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName,
        propertyName: 'Main Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    return response;
  }

  it('defaults to today’s recipients, saves custom ones, and switches guest emails off', async () => {
    const signed = await signup(ownerEmail, 'Notify Hotel');
    tenantId = signed.body.organization.id;
    propertyId = signed.body.property.id;
    ownerId = signed.body.user.id;
    cookie = signed.headers['set-cookie'][0];
    const url = `/tenants/${tenantId}/properties/${propertyId}/notification-settings`;
    const topic = (body: { topics: TopicBody[] }, name: string) =>
      body.topics.find((entry) => entry.topic === name)!;

    // No assigned staff: the owner gets staff emails (the existing fallback).
    let settings = await request(app!.getHttpServer()).get(url).set('Cookie', cookie).expect(200);
    expect(settings.body.topics.map((entry: TopicBody) => entry.topic)).toEqual([
      'new_booking',
      'booking_cancelled',
      'refund_processed',
      'booking_changed',
      'payment_not_completed',
      'pre_arrival',
      'owner_daily_summary',
      'owner_alerts',
    ]);
    expect(topic(settings.body, 'new_booking')).toMatchObject({
      guestEnabled: true,
      customStaffRecipients: false,
      staffRecipients: [{ email: ownerEmail }],
    });

    // One assigned front-desk person: by default only they get staff emails, as before.
    const [frontDesk] = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM property_role_templates
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND name = 'Front Desk'
    `;
    expect(frontDesk).toBeDefined();
    await admin.$executeRaw`INSERT INTO users (id, email) VALUES (${staffId}::uuid, ${staffEmail})`;
    await admin.$executeRaw`INSERT INTO tenant_memberships (tenant_id, user_id, role) VALUES (${tenantId}::uuid, ${staffId}::uuid, 'STAFF')`;
    await admin.$executeRaw`
      INSERT INTO property_staff_assignments (tenant_id, property_id, user_id, role_template_id)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${staffId}::uuid, ${frontDesk!.id}::uuid)
    `;
    settings = await request(app!.getHttpServer()).get(url).set('Cookie', cookie).expect(200);
    expect(topic(settings.body, 'new_booking').staffRecipients).toEqual([{ email: staffEmail }]);
    expect(settings.body.options.roleTemplates).toEqual(
      expect.arrayContaining([{ id: frontDesk!.id, name: 'Front Desk' }]),
    );
    expect(settings.body.options.staff).toEqual(
      expect.arrayContaining([
        { userId: ownerId, email: ownerEmail, role: 'OWNER' },
        { userId: staffId, email: staffEmail, role: 'STAFF' },
      ]),
    );

    // Custom: owner role + Front Desk role + the same person again + an extra address
    // (twice, different case). Everyone is emailed once.
    const saved = await request(app!.getHttpServer())
      .put(`${url}/new_booking`)
      .set('Cookie', cookie)
      .send({
        guestEnabled: false,
        customStaffRecipients: true,
        rules: [
          { target: 'MEMBERSHIP_ROLE', membershipRole: 'OWNER' },
          { target: 'ROLE_TEMPLATE', roleTemplateId: frontDesk!.id },
          { target: 'STAFF_USER', userId: staffId },
          { target: 'EMAIL', email: 'Reservations@Hotel.test' },
          { target: 'EMAIL', email: 'reservations@hotel.test' },
        ],
      })
      .expect(200);
    expect(saved.body).toMatchObject({ guestEnabled: false, customStaffRecipients: true });
    expect(saved.body.rules).toHaveLength(4);
    expect(saved.body.staffRecipients.map((r: { email: string }) => r.email).sort()).toEqual(
      [ownerEmail, staffEmail, 'reservations@hotel.test'].sort(),
    );
    const audit = await admin.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM audit_logs WHERE tenant_id = ${tenantId}::uuid AND target_id = 'new_booking'
    `;
    expect(audit).toEqual([{ action: 'notification_settings.updated' }]);

    // Custom with nobody selected: nobody at the hotel gets it (shown, not hidden).
    const empty = await request(app!.getHttpServer())
      .put(`${url}/booking_cancelled`)
      .set('Cookie', cookie)
      .send({ guestEnabled: true, customStaffRecipients: true, rules: [] })
      .expect(200);
    expect(empty.body.staffRecipients).toEqual([]);

    // The guest switch is honoured when emails go out; other topics are untouched.
    const notifications = app!.get(PaymentNotificationService);
    const dispatch = vi.spyOn(app!.get(MailDeliveryService), 'dispatch').mockResolvedValue();
    const context = { tenantId, propertyId };
    await notifications.sendPaymentConfirmationEmailSafely({} as never, context);
    expect(dispatch).not.toHaveBeenCalled();
    await notifications.sendBookingCancelledEmailSafely({} as never, context);
    await notifications.sendRefundConfirmationEmailSafely({} as never, context);
    expect(dispatch.mock.calls.map(([kind]) => kind)).toEqual([
      'bookingCancelled',
      'refundConfirmation',
    ]);
    dispatch.mockRestore();

    // Switching custom off again returns to the default list.
    const reset = await request(app!.getHttpServer())
      .put(`${url}/new_booking`)
      .set('Cookie', cookie)
      .send({ guestEnabled: true, customStaffRecipients: false, rules: [] })
      .expect(200);
    expect(reset.body).toMatchObject({ rules: [], staffRecipients: [{ email: staffEmail }] });
  });

  it('rejects invalid recipients and other hotels’ roles or people', async () => {
    const url = `/tenants/${tenantId}/properties/${propertyId}/notification-settings`;
    const put = (topic: string, body: object) =>
      request(app!.getHttpServer()).put(`${url}/${topic}`).set('Cookie', cookie).send(body);
    const custom = (rules: unknown[]) => ({
      guestEnabled: true,
      customStaffRecipients: true,
      rules,
    });

    await put('nope', custom([])).expect(404);
    await put('new_booking', custom([{ target: 'EMAIL', email: 'not-an-email' }])).expect(400);
    await put(
      'new_booking',
      custom([{ target: 'MEMBERSHIP_ROLE', membershipRole: 'STAFF' }]),
    ).expect(400);
    await put('new_booking', {
      guestEnabled: true,
      customStaffRecipients: false,
      rules: [{ target: 'EMAIL', email: 'a@hotel.test' }],
    }).expect(400);
    await put('pre_arrival', custom([])).expect(400);
    await put(
      'new_booking',
      custom(
        Array.from({ length: 51 }, (_, i) => ({ target: 'EMAIL', email: `s${i}@hotel.test` })),
      ),
    ).expect(400);

    const other = await signup(`notify-other-${randomUUID()}@example.test`, 'Other Hotel');
    otherTenantId = other.body.organization.id;
    otherOwnerId = other.body.user.id;
    const [otherRole] = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id::text FROM property_role_templates WHERE tenant_id = ${otherTenantId}::uuid LIMIT 1
    `;
    await put(
      'new_booking',
      custom([{ target: 'ROLE_TEMPLATE', roleTemplateId: otherRole!.id }]),
    ).expect(400);
    await put('new_booking', custom([{ target: 'STAFF_USER', userId: otherOwnerId }])).expect(400);

    // The other hotel can't read or change this one.
    const otherCookie = other.headers['set-cookie'][0];
    await request(app!.getHttpServer()).get(url).set('Cookie', otherCookie).expect(403);
  });

  it('lets each member mute the non-urgent staff emails for themselves', async () => {
    const owner = await signup(`notify-mute-${randomUUID()}@example.test`, 'Mute Hotel');
    const muteTenant = owner.body.organization.id;
    const muteProperty = owner.body.property.id;
    const muteCookie = owner.headers['set-cookie'][0];
    try {
      const prefs = `/tenants/${muteTenant}/my-email-preferences`;
      const initial = await request(app!.getHttpServer())
        .get(prefs)
        .set('Cookie', muteCookie)
        .expect(200);
      expect(initial.body).toEqual({
        muteOptionalEmails: false,
        optionalEmails: [
          { topic: 'refund_processed', label: 'Refund processed' },
          { topic: 'owner_daily_summary', label: 'Daily summary' },
        ],
      });
      await request(app!.getHttpServer())
        .put(prefs)
        .set('Cookie', muteCookie)
        .send({ muteOptionalEmails: 'yes' })
        .expect(400);
      await request(app!.getHttpServer())
        .put(prefs)
        .set('Cookie', muteCookie)
        .send({ muteOptionalEmails: true })
        .expect(200);

      // Optional emails skip the owner; urgent ones still reach them.
      const settings = await request(app!.getHttpServer())
        .get(`/tenants/${muteTenant}/properties/${muteProperty}/notification-settings`)
        .set('Cookie', muteCookie)
        .expect(200);
      const recipients = (name: string) =>
        settings.body.topics.find((entry: TopicBody) => entry.topic === name).staffRecipients;
      expect(recipients('owner_daily_summary')).toEqual([]);
      expect(recipients('refund_processed')).toEqual([]);
      expect(recipients('new_booking')).toHaveLength(1);
      expect(recipients('owner_alerts')).toHaveLength(1);

      // Another hotel's member can't read this one's preferences.
      await request(app!.getHttpServer()).get(prefs).set('Cookie', cookie).expect(403);
    } finally {
      await cleanupTenant(admin, muteTenant);
      await admin.$executeRaw`DELETE FROM users WHERE id = ${owner.body.user.id}::uuid`;
    }
  });
});
