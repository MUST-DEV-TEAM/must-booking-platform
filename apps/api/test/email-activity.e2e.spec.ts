import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderedEmailCommand } from '@must/domain-contracts';

import { MailDeliveryError } from '../src/mail/mail-delivery-error';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('email activity (every email a property sent, and sending failed ones again)', () => {
  let app: INestApplication | undefined;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let cookie = '';
  let verificationToken = '';
  let failNext = true;
  const ownerEmail = `activity-owner-${randomUUID()}@example.test`;
  const rendered: RenderedEmailCommand[] = [];
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
      if (failNext) {
        failNext = false;
        throw new MailDeliveryError('Resend email delivery failed with status 422.', false, 422);
      }
      rendered.push(command);
    },
  };

  async function waitFor(check: () => Promise<boolean> | boolean) {
    for (let i = 0; i < 100 && !(await check()); i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
  }

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    process.env.MAIL_FROM_EMAIL = 'MUST Booking <bookings@mail.example.test>';
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
        organizationName: 'Activity Hotel',
        propertyName: 'Activity Villa',
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

  const base = () => `/tenants/${tenantId}/properties/${propertyId}`;

  it('lists a failed email, sends it again once, and shows the sender', async () => {
    const http = () => request(app!.getHttpServer());
    await http()
      .post(`${base()}/email-templates/pre_arrival/test`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    const status = async () =>
      (
        await admin.$queryRaw<Array<{ status: string }>>`
          SELECT status::text AS status FROM email_messages
          WHERE tenant_id = ${tenantId}::uuid AND event_type = 'template.test'`
      )[0]?.status;
    await waitFor(async () => (await status()) === 'FAILED');

    const problems = await http()
      .get(`${base()}/email-activity?filter=problems`)
      .set('Cookie', cookie)
      .expect(200);
    expect(problems.body.total).toBe(1);
    const failed = problems.body.items[0];
    expect(failed).toMatchObject({
      label: 'Template test',
      recipient: ownerEmail,
      status: 'FAILED',
      canResend: true,
      lastError: 'Resend email delivery failed with status 422.',
    });

    await http()
      .post(`${base()}/email-activity/${failed.id}/resend`)
      .set('Cookie', cookie)
      .expect(200);
    await waitFor(async () => (await status()) === 'SENT');
    expect(await status()).toBe('SENT');
    expect(rendered).toHaveLength(1);
    expect(rendered[0]!.subject).toContain('[Test]');

    // Sent now: it cannot be sent again.
    await http()
      .post(`${base()}/email-activity/${failed.id}/resend`)
      .set('Cookie', cookie)
      .expect(409);
    await http()
      .post(`${base()}/email-activity/${randomUUID()}/resend`)
      .set('Cookie', cookie)
      .expect(404);
    await http().get(`${base()}/email-activity?filter=nope`).set('Cookie', cookie).expect(400);

    const all = await http().get(`${base()}/email-activity`).set('Cookie', cookie).expect(200);
    expect(all.body.items.map((item: { status: string }) => item.status)).toContain('SENT');

    const audit = await admin.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM audit_logs WHERE tenant_id = ${tenantId}::uuid AND action = 'email.resent'`;
    expect(audit).toHaveLength(1);

    const sender = await http().get(`${base()}/email-sender`).set('Cookie', cookie).expect(200);
    expect(sender.body).toEqual({
      fromAddress: 'bookings@mail.example.test',
      replyTo: null,
      hotelName: 'Activity Villa',
    });
  });

  it('refuses other hotels', async () => {
    await request(app!.getHttpServer())
      .get(`/tenants/${randomUUID()}/properties/${propertyId}/email-activity`)
      .set('Cookie', cookie)
      .expect(403);
  });
});
