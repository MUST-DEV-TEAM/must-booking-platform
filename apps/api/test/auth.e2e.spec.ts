import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('authentication endpoints', () => {
  let app: INestApplication;
  const email = `auth-${randomUUID()}@example.test`;
  let userId: string | undefined;

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (userId) {
      await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
    }
    await app.close();
    await migrationPrisma.$disconnect();
  });

  it('signs up, authenticates with a bcrypt hash, and invalidates the Redis session on logout', async () => {
    const password = 'correct-horse-battery-staple';
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email, password })
      .expect(201);
    userId = signup.body.id;
    expect(signup.body).toEqual({ id: userId, email });

    const stored = await migrationPrisma.$queryRaw<Array<{ passwordHash: string }>>`
      SELECT password_hash AS "passwordHash" FROM "users" WHERE "id" = ${userId}::uuid
    `;
    expect(stored[0].passwordHash).not.toBe(password);
    expect(stored[0].passwordHash).toMatch(/^\$2[aby]\$/);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    const cookie = login.headers['set-cookie'][0] as string;
    expect(cookie).toContain('must_session=');

    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(204);
    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(204);
  });
});
