import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ProviderHealthService } from '../src/platform/provider-health.service';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('platform provider health', () => {
  let app: INestApplication;
  const userId = randomUUID();
  const email = `provider-health-${randomUUID()}@must.al`;
  const password = 'correct-horse-battery-staple';
  const mail: MailProvider = {
    async sendVerificationEmail() {},
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
  };

  beforeAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.POKPAY_KEY_ID;
    delete process.env.POKPAY_KEY_SECRET;
    delete process.env.POKPAY_MERCHANT_ID;
    delete process.env.POKPAY_WEBHOOK_URL;

    const redis = createClient({ url: 'redis://localhost:6379' });
    await redis.connect();
    await redis.del(['platform:provider-health:stripe', 'platform:provider-health:pokpay']);
    await redis.quit();

    const hash = await bcrypt.hash(password, 12);
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_platform_admin")
      VALUES (${userId}::uuid, ${email}, ${hash}, CURRENT_TIMESTAMP, true)
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

    const redisAfterInit = createClient({ url: 'redis://localhost:6379' });
    await redisAfterInit.connect();
    await redisAfterInit.del([
      'platform:provider-health:stripe',
      'platform:provider-health:pokpay',
    ]);
    await redisAfterInit.quit();
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "actor_user_id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
    await app.close();
    const redis = createClient({ url: 'redis://localhost:6379' });
    await redis.connect();
    await redis.del(['platform:provider-health:stripe', 'platform:provider-health:pokpay']);
    await redis.quit();
    await migrationPrisma.$disconnect();
  });

  it('returns checking before the first scheduled run and cached results afterward', async () => {
    const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const cookie = login.headers['set-cookie'][0] as string;

    const initial = await request(app.getHttpServer())
      .get('/platform/provider-health')
      .set('Cookie', cookie)
      .expect(200);
    expect(initial.body.stripe).toEqual({ status: 'checking', ok: null, checkedAt: null });
    expect(['checking', 'unhealthy']).toContain(initial.body.pokpay.status);

    await app.get(ProviderHealthService).checkAll();
    const response = await request(app.getHttpServer())
      .get('/platform/provider-health')
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body.stripe).toMatchObject({ status: 'unhealthy', ok: false });
    expect(response.body.pokpay).toMatchObject({ status: 'unhealthy', ok: false });
    expect(response.body.stripe.checkedAt).toEqual(expect.any(String));
  });

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/platform/provider-health').expect(401);
  });
});
