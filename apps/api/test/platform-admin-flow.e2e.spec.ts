import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('platform admin end-to-end flow', () => {
  let app: INestApplication;
  const organizationId = randomUUID();
  const propertyId = randomUUID();
  const platformUserId = randomUUID();
  const ownerUserId = randomUUID();
  const platformEmail = `platform-flow-${randomUUID()}@must.al`;
  const ownerEmail = `owner-flow-${randomUUID()}@must.al`;
  const password = 'correct-horse-battery-staple';
  const resetEmails: Parameters<MailProvider['sendPasswordResetEmail']>[0][] = [];
  const mail: MailProvider = {
    async sendVerificationEmail() {},
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail(command) {
      resetEmails.push(command);
    },
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name")
      VALUES (${organizationId}::uuid, 'Platform flow tenant')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug", "address", "timezone")
      VALUES (${propertyId}::uuid, ${organizationId}::uuid, 'Platform flow property', 'platform-flow-property', '', 'UTC')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin")
      VALUES
        (${platformUserId}::uuid, ${platformEmail}, ${hash}, CURRENT_TIMESTAMP, true),
        (${ownerUserId}::uuid, ${ownerEmail}, ${hash}, CURRENT_TIMESTAMP, false)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
      VALUES (${organizationId}::uuid, ${ownerUserId}::uuid, 'OWNER')
    `;

    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`
      DELETE FROM "audit_logs"
      WHERE "actor_user_id" IN (${platformUserId}::uuid, ${ownerUserId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${organizationId}::uuid
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "users" WHERE "id" IN (${platformUserId}::uuid, ${ownerUserId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "organizations" WHERE "id" = ${organizationId}::uuid
    `;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('completes the platform-admin dashboard flow end to end', async () => {
    const platformLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: platformEmail, password })
      .expect(201);
    const platformCookie = platformLogin.headers['set-cookie'][0] as string;

    const dashboard = await request(app.getHttpServer())
      .get('/platform/dashboard')
      .set('Cookie', platformCookie)
      .expect(200);
    expect(dashboard.body.stats).toMatchObject({
      tenants: expect.any(Number),
      properties: expect.any(Number),
      plans: expect.any(Object),
    });
    expect(dashboard.body.activity).toEqual(expect.any(Array));

    const health = await request(app.getHttpServer())
      .get('/platform/provider-health')
      .set('Cookie', platformCookie)
      .expect(200);
    expect(health.body).toMatchObject({
      stripe: { status: expect.any(String) },
      pokpay: { status: expect.any(String) },
    });

    const tenants = await request(app.getHttpServer())
      .get('/platform/tenants?search=Platform%20flow')
      .set('Cookie', platformCookie)
      .expect(200);
    expect(tenants.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: organizationId, ownerEmail })]),
    );

    await request(app.getHttpServer())
      .get(`/platform/tenants/${organizationId}`)
      .set('Cookie', platformCookie)
      .expect(200)
      .expect((response) =>
        expect(response.body).toMatchObject({ id: organizationId, ownerUserId, ownerEmail }),
      );

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/suspend`)
      .set('Cookie', platformCookie)
      .expect(201)
      .expect({ id: organizationId, status: 'SUSPENDED' });

    const postSuspendDashboard = await request(app.getHttpServer())
      .get('/platform/dashboard')
      .set('Cookie', platformCookie)
      .expect(200);
    expect(postSuspendDashboard.body.activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'platform.tenant.suspended',
          targetId: organizationId,
          actorType: 'PLATFORM_ADMIN',
        }),
      ]),
    );

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/reactivate`)
      .set('Cookie', platformCookie)
      .expect(201)
      .expect({ id: organizationId, status: 'ACTIVE' });

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/users/${ownerUserId}/reset-password`)
      .set('Cookie', platformCookie)
      .expect(202);
    expect(resetEmails).toHaveLength(1);
    expect(resetEmails[0]).toMatchObject({ userId: ownerUserId, to: ownerEmail });
  });

  it('rejects a tenant-membership session from every platform route used above', async () => {
    const tenantLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ownerEmail, password })
      .expect(201);
    const tenantCookie = tenantLogin.headers['set-cookie'][0] as string;
    const routes = [
      ['get', '/platform/dashboard'],
      ['get', '/platform/provider-health'],
      ['get', '/platform/tenants?search=Platform%20flow'],
      ['get', `/platform/tenants/${organizationId}`],
      ['post', `/platform/tenants/${organizationId}/suspend`],
      ['post', `/platform/tenants/${organizationId}/reactivate`],
      ['post', `/platform/tenants/${organizationId}/users/${ownerUserId}/reset-password`],
    ] as const;
    for (const [method, path] of routes) {
      await request(app.getHttpServer())[method](path).set('Cookie', tenantCookie).expect(403);
    }
  });
});
