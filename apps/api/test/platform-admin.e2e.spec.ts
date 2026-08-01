import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('platform-admin session routing data', () => {
  let app: INestApplication;
  const platformUserId = randomUUID();
  const platformEmail = `platform-${randomUUID()}@must.al`;
  const platformPassword = 'correct-horse-battery-staple';

  beforeAll(async () => {
    const hash = await bcrypt.hash(platformPassword, 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin")
      VALUES (${platformUserId}::uuid, ${platformEmail}, ${hash}, CURRENT_TIMESTAMP, true)
    `;
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`
      DELETE FROM "users" WHERE "id" = ${platformUserId}::uuid
    `;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('exposes the platform role on login and session resolution', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: platformEmail, password: platformPassword })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;

    expect(login.body).toEqual({
      user: {
        id: platformUserId,
        email: platformEmail,
        emailVerified: true,
        isPlatformAdmin: true,
      },
    });
    await request(app.getHttpServer())
      .get('/auth/session')
      .set('Cookie', cookie)
      .expect(200)
      .expect({
        user: {
          id: platformUserId,
          email: platformEmail,
          emailVerified: true,
          isPlatformAdmin: true,
        },
      });
  });

  it('rejects adding a tenant membership to a platform-admin account', async () => {
    const tenantId = randomUUID();
    try {
      await migrationPrisma.$executeRaw`
        INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Platform invariant test')
      `;
      await expect(
        migrationPrisma.$executeRaw`
          INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
          VALUES (${tenantId}::uuid, ${platformUserId}::uuid, 'OWNER')
        `,
      ).rejects.toThrow();
    } finally {
      await migrationPrisma.$executeRaw`
        DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid
      `;
    }
  });
});
