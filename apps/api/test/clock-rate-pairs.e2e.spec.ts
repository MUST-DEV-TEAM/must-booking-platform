import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClockAvailabilityService } from '../src/integrations/clock/clock-availability.service';
import { ClockBackgroundSyncService } from '../src/integrations/clock/clock-background-sync.service';
import { ClockPermissionsMonitorService } from '../src/integrations/clock/clock-permissions-monitor.service';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { AlertEmailService } from '../src/mail/alert-email.service';
import { ScheduledEmailService } from '../src/mail/scheduled-email.service';
import { CapabilitiesService } from '../src/tenancy/capabilities.service';
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

describe('Clock rate pairs: storage, RLS and HTTP authorization', () => {
  const email = `website-rates-${randomUUID()}@example.test`;
  let app: INestApplication;
  let cookie = '';
  let otherCookie = '';
  let sameTenantPropertyId = '';
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
    if (!cookie) cookie = signup.headers['set-cookie'][0];
    else otherCookie = signup.headers['set-cookie'][0];
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
    let builder = withoutExternalWorkers(Test.createTestingModule({ imports: [AppModule] }));
    for (const provider of [
      ClockBackgroundSyncService,
      ClockPermissionsMonitorService,
      AlertEmailService,
      ScheduledEmailService,
    ])
      builder = builder.overrideProvider(provider).useValue({});
    builder = builder
      .overrideProvider(MailDeliveryService)
      .useValue({ dispatch: vi.fn().mockResolvedValue(undefined) });
    builder = builder.overrideProvider(ClockAvailabilityService).useValue({
      ratesForAllRoomTypesDetailed: vi.fn().mockResolvedValue({
        ok: true,
        value: new Map([['rt', [{ externalRateId: 'promo' }, { externalRateId: 'normal' }]]]),
      }),
    });
    app = (await builder.compile()).createNestApplication();
    await app.init();
    const one = await signUp('Rates One', email);
    const two = await signUp('Rates Two', `website-rates-${randomUUID()}@example.test`);
    Object.assign(ids, one, {
      otherTenantId: two.tenantId,
      otherPropertyId: two.propertyId,
      otherUserId: two.userId,
    });
    sameTenantPropertyId = randomUUID();
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,address,timezone) VALUES(${sameTenantPropertyId}::uuid,${ids.tenantId}::uuid,'Pair test second hotel',${'pair-test-' + sameTenantPropertyId},'2 Rate Way','Europe/Tirane')`;
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const tenantId of [ids.tenantId, ids.otherTenantId])
      if (tenantId) await cleanupTenant(admin, tenantId);
    for (const userId of [ids.userId, ids.otherUserId])
      if (userId) await admin.$executeRaw`DELETE FROM users WHERE id=${userId}::uuid`;
    await admin.$disconnect();
  });

  it('sets, updates, clears and caches per hotel, auditing actual changes atomically', async () => {
    const { ClockRatePairsService } =
      await import('../src/integrations/clock/clock-rate-pairs.service');
    const service = app.get(ClockRatePairsService);
    expect(await service.pairs(ids.tenantId, ids.propertyId)).toEqual({});
    expect(await service.setPair(ids.tenantId, ids.propertyId, 'promo', 'normal', ids.userId)).toBe(
      true,
    );
    expect(await service.setPair(ids.tenantId, ids.propertyId, 'promo', 'normal', ids.userId)).toBe(
      false,
    );
    expect(await service.pairs(ids.tenantId, ids.propertyId)).toEqual({ promo: 'normal' });
    expect(await service.pairs(ids.otherTenantId, ids.otherPropertyId)).toEqual({});
    expect(await service.pairs(ids.tenantId, sameTenantPropertyId)).toEqual({});
    expect(await service.setPair(ids.tenantId, ids.propertyId, 'promo', 'other', ids.userId)).toBe(
      true,
    );
    expect(await service.pairs(ids.tenantId, ids.propertyId)).toEqual({ promo: 'other' });
    expect(await service.setPair(ids.tenantId, ids.propertyId, 'promo', null, ids.userId)).toBe(
      true,
    );
    expect(await service.pairs(ids.tenantId, ids.propertyId)).toEqual({});
    const events = await admin.$queryRaw<
      Array<{ action: string }>
    >`SELECT action FROM audit_logs WHERE tenant_id=${ids.tenantId}::uuid AND property_id=${ids.propertyId}::uuid AND action='rates.pair_changed'`;
    expect(events).toHaveLength(3);
  });

  it('enforces tenant and property read/write RLS even on raw queries', async () => {
    await admin.$executeRaw`INSERT INTO clock_rate_pairs(tenant_id,property_id,promo_rate_id,compare_rate_id) VALUES(${ids.tenantId}::uuid,${ids.propertyId}::uuid,'private','normal')`;
    const { TenantDatabaseService } = await import('../src/tenancy/tenant-database.service');
    const db = app.get(TenantDatabaseService);
    for (const context of [
      { tenantId: ids.otherTenantId, propertyId: ids.otherPropertyId },
      { tenantId: ids.tenantId, propertyId: sameTenantPropertyId },
    ]) {
      expect(
        await db.withTenantTransaction(context, (tx) =>
          tx.$queryRawUnsafe('SELECT * FROM clock_rate_pairs'),
        ),
      ).toEqual([]);
      expect(
        await db.withTenantTransaction(context, (tx) =>
          tx.$executeRawUnsafe('UPDATE clock_rate_pairs SET compare_rate_id=$1', 'stolen'),
        ),
      ).toBe(0);
      await expect(
        db.withTenantTransaction(context, (tx) =>
          tx.$executeRawUnsafe(
            'INSERT INTO clock_rate_pairs(tenant_id,property_id,promo_rate_id,compare_rate_id) VALUES($1::uuid,$2::uuid,$3,$4)',
            ids.tenantId,
            ids.propertyId,
            'forged',
            'normal',
          ),
        ),
      ).rejects.toThrow();
    }
    expect(
      await db.withTenantTransaction({ tenantId: ids.tenantId, propertyId: ids.propertyId }, (tx) =>
        tx.$queryRawUnsafe<unknown[]>('SELECT * FROM clock_rate_pairs'),
      ),
    ).toHaveLength(1);
  });

  it('requires a session, tenant membership, rates.manage and verified email to change pairs', async () => {
    const url = `/tenants/${ids.tenantId}/properties/${ids.propertyId}/clock-rate-pairs`;
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer())
      .put(`${url}/promo`)
      .send({ compareRateId: 'normal' })
      .expect(401);
    await request(app.getHttpServer()).get(url).set('Cookie', otherCookie).expect(403);
    await request(app.getHttpServer())
      .put(`${url}/promo`)
      .set('Cookie', cookie)
      .send({ compareRateId: 'normal' })
      .expect(403);
    await admin.$executeRaw`UPDATE users SET email_verified_at=NOW() WHERE id=${ids.userId}::uuid`;
    const cap = vi.spyOn(app.get(CapabilitiesService), 'effective').mockResolvedValue([]);
    await request(app.getHttpServer()).get(url).set('Cookie', cookie).expect(403);
    await request(app.getHttpServer())
      .put(`${url}/promo`)
      .set('Cookie', cookie)
      .send({ compareRateId: 'normal' })
      .expect(403);
    cap.mockRestore();
    await request(app.getHttpServer())
      .put(`${url}/promo`)
      .set('Cookie', cookie)
      .send({ compareRateId: 'normal' })
      .expect(200);
    const answer = await request(app.getHttpServer()).get(url).set('Cookie', cookie).expect(200);
    expect(answer.body.pairs.promo).toBe('normal');
    await request(app.getHttpServer())
      .put(`${url}/promo`)
      .set('Cookie', cookie)
      .send({ compareRateId: null })
      .expect(200);
  });
});
