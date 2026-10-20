import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { withoutExternalWorkers } from './helpers/without-external-workers';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('my account: profile and password', () => {
  const email = `account-${randomUUID()}@example.test`;
  const password = 'correct-horse-battery-staple';
  let app: INestApplication;
  let tenantId = '';
  let userId = '';
  let cookie = '';
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const signup = await http()
      .post('/auth/signup')
      .send({
        organizationName: 'Account Fixture Group',
        propertyName: 'Account Fixture Hotel',
        propertyAddress: '1 Account Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('requires a session', async () => {
    await http().get('/auth/profile').expect(401);
    await http().patch('/auth/profile').send({ firstName: 'X' }).expect(401);
    await http()
      .post('/auth/change-password')
      .send({ currentPassword: password, newPassword: 'another-long-password-1' })
      .expect(401);
  });

  it('reads and updates the own profile name', async () => {
    const before = await http().get('/auth/profile').set('Cookie', cookie).expect(200);
    expect(before.body).toMatchObject({ email, firstName: null, lastName: null });
    await http()
      .patch('/auth/profile')
      .set('Cookie', cookie)
      .send({ firstName: ' Ana ', lastName: 'Owner' })
      .expect(200)
      .expect((res) => expect(res.body).toEqual({ firstName: 'Ana', lastName: 'Owner' }));
    const after = await http().get('/auth/profile').set('Cookie', cookie).expect(200);
    expect(after.body).toMatchObject({ firstName: 'Ana', lastName: 'Owner' });
    await http()
      .patch('/auth/profile')
      .set('Cookie', cookie)
      .send({ firstName: 'x'.repeat(101) })
      .expect(400);
  });

  it('changes the password only with the correct current password', async () => {
    const change = (body: object) =>
      http().post('/auth/change-password').set('Cookie', cookie).send(body);
    await change({
      currentPassword: 'wrong-password-value',
      newPassword: 'another-long-password-1',
    }).expect(400);
    await change({ currentPassword: password, newPassword: 'short' }).expect(400);
    await change({ currentPassword: password, newPassword: password }).expect(400);
    await change({ currentPassword: password, newPassword: 'another-long-password-1' }).expect(204);
    await http().post('/auth/login').send({ email, password }).expect(401);
    await http()
      .post('/auth/login')
      .send({ email, password: 'another-long-password-1' })
      .expect(201);
    const events = await admin.$queryRaw<{ action: string }[]>`
      SELECT action FROM audit_logs WHERE actor_user_id=${userId}::uuid
        AND action IN ('auth.password_changed','auth.profile_updated')`;
    const actions = new Set(events.map((e) => e.action));
    expect(actions.has('auth.password_changed')).toBe(true);
    expect(actions.has('auth.profile_updated')).toBe(true);
  });
});
