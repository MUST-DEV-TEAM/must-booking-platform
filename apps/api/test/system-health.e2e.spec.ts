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

describe('hotel system health', () => {
  const email = `health-${randomUUID()}@example.test`;
  let app: INestApplication;
  let tenantId = '';
  let propertyId = '';
  let userId = '';
  let cookie = '';

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    app = (
      await withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] })).compile()
    ).createNestApplication();
    await app.init();
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Health Fixture Group',
        propertyName: 'Health Fixture Hotel',
        propertyAddress: '1 Health Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('returns the four live signals for the hotel and requires a session', async () => {
    const url = `/tenants/${tenantId}/properties/${propertyId}/system-health`;
    await request(app.getHttpServer()).get(url).expect(401);
    const res = await request(app.getHttpServer()).get(url).set('Cookie', cookie).expect(200);
    expect(res.body.signals.map((s: { key: string }) => s.key)).toEqual([
      'reservations',
      'pms',
      'payments',
      'emails',
    ]);
    // A brand-new hotel has no payment method switched on yet.
    expect(res.body.signals.find((s: { key: string }) => s.key === 'payments').status).toBe(
      'attention',
    );
    expect(['healthy', 'attention', 'unknown']).toContain(res.body.overall);
  });

  it("never returns another hotel's health", async () => {
    await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/properties/${randomUUID()}/system-health`)
      .set('Cookie', cookie)
      .expect((res) => expect([403, 404]).toContain(res.status));
  });
});
