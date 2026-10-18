import { propertyClock } from '../src/booking/booking-rules';
import { ClockAvailabilityService } from '../src/integrations/clock/clock-availability.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { pricingDay } from '../src/booking/pricing-evaluator';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('Rates & Pricing v2', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let roomTypeId: string;
  let userId: string;
  let cookie: string;
  const email = `rooms-${randomUUID()}@example.test`;
  const password = randomUUID() + randomUUID();
  let token = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      token = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendStaffInvitationEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
    async sendRenderedEmail() {},
  };

  const providerRead = vi.fn(
    async (_tenant: string, _property: string, q: { startsOn: string }) => ({
      ok: true,
      value: {
        total: { amount: '555.00', currency: 'EUR' },
        nightlyRates: [{ date: q.startsOn, amount: '555.00' }],
      },
    }),
  );
  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    await clearSignupRateLimits();
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_PROVIDER)
      .useValue(mail)
      .overrideProvider(ClockAvailabilityService)
      .useValue({ getQuoteWithNightlyRates: providerRead })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  const fixture = { root: '', url: '', today: '' };
  let plan: { id: string; version: number };
  let derived: { id: string; version: number };
  let activeRule: { id: string; version: number };
  const http = () => request(app.getHttpServer());
  const post = (path: string, body: Record<string, unknown>, key = randomUUID()) =>
    http()
      .post(`${fixture.url}/${path}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const patch = (path: string, body: Record<string, unknown>) =>
    http()
      .patch(`${fixture.url}/${path}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const workspace = () => http().get(fixture.url).set('Cookie', cookie);
  const base = (amount = '100.00') => ({
    ratePlanId: plan.id,
    roomTypeIds: [roomTypeId],
    allYear: true,
    operation: 'set',
    amount,
    reason: 'Pricing test setup',
  });
  const applyBase = async (body: Record<string, unknown>, key = randomUUID()) => {
    const p = await post('base-prices/preview', body).expect(201);
    return http()
      .put(`${fixture.url}/base-prices`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ ...body, version: p.body.version, previewToken: p.body.previewToken })
      .expect(200);
  };
  const ruleBody = () => ({
    name: 'High season',
    mode: 'percentage',
    value: '10.00',
    roomTypeIds: [roomTypeId],
    ratePlanIds: [],
    startsOn: fixture.today,
    endsOn: pricingDay(fixture.today, 30),
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    priority: 50,
  });
  beforeAll(async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Overview group',
        propertyName: 'Overview hotel',
        propertyAddress: 'Local test',
        propertyTimezone: 'Pacific/Auckland',
        email,
        password,
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token })
      .expect(204);
    const root = `/tenants/${tenantId}/properties/${propertyId}`,
      url = `${root}/pricing`;
    const type = await request(app.getHttpServer())
      .post(`${root}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 4 })
      .expect(201);
    roomTypeId = type.body.id;
    await request(app.getHttpServer())
      .patch(`${root}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 4, status: 'PUBLISHED' })
      .expect(200);

    const state = await http().get(url).set('Cookie', cookie).expect(200);
    Object.assign(fixture, { root, url, today: state.body.today });
  });
  it('starts empty, requires capabilities/keys and creates a plan exactly once under concurrent retry', async () => {
    const state = await workspace().expect(200);
    expect(state.body).toMatchObject({ source: 'LOCAL', plans: [], charges: [] });
    const input = { name: 'Flexible', currency: 'EUR', roomTypeIds: [roomTypeId] };
    await http().post(`${fixture.url}/plans`).set('Cookie', cookie).send(input).expect(400);
    const key = randomUUID(),
      results = await Promise.all([
        post('plans', input, key).expect(201),
        post('plans', input, key).expect(201),
      ]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    plan = results[0]!.body;
    expect(results[0]!.body).toMatchObject({ lifecycle: 'Draft', version: 1, isFallback: false });
    await post('plans', { ...input, name: 'Changed intent' }, key).expect(409);
    const logs = await admin.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*) FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='pricing.plans.create'`;
    expect(Number(logs[0]?.count)).toBe(1);
  });
  it('previews and atomically sets all-year prices, publishes and makes the first active plan fallback', async () => {
    await post(`plans/${plan.id}/activate`, { version: 1 }).expect(400);
    await applyBase(base());
    plan = (await post(`plans/${plan.id}/activate`, { version: 1 }).expect(201)).body;
    expect(plan).toMatchObject({ version: 2, lifecycle: 'Active', isFallback: true });
    await post(`plans/${plan.id}/archive`, { version: 2 }).expect(400);
  });
  it('activates adjustments, derived plans and confirmed charges and shares quote/catalog/calendar pricing', async () => {
    const draft = await post('rules', ruleBody()).expect(201);
    activeRule = (await post(`rules/${draft.body.id}/activate`, { version: 1 }).expect(201)).body;
    const d = await post('plans', {
      name: 'Nonrefundable example',
      currency: 'EUR',
      pricingBasis: 'derived',
      basePlanId: plan.id,
      adjustmentKind: 'percentage',
      adjustmentValue: '-10',
      roomTypeIds: [roomTypeId],
    }).expect(201);
    derived = (await post(`plans/${d.body.id}/activate`, { version: 1 }).expect(201)).body;
    for (const input of [
      { name: 'VAT example', basis: 'percentage_accommodation', value: '6', display: 'included' },
      {
        name: 'City fee example',
        basis: 'per_adult_night',
        value: '2',
        currency: 'EUR',
        display: 'added',
      },
    ]) {
      const body = {
        ...input,
        startsOn: fixture.today,
        confirmed: false,
        roomTypeIds: [roomTypeId],
      };
      const c = await post('charges', body).expect(201);
      await post(`charges/${c.body.id}/activate`, { version: 1 }).expect(400);
      const fixed = await patch(`charges/${c.body.id}`, {
        ...body,
        confirmed: true,
        version: 1,
      }).expect(200);
      await post(`charges/${c.body.id}/activate`, { version: fixed.body.version }).expect(201);
    }
    await http()
      .put(`${fixture.root}/inventory-units`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        roomTypeId,
        startsOn: fixture.today,
        endsOn: pricingDay(fixture.today, 30),
        availableUnits: 5,
      })
      .expect(204);
    const input = {
      roomTypeId,
      ratePlanId: derived.id,
      startsOn: pricingDay(fixture.today, 2),
      endsOn: pricingDay(fixture.today, 4),
      adults: 2,
      children: 1,
      channel: 'website',
    };
    const preview = await post('preview', input).expect(201);
    expect(preview.body.total.amount).toBe('217.88');
    const quote = await http().post(`${fixture.root}/quotes`).send(input).expect(201);
    expect(quote.body.total).toEqual(preview.body.total);
    expect(quote.body.nightlyRates).toEqual(preview.body.nightlyRates);
    const catalog = await http()
      .get(`${fixture.root}/public/catalog`)
      .query({ startsOn: input.startsOn, endsOn: input.endsOn })
      .expect(200);
    expect(catalog.body.roomTypes[0].ratePlans.map((p: { id: string }) => p.id)).toContain(
      derived.id,
    );
    const calendar = await http()
      .get(`${fixture.url}/calendar`)
      .query({ ratePlanId: derived.id, startsOn: input.startsOn, days: 7 })
      .set('Cookie', cookie)
      .expect(200);
    expect(calendar.body.rows[0].days[0].amount).toBe('106.94');
    const availability = await http()
      .get(`${fixture.root}/availability-calendar`)
      .query({ roomTypeId, month: input.startsOn.slice(0, 7) })
      .set('Cookie', cookie)
      .expect(200);
    expect(
      availability.body.days.find((d: { date: string }) => d.date === input.startsOn).pricing.total
        .amount,
    ).toBe('118.60');
  });
  it('blocks actual concurrent equal-priority activations and stale active edits', async () => {
    const a = await post('rules', { ...ruleBody(), name: 'Tie A', priority: 75 }).expect(201),
      b = await post('rules', { ...ruleBody(), name: 'Tie B', priority: 75, value: '11' }).expect(
        201,
      );
    const results = await Promise.all(
      [a.body, b.body].map((r) => post(`rules/${r.id}/activate`, { version: 1 })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = results.find((r) => r.status === 201)!.body;
    await post(`rules/${winner.id}/archive`, { version: winner.version }).expect(201);
    const updates = await Promise.all(
      ['12', '14'].map((value) =>
        patch(`rules/${activeRule.id}`, {
          ...ruleBody(),
          value,
          version: activeRule.version,
          changeReason: 'Concurrent test',
        }),
      ),
    );
    expect(updates.map((r) => r.status).sort()).toEqual([200, 409]);
    activeRule = updates.find((r) => r.status === 200)!.body;
    activeRule = (
      await patch(`rules/${activeRule.id}`, {
        ...ruleBody(),
        version: activeRule.version,
        changeReason: 'Restore test rule',
      }).expect(200)
    ).body;
  });
  it('handles real concurrent bulk edits, retry receipts, weekday leap edges and stale previews', async () => {
    const input = {
      ratePlanId: plan.id,
      roomTypeIds: [roomTypeId],
      startsOn: '2036-02-28',
      endsOn: '2036-03-03',
      operation: 'set',
      amount: '120.00',
      weekdays: [5, 6, 7],
      reason: 'Leap date test',
    };
    const p = await post('base-prices/preview', input).expect(201);
    expect(p.body.changes.map((c: { date: string }) => c.date)).toEqual([
      '2036-02-29',
      '2036-03-01',
      '2036-03-02',
    ]);
    const body = { ...input, version: p.body.version, previewToken: p.body.previewToken },
      key = randomUUID();
    const send = (value: Record<string, unknown>, k: string) =>
      http()
        .put(`${fixture.url}/base-prices`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', k)
        .send(value);
    await Promise.all([send(body, key).expect(200), send(body, key).expect(200)]);
    await send(body, key).expect(200);
    await send({ ...body, amount: '130' }, key).expect(409);
    const p2 = await post('base-prices/preview', { ...input, amount: '130' }).expect(201),
      p3 = await post('base-prices/preview', { ...input, amount: '140' }).expect(201);
    const edits = await Promise.all([
      send(
        { ...input, amount: '130', version: p2.body.version, previewToken: p2.body.previewToken },
        randomUUID(),
      ),
      send(
        { ...input, amount: '140', version: p3.body.version, previewToken: p3.body.previewToken },
        randomUUID(),
      ),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    await post('base-prices/preview', {
      ...input,
      startsOn: pricingDay(fixture.today, -1),
      endsOn: fixture.today,
    }).expect(400);
    await post('base-prices/preview', { ...input, startsOn: '2036-02-30' }).expect(400);
    await post('base-prices/preview', { ...input, endsOn: '2040-01-01' }).expect(400);
    const logs = await admin.$queryRaw<
      Array<{ details: { result: { changes: unknown[] } } }>
    >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='pricing.base.bulk_change' ORDER BY created_at DESC`;
    expect(logs[0]?.details.result.changes).toHaveLength(3);
  });
  it('retains issued quote and booking totals/components after future pricing changes', async () => {
    const stay = {
      roomTypeId,
      ratePlanId: derived.id,
      startsOn: pricingDay(fixture.today, 6),
      endsOn: pricingDay(fixture.today, 8),
      adults: 2,
      children: 0,
    };
    const q = await http().post(`${fixture.root}/quotes`).send(stay).expect(201),
      guestCookie = q.headers['set-cookie'][0],
      old = JSON.parse(JSON.stringify(q.body));
    await applyBase(base('200.00'));
    const newer = await http().post(`${fixture.root}/quotes`).send(stay).expect(201);
    expect(newer.body.total.amount).not.toBe(old.total.amount);
    await http()
      .patch(`${fixture.root}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);
    const booking = await http()
      .post(`${fixture.root}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...stay,
        guest: {
          firstName: 'Pricing',
          lastName: 'Fixture',
          email: `pricing-guest-${randomUUID()}@example.test`,
          phone: '+355690000001',
        },
        total: old.total,
        quoteToken: old.quoteToken,
        paymentMethod: 'pay_at_hotel',
      })
      .expect(201);
    expect(booking.body).toMatchObject({ ok: true, value: { total: old.total } });
    const id = booking.body.value.id;
    const before = await admin.$queryRaw<
      Array<{ total: string; nightlyRates: unknown }>
    >`SELECT total_amount::text AS total,nightly_rates AS "nightlyRates" FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    expect(before[0]?.nightlyRates).toEqual(old.nightlyRates);
    await applyBase(base('300.00'));
    const after = await admin.$queryRaw<
      Array<{ total: string; nightlyRates: unknown }>
    >`SELECT total_amount::text AS total,nightly_rates AS "nightlyRates" FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
    expect(after).toEqual(before);
  });
  it('isolates actual tenant/property targets and operation receipts under forced RLS', async () => {
    const foreignTenant = randomUUID(),
      foreignProperty = randomUUID(),
      foreignType = randomUUID();
    await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${foreignTenant}::uuid,'Foreign pricing test')`;
    try {
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${foreignProperty}::uuid,${foreignTenant}::uuid,'Foreign pricing','foreign-pricing','UTC')`;
      await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${foreignType}::uuid,${foreignTenant}::uuid,${foreignProperty}::uuid,'Other type',2)`;
      await post('rules', { ...ruleBody(), roomTypeIds: [foreignType] }).expect(404);
      await http()
        .get(`/tenants/${tenantId}/properties/${foreignProperty}/pricing`)
        .set('Cookie', cookie)
        .expect(403);
      const db = app.get(TenantDatabaseService);
      expect(
        await db.withTenantTransaction(
          { tenantId: foreignTenant, propertyId: foreignProperty },
          (tx) =>
            tx.$queryRaw`SELECT * FROM pricing_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
        ),
      ).toEqual([]);
      const flags = await admin.$queryRaw<
        Array<{ relname: string; relforcerowsecurity: boolean }>
      >`SELECT relname,relforcerowsecurity FROM pg_class WHERE relname IN ('pricing_operations','pricing_daily_prices','pricing_adjustments','pricing_charges')`;
      expect(flags).toHaveLength(4);
      expect(flags.every((f) => f.relforcerowsecurity)).toBe(true);
    } finally {
      await cleanupTenant(admin, foreignTenant);
    }
  });
  it('checks view/write capability and email; exposes full-horizon issues and exact history', async () => {
    const state = await workspace().expect(200);
    expect(state.body.coverage.horizonComplete).toBe(false);
    expect(state.body.coverage.endsOn).toBe(pricingDay(fixture.today, 365));
    await admin.$executeRaw`UPDATE properties SET advance_booking_days=800 WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    const bounded = await workspace().expect(200);
    expect(bounded.body.coverage.horizonComplete).toBe(true);
    expect(bounded.body.coverage.endsOn).toBe(pricingDay(fixture.today, 801));
    await http()
      .get(`${fixture.url}/history/plans/${plan.id}`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((r) => expect(r.body.length).toBeGreaterThan(0));
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    await post('rules', ruleBody()).expect(403);
    await workspace().expect(200);
    await admin.$executeRaw`UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=${userId}::uuid`;
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    await workspace().expect(403);
    await post('rules', ruleBody()).expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
  });
  it('copies independent prices as a new draft and rejects bulk changes that produce a negative adjusted price', async () => {
    const created = await post('plans', { name: 'Negative guard fixture', currency: 'EUR' }).expect(
      201,
    );
    const independent = created.body as { id: string; version: number };
    await applyBase({ ...base('100.00'), ratePlanId: independent.id });
    const active = await post(`plans/${independent.id}/activate`, { version: 1 }).expect(201);
    const adjustment = await post('rules', {
      ...ruleBody(),
      name: 'Fixed discount fixture',
      mode: 'fixed',
      currency: 'EUR',
      value: '-10.00',
      priority: 99,
      ratePlanIds: [independent.id],
    }).expect(201);
    await post(`rules/${adjustment.body.id}/activate`, { version: 1 }).expect(201);
    const body = { ...base('5.00'), ratePlanId: independent.id };
    const preview = await post('base-prices/preview', body).expect(201);
    expect(preview.body.valid).toBe(false);
    expect(preview.body.errors[0]).toMatchObject({
      code: 'PRICING_AMOUNT_INVALID',
      roomTypeId,
      ratePlanId: independent.id,
    });
    await http()
      .put(`${fixture.url}/base-prices`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, version: preview.body.version, previewToken: preview.body.previewToken })
      .expect(400);
    const copied = await post(`plans/${independent.id}/duplicate`, {
      version: active.body.version,
    }).expect(201);
    expect(copied.body).toMatchObject({ lifecycle: 'Draft', version: 1, isFallback: false });
    const saved = await workspace().expect(200);
    expect(
      saved.body.base.find(
        (b: { ratePlanId: string; amount: string }) => b.ratePlanId === independent.id,
      )?.amount,
    ).toBe('100.00');
    expect(
      saved.body.base.find(
        (b: { ratePlanId: string; amount: string }) => b.ratePlanId === copied.body.id,
      )?.amount,
    ).toBe('100.00');
    await admin.$executeRaw`UPDATE properties SET timezone='Pacific/Kiritimati' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    const zoned = await workspace().expect(200);
    expect(zoned.body.today).toBe(propertyClock('Pacific/Kiritimati').date);
    await admin.$executeRaw`UPDATE properties SET timezone='UTC' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
  });
  it('keeps Clock read-only, uses only the existing provider reader and never falls back to local prices', async () => {
    const connectionId = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connectionId}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Read-only pricing fixture','not-real-credentials','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind,enabled) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connectionId}::uuid,'PMS',true)`;
    const state = await workspace().expect(200);
    expect(state.body).toMatchObject({
      source: 'CLOCK_PMS',
      readOnly: true,
      plans: [],
      base: [],
      charges: [],
      providerPrices: null,
    });
    await post('rules', ruleBody()).expect(403);
    await http()
      .post(`${fixture.root}/rate-plans`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ name: 'Must not save', currency: 'EUR' })
      .expect(403);
    const p = await post('preview', {
      roomTypeId,
      startsOn: pricingDay(fixture.today, 2),
      endsOn: pricingDay(fixture.today, 3),
      adults: 1,
    }).expect(201);
    expect(p.body.total.amount).toBe('555.00');
    expect(p.body.source).toBe('CLOCK_PMS');
    expect(providerRead).toHaveBeenCalledOnce();
  });
});
