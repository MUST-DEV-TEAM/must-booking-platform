import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SIGNUP_EMAIL_LIMIT,
  SIGNUP_IP_LIMIT,
  SignupRateLimiterService,
} from '../src/auth/signup-rate-limiter.service';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

describe('signup rate limiting', () => {
  let app: INestApplication;
  let limiter: SignupRateLimiterService;

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    limiter = app.get(SignupRateLimiterService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces independent Redis-backed limits for IP addresses and email addresses', async () => {
    const ip = `ip-${randomUUID()}`;
    const email = `email-${randomUUID()}@example.test`;

    for (let attempt = 0; attempt < SIGNUP_IP_LIMIT; attempt += 1) {
      await expect(limiter.consume(ip, `ip-${attempt}-${email}`)).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(limiter.consume(ip, `ip-over-limit-${email}`)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });

    const emailIp = `email-ip-${randomUUID()}`;
    for (let attempt = 0; attempt < SIGNUP_EMAIL_LIMIT; attempt += 1) {
      await expect(limiter.consume(`${emailIp}-${attempt}`, email)).resolves.toMatchObject({
        allowed: true,
      });
    }
    await expect(limiter.consume(`${emailIp}-over-limit`, email)).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('returns 429 and Retry-After after the email cap without blocking under-cap requests', async () => {
    const email = `endpoint-${randomUUID()}@example.test`;

    for (let attempt = 0; attempt < SIGNUP_EMAIL_LIMIT; attempt += 1) {
      await request(app.getHttpServer()).post('/auth/signup').send({ email }).expect(400);
    }
    const limited = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email })
      .expect(429);

    expect(limited.headers['retry-after']).toMatch(/^[1-9]\d*$/);
  });
});
