import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../src/auth/auth.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('authentication endpoints', () => {
  let app: INestApplication;
  let failVerificationEmail = false;
  let failWelcomeEmail = false;
  const sentEmails: Array<
    | {
        kind: 'verification';
        command: Parameters<MailProvider['sendVerificationEmail']>[0];
      }
    | { kind: 'welcome'; command: Parameters<MailProvider['sendWelcomeEmail']>[0] }
    | { kind: 'password-reset'; command: Parameters<MailProvider['sendPasswordResetEmail']>[0] }
  > = [];
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      if (failVerificationEmail) throw new Error('simulated verification email failure');
      sentEmails.push({ kind: 'verification', command });
    },
    async sendWelcomeEmail(command) {
      if (failWelcomeEmail) throw new Error('simulated welcome email failure');
      sentEmails.push({ kind: 'welcome', command });
    },
    async sendPasswordResetEmail(command) {
      sentEmails.push({ kind: 'password-reset', command });
    },
    async sendPaymentConfirmationEmail() {},
    async sendRefundConfirmationEmail() {},
  };
  const email = `auth-${randomUUID()}@example.test`;
  let userId: string | undefined;
  let organizationId: string | undefined;
  let propertyId: string | undefined;

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
    if (organizationId)
      await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "tenant_id" = ${organizationId}::uuid`;
    if (userId)
      await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "actor_user_id" = ${userId}::uuid`;
    if (organizationId && userId)
      await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${organizationId}::uuid AND "user_id" = ${userId}::uuid`;
    if (propertyId)
      await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid`;
    if (organizationId)
      await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${organizationId}::uuid`;
    if (userId) await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('creates the Free-plan tenant atomically and starts an authenticated session', async () => {
    const password = 'correct-horse-battery-staple';
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'MUST Test Hotels',
        propertyName: 'MUST Test Hotel',
        propertyAddress: '1 Example Street, Tirana',
        propertyTimezone: 'Europe/Tirane',
        email,
        password,
      })
      .expect(201);
    userId = signup.body.user.id;
    organizationId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    const cookie = signup.headers['set-cookie'][0] as string;
    expect(cookie).toContain('must_session=');
    const signupSessionId = cookie.match(/must_session=([^;]+)/)?.[1];
    expect(await app.get(AuthService).getSessionUserId(signupSessionId)).toBe(userId);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      kind: 'verification',
      command: { to: email, organizationName: 'MUST Test Hotels' },
    });
    expect(signup.body).toEqual({
      user: { id: userId, email, emailVerified: false },
      organization: { id: organizationId, name: 'MUST Test Hotels' },
      property: {
        id: propertyId,
        name: 'MUST Test Hotel',
        address: '1 Example Street, Tirana',
        timezone: 'Europe/Tirane',
      },
    });

    const planUsage = await request(app.getHttpServer())
      .get(`/tenants/${organizationId}/plan-usage`)
      .set('Cookie', cookie)
      .expect(200);
    expect(planUsage.body).toEqual({
      plan: {
        name: 'Free',
        maxProperties: 1,
        maxStaffSeats: 3,
        pmsEnabled: false,
        maxPmsConnectionsPerProperty: 0,
      },
      usage: { properties: 1, staffSeats: 1 },
    });
    await request(app.getHttpServer())
      .get(`/tenants/${randomUUID()}/plan-usage`)
      .set('Cookie', cookie)
      .expect(403);

    const auditLogs = await request(app.getHttpServer())
      .get(`/tenants/${organizationId}/audit-logs`)
      .set('Cookie', cookie)
      .expect(200);
    expect(auditLogs.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: userId,
          action: 'tenant.created',
          targetType: 'organization',
          targetId: organizationId,
          propertyId: null,
        }),
        expect.objectContaining({
          actorUserId: userId,
          action: 'property.created',
          targetType: 'property',
          targetId: propertyId,
          propertyId,
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/tenants/${organizationId}/staff-invitations`)
      .set('Cookie', cookie)
      .send({
        email: `unverified-invite-${randomUUID()}@example.test`,
        assignments: [{ propertyId, roleTemplateId: randomUUID() }],
      })
      .expect(403);

    const stored = await migrationPrisma.$queryRaw<
      Array<{
        passwordHash: string;
        planName: string;
        membershipRole: string;
        address: string;
        timezone: string;
      }>
    >`
      SELECT
        u."password_hash" AS "passwordHash",
        pl."name" AS "planName",
        tm."role"::text AS "membershipRole",
        p."address",
        p."timezone"
      FROM "users" u
      JOIN "tenant_memberships" tm ON tm."user_id" = u."id"
      JOIN "organizations" o ON o."id" = tm."tenant_id"
      JOIN "plans" pl ON pl."id" = o."plan_id"
      JOIN "properties" p ON p."id" = ${propertyId}::uuid AND p."tenant_id" = o."id"
      WHERE u."id" = ${userId}::uuid
    `;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      planName: 'Free',
      membershipRole: 'OWNER',
      address: '1 Example Street, Tirana',
      timezone: 'Europe/Tirane',
    });
    expect(stored[0].passwordHash).not.toBe(password);
    expect(stored[0].passwordHash).toMatch(/^\$2[aby]\$/);

    const verificationEmail = sentEmails[0];
    if (verificationEmail.kind !== 'verification')
      throw new Error('Verification email was not sent.');
    const verificationToken = new URL(verificationEmail.command.verificationUrl).searchParams.get(
      'token',
    );
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    expect(
      (await request(app.getHttpServer()).get('/auth/session').set('Cookie', cookie).expect(200))
        .body,
    ).toEqual({
      user: { id: userId, email, emailVerified: true, isPlatformAdmin: false },
    });
    await request(app.getHttpServer())
      .post(`/tenants/${organizationId}/staff-invitations`)
      .set('Cookie', cookie)
      .send({
        email: `verified-invite-${randomUUID()}@example.test`,
        assignments: [{ propertyId, roleTemplateId: randomUUID() }],
      })
      .expect(201);
    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[1]).toMatchObject({
      kind: 'welcome',
      command: { to: email, organizationName: 'MUST Test Hotels' },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const loginCookie = login.headers['set-cookie'][0] as string;
    expect(loginCookie).toContain('must_session=');

    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', loginCookie).expect(204);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', loginCookie).expect(204);
  });

  it('does not treat a missing user as email-verified', async () => {
    expect(await app.get(AuthService).isEmailVerified(randomUUID())).toBe(false);
  });

  it('issues a reset token, emails the reset URL, and accepts the new password', async () => {
    const resetRequest = await request(app.getHttpServer())
      .post('/auth/password-reset/request')
      .send({ email })
      .expect(202);
    expect(resetRequest.body).toEqual({ accepted: true });
    const resetEmail = sentEmails.at(-1);
    if (!resetEmail || resetEmail.kind !== 'password-reset')
      throw new Error('Password reset email was not sent.');
    const resetToken = new URL(resetEmail.command.resetUrl).searchParams.get('token');
    expect(resetToken).toBeTruthy();

    await request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({ token: resetToken, password: 'new-correct-horse-battery' })
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'new-correct-horse-battery' })
      .expect(201);
  });

  it('rolls back the organization and property when user creation fails', async () => {
    const failedOrganizationName = `Failed signup ${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: failedOrganizationName,
        propertyName: 'Should Not Persist',
        propertyAddress: '2 Example Street, Tirana',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(409);

    const rows = await migrationPrisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM "organizations"
      WHERE "name" = ${failedOrganizationName}
    `;
    expect(rows[0].count).toBe(0n);
  });

  it('keeps signup and verification successful when mail delivery fails after commit', async () => {
    const failureEmail = `mail-failure-${randomUUID()}@example.test`;
    let failureUserId: string | undefined;
    let failureOrganizationId: string | undefined;
    let failurePropertyId: string | undefined;

    try {
      failVerificationEmail = true;
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          organizationName: 'Mail Failure Hotels',
          propertyName: 'Mail Failure Hotel',
          propertyAddress: '3 Example Street, Tirana',
          propertyTimezone: 'Europe/Tirane',
          email: failureEmail,
          password: 'correct-horse-battery-staple',
        })
        .expect(201);
      failureUserId = signup.body.user.id;
      failureOrganizationId = signup.body.organization.id;
      failurePropertyId = signup.body.property.id;
      expect(signup.headers['set-cookie'][0]).toContain('must_session=');

      failVerificationEmail = false;
      await request(app.getHttpServer())
        .post('/auth/email-verification/request')
        .send({ email: failureEmail })
        .expect(202);
      const verificationEmail = sentEmails.at(-1);
      if (!verificationEmail || verificationEmail.kind !== 'verification')
        throw new Error('Verification email was not sent after delivery recovered.');
      const verificationToken = new URL(verificationEmail.command.verificationUrl).searchParams.get(
        'token',
      );

      failWelcomeEmail = true;
      await request(app.getHttpServer())
        .post('/auth/email-verification/confirm')
        .send({ token: verificationToken })
        .expect(204);

      const verified = await migrationPrisma.$queryRaw<Array<{ verified: boolean }>>`
        SELECT "email_verified_at" IS NOT NULL AS "verified"
        FROM "users"
        WHERE "id" = ${failureUserId}::uuid
      `;
      expect(verified).toEqual([{ verified: true }]);
    } finally {
      failVerificationEmail = false;
      failWelcomeEmail = false;
      if (failureOrganizationId)
        await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "tenant_id" = ${failureOrganizationId}::uuid`;
      if (failureUserId)
        await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "actor_user_id" = ${failureUserId}::uuid`;
      if (failureOrganizationId && failureUserId)
        await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${failureOrganizationId}::uuid AND "user_id" = ${failureUserId}::uuid`;
      if (failurePropertyId)
        await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${failurePropertyId}::uuid`;
      if (failureOrganizationId)
        await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${failureOrganizationId}::uuid`;
      if (failureUserId)
        await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${failureUserId}::uuid`;
    }
  });

  it('keeps signup successful if the verification URL configuration disappears after startup', async () => {
    const configurationFailureEmail = `url-failure-${randomUUID()}@example.test`;
    const configuredWebAppUrl = process.env.WEB_APP_URL;
    let configurationFailureUserId: string | undefined;
    let configurationFailureOrganizationId: string | undefined;
    let configurationFailurePropertyId: string | undefined;

    try {
      delete process.env.WEB_APP_URL;
      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          organizationName: 'URL Failure Hotels',
          propertyName: 'URL Failure Hotel',
          propertyAddress: '4 Example Street, Tirana',
          propertyTimezone: 'Europe/Tirane',
          email: configurationFailureEmail,
          password: 'correct-horse-battery-staple',
        })
        .expect(201);
      configurationFailureUserId = signup.body.user.id;
      configurationFailureOrganizationId = signup.body.organization.id;
      configurationFailurePropertyId = signup.body.property.id;
      expect(signup.headers['set-cookie'][0]).toContain('must_session=');
    } finally {
      process.env.WEB_APP_URL = configuredWebAppUrl;
      if (configurationFailureOrganizationId)
        await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "tenant_id" = ${configurationFailureOrganizationId}::uuid`;
      if (configurationFailureUserId)
        await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "actor_user_id" = ${configurationFailureUserId}::uuid`;
      if (configurationFailureOrganizationId && configurationFailureUserId)
        await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${configurationFailureOrganizationId}::uuid AND "user_id" = ${configurationFailureUserId}::uuid`;
      if (configurationFailurePropertyId)
        await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${configurationFailurePropertyId}::uuid`;
      if (configurationFailureOrganizationId)
        await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${configurationFailureOrganizationId}::uuid`;
      if (configurationFailureUserId)
        await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${configurationFailureUserId}::uuid`;
    }
  });
});
