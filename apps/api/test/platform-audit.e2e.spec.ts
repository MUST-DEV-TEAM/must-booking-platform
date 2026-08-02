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

describe('platform audit log', () => {
  let app: INestApplication;
  const platformUserId = randomUUID();
  const email = `platform-audit-${randomUUID()}@must.al`;
  const password = 'correct-horse-battery-staple';
  const seededActions = Array.from({ length: 5 }, (_, index) => `platform.audit.seed.${index + 1}`);

  beforeAll(async () => {
    const hash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin")
      VALUES (${platformUserId}::uuid, ${email}, ${hash}, CURRENT_TIMESTAMP, true)
    `;
    for (const [index, action] of seededActions.entries()) {
      await migrationPrisma.$executeRaw`
        INSERT INTO "audit_logs" ("actor_user_id", "actor_type", "action", "target_type", "target_id", "created_at")
        VALUES (
          ${platformUserId}::uuid,
          'PLATFORM_ADMIN'::"AuditActorType",
          ${action},
          'audit_fixture',
          ${String(index + 1)},
          ${new Date(Date.UTC(2099, 0, 1, 0, 0, index))}
        )
      `;
    }
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
    await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "actor_user_id" = ${platformUserId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${platformUserId}::uuid`;
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('returns page two of the seeded activity rather than repeating page one', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;

    const response = await request(app.getHttpServer())
      .get('/platform/audit?page=2&pageSize=2')
      .set('Cookie', cookie)
      .expect(200);

    expect(response.body).toMatchObject({ page: 2, pageSize: 2, total: 6 });
    expect(response.body.items.map((item: { action: string }) => item.action)).toEqual([
      'platform.audit.seed.3',
      'platform.audit.seed.2',
    ]);
    const read = await migrationPrisma.$queryRaw<Array<{ action: string }>>`
      SELECT "action" FROM "audit_logs"
      WHERE "actor_user_id" = ${platformUserId}::uuid AND "action" = 'platform.audit.listed'
    `;
    expect(read).toEqual([{ action: 'platform.audit.listed' }]);
  });

  it('requires a platform-admin session', async () => {
    await request(app.getHttpServer()).get('/platform/audit').expect(401);
  });
});
