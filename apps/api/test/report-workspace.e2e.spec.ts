import { ReportOtbService } from '../src/tenancy/report-otb.service';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { ReportViewsService } from '../src/tenancy/report-views.service';
import { ReportWorkspaceService } from '../src/tenancy/report-workspace.service';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { reportFacts } from '../src/tenancy/report-facts.repository';
import { parseReportQuery } from '../src/tenancy/report-query';
import { propertyDay, shiftDay } from '../src/tenancy/report-metrics';

/**
 * A time zone far from UTC, but where it is not the small hours: the nightly snapshot refuses to run before 02:00
 * local time, so a fixed zone made this test fail for two hours of every day.
 */
const CAPTURE_ZONE = (() => {
  for (const zone of ['Pacific/Auckland', 'America/New_York', 'Europe/Tirane', 'Asia/Tokyo']) {
    const hour = Number(
      new Intl.DateTimeFormat('en', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(
        new Date(),
      ),
    );
    if (hour >= 3 && hour <= 21) return zone;
  }
  return 'UTC';
})();

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
describe('Reports R2 real scoped projections, cache and export audit', () => {
  let app: INestApplication, templates: PropertyRoleTemplatesService;
  const tenant = randomUUID(),
    foreignTenant = randomUUID(),
    property = randomUUID(),
    otherProperty = randomUUID(),
    foreignProperty = randomUUID();
  const owner = randomUUID(),
    staff = randomUUID(),
    king = randomUUID(),
    family = randomUUID(),
    eur = randomUUID(),
    usd = randomUUID(),
    guest = randomUUID();
  const b1 = randomUUID(),
    b2 = randomUUID(),
    cancel = randomUUID(),
    otherType = randomUUID(),
    otherPlan = randomUUID(),
    otherBooking = randomUUID();
  const connection = randomUUID(),
    block = randomUUID(),
    duplicateBlock = randomUUID();
  const ownerEmail = `reports-owner-${randomUUID()}@example.test`,
    staffEmail = `reports-staff-${randomUUID()}@example.test`,
    password = randomUUID() + randomUUID();
  let ownerCookie = '',
    staffCookie = '';
  const root = (p = property, t = tenant) => `/tenants/${t}/properties/${p}/reports`;
  const query = { from: '2026-03-29', to: '2026-03-30', report: 'reservations' };
  const get = (q: Record<string, unknown> = {}, cookie = ownerCookie, p = property) =>
    request(app.getHttpServer())
      .get(`${root(p)}/workspace`)
      .set('Cookie', cookie)
      .query({ ...query, ...q });
  const post = (body: Record<string, unknown>, cookie = ownerCookie) =>
    request(app.getHttpServer()).post(`${root()}/exports`).set('Cookie', cookie).send(body);
  const context = { tenantId: tenant, propertyId: property, userId: owner };
  const nights = [
    {
      date: '2026-03-29',
      amount: '110.00',
      components: [
        { kind: 'base', amount: '100.00' },
        { kind: 'charge', id: 'fee', name: 'Recorded charge', amount: '10.00' },
      ],
    },
    {
      date: '2026-03-30',
      amount: '110.00',
      components: [
        { kind: 'base', amount: '100.00' },
        { kind: 'charge', id: 'fee', name: 'Recorded charge', amount: '10.00' },
      ],
    },
  ];

  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    templates = module.get(PropertyRoleTemplatesService);
    const hash = await bcrypt.hash(password, 12);
    await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${tenant}::uuid,'Reports test'),(${foreignTenant}::uuid,'Foreign test')`;
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${property}::uuid,${tenant}::uuid,'Reports local','r2-main','Europe/Tirane'),(${otherProperty}::uuid,${tenant}::uuid,'Reports second','r2-second','UTC'),(${foreignProperty}::uuid,${foreignTenant}::uuid,'Reports foreign','r2-foreign','UTC')`;
    await admin.$executeRaw`INSERT INTO users(id,email,password_hash,email_verified_at) VALUES(${owner}::uuid,${ownerEmail},${hash},now()),(${staff}::uuid,${staffEmail},${hash},now())`;
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenant}::uuid,${owner}::uuid,'OWNER'),(${tenant}::uuid,${staff}::uuid,'STAFF')`;
    await templates.ensureBuiltInTemplates(tenant, property);
    const roles = await admin.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM property_role_templates WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND name='Front Desk'`;
    await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenant}::uuid,${property}::uuid,${staff}::uuid,${roles[0]!.id}::uuid)`;
    ownerCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    staffCookie = (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${king}::uuid,${tenant}::uuid,${property}::uuid,'King',3),(${family}::uuid,${tenant}::uuid,${property}::uuid,'Family',3),(${otherType}::uuid,${tenant}::uuid,${otherProperty}::uuid,'Other type',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${eur}::uuid,${tenant}::uuid,${property}::uuid,'EUR plan','EUR'),(${usd}::uuid,${tenant}::uuid,${property}::uuid,'USD plan','USD'),(${otherPlan}::uuid,${tenant}::uuid,${otherProperty}::uuid,'Other plan','EUR')`;
    await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email,first_name,last_name) VALUES(${guest}::uuid,${tenant}::uuid,'fixture@example.test','Guest','One')`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,external_reference,status,starts_on,ends_on,total_amount,nightly_rates,payment_method,created_at,source,adults,children) VALUES
      (${b1}::uuid,${tenant}::uuid,${property}::uuid,${king}::uuid,${eur}::uuid,${guest}::uuid,'=unsafe reference','CONFIRMED','2026-03-29','2026-03-31',220,${JSON.stringify(nights)}::jsonb,'STRIPE_CHECKOUT','2026-03-28T23:30:00Z','WEBSITE',2,1),
      (${b2}::uuid,${tenant}::uuid,${property}::uuid,${king}::uuid,${usd}::uuid,${guest}::uuid,'USD reservation','CONFIRMED','2026-03-29','2026-03-30',200,'[{"date":"2026-03-29","amount":"200.00"}]'::jsonb,'PAY_AT_HOTEL','2026-03-29T22:30:00Z','DIRECT',1,0),
      (${cancel}::uuid,${tenant}::uuid,${property}::uuid,${family}::uuid,${eur}::uuid,${guest}::uuid,'Cancelled reservation','CANCELLED','2026-03-29','2026-03-31',300,null,'PAY_AT_HOTEL','2026-03-29T08:00:00Z',null,1,0),
      (${otherBooking}::uuid,${tenant}::uuid,${otherProperty}::uuid,${otherType}::uuid,${otherPlan}::uuid,null,'Other hotel booking','CONFIRMED','2026-03-29','2026-03-30',900,'[{"date":"2026-03-29","amount":"900.00"}]'::jsonb,'FREE','2026-03-29T08:00:00Z',null,1,0)`;
    await admin.$executeRaw`UPDATE bookings SET cancellation_is_free=true,cancellation_cutoff_at='2026-03-30T10:00:00Z' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${cancel}::uuid`;
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency,created_at) VALUES
      (${tenant}::uuid,${property}::uuid,${b1}::uuid,'CHARGE','manual','r2-charge-eur','PAID',100,'EUR','2026-03-28T23:15:00Z'),
      (${tenant}::uuid,${property}::uuid,${b1}::uuid,'REFUND','manual','r2-refund-eur','REFUNDED',20,'EUR','2026-03-30T22:15:00Z'),
      (${tenant}::uuid,${property}::uuid,${b1}::uuid,'REFUND','manual','r2-failed-refund','FAILED',999,'EUR','2026-03-29T10:00:00Z'),
      (${tenant}::uuid,${property}::uuid,${b2}::uuid,'CHARGE','manual','r2-charge-usd','succeeded',200,'USD','2026-03-29T22:30:00Z'),
      (${tenant}::uuid,${property}::uuid,${b1}::uuid,'CHARGE','manual','r2-mismatch','PAID',5,'USD','2026-03-29T14:00:00Z')`;
    await admin.$executeRaw`INSERT INTO inventory_units(tenant_id,property_id,room_type_id,stays_on,available_units) VALUES(${tenant}::uuid,${property}::uuid,${king}::uuid,'2026-03-29',4),(${tenant}::uuid,${property}::uuid,${king}::uuid,'2026-03-30',4),(${tenant}::uuid,${property}::uuid,${family}::uuid,'2026-03-29',2),(${tenant}::uuid,${property}::uuid,${family}::uuid,'2026-03-30',2)`;
    for (const id of [block, duplicateBlock]) {
      await admin.$executeRaw`INSERT INTO availability_blocks(id,tenant_id,property_id,starts_on,ends_on,reason,title,lifecycle) VALUES(${id}::uuid,${tenant}::uuid,${property}::uuid,'2026-03-29','2026-03-30','maintenance','Maintenance','Active')`;
      await admin.$executeRaw`INSERT INTO availability_block_room_types(tenant_id,property_id,block_id,room_type_id) VALUES(${tenant}::uuid,${property}::uuid,${id}::uuid,${king}::uuid)`;
    }
    await admin.$executeRaw`INSERT INTO inventory_restrictions(tenant_id,property_id,reference,name,type,value,scope,target_ids,starts_on,ends_on,weekdays,priority,lifecycle,created_by_user_id,updated_by_user_id) VALUES(${tenant}::uuid,${property}::uuid,'R2-1','Minimum','minimum_stay',3,'room_type',ARRAY[${king}::uuid],'2026-03-29','2026-03-29',ARRAY[1,2,3,4,5,6,7],1,'Active',${owner}::uuid,${owner}::uuid)`;
    await admin.$executeRaw`INSERT INTO audit_logs(tenant_id,property_id,actor_user_id,action,target_type,target_id,created_at) VALUES(${tenant}::uuid,${property}::uuid,${owner}::uuid,'booking.cancelled','booking',${cancel},'2026-03-30T09:00:00Z')`;
    await admin.$executeRaw`INSERT INTO email_messages(tenant_id,property_id,event_type,recipient_email,subject,status,idempotency_key,created_at) VALUES(${tenant}::uuid,${property}::uuid,'payment_confirmation','fixture@example.test','Fixture','DELIVERED','reports-r2-email','2026-03-29T08:00:00Z')`;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await cleanupTenant(admin, tenant);
    await cleanupTenant(admin, foreignTenant);
    await admin.$executeRaw`DELETE FROM users WHERE id IN (${owner}::uuid,${staff}::uuid)`;
    await app?.close();
    await admin.$disconnect();
  });

  it('calculates separated accrual/cash currencies, gross occupancy and cancellation cohort', async () => {
    const result = await get({ report: 'overview' }).expect(200);
    expect(result.body.summary).toMatchObject({
      bookings: 3,
      cancelled: 1,
      soldNights: 3,
      availableNights: 12,
      occupancy: 25,
      blockedNights: 4,
      minStayTypeDays: 1,
      adults: 4,
      children: 1,
    });
    expect(result.body.summary.financial).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'EUR',
          roomRevenue: '200.00',
          mandatoryCharges: '20.00',
          adr: '100.00',
          revpar: '16.67',
          collected: '100.00',
          refunded: '0.00',
          netCollected: '100.00',
          cohortNetCollected: '80.00',
          outstanding: '140.00',
          collectionRate: '36.36',
        }),
        expect.objectContaining({
          currency: 'USD',
          roomRevenue: '200.00',
          adr: '200.00',
          collected: '205.00',
          outstanding: '0.00',
        }),
      ]),
    );
    expect(result.body.meta.timezone).toBe('Europe/Tirane');
    expect(result.body.comparison).toBeNull();
  });
  it('counts created dates through Tirane DST and groups without changing period totals', async () => {
    const daily = await get().expect(200);
    expect(daily.body.series.find((r: { date: string }) => r.date === '2026-03-29').bookings).toBe(
      2,
    );
    expect(daily.body.series.find((r: { date: string }) => r.date === '2026-03-30').bookings).toBe(
      1,
    );
    const monthly = await get({ group: 'month' }).expect(200);
    expect(monthly.body.summary).toEqual(daily.body.summary);
    expect(monthly.body.series.every((r: { date: string }) => r.date === '2026-03-01')).toBe(true);
    const cancelled = monthly.body.summary.cancellationAnalysis;
    expect(cancelled).toMatchObject({ withinFreeWindow: 1, missingEvent: 0 });
  });
  it('filters every source dimension, validates scoped targets, and supports current-page sorting', async () => {
    const result = await get({
      roomTypeId: king,
      ratePlanId: eur,
      source: 'WEBSITE',
      status: 'CONFIRMED',
      paymentMethod: 'STRIPE_CHECKOUT',
      currency: 'EUR',
      sort: 'value',
      direction: 'desc',
      pageSize: 1,
    }).expect(200);
    expect(result.body.pagination.total).toBe(1);
    expect(result.body.rows[0].id).toBe(b1);
    expect(result.body.rows[0].href).toContain(`section=reservations&reservation=${b1}`);
    expect(result.body.summary.availableNights).toBe(8);
    await get({ roomTypeId: otherType }).expect(404);
    await get({ ratePlanId: otherPlan }).expect(404);
    await get({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200)
      .expect((r) => expect(r.body.pagination.total).toBe(0));
    const page = await get({ sort: 'reference', page: 2, pageSize: 1 }).expect(200);
    expect(page.body.rows).toHaveLength(1);
    expect(page.body.pagination.total).toBe(3);
  });
  it('provides end-exclusive stay/arrival/departure and cancellation-event drill cohorts', async () => {
    const departed = await get({
      from: '2026-03-30',
      to: '2026-03-30',
      rowBasis: 'departure',
      status: 'CONFIRMED',
    }).expect(200);
    expect(departed.body.rows.map((r: { id: string }) => r.id)).toEqual([b2]);
    const staying = await get({
      from: '2026-03-30',
      to: '2026-03-30',
      rowBasis: 'stay',
      status: 'CONFIRMED',
    }).expect(200);
    expect(staying.body.rows.map((r: { id: string }) => r.id)).toEqual([b1]);
    const events = await get({ rowBasis: 'cancellation' }).expect(200);
    expect(events.body.rows.map((r: { id: string }) => r.id)).toEqual([cancel]);
    expect(events.body.meta.drilldowns.soldNights).toMatchObject({
      report: 'reservations',
      rowBasis: 'stay',
      status: 'CONFIRMED',
    });
  });
  it('returns no-data comparison rather than fabricated zero last year', async () => {
    const result = await get({ comparison: 'year' }).expect(200);
    expect(result.body.comparison).toMatchObject({
      from: '2025-03-29',
      to: '2025-03-30',
      hasData: false,
      summary: null,
      series: [],
    });
    const leap = await get({ from: '2024-02-29', to: '2024-03-01', comparison: 'year' }).expect(
      200,
    );
    expect(leap.body.comparison.from).toBe('2023-02-28');
  });
  it('enforces session, tenant/property and money permissions even after cached financial reads', async () => {
    await request(app.getHttpServer()).get(`${root()}/workspace`).expect(401);
    await get({}, staffCookie).expect(403);
    await templates.setCapabilityOverride(tenant, property, staff, 'reports.view', true);
    await templates.setCapabilityOverride(tenant, property, staff, 'payments.view', true);
    const allowed = await get({}, staffCookie).expect(200);
    expect(allowed.body.summary.financial).toBeDefined();
    await templates.setCapabilityOverride(tenant, property, staff, 'payments.view', false);
    for (const report of [
      'reservations',
      'revenue',
      'accommodation',
      'guests',
      'occupancy',
      'overview',
      'quality',
    ]) {
      const denied = await get({ report }, staffCookie).expect(200);
      expect(denied.body.summary.financial).toBeUndefined();
      expect(denied.body.columns.some((c: { money: boolean }) => c.money)).toBe(false);
      expect(JSON.stringify(denied.body.rows)).not.toMatch(
        /"(?:roomRevenue|value|amount|adr|revpar)":/,
      );
      expect(JSON.stringify(denied.body.series)).not.toMatch(
        /"(?:roomRevenue|amount|adr|revpar)":/,
      );
    }
    await get({ report: 'revenue', detail: 'balances' }, staffCookie).expect(403);
    await request(app.getHttpServer())
      .get(`${root()}`)
      .set('Cookie', staffCookie)
      .expect(200)
      .expect((r) => expect(r.body.revenue).toEqual([]));
    await get({}, staffCookie, otherProperty).expect(403);
    await request(app.getHttpServer())
      .get(`${root(foreignProperty, foreignTenant)}/workspace`)
      .set('Cookie', ownerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`${root(foreignProperty)}/workspace`)
      .set('Cookie', ownerCookie)
      .expect(403);
    const second = await get({}, ownerCookie, otherProperty).expect(200);
    expect(second.body.rows.map((r: { id: string }) => r.id)).toEqual([otherBooking]);
    const first = await get().expect(200);
    expect(JSON.stringify(first.body)).not.toContain('Other hotel booking');
  });
  it('exports exactly visible selected rows with BOM/formula safety and a complete audit', async () => {
    const result = await post({
      query: { ...query, pageSize: 1, sort: 'reference' },
      target: 'rows',
      columns: ['reference', 'value', 'currency'],
      rowIds: [b1],
      format: 'csv',
    }).expect(201);
    expect(result.body.rowCount).toBe(1);
    expect(result.body.content.charCodeAt(0)).toBe(0xfeff);
    expect(result.body.content).toContain("'=unsafe reference");
    expect(result.body.content).not.toContain('USD reservation');
    const audits = await admin.$queryRaw<
      Array<{ details: Record<string, unknown>; propertyId: string; actor: string }>
    >`SELECT details,property_id AS "propertyId",actor_user_id AS actor FROM audit_logs WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND action='report.exported' AND target_id=${result.body.exportId}`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      propertyId: property,
      actor: owner,
      details: {
        rowCount: 1,
        timezone: 'Europe/Tirane',
        format: 'csv',
        moneyVisible: true,
        columns: ['reference', 'value', 'currency'],
      },
    });
    expect(audits[0]!.details).not.toHaveProperty('content');
    await post({
      query,
      target: 'rows',
      columns: ['reference'],
      rowIds: ['off-page'],
      format: 'csv',
    }).expect(400);
    await post({ query, target: 'rows', columns: ['value'], format: 'csv' }, staffCookie).expect(
      400,
    );
    await post({ query, moneyVisible: true, format: 'csv' }).expect(400);
  });
  it('exports a permission-projected print model and rechecks revocation', async () => {
    const result = await post(
      { query, target: 'series', columns: ['date', 'bookings'], format: 'print' },
      staffCookie,
    ).expect(201);
    const model = JSON.parse(result.body.content);
    expect(model.meta.moneyVisible).toBe(false);
    expect(model.summary.financial).toBeUndefined();
    await templates.setCapabilityOverride(tenant, property, staff, 'reports.view', false);
    await post({ query, format: 'csv' }, staffCookie).expect(403);
    await templates.setCapabilityOverride(tenant, property, staff, 'reports.view', true);
  });
  it('returns no file if audit persistence fails', async () => {
    const audit = vi
      .spyOn(app.get(AuditLogService), 'record')
      .mockRejectedValueOnce(new Error('test audit unavailable'));
    const result = await post({ query, format: 'csv' }).expect(500);
    expect(result.body).not.toHaveProperty('content');
    audit.mockRestore();
  });
  it('rejects an export after the displayed content changes, and accepts a reviewed snapshot', async () => {
    const service = app.get(ReportWorkspaceService),
      q = { ...query, sort: 'createdDate' };
    const shown = await service.workspace(context, q, true);
    await admin.$executeRaw`UPDATE bookings SET external_reference='Changed while exporting' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    try {
      const changed = await post({
        query: q,
        columns: ['reference'],
        expectedFingerprint: shown.meta.fingerprint,
        format: 'csv',
      }).expect(409);
      expect(changed.body.code).toBe('REPORT_CHANGED');
      expect(changed.body).not.toHaveProperty('content');
      const reviewed = await service.workspace(context, q, true);
      const result = await post({
        query: q,
        columns: ['reference'],
        expectedFingerprint: reviewed.meta.fingerprint,
        format: 'csv',
      }).expect(201);
      expect(result.body.content).toContain('Changed while exporting');
    } finally {
      await admin.$executeRaw`UPDATE bookings SET external_reference='=unsafe reference' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    }
  });
  it('keeps a bounded short snapshot cache and bypasses it for exports', async () => {
    const service = app.get(ReportWorkspaceService),
      q = { ...query, sort: 'createdDate' };
    const first = await service.workspace(context, q),
      cached = await service.workspace(context, q);
    expect(cached.meta.asOf).toBe(first.meta.asOf);
    first.rows.length = 0;
    expect((await service.workspace(context, q)).rows).toHaveLength(3);
    const fresh = await service.export(context, {
      query: q,
      columns: ['reference'],
      format: 'csv',
    });
    expect(fresh.asOf).not.toBe(first.meta.asOf);
    await new Promise((resolve) => setTimeout(resolve, 5100));
    expect((await service.workspace(context, q)).meta.asOf).not.toBe(first.meta.asOf);
  });
  it('uses a real repeatable-read snapshot under a concurrent data edit', async () => {
    const db = app.get(TenantDatabaseService);
    let ready!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => (ready = resolve)),
      proceed = new Promise<void>((resolve) => (release = resolve));
    const read = db.withTenantTransaction(
      context,
      async (tx) => {
        const before = await reportFacts(
          tx,
          tenant,
          property,
          parseReportQuery(query, '2026-10-18'),
          false,
        );
        ready();
        await proceed;
        const after = await reportFacts(
          tx,
          tenant,
          property,
          parseReportQuery(query, '2026-10-18'),
          false,
        );
        return {
          before: before.bookings.find((b) => b.id === b1)!.totalAmount,
          after: after.bookings.find((b) => b.id === b1)!.totalAmount,
        };
      },
      { timeoutMs: 15000, isolationLevel: 'RepeatableRead' },
    );
    await started;
    try {
      await admin.$executeRaw`UPDATE bookings SET total_amount=221 WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
      release();
      expect(await read).toEqual({ before: '220.00', after: '220.00' });
    } finally {
      release();
      await admin.$executeRaw`UPDATE bookings SET total_amount=220 WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    }
  });
  it('keeps missing snapshots unknown and exposes read-only quality evidence', async () => {
    await admin.$executeRaw`UPDATE bookings SET nightly_rates=null WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    try {
      const result = await app
        .get(ReportWorkspaceService)
        .workspace(context, { ...query, report: 'quality' }, true);
      expect(result.rows.some((r) => r.code === 'MISSING_NIGHTLY_PRICES')).toBe(true);
      expect(result.rows.some((r) => r.code === 'CURRENCY_MISMATCH')).toBe(true);
      expect(result.summary.financial).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ currency: 'EUR', roomRevenue: null, adr: null, revpar: null }),
        ]),
      );
    } finally {
      await admin.$executeRaw`UPDATE bookings SET nightly_rates=${JSON.stringify(nights)}::jsonb WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    }
  });
  it('provides paged receivables/reconciliation/charges/refunds and operational gates', async () => {
    const balances = await get({ report: 'revenue', detail: 'balances' }).expect(200);
    expect(balances.body.rows[0]).toMatchObject({ id: b1, outstanding: '140.00' });
    const reconciliation = await get({ report: 'revenue', detail: 'reconciliation' }).expect(200);
    expect(reconciliation.body.rows[0].difference).toBe('140.00');
    expect(reconciliation.body.summary).not.toHaveProperty('reconciliation');
    const charges = await get({ report: 'revenue', detail: 'charges' }).expect(200);
    expect(charges.body.rows).toEqual([
      expect.objectContaining({ name: 'Recorded charge', currency: 'EUR', amount: '20.00' }),
    ]);
    const refunds = await get({ report: 'revenue', detail: 'refunds', to: '2026-03-31' }).expect(
      200,
    );
    expect(refunds.body.rows[0]).toMatchObject({
      currency: 'EUR',
      amount: '20.00',
      postingDate: '2026-03-31',
      daysSinceFirstCharge: 2,
    });
    const ops = await get({ report: 'operations' }, staffCookie).expect(200);
    expect(ops.body.rows[0]).toMatchObject({ status: 'DELIVERED', count: 1 });
    expect(JSON.stringify(ops.body)).not.toContain(owner);
    await get({ report: 'operations', detail: 'staff' }, staffCookie).expect(403);
    const activity = await get({ report: 'operations', detail: 'staff' }).expect(200);
    expect(activity.body.rows.some((r: { actor: string }) => r.actor === owner)).toBe(true);
    const guests = await get({ report: 'guests' }).expect(200);
    expect(guests.body.summary).toMatchObject({ newGuests: 1, returningGuests: 0 });
    const accommodation = await get({ report: 'accommodation' }).expect(200);
    expect(accommodation.body.rows.some((r: { name: string }) => r.name === 'King')).toBe(true);
    await get({ report: 'pricing', detail: 'issues' }).expect(200);
  });
  it('shows Clock basis and unknown supply despite local stock; never substitutes local pricing health', async () => {
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenant}::uuid,'PMS','CLOCK_PMS','Test Clock','unused-test-data','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenant}::uuid,${property}::uuid,${connection}::uuid,'PMS')`;
    const result = await get({ report: 'occupancy' }).expect(200);
    expect(result.body.meta.source).toBe('CLOCK');
    expect(result.body.meta.basis).toContain('Synced from Clock');
    expect(result.body.summary).toMatchObject({
      availableNights: null,
      occupancy: null,
      blockedNights: null,
    });
    const pricing = await get({ report: 'pricing', detail: 'issues' }).expect(200);
    expect(pricing.body.rows).toEqual([]);
    expect(pricing.body.summary.pricingHealth).toBeNull();
    const reservations = await get().expect(200);
    expect(reservations.body.columns.some((c: { key: string }) => c.key === 'mealPlan')).toBe(
      false,
    );
    await admin.$executeRaw`UPDATE property_integration_connections SET enabled=false WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND connection_id=${connection}::uuid`;
  });
  it('filters cash by its own currency even when a linked booking currency differs', async () => {
    const eurOnly = await get({ currency: 'EUR' }).expect(200);
    expect(
      eurOnly.body.summary.financial.every((r: { currency: string }) => r.currency === 'EUR'),
    ).toBe(true);
    const usdOnly = await get({ currency: 'USD', group: 'week' }).expect(200);
    expect(usdOnly.body.summary.bookings).toBe(1);
    expect(usdOnly.body.summary.financial).toEqual([
      expect.objectContaining({ currency: 'USD', collected: '205.00', roomRevenue: '200.00' }),
    ]);
    await get({ sort: 'value' }, staffCookie).expect(400);
  });
  it('returns a real comparison when the prior period has stored evidence', async () => {
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount,nightly_rates,payment_method,created_at) VALUES(${id}::uuid,${tenant}::uuid,${property}::uuid,${king}::uuid,${eur}::uuid,'Prior period fixture','CONFIRMED','2026-03-27','2026-03-28',50,'[{"date":"2026-03-27","amount":"50.00"}]'::jsonb,'FREE','2026-03-27T09:00:00Z')`;
    try {
      const result = await get({ comparison: 'previous', group: 'week' }).expect(200);
      expect(result.body.comparison.hasData).toBe(true);
      expect(result.body.comparison.summary.bookings).toBe(1);
      expect(result.body.comparison.summary.financial).toEqual([
        expect.objectContaining({
          currency: 'EUR',
          roomRevenue: '50.00',
          adr: '50.00',
          revpar: null,
        }),
      ]);
    } finally {
      await admin.$executeRaw`DELETE FROM bookings WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${id}::uuid`;
    }
  });
  it('shows an honest partial no-show cohort only when stored evidence exists', async () => {
    await admin.$executeRaw`UPDATE bookings SET pms_stay_status='no_show' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b2}::uuid`;
    try {
      const result = await app
        .get(ReportWorkspaceService)
        .workspace(context, { ...query, group: 'month' }, true);
      expect(result.summary.noShow).toMatchObject({
        count: 1,
        eligibleObserved: 1,
        missingEvidence: 1,
        rate: 100,
      });
    } finally {
      await admin.$executeRaw`UPDATE bookings SET pms_stay_status=null WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b2}::uuid`;
    }
  });
  it('uses the same restriction priority evaluator, including an explicit open override', async () => {
    const closed = randomUUID(),
      opened = randomUUID();
    await admin.$executeRaw`INSERT INTO inventory_restrictions(id,tenant_id,property_id,reference,name,type,value,scope,target_ids,starts_on,ends_on,weekdays,priority,lifecycle,created_by_user_id,updated_by_user_id) VALUES
      (${closed}::uuid,${tenant}::uuid,${property}::uuid,'R2-CLOSE','Closed','stop_sell',1,'room_type',ARRAY[${king}::uuid],'2026-03-30','2026-03-30',ARRAY[1,2,3,4,5,6,7],1,'Active',${owner}::uuid,${owner}::uuid),
      (${opened}::uuid,${tenant}::uuid,${property}::uuid,'R2-OPEN','Open override','stop_sell',0,'room_type',ARRAY[${king}::uuid],'2026-03-30','2026-03-30',ARRAY[1,2,3,4,5,6,7],2,'Active',${owner}::uuid,${owner}::uuid)`;
    try {
      const result = await app
        .get(ReportWorkspaceService)
        .workspace(context, { ...query, report: 'occupancy' }, true);
      expect(result.summary.stopSellTypeDays).toBe(0);
      expect(result.summary.minStayTypeDays).toBe(1);
    } finally {
      await admin.$executeRaw`DELETE FROM inventory_restrictions WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id IN (${closed}::uuid,${opened}::uuid)`;
    }
  });
  it('uses active physical capacity, assigned-unit evidence, and the MIXED pool bottleneck', async () => {
    const room = randomUUID(),
      second = randomUUID(),
      inactive = randomUUID(),
      today = propertyDay(new Date(), 'Europe/Tirane');
    await admin.$executeRaw`INSERT INTO rooms(id,tenant_id,property_id,room_type_id,name,is_active) VALUES(${room}::uuid,${tenant}::uuid,${property}::uuid,${king}::uuid,'101',true),(${second}::uuid,${tenant}::uuid,${property}::uuid,${king}::uuid,'102',true),(${inactive}::uuid,${tenant}::uuid,${property}::uuid,${king}::uuid,'103',false)`;
    await admin.$executeRaw`UPDATE bookings SET room_id=${room}::uuid WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    await admin.$executeRaw`UPDATE properties SET booking_mode='INDIVIDUAL_ROOM_ONLY' WHERE tenant_id=${tenant}::uuid AND id=${property}::uuid`;
    try {
      const individual = await app
        .get(ReportWorkspaceService)
        .workspace(context, { ...query, report: 'accommodation', roomId: room }, true);
      expect(individual.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: '101',
            level: 'Room',
            soldNights: 2,
            roomRevenue: '200.00',
            availableNights: null,
          }),
        ]),
      );
      const current = await app
        .get(ReportWorkspaceService)
        .workspace(context, { report: 'occupancy', from: today, to: today }, true);
      expect(current.summary.availableNights).toBe(2);
      await admin.$executeRaw`INSERT INTO room_availability(tenant_id,property_id,room_id,stays_on,is_available) VALUES(${tenant}::uuid,${property}::uuid,${room}::uuid,${today}::date,false)`;
      const unavailable = await app
        .get(ReportWorkspaceService)
        .workspace(context, { report: 'occupancy', from: today, to: today }, true);
      expect(unavailable.summary.blockedNights).toBe(1);
      await admin.$executeRaw`INSERT INTO inventory_units(tenant_id,property_id,room_type_id,stays_on,available_units) VALUES(${tenant}::uuid,${property}::uuid,${king}::uuid,${today}::date,1)`;
      await admin.$executeRaw`UPDATE properties SET booking_mode='MIXED' WHERE tenant_id=${tenant}::uuid AND id=${property}::uuid`;
      const mixed = await app
        .get(ReportWorkspaceService)
        .workspace(context, { report: 'occupancy', from: today, to: today }, true);
      expect(mixed.summary).toMatchObject({ availableNights: 1, blockedNights: 0 });
    } finally {
      await admin.$executeRaw`UPDATE properties SET booking_mode='ROOM_TYPE_ONLY' WHERE tenant_id=${tenant}::uuid AND id=${property}::uuid`;
      await admin.$executeRaw`UPDATE bookings SET room_id=null WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
      await admin.$executeRaw`DELETE FROM room_availability WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND room_id=${room}::uuid`;
      await admin.$executeRaw`DELETE FROM inventory_units WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND stays_on=${today}::date`;
      await admin.$executeRaw`DELETE FROM rooms WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id IN (${room}::uuid,${second}::uuid,${inactive}::uuid)`;
    }
  });
  it('finds cancellations posted in the window even when creation and stay are outside it', async () => {
    const service = app.get(ReportWorkspaceService);
    await admin.$executeRaw`UPDATE bookings SET created_at='2026-01-01T09:00:00Z',starts_on='2026-02-01',ends_on='2026-02-02' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${cancel}::uuid`;
    try {
      const result = await service.workspace(context, { ...query, rowBasis: 'cancellation' }, true);
      expect(result.rows.map((r) => r.id)).toContain(cancel);
      expect(result.summary.cancelled).toBe(0);
    } finally {
      await admin.$executeRaw`UPDATE bookings SET created_at='2026-03-29T08:00:00Z',starts_on='2026-03-29',ends_on='2026-03-31' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${cancel}::uuid`;
    }
  });

  it('rejects a genuinely oversized database cohort without returning partial metrics', async () => {
    await admin.$executeRaw`INSERT INTO bookings(tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount,payment_method,created_at)
      SELECT ${tenant}::uuid,${property}::uuid,${king}::uuid,${eur}::uuid,'R2-CAP-'||n,'DRAFT','2035-01-01','2035-01-02',1,'FREE','2035-01-01T09:00:00Z' FROM generate_series(1,25001) n`;
    try {
      const result = await get({ from: '2035-01-01', to: '2035-01-01' }).expect(422);
      expect(result.body.code).toBe('REPORT_DATA_LIMIT');
      expect(result.body).not.toHaveProperty('summary');
    } finally {
      await admin.$executeRaw`DELETE FROM bookings WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND external_reference LIKE 'R2-CAP-%'`;
    }
    // Inserts and reads back 25,001 bookings, so it needs more than the 45 s default on a loaded machine.
  }, 120_000);
  it('uses Unknown for historical individual-room supply and rejects invalid inputs', async () => {
    await admin.$executeRaw`UPDATE properties SET booking_mode='INDIVIDUAL_ROOM_ONLY' WHERE tenant_id=${tenant}::uuid AND id=${property}::uuid`;
    const result = await get({ report: 'occupancy', group: 'week' }).expect(200);
    expect(result.body.summary.availableNights).toBeNull();
    await admin.$executeRaw`UPDATE properties SET booking_mode='ROOM_TYPE_ONLY' WHERE tenant_id=${tenant}::uuid AND id=${property}::uuid`;
    for (const extra of [
      { from: '2025-02-29' },
      { pageSize: 101 },
      { group: 'hour' },
      { sort: 'password' },
      { to: '2028-03-31' },
      { report: 'sql' },
    ])
      await get(extra).expect(400);
  });
  const viewBody = (visibility = 'private', name = 'Daily review') => ({
    name,
    visibility,
    configuration: {
      query: { ...query },
      columns: ['reference', 'status'],
      metrics: ['bookings', 'occupancy'],
      display: 'table',
      chartMetric: 'bookings',
    },
  });
  const viewWrite = (
    method: 'post' | 'patch' | 'delete',
    path: string,
    body: Record<string, unknown>,
    key = randomUUID(),
    cookie = ownerCookie,
  ) =>
    request(app.getHttpServer())
      [method](`${root()}/views${path}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(body);
  it('R3 keeps private views private, shares team configurations, duplicates privately and gates edits', async () => {
    const privateView = (await viewWrite('post', '', viewBody()).expect(201)).body;
    const team = (await viewWrite('post', '', viewBody('team', 'Team report')).expect(201)).body;
    const list = await request(app.getHttpServer())
      .get(`${root()}/views`)
      .set('Cookie', staffCookie)
      .expect(200);
    expect(list.body.views.map((v: { id: string }) => v.id)).not.toContain(privateView.id);
    expect(list.body.views.find((v: { id: string }) => v.id === team.id).canEdit).toBe(false);
    await request(app.getHttpServer())
      .get(`${root()}/views/${privateView.id}/workspace`)
      .set('Cookie', staffCookie)
      .expect(404);
    await viewWrite(
      'patch',
      `/${team.id}`,
      { ...viewBody('team'), version: 1 },
      randomUUID(),
      staffCookie,
    ).expect(403);
    const copy = (
      await viewWrite(
        'post',
        `/${team.id}/duplicate`,
        { version: 1 },
        randomUUID(),
        staffCookie,
      ).expect(201)
    ).body;
    expect(copy).toMatchObject({ ownerUserId: staff, visibility: 'private', version: 1 });
    const changed = (
      await viewWrite('patch', `/${privateView.id}`, {
        ...viewBody('team', 'Renamed'),
        version: 1,
      }).expect(200)
    ).body;
    expect(changed).toMatchObject({ version: 2, name: 'Renamed', visibility: 'team' });
    await viewWrite('delete', `/${privateView.id}`, { version: 1 }).expect(409);
    await viewWrite('delete', `/${privateView.id}`, { version: 2 }).expect(200);
    await request(app.getHttpServer())
      .get(`${root()}/views/${privateView.id}/workspace`)
      .set('Cookie', ownerCookie)
      .expect(404);
  });
  it('R3 returns one durable result and audit for simultaneous idempotent creates and rejects key reuse', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      viewWrite('post', '', viewBody(), key),
      viewWrite('post', '', viewBody(), key),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    const id = results[0]!.body.id;
    const audit = await admin.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND action='report.view.create' AND target_id=${id}`;
    expect(audit[0]!.count).toBe(1);
    await viewWrite('post', '', viewBody('private', 'Different'), key).expect(409);
    await viewWrite('post', '', viewBody(), key, staffCookie).expect(409);
  });
  it('R3 rejects a real lost update and stale duplicate/delete without losing the winning configuration', async () => {
    const first = (await viewWrite('post', '', viewBody()).expect(201)).body;
    const responses = await Promise.all(
      ['First', 'Second'].map((n) =>
        viewWrite('patch', `/${first.id}`, { ...viewBody('private', n), version: 1 }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses.find((r) => r.status === 200)!.body;
    const read = await request(app.getHttpServer())
      .get(`${root()}/views/${first.id}/workspace`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(read.body.view).toMatchObject({ name: winner.name, version: 2 });
    await viewWrite('post', `/${first.id}/duplicate`, { version: 1 }).expect(409);
    await viewWrite('delete', `/${first.id}`, { version: 1 }).expect(409);
  });
  it('R3 enforces actual RLS scope and rechecks money permissions on shared execution', async () => {
    const body = viewBody('team', 'Money view');
    body.configuration.columns.push('value');
    body.configuration.metrics.push('roomRevenue');
    Object.assign(body.configuration.query, { sort: 'value' });
    const saved = (await viewWrite('post', '', body).expect(201)).body;
    const result = await request(app.getHttpServer())
      .get(`${root()}/views/${saved.id}/workspace`)
      .set('Cookie', staffCookie)
      .expect(200);
    expect(result.body.workspace.columns.some((c: { money?: boolean }) => c.money)).toBe(false);
    expect(result.body.workspace.summary.financial).toBeUndefined();
    await request(app.getHttpServer())
      .get(`${root(otherProperty)}/views/${saved.id}/workspace`)
      .set('Cookie', ownerCookie)
      .expect(404);
    await request(app.getHttpServer())
      .get(`${root(foreignProperty, foreignTenant)}/views`)
      .set('Cookie', ownerCookie)
      .expect(403);
    const db = app.get(TenantDatabaseService);
    const scoped = await db.withTenantTransaction(
      { tenantId: tenant, propertyId: otherProperty },
      (tx) =>
        tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT id FROM report_views WHERE tenant_id=${tenant}::uuid AND id=${saved.id}::uuid`,
    );
    expect(scoped).toEqual([]);
    await expect(
      db.withTenantTransaction(
        { tenantId: tenant, propertyId: otherProperty },
        (tx) =>
          tx.$executeRaw`INSERT INTO report_views(tenant_id,property_id,owner_user_id,name,visibility,configuration) VALUES(${tenant}::uuid,${property}::uuid,${owner}::uuid,'bad','team','{}'::jsonb)`,
      ),
    ).rejects.toThrow();
    const flags = await admin.$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('report_views','report_view_operations')`;
    expect(flags).toHaveLength(2);
    expect(flags.every((f) => f.relrowsecurity && f.relforcerowsecurity)).toBe(true);
  });
  it('R3 rolls back configuration and receipt if audit fails, validates inputs and denies revoked access', async () => {
    const audit = app.get(AuditLogService),
      key = randomUUID();
    const failure = vi
      .spyOn(audit, 'recordInTransaction')
      .mockRejectedValueOnce(new Error('test audit unavailable'));
    await viewWrite('post', '', viewBody('private', 'Must rollback'), key).expect(500);
    failure.mockRestore();
    const rows = await admin.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM report_views WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND name='Must rollback'`;
    expect(rows).toEqual([]);
    await viewWrite('post', '', viewBody('private', 'Must rollback'), key).expect(201);
    await request(app.getHttpServer())
      .post(`${root()}/views`)
      .set('Cookie', ownerCookie)
      .send(viewBody())
      .expect(400);
    await viewWrite('post', '', {
      ...viewBody(),
      configuration: { ...viewBody().configuration, columns: ['password_hash'] },
    }).expect(400);
    await viewWrite('post', '', {
      ...viewBody(),
      configuration: { ...viewBody().configuration, metrics: ['sql()'] },
    }).expect(400);
    await viewWrite('post', '', viewBody('role-default')).expect(400);
    await request(app.getHttpServer()).get(`${root()}/views`).expect(401);
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenant}::uuid,${property}::uuid,${staff}::uuid,id,false FROM capabilities WHERE tenant_id=${tenant}::uuid AND key='reports.view' ON CONFLICT(tenant_id,property_id,user_id,capability_id) DO UPDATE SET granted=false`;
    try {
      await request(app.getHttpServer())
        .get(`${root()}/views`)
        .set('Cookie', staffCookie)
        .expect(403);
    } finally {
      await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND user_id=${staff}::uuid`;
    }
    expect(app.get(ReportViewsService)).toBeDefined();
  });
  it('R5 reconciles selected-period Payments, new Reports and the legacy adapter by currency', async () => {
    const report = (await get({ report: 'revenue' }).expect(200)).body;
    const payments = await request(app.getHttpServer())
      .get(`/tenants/${tenant}/properties/${property}/payments/summary`)
      .set('Cookie', ownerCookie)
      .query({ from: query.from, to: query.to })
      .expect(200);
    expect(payments.body.financial).toEqual(report.summary.financial);
    const legacy = await request(app.getHttpServer())
      .get(root())
      .set('Cookie', ownerCookie)
      .query({ from: query.from, to: query.to })
      .expect(200);
    expect(legacy.body.revenue).toEqual(
      report.series.map((r: { date: string; currency: string; netCollected: string }) => ({
        date: r.date,
        currency: r.currency,
        amount: r.netCollected,
      })),
    );
    expect(legacy.body.cancellationRate).toEqual({
      createdBookings: report.summary.bookings,
      cancelledBookings: report.summary.cancelled,
      rate: report.summary.cancellationRate,
    });
    await request(app.getHttpServer())
      .get(`/tenants/${tenant}/properties/${property}/payments/summary`)
      .set('Cookie', staffCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/tenants/${foreignTenant}/properties/${foreignProperty}/payments/summary`)
      .set('Cookie', ownerCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/tenants/${tenant}/properties/${property}/payments/summary?from=bad`)
      .set('Cookie', ownerCookie)
      .expect(400);
    const staffOverview = await request(app.getHttpServer())
      .get(`/tenants/${tenant}/properties/${property}/overview`)
      .set('Cookie', staffCookie)
      .expect(200);
    expect(staffOverview.body.revenue.byCurrency).toEqual([]);
    expect(staffOverview.body.balancesDueAtDesk).toEqual([]);
  });
  it('R5 proves Overview, Bookings and Reports share today boundaries, confirmed counts and multi-currency cash', async () => {
    const today = propertyDay(new Date(), 'Europe/Tirane'),
      tomorrow = shiftDay(today, 1),
      yesterday = shiftDay(today, -1),
      pending = randomUUID(),
      eurPayment = randomUUID(),
      usdPayment = randomUUID();
    const todayCreated = `${today}T10:00:00Z`;
    const currentNights = [
      {
        date: today,
        amount: '110.00',
        components: [
          { kind: 'base', amount: '100.00' },
          { kind: 'charge', id: 'fee', name: 'Recorded charge', amount: '10.00' },
        ],
      },
    ];
    await admin.$executeRaw`UPDATE bookings SET starts_on=${today}::date,ends_on=${tomorrow}::date,created_at=${todayCreated}::timestamptz,nightly_rates=${JSON.stringify(currentNights)}::jsonb WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    await admin.$executeRaw`UPDATE bookings SET starts_on=${yesterday}::date,ends_on=${today}::date,created_at=${todayCreated}::timestamptz,nightly_rates=${JSON.stringify([{ date: yesterday, amount: '200.00' }])}::jsonb WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b2}::uuid`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount,payment_method,created_at) VALUES(${pending}::uuid,${tenant}::uuid,${property}::uuid,${king}::uuid,${eur}::uuid,'Pending current fixture','PAYMENT_PENDING',${today}::date,${tomorrow}::date,50,'PAY_AT_HOTEL',${todayCreated}::timestamptz)`;
    await admin.$executeRaw`INSERT INTO payments(id,tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency,created_at) VALUES(${eurPayment}::uuid,${tenant}::uuid,${property}::uuid,${b1}::uuid,'CHARGE','manual',${eurPayment},'PAID',10,'EUR',${todayCreated}::timestamptz),(${usdPayment}::uuid,${tenant}::uuid,${property}::uuid,${b2}::uuid,'CHARGE','manual',${usdPayment},'PAID',20,'USD',${todayCreated}::timestamptz)`;
    await admin.$executeRaw`INSERT INTO inventory_units(tenant_id,property_id,room_type_id,stays_on,available_units) VALUES(${tenant}::uuid,${property}::uuid,${king}::uuid,${today}::date,4),(${tenant}::uuid,${property}::uuid,${family}::uuid,${today}::date,2)`;
    try {
      const report = (await get({ report: 'overview', from: today, to: today }).expect(200)).body;
      const overview = (
        await request(app.getHttpServer())
          .get(`/tenants/${tenant}/properties/${property}/overview`)
          .set('Cookie', ownerCookie)
          .expect(200)
      ).body;
      const search = (
        await request(app.getHttpServer())
          .get(`/tenants/${tenant}/properties/${property}/bookings/search?view=arriving_today`)
          .set('Cookie', ownerCookie)
          .expect(200)
      ).body;
      expect(overview.kpis).toMatchObject({
        date: today,
        arrivals: report.summary.arrivals,
        departures: report.summary.departures,
        inHouse: report.summary.soldNights,
        bookedRoomNights: report.summary.soldNights,
        availableRoomNights: report.summary.availableNights,
        occupancyRate: report.summary.occupancy,
      });
      expect(search.counts).toMatchObject({
        arriving_today: report.summary.arrivals,
        departing_today: report.summary.departures,
        in_house: report.summary.soldNights,
      });
      expect(search.items.map((b: { id: string }) => b.id)).not.toContain(pending);
      expect(overview.revenue.byCurrency).toEqual(
        report.summary.financial.map((r: { currency: string; collected: string }) => ({
          currency: r.currency,
          amount: r.collected,
        })),
      );
      expect(overview.revenue.today).toBeNull();
      expect(overview.revenue.byCurrency).toHaveLength(2);
      const newBookings = (await get({ from: yesterday, to: today }).expect(200)).body.summary
        .bookings;
      expect(overview.newBookingsSinceYesterday).toBe(newBookings);
      await admin.$executeRaw`UPDATE property_integration_connections SET enabled=true WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND connection_id=${connection}::uuid`;
      const clockOverview = (
        await request(app.getHttpServer())
          .get(`/tenants/${tenant}/properties/${property}/overview`)
          .set('Cookie', ownerCookie)
          .expect(200)
      ).body;
      const clockReport = (await get({ report: 'overview', from: today, to: today }).expect(200))
        .body;
      expect(clockOverview.kpis.availableRoomNights).toBeNull();
      expect(clockOverview.kpis.occupancyRate).toBe(clockReport.summary.occupancy);
      expect(clockOverview.soldOutRooms).toEqual([]);
      expect(clockOverview.metricBasis.source).toBe('CLOCK');
    } finally {
      await admin.$executeRaw`UPDATE property_integration_connections SET enabled=false WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND connection_id=${connection}::uuid`;
      await admin.$executeRaw`DELETE FROM payments WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id IN (${eurPayment}::uuid,${usdPayment}::uuid)`;
      await admin.$executeRaw`DELETE FROM bookings WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${pending}::uuid`;
      await admin.$executeRaw`DELETE FROM inventory_units WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND stays_on=${today}::date`;
      await admin.$executeRaw`UPDATE bookings SET starts_on='2026-03-29',ends_on='2026-03-31',created_at='2026-03-28T23:30:00Z',nightly_rates=${JSON.stringify(nights)}::jsonb WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
      await admin.$executeRaw`UPDATE bookings SET starts_on='2026-03-29',ends_on='2026-03-30',created_at='2026-03-29T22:30:00Z',nightly_rates='[{"date":"2026-03-29","amount":"200.00"}]'::jsonb WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b2}::uuid`;
    }
  });
  it('R5 lists only the caller own completed export metadata in the scoped hotel', async () => {
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenant}::uuid,${property}::uuid,${staff}::uuid,id,true FROM capabilities WHERE tenant_id=${tenant}::uuid AND key='reports.view' ON CONFLICT(tenant_id,property_id,user_id,capability_id) DO UPDATE SET granted=true`;

    const own = (await post({ query, columns: ['reference'] }).expect(201)).body;
    const other = (await post({ query, columns: ['reference'] }, staffCookie).expect(201)).body;
    const history = (
      await request(app.getHttpServer())
        .get(`${root()}/exports`)
        .set('Cookie', ownerCookie)
        .expect(200)
    ).body.exports;
    expect(history.some((r: { id: string }) => r.id === own.exportId)).toBe(true);
    expect(history.some((r: { id: string }) => r.id === other.exportId)).toBe(false);
    expect(
      history.every((r: Record<string, unknown>) => !('content' in r) && !('actorUserId' in r)),
    ).toBe(true);
    const second = (
      await request(app.getHttpServer())
        .get(`${root(otherProperty)}/exports`)
        .set('Cookie', ownerCookie)
        .expect(200)
    ).body.exports;
    expect(second).toEqual([]);
    await request(app.getHttpServer()).get(`${root()}/exports`).expect(401);
  });
  it('enforces the saved-view ownership cap against real stored configurations', async () => {
    const fixtureName = `view-limit-${randomUUID()}`,
      config = JSON.stringify(viewBody().configuration);
    const seeded = await admin.$queryRaw<
      Array<{ id: string }>
    >`INSERT INTO report_views(tenant_id,property_id,owner_user_id,name,visibility,configuration) SELECT ${tenant}::uuid,${property}::uuid,${owner}::uuid,${fixtureName},'private',${config}::jsonb FROM generate_series(1,100) RETURNING id`;
    try {
      const result = await viewWrite('post', '', viewBody()).expect(400);
      expect(result.body.message).toContain('limit reached');
    } finally {
      await admin.$executeRaw`DELETE FROM report_views WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND owner_user_id=${owner}::uuid AND name=${fixtureName}`;
    }
    expect(seeded).toHaveLength(100);
  });
  it('collects one 365-day snapshot under concurrent retries, enforces RLS/retention and Clock Unknown', async () => {
    const collector = app.get(ReportOtbService),
      db = app.get(TenantDatabaseService);
    await admin.$executeRaw`UPDATE properties SET timezone=${CAPTURE_ZONE} WHERE tenant_id=${tenant}::uuid AND id=${property}::uuid`;
    const today = propertyDay(new Date(), CAPTURE_ZONE);
    await admin.$executeRaw`UPDATE bookings SET starts_on=${today}::date,ends_on=${shiftDay(today, 1)}::date,nightly_rates=${JSON.stringify(
      [
        {
          date: today,
          amount: '110.00',
          components: [
            { kind: 'base', amount: '100.00' },
            { kind: 'charge', id: 'tax', name: 'VAT', amount: '10.00', category: 'vat' },
          ],
        },
      ],
    )}::jsonb WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    try {
      await admin.$executeRaw`INSERT INTO report_otb_snapshots(tenant_id,property_id,snapshot_date,timezone,source) VALUES(${tenant}::uuid,${property}::uuid,${shiftDay(today, -800)}::date,${CAPTURE_ZONE},'LOCAL'),(${tenant}::uuid,${property}::uuid,${shiftDay(today, -799)}::date,${CAPTURE_ZONE},'LOCAL')`;
      const captures = await Promise.all([
        collector.capture(context),
        collector.capture(context),
        collector.capture(context),
      ]);
      expect(captures.filter((c) => c.captured)).toHaveLength(1);
      const days = await admin.$queryRaw<
        Array<{ count: number; first: string; last: string }>
      >`SELECT count(*)::int AS count,min(stay_date)::text AS first,max(stay_date)::text AS last FROM report_otb_days WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND snapshot_date=${today}::date`;
      expect(days[0]).toEqual({ count: 365, first: today, last: shiftDay(today, 364) });
      const money = await admin.$queryRaw<
        Array<{ amount: string }>
      >`SELECT room_revenue_minor::text AS amount FROM report_otb_revenue WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND snapshot_date=${today}::date AND stay_date=${today}::date AND currency='EUR'`;
      expect(money).toEqual([{ amount: '10000' }]);
      const auditCount = await admin.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND action='reports.otb.captured'`;
      expect(auditCount[0]!.count).toBe(1);
      const retained = await admin.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM report_otb_snapshots WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid`;
      expect(retained[0]!.count).toBe(2);
      await db.withTenantTransaction(
        { tenantId: foreignTenant, propertyId: foreignProperty },
        async (tx) => {
          const rows = await tx.$queryRaw<
            unknown[]
          >`SELECT * FROM report_otb_days WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid`;
          expect(rows).toEqual([]);
        },
      );
      await expect(
        db.withTenantTransaction(
          { tenantId: tenant, propertyId: otherProperty },
          (tx) =>
            tx.$executeRaw`INSERT INTO report_otb_snapshots(tenant_id,property_id,snapshot_date,timezone,source) VALUES(${tenant}::uuid,${property}::uuid,${shiftDay(today, -1)}::date,'UTC','LOCAL')`,
        ),
      ).rejects.toThrow();
      const report = await get({ report: 'occupancy', from: today, to: shiftDay(today, 2) }).expect(
        200,
      );
      expect(
        report.body.summary.onTheBooksHistory.pickup.every(
          (p: { status: string }) => p.status === 'No history yet',
        ),
      ).toBe(true);
      const previous = shiftDay(today, -1);
      await admin.$executeRaw`INSERT INTO report_otb_snapshots(tenant_id,property_id,snapshot_date,timezone,source) VALUES(${tenant}::uuid,${property}::uuid,${previous}::date,${CAPTURE_ZONE},'LOCAL')`;
      await admin.$executeRaw`INSERT INTO report_otb_days(tenant_id,property_id,snapshot_date,stay_date,sold,available)VALUES(${tenant}::uuid,${property}::uuid,${previous}::date,${today}::date,0,5)`;
      const historicalQuery = { report: 'occupancy', from: today, to: today };
      const live = await app.get(ReportWorkspaceService).workspace(context, historicalQuery, true);
      expect((live.summary.onTheBooksHistory as { pickup: object[] }).pickup[0]).toMatchObject({
        status: 'Available',
        change: 1,
        sold: 1,
        previousSold: 0,
        revenue: [{ currency: 'EUR', change: '100.00' }],
      });
      await admin.$executeRaw`UPDATE bookings SET status='CANCELLED' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
      const changed = await app
        .get(ReportWorkspaceService)
        .workspace(context, historicalQuery, true);
      expect((changed.summary.onTheBooksHistory as { pickup: object[] }).pickup[0]).toMatchObject({
        status: 'Available',
        change: 0,
        sold: 0,
      });
      await admin.$executeRaw`UPDATE bookings SET status='CONFIRMED' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
      await admin.$executeRaw`DELETE FROM report_otb_snapshots WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND snapshot_date=${today}::date`;
      await admin.$executeRaw`UPDATE property_integration_connections SET enabled=true WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND connection_id=${connection}::uuid`;
      expect((await collector.capture(context)).captured).toBe(true);
      const unknown = await admin.$queryRaw<
        Array<{ count: number }>
      >`SELECT count(*)::int AS count FROM report_otb_days WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND snapshot_date=${today}::date AND available IS NULL`;
      expect(unknown[0]!.count).toBe(365);
    } finally {
      await admin.$executeRaw`UPDATE bookings SET status='CONFIRMED',starts_on='2026-03-29',ends_on='2026-03-31',nightly_rates=${JSON.stringify(nights)}::jsonb WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
      await admin.$executeRaw`DELETE FROM report_otb_snapshots WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid`;
      await admin.$executeRaw`UPDATE properties SET timezone='Europe/Tirane' WHERE tenant_id=${tenant}::uuid AND id=${property}::uuid`;
      await admin.$executeRaw`UPDATE property_integration_connections SET enabled=false WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND connection_id=${connection}::uuid`;
    }
  }, 60000);
  it('captures guest country with scoped authorization, actual retry/version races and atomic audit', async () => {
    const base = `/tenants/${tenant}/properties/${property}/guests/${guest}/country`;
    const write = (body: object, key: string, cookie = ownerCookie, url = base) =>
      request(app.getHttpServer())
        .patch(url)
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(body);
    await write({ countryCode: 'ZZ', version: 1 }, randomUUID()).expect(400);
    await request(app.getHttpServer())
      .patch(base)
      .set('Cookie', ownerCookie)
      .send({ countryCode: 'AL', version: 1 })
      .expect(400);
    const key = randomUUID(),
      retry = await Promise.all([
        write({ countryCode: 'AL', version: 1 }, key),
        write({ countryCode: 'AL', version: 1 }, key),
      ]);
    expect(retry.map((r) => r.status)).toEqual([200, 200]);
    expect(retry[0]!.body).toEqual(retry[1]!.body);
    await write({ countryCode: 'GB', version: 1 }, key).expect(409);
    const race = await Promise.all([
      write({ countryCode: 'GB', version: 2 }, randomUUID()),
      write({ countryCode: 'US', version: 2 }, randomUUID()),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    await write(
      { countryCode: null, version: 3 },
      randomUUID(),
      ownerCookie,
      `/tenants/${tenant}/properties/${otherProperty}/guests/${guest}/country`,
    ).expect(404);
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenant}::uuid,${property}::uuid,${staff}::uuid,id,false FROM capabilities WHERE tenant_id=${tenant}::uuid AND key='bookings.edit' ON CONFLICT DO NOTHING`;
    await write({ countryCode: 'AL', version: 3 }, randomUUID(), staffCookie).expect(403);
    const audit = await admin.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND action='guest.country.updated' AND target_id=${guest}`;
    expect(audit[0]!.count).toBe(2);
  });
  it('captures refund reason without changing refund amounts or retry behavior; classifies only new immutable charges', async () => {
    const booking = randomUUID(),
      charge = randomUUID(),
      key = randomUUID();
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,external_reference,status,starts_on,ends_on,total_amount,nightly_rates,adults,children,payment_method) SELECT ${booking}::uuid,tenant_id,property_id,room_type_id,rate_plan_id,guest_id,${booking},'CONFIRMED',starts_on,ends_on,100,nightly_rates,adults,children,'PAY_AT_HOTEL' FROM bookings WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${b1}::uuid`;
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenant}::uuid,${property}::uuid,${booking}::uuid,'CHARGE','manual',${charge},'PAID',100,'EUR')`;
    const url = `/tenants/${tenant}/properties/${property}/payments/refunds`;
    const refund = (reasonCode: string, k = key) =>
      request(app.getHttpServer())
        .post(url)
        .set('Cookie', ownerCookie)
        .set('Idempotency-Key', k)
        .send({
          bookingId: booking,
          amount: { amount: '25.00', currency: 'EUR' },
          reasonCode,
          note: 'Fixture reason',
        });
    await refund('invented').expect(400);
    const retries = await Promise.all([refund('guest_request'), refund('guest_request')]);
    expect(retries.map((r) => r.status)).toEqual([200, 200]);
    expect(retries.every((r) => r.body.ok)).toBe(true);
    await refund('goodwill').expect(409);
    const payment = await admin.$queryRaw<
      Array<{ amount: string; reason: string; note: string }>
    >`SELECT amount::text,reason_code AS reason,note FROM payments WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND booking_id=${booking}::uuid AND kind='REFUND'`;
    expect(payment).toEqual([{ amount: '25.00', reason: 'guest_request', note: 'Fixture reason' }]);
    const today = propertyDay(new Date(), 'Europe/Tirane');
    const analysis = await get({
      report: 'revenue',
      detail: 'refunds',
      from: today,
      to: today,
    }).expect(200);
    expect(
      analysis.body.rows.some(
        (r: { reason: string; amount: string }) =>
          r.reason === 'guest_request' && r.amount === '25.00',
      ),
    ).toBe(true);
    const charges = `/tenants/${tenant}/properties/${property}/pricing/charges`,
      body = {
        name: 'Classified VAT',
        category: 'vat',
        basis: 'percentage_accommodation',
        display: 'included',
        value: '10.00',
        startsOn: today,
        confirmed: true,
      };
    const created = await request(app.getHttpServer())
      .post(charges)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(201);
    expect(created.body.category).toBe('vat');
    await request(app.getHttpServer())
      .patch(`${charges}/${created.body.id}`)
      .set('Cookie', ownerCookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, version: created.body.version, category: 'tourist_tax' })
      .expect(400);
    await expect(
      app
        .get(TenantDatabaseService)
        .withTenantTransaction(
          context,
          (tx) =>
            tx.$executeRaw`UPDATE pricing_charges SET category='other' WHERE tenant_id=${tenant}::uuid AND property_id=${property}::uuid AND id=${created.body.id}::uuid`,
        ),
    ).rejects.toThrow();
  });
});
