import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

// Per ADR-0027: a short-lived, single-use pairing code replaces manual
// tenant/property UUID entry in the WordPress plugin's settings screen.
describe('WordPress pairing code', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `wp-pairing-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendRefundConfirmationEmail() {},
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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'WP Pairing Test Group',
        propertyName: 'Sanur Beach Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
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
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('generates a code shaped MUST-<slug>-XXXX-XXXX and redeems it exactly once', async () => {
    const generated = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/wordpress-pairing`)
      .set('Cookie', cookie)
      .expect(201);
    const code = generated.body.code as string;
    expect(code).toMatch(/^MUST-[A-Z0-9]+-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    const redeemed = await request(app.getHttpServer())
      .post('/wordpress-pairing/redeem')
      .send({ code })
      .expect(200);
    expect(redeemed.body).toEqual({
      tenantId,
      propertyId,
      apiBaseUrl: 'http://localhost:3001/api',
      propertyName: 'Sanur Beach Hotel',
    });

    // Single-use: the same code cannot be redeemed a second time.
    await request(app.getHttpServer()).post('/wordpress-pairing/redeem').send({ code }).expect(400);
  });

  it('redeeming is case-insensitive on the random segments', async () => {
    const generated = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/wordpress-pairing`)
      .set('Cookie', cookie)
      .expect(201);
    const code = generated.body.code as string;

    const redeemed = await request(app.getHttpServer())
      .post('/wordpress-pairing/redeem')
      .send({ code: code.toLowerCase() })
      .expect(200);
    expect(redeemed.body.propertyId).toBe(propertyId);
  });

  it('rejects a code that was never generated', async () => {
    await request(app.getHttpServer())
      .post('/wordpress-pairing/redeem')
      .send({ code: 'MUST-NOPE-0000-0000' })
      .expect(400);
  });

  it('rejects an empty code', async () => {
    await request(app.getHttpServer())
      .post('/wordpress-pairing/redeem')
      .send({ code: '' })
      .expect(400);
  });

  it('rejects generation from a non-Owner/Admin staff member', async () => {
    const staffUserId = randomUUID();
    const staffEmail = `wp-pairing-staff-${staffUserId}@example.test`;
    const staffPassword = 'correct-horse-battery-staple';
    await admin.$executeRaw`
      INSERT INTO users ("id", "email", "password_hash", "email_verified_at")
      VALUES (${staffUserId}::uuid, ${staffEmail}, ${await bcrypt.hash(staffPassword, 12)}, CURRENT_TIMESTAMP)
    `;
    await admin.$executeRaw`
      INSERT INTO tenant_memberships ("tenant_id", "user_id", "role")
      VALUES (${tenantId}::uuid, ${staffUserId}::uuid, 'STAFF')
    `;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password: staffPassword })
      .expect(201);
    const staffCookie = login.headers['set-cookie'][0];

    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/wordpress-pairing`)
      .set('Cookie', staffCookie)
      .expect(403);

    await admin.$executeRaw`DELETE FROM tenant_memberships WHERE user_id = ${staffUserId}::uuid`;
    await admin.$executeRaw`DELETE FROM users WHERE id = ${staffUserId}::uuid`;
  });
});
