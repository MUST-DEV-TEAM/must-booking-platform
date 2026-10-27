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

describe('Clock rates switched off for the website', () => {
  const email = `website-rates-${randomUUID()}@example.test`;
  let app: INestApplication;
  const ids = {
    tenantId: '',
    propertyId: '',
    userId: '',
    otherTenantId: '',
    otherPropertyId: '',
    otherUserId: '',
  };

  async function signUp(name: string, mail: string) {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: name,
        propertyName: `${name} Hotel`,
        propertyAddress: '1 Rate Way',
        propertyTimezone: 'Europe/Tirane',
        email: mail,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    return {
      tenantId: signup.body.organization.id as string,
      propertyId: signup.body.property.id as string,
      userId: signup.body.user.id as string,
    };
  }

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
    const one = await signUp('Rates One', email);
    const two = await signUp('Rates Two', `website-rates-${randomUUID()}@example.test`);
    Object.assign(ids, one, {
      otherTenantId: two.tenantId,
      otherPropertyId: two.propertyId,
      otherUserId: two.userId,
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const tenantId of [ids.tenantId, ids.otherTenantId])
      if (tenantId) await cleanupTenant(admin, tenantId);
    for (const userId of [ids.userId, ids.otherUserId])
      if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('are remembered per hotel, come back on when switched on, and never leak to another hotel', async () => {
    const { ClockWebsiteRatesService } =
      await import('../src/integrations/clock/clock-website-rates.service');
    const rates = app.get(ClockWebsiteRatesService);

    expect([...(await rates.hiddenRateIds(ids.tenantId, ids.propertyId))]).toEqual([]);

    expect(
      await rates.setOnWebsite(ids.tenantId, ids.propertyId, '615688', false, ids.userId),
    ).toBe(true);
    // Switching it off twice changes nothing.
    expect(
      await rates.setOnWebsite(ids.tenantId, ids.propertyId, '615688', false, ids.userId),
    ).toBe(false);
    expect([...(await rates.hiddenRateIds(ids.tenantId, ids.propertyId))]).toEqual(['615688']);
    expect([...(await rates.hiddenRateIds(ids.otherTenantId, ids.otherPropertyId))]).toEqual([]);

    expect(await rates.setOnWebsite(ids.tenantId, ids.propertyId, '615688', true)).toBe(true);
    expect([...(await rates.hiddenRateIds(ids.tenantId, ids.propertyId))]).toEqual([]);
  });

  it('cannot be read by another hotel straight from the table (row-level security)', async () => {
    await admin.$executeRaw`INSERT INTO clock_website_hidden_rates(tenant_id,property_id,external_rate_id) VALUES(${ids.tenantId}::uuid,${ids.propertyId}::uuid,'777')`;
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const database = app.get(TenantDatabaseService);
    const seenByOther = await database.withTenantTransaction(
      { tenantId: ids.otherTenantId, propertyId: ids.otherPropertyId },
      (tx) => tx.$queryRawUnsafe<unknown[]>('SELECT * FROM clock_website_hidden_rates'),
    );
    expect(seenByOther).toEqual([]);
    const seenByOwner = await database.withTenantTransaction(
      { tenantId: ids.tenantId, propertyId: ids.propertyId },
      (tx) => tx.$queryRawUnsafe<unknown[]>('SELECT * FROM clock_website_hidden_rates'),
    );
    expect(seenByOwner).toHaveLength(1);
  });
});
