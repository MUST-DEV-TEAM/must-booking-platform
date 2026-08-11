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

describe('platform-admin actions', () => {
  let app: INestApplication;
  const organizationId = randomUUID();
  const platformUserId = randomUUID();
  const tenantUserId = randomUUID();
  const platformEmail = `platform-actions-${randomUUID()}@must.al`;
  const tenantEmail = `tenant-actions-${randomUUID()}@must.al`;
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
      VALUES (${organizationId}::uuid, 'Platform actions tenant')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin")
      VALUES
        (${platformUserId}::uuid, ${platformEmail}, ${hash}, CURRENT_TIMESTAMP, true),
        (${tenantUserId}::uuid, ${tenantEmail}, ${hash}, CURRENT_TIMESTAMP, false)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
      VALUES (${organizationId}::uuid, ${tenantUserId}::uuid, 'OWNER')
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
      DELETE FROM "tenant_memberships"
      WHERE "tenant_id" = ${organizationId}::uuid AND "user_id" = ${tenantUserId}::uuid
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "audit_logs" WHERE "actor_user_id" IN (${platformUserId}::uuid, ${tenantUserId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "users" WHERE "id" IN (${platformUserId}::uuid, ${tenantUserId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "organizations" WHERE "id" = ${organizationId}::uuid
    `;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('allows a platform-admin session to suspend, reactivate, and trigger a tenant-user reset', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: platformEmail, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/suspend`)
      .set('Cookie', cookie)
      .expect(201)
      .expect({ id: organizationId, status: 'SUSPENDED' });

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/reactivate`)
      .set('Cookie', cookie)
      .expect(201)
      .expect({ id: organizationId, status: 'ACTIVE' });

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/users/${tenantUserId}/reset-password`)
      .set('Cookie', cookie)
      .expect(202)
      .expect({ accepted: true });
    expect(resetEmails).toHaveLength(1);
    expect(resetEmails[0]).toMatchObject({ userId: tenantUserId, to: tenantEmail });

    const auditRows = await migrationPrisma.$queryRaw<
      Array<{
        action: string;
        actorUserId: string;
        actorType: string;
        tenantId: string;
        targetId: string;
      }>
    >`
      SELECT "action", "actor_user_id" AS "actorUserId", "actor_type"::text AS "actorType",
        "tenant_id" AS "tenantId", "target_id" AS "targetId"
      FROM "audit_logs"
      WHERE "tenant_id" = ${organizationId}::uuid
        AND "actor_user_id" = ${platformUserId}::uuid
      ORDER BY "action"
    `;
    expect(auditRows).toEqual([
      {
        action: 'platform.tenant.reactivated',
        actorUserId: platformUserId,
        actorType: 'PLATFORM_ADMIN',
        tenantId: organizationId,
        targetId: organizationId,
      },
      {
        action: 'platform.tenant.suspended',
        actorUserId: platformUserId,
        actorType: 'PLATFORM_ADMIN',
        tenantId: organizationId,
        targetId: organizationId,
      },
      {
        action: 'platform.user.password_reset_requested',
        actorUserId: platformUserId,
        actorType: 'PLATFORM_ADMIN',
        tenantId: organizationId,
        targetId: tenantUserId,
      },
    ]);
  });

  it('rejects a tenant-membership session on every platform action route', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantEmail, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;

    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/suspend`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/reactivate`)
      .set('Cookie', cookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/platform/tenants/${organizationId}/users/${tenantUserId}/reset-password`)
      .set('Cookie', cookie)
      .expect(403);
  });
});
