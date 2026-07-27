import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, it } from 'vitest';

describe('Health endpoint', () => {
  let app: INestApplication;
  let appModule: typeof import('../src/app.module').AppModule;

  beforeEach(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';

    ({ AppModule: appModule } = await import('../src/app.module'));
  });

  afterEach(async () => {
    await app?.close();
  });

  it('returns an OK status payload', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [appModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });
});
