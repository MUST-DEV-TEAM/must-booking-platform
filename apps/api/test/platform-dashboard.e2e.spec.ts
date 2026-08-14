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

describe('platform dashboard home', () => {
  let app: INestApplication;
  const organizationId = randomUUID();
  const propertyId = randomUUID();
  const userId = randomUUID();
  const ownerId = randomUUID();
  const email = `platform-dashboard-${randomUUID()}@must.al`;
  const ownerEmail = `owner-dashboard-${randomUUID()}@must.al`;
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
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
  };

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`INSERT INTO "organizations" ("id", "name") VALUES (${organizationId}::uuid, 'Dashboard tenant')`;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug", "address", "timezone", "stripe_enabled")
      VALUES (${propertyId}::uuid, ${organizationId}::uuid, 'Dashboard property', 'dashboard-property', '', 'UTC', true)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin")
      VALUES
        (${userId}::uuid, ${email}, ${hash}, CURRENT_TIMESTAMP, true),
        (${ownerId}::uuid, ${ownerEmail}, ${hash}, CURRENT_TIMESTAMP, false)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
      VALUES (${organizationId}::uuid, ${ownerId}::uuid, 'OWNER')
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
    await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "actor_user_id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${organizationId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" IN (${userId}::uuid, ${ownerId}::uuid)`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${organizationId}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('returns cross-tenant stats, platform activity, and requires a platform session', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;
    const response = await request(app.getHttpServer())
      .get('/platform/dashboard')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body.stats).toMatchObject({
      tenants: expect.any(Number),
      properties: expect.any(Number),
      signupsThisWeek: expect.any(Number),
    });
    expect(response.body.stats.tenants).toBeGreaterThanOrEqual(1);
    expect(response.body.stats.properties).toBeGreaterThanOrEqual(1);
    expect(response.body.activity).toContainEqual(
      expect.objectContaining({ action: 'platform.dashboard.viewed', actorType: 'PLATFORM_ADMIN' }),
    );

    const auditRows = await migrationPrisma.$queryRaw<Array<{ action: string; actorType: string }>>`
      SELECT "action", "actor_type"::text AS "actorType" FROM "audit_logs"
      WHERE "actor_user_id" = ${userId}::uuid AND "action" = 'platform.dashboard.viewed'
    `;
    expect(auditRows).toEqual([
      { action: 'platform.dashboard.viewed', actorType: 'PLATFORM_ADMIN' },
    ]);
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/platform/dashboard').expect(401);
  });

  it('searches tenants by organization name or owner email', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;

    await request(app.getHttpServer())
      .get('/platform/tenants?search=Dashboard')
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: organizationId, ownerEmail })]),
        );
      });
    await request(app.getHttpServer())
      .get(`/platform/tenants?search=${encodeURIComponent(ownerEmail)}`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) =>
        expect(response.body).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: organizationId })]),
        ),
      );
  });

  it('returns tenant detail and handles unknown tenants', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;
    await request(app.getHttpServer())
      .get(`/platform/tenants/${organizationId}`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          id: organizationId,
          ownerEmail,
          propertyCount: 1,
          stripeEnabled: true,
          stripeEnabledPropertyCount: 1,
          pokpayEnabled: false,
        });
      });
    await request(app.getHttpServer())
      .get(`/platform/tenants/${randomUUID()}`)
      .set('Cookie', cookie)
      .expect(404);
    await request(app.getHttpServer()).get(`/platform/tenants/${organizationId}`).expect(401);
  });

  it('reflects a suspend action after re-fetching tenant detail', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;
    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/suspend`)
      .set('Cookie', cookie)
      .expect(201);
    await request(app.getHttpServer())
      .get(`/platform/tenants/${organizationId}`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => expect(response.body.status).toBe('SUSPENDED'));
    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/reactivate`)
      .set('Cookie', cookie)
      .expect(201);
  });

  it('triggers an owner password reset and passes the owner identity to mail', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;
    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/users/${ownerId}/reset-password`)
      .set('Cookie', cookie)
      .expect(202);
    expect(resetEmails).toHaveLength(1);
    expect(resetEmails[0]).toMatchObject({ userId: ownerId, to: ownerEmail });
  });
});
