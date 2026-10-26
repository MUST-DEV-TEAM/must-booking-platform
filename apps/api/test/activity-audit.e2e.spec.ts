import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { ActivityAuditService } from '../src/tenancy/activity-audit.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { withoutExternalWorkers } from './helpers/without-external-workers';
const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
describe('property audit workspace and actual export/security evidence', () => {
  const tenantId = randomUUID(),
    otherTenantId = randomUUID(),
    propertyId = randomUUID(),
    otherPropertyId = randomUUID(),
    foreignPropertyId = randomUUID();
  const owner = randomUUID(),
    second = randomUUID(),
    finance = randomUUID(),
    unverified = randomUUID(),
    noAccess = randomUUID();
  const inventory = randomUUID(),
    payment = randomUUID(),
    unknown = randomUUID(),
    foreign = randomUUID(),
    formula = randomUUID(),
    wrongPrefix = randomUUID();
  const base = `/tenants/${tenantId}/properties/${propertyId}/activity-audit`,
    password = 'audit-fixture-password';
  const cookies = new Map<string, string>();
  let app: INestApplication,
    db: TenantDatabaseService,
    service: ActivityAuditService,
    resetToken = '';
  const email = (id: string) => 'audit-' + id + '@example.test';
  const http = () => request(app.getHttpServer());
  const get = (user = owner, q = '') =>
    http()
      .get(base + q)
      .set('Cookie', cookies.get(user)!);
  const exportRequest = (body: object, key = randomUUID(), user = owner) =>
    http()
      .post(`${base}/export`)
      .set('Cookie', cookies.get(user)!)
      .set('Idempotency-Key', key)
      .send(body);
  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const hash = await bcrypt.hash(password, 4);
    await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${tenantId}::uuid,'Audit fixture'),(${otherTenantId}::uuid,'Foreign audit fixture')`;
    for (const [t, p] of [
      [tenantId, propertyId],
      [tenantId, otherPropertyId],
      [otherTenantId, foreignPropertyId],
    ])
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${p}::uuid,${t}::uuid,'Audit property',${'audit-' + p},'Pacific/Kiritimati')`;
    for (const user of [owner, second, finance, unverified, noAccess]) {
      await admin.$executeRaw`INSERT INTO users(id,email,password_hash,email_verified_at,first_name,last_name) VALUES(${user}::uuid,${email(user)},${hash},${user === unverified ? null : new Date()},'Audit','Operator')`;
      await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${user}::uuid,${user === owner ? 'OWNER' : [second, unverified].includes(user) ? 'ADMIN' : 'STAFF'}::"TenantMembershipRole")`;
    }
    const { AppModule } = await import('../src/app.module');
    const delivery = {
      async dispatch(kind: string, command: { resetUrl?: string }) {
        if (kind === 'passwordReset' && command.resetUrl)
          resetToken = new URL(command.resetUrl).searchParams.get('token')!;
      },
    };
    const module = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MailDeliveryService)
        .useValue(delivery),
    ).compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(TenantDatabaseService);
    service = module.get(ActivityAuditService);
    await module.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
    const roles = await admin.$queryRaw<
      { id: string }[]
    >`SELECT id FROM property_role_templates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND name='Finance'`;
    for (const user of [finance, noAccess])
      await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${user}::uuid,${roles[0].id}::uuid)`;
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${finance}::uuid,id,false FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='bookings.view'`;
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${noAccess}::uuid,id,false FROM capabilities WHERE tenant_id=${tenantId}::uuid`;
    for (const user of [owner, second, finance, unverified, noAccess]) {
      const r = await http()
        .post('/auth/login')
        .send({ email: email(user), password })
        .expect(201);
      cookies.set(user, r.headers['set-cookie'][0]);
    }
    const details = {
      before: { stock: 5, password: 'private-value', actorEmail: email(owner) },
      after: { stock: 7, credentials: { secret: 'private-value' } },
      reason: 'Changed by ' + email(owner) + ' Audit Operator',
      result: 'succeeded',
      apiKey: 'private-value',
      ip: '192.0.2.1',
      location: 'Private location',
    };
    for (const [id, action] of [
      [inventory, 'inventory_units.bulk_change'],
      [payment, 'payment.refunded'],
      [unknown, 'future.unknown'],
      [formula, 'room.updated'],
      [wrongPrefix, 'inventoryXnot_registered'],
    ])
      await admin.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,actor_user_id,action,target_type,target_id,details) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${owner}::uuid,${action},'room',${id === formula ? '\t=HYPERLINK("unsafe")' : 'target-1'},${JSON.stringify(details)}::jsonb)`;
    await admin.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,actor_user_id,action,target_type,target_id) VALUES(${foreign}::uuid,${tenantId}::uuid,${otherPropertyId}::uuid,${owner}::uuid,'inventory_block.create','block','other')`;
  });
  afterAll(async () => {
    if (app) await app.close();
    await cleanupTenant(admin, tenantId);
    await cleanupTenant(admin, otherTenantId);
    for (const user of [owner, second, finance, unverified, noAccess]) {
      await admin.$executeRaw`DELETE FROM audit_logs WHERE actor_user_id=${user}::uuid`;
      await admin.$executeRaw`DELETE FROM users WHERE id=${user}::uuid`;
    }
    await admin.$disconnect();
  });
  it('keeps historical outcomes unspecified and links only recorded operations through authorized sources/views', async () => {
    const audit = app.get(AuditLogService),
      operation = randomUUID(),
      eventId = randomUUID();
    await admin.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,actor_user_id,action,target_type,target_id,details) VALUES(${eventId}::uuid,${tenantId}::uuid,${propertyId}::uuid,${owner}::uuid,'booking.cancelled','booking','historical-test','{}'::jsonb)`;
    const old = await get(owner, '?search=' + eventId).expect(200);
    expect(old.body.items[0].result).toBe('Not recorded');
    await audit.record({
      tenantId,
      propertyId,
      actorUserId: owner,
      action: 'payment.collection_requested',
      targetType: 'booking',
      targetId: 'linked-booking',
      operationId: operation,
    });
    await audit.record({
      tenantId,
      propertyId,
      actorUserId: null,
      action: 'payment.balance_collected',
      targetType: 'booking',
      targetId: 'linked-booking',
      operationId: operation,
      details: { amount: { amount: '250.00', currency: 'EUR' } },
    });
    await audit.record({
      tenantId,
      propertyId: otherPropertyId,
      actorUserId: null,
      action: 'payment.balance_collected',
      targetType: 'booking',
      targetId: 'foreign-linked-booking',
      operationId: operation,
    });
    const r = await get(owner, '?search=linked-booking&source=POKPAY').expect(200);
    expect(r.body.items[0]).toMatchObject({
      title: 'Payment received',
      result: 'Succeeded',
      source: 'PokPay',
      summary: 'EUR 250.00',
    });
    const detail = await http()
      .get(base + '/' + r.body.items[0].id)
      .set('Cookie', cookies.get(owner)!)
      .expect(200);
    expect(detail.body.linked).toHaveLength(2);
    expect(detail.body.linked.map((e: { result: string }) => e.result)).toEqual([
      'Pending',
      'Succeeded',
    ]);
    expect(JSON.stringify(detail.body.linked)).not.toContain('foreign-linked-booking');
    await audit.record({
      tenantId,
      propertyId,
      actorUserId: null,
      action: 'clock_catalog.synced',
      targetType: 'integration_connection',
      targetId: 'routine-test',
    });
    expect(
      (await get(owner, '?view=system&search=routine-test').expect(200)).body.items,
    ).toHaveLength(1);
    expect(
      (await get(owner, '?view=business&search=routine-test').expect(200)).body.items,
    ).toHaveLength(0);
    await get(owner, '?source=NOT_A_PROVIDER').expect(400);
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND (id=${eventId}::uuid OR details#>>'{_audit,operationId}'=${operation} OR target_id='routine-test')`;
  });
  it('records shared connection changes only in properties assigned at occurrence with an explicit shared scope', async () => {
    const connection = randomUUID(),
      audit = app.get(AuditLogService);
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connection}::uuid,${tenantId}::uuid,'PAYMENT','POKPAY','Audit mock connection','not-decryptable','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PAYMENT')`;
    await audit.record({
      tenantId,
      actorUserId: owner,
      action: 'integration_connection.credentials_replaced',
      targetType: 'integration_connection',
      targetId: connection,
      details: { apiKey: 'never-store-this', verified: true },
    });
    const response = await get(owner, '?search=' + connection).expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].result).toBe('Succeeded');
    const record = await http()
      .get(base + '/' + response.body.items[0].id)
      .set('Cookie', cookies.get(owner)!)
      .expect(200);
    expect(record.body.details.eventScope).toContain('hotel assignment existed');
    expect(JSON.stringify(record.body)).not.toContain('never-store-this');
    const elsewhere = await http()
      .get(`/tenants/${tenantId}/properties/${otherPropertyId}/activity-audit?search=${connection}`)
      .set('Cookie', cookies.get(owner)!)
      .expect(200);
    expect(elsewhere.body.items).toHaveLength(0);
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND target_id=${connection}`;
    await admin.$executeRaw`DELETE FROM integration_connections WHERE tenant_id=${tenantId}::uuid AND id=${connection}::uuid`;
  });
  it('lists real property records, scoped counts, recorded snapshots and privileged unknown families', async () => {
    const r = await get().expect(200);
    expect(r.body.items.some((r: { id: string }) => r.id === unknown)).toBe(true);
    expect(r.body.items.some((r: { id: string }) => r.id === foreign)).toBe(false);
    expect(r.body.counts.today).toBeGreaterThan(0);
    expect(r.body.canViewActors).toBe(true);
    expect(r.body.items.find((r: { id: string }) => r.id === inventory)).toMatchObject({
      family: 'Inventory',
      result: 'Succeeded',

      actorUserId: owner,
    });
    expect(JSON.stringify(r.body)).not.toContain('private-value');
  });
  it('routes staff by family and redacts actor identifiers and nested/embedded identity', async () => {
    const r = await get(finance).expect(200);
    expect(r.body.items.map((r: { id: string }) => r.id)).toEqual([payment]);
    expect(r.body.actors).toEqual([]);
    expect(r.body.items[0]).toMatchObject({
      actorUserId: null,
      actor: 'Hidden (requires staff.view)',
    });
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(email(owner));
    expect(text).not.toContain('Audit Operator');
    expect(text).not.toContain('private-value');
    expect(text).not.toContain('192.0.2.1');
    await get(noAccess).expect(403);
    await get(finance, '?actor=' + owner).expect(403);
    await get(finance, '?family=Access%20and%20security').expect(403);
  });
  it('does not confuse wildcard-like prefix characters with a registered event family', async () => {
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${finance}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='calendar.view' ON CONFLICT(tenant_id,property_id,user_id,capability_id) DO UPDATE SET granted=true`;
    const r = await get(finance, '?family=Inventory').expect(200);
    expect(r.body.items.map((r: { id: string }) => r.id)).toEqual([inventory]);
    expect(r.body.items.some((r: { id: string }) => r.id === wrongPrefix)).toBe(false);
  });

  it('requires payments.view for Clock deposit evidence even when the action is named booking.*', async () => {
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,actor_user_id,action,target_type,target_id,details) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${owner}::uuid,'booking.clock_deposit_posted','booking','deposit-policy','{"amount":"20.00","currency":"EUR"}')`;
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${noAccess}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='bookings.view' ON CONFLICT(tenant_id,property_id,user_id,capability_id) DO UPDATE SET granted=true`;
    const permitted = await get(finance, '?family=Payments').expect(200);
    expect(permitted.body.items.find((row: { id: string }) => row.id === id)).toMatchObject({
      family: 'Payments',
    });
    await http().get(`${base}/${id}`).set('Cookie', cookies.get(noAccess)!).expect(404);
    expect((await get(noAccess)).body.items.some((row: { id: string }) => row.id === id)).toBe(
      false,
    );
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`;
  });
  it('routes known Clock catalog evidence to settings and keeps unknown Clock families privileged', async () => {
    const catalog = randomUUID(),
      unknownClock = randomUUID();
    await admin.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,action,target_type,target_id) VALUES(${catalog}::uuid,${tenantId}::uuid,${propertyId}::uuid,'clock_catalog_mapping.confirmed','property','catalog'),(${unknownClock}::uuid,${tenantId}::uuid,${propertyId}::uuid,'clock.unknown','property','unknown')`;
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${noAccess}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='settings.manage' ON CONFLICT(tenant_id,property_id,user_id,capability_id) DO UPDATE SET granted=true`;
    const permitted = await get(noAccess, '?family=Settings%20and%20providers').expect(200);
    expect(permitted.body.items.find((row: { id: string }) => row.id === catalog)).toMatchObject({
      family: 'Settings and providers',
      critical: true,
    });
    await http().get(`${base}/${unknownClock}`).set('Cookie', cookies.get(noAccess)!).expect(404);
    await http().get(`${base}/${unknownClock}`).set('Cookie', cookies.get(owner)!).expect(200);
    await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND user_id=${noAccess}::uuid AND capability_id IN(SELECT id FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='settings.manage')`;
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id IN(${catalog}::uuid,${unknownClock}::uuid)`;
  });
  it('returns scoped detail and nearby events with no invented before/after/result', async () => {
    await http().get(`${base}/${foreign}`).set('Cookie', cookies.get(owner)!).expect(404);
    const r = await http()
      .get(`${base}/${inventory}`)
      .set('Cookie', cookies.get(owner)!)
      .expect(200);
    expect(r.body.related.every((e: { targetId: string }) => e.targetId === 'target-1')).toBe(true);
    expect(r.body).toMatchObject({ before: { stock: 5 }, after: { stock: 7 } });
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,action,target_type,target_id) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,'inventory_block.create','block','missing')`;
    const missing = await http()
      .get(`${base}/${id}`)
      .set('Cookie', cookies.get(owner)!)
      .expect(200);
    expect(missing.body).toMatchObject({
      before: null,
      after: null,
      result: 'Not recorded',
      requestContext: null,
    });
  });
  it('validates paging/date/result filters and honors property-local date edges and actor privacy in search', async () => {
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO audit_logs(id,tenant_id,property_id,action,target_type,target_id,created_at) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,'inventory_block.create','block','date-edge',date_trunc('day',now())-interval '12 hours')`;
    const dates = await admin.$queryRaw<
      { day: string }[]
    >`SELECT ((date_trunc('day',now())-interval '12 hours') AT TIME ZONE 'Pacific/Kiritimati')::date::text AS day`;
    expect(
      (
        await get(owner, `?from=${dates[0].day}&to=${dates[0].day}&target=date-edge`)
      ).body.items.map((r: { id: string }) => r.id),
    ).toEqual([id]);
    expect((await get(finance, '?search=' + encodeURIComponent(email(owner)))).body.total).toBe(0);
    for (const q of [
      '?from=2026-02-30',
      '?from=0000-01-01&to=0000-01-02',
      '?from=2026-01-02&to=2026-01-01',
      '?from=2020-01-01&to=2026-01-01',
      '?result=Imaginary',
      '?pageSize=101',
    ])
      await get(owner, q).expect(400);
  });
  it('exports exact filtered bytes with BOM/formula protection and one atomic audit on retry', async () => {
    const list = await get(),
      body = {
        version: list.body.version,
        through: list.body.through,
        filters: { ...list.body.filters, family: 'Accommodation' },
      };
    const key = randomUUID(),
      first = await exportRequest(body, key).expect(201),
      retry = await exportRequest(body, key).expect(201);
    expect(first.body).toEqual(retry.body);
    expect(first.body.csv.startsWith('\uFEFF')).toBe(true);
    expect(first.body.csv).toContain('"\'\t=HYPERLINK');
    expect(first.body.count).toBe(1);
    expect(first.body.csv).not.toContain('private-value');
    const logs = await admin.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='audit.exported'`;
    expect(logs[0].n).toBe(1);
    const evidence = await http()
      .get(`${base}/${first.body.evidenceId}`)
      .set('Cookie', cookies.get(owner)!)
      .expect(200);
    expect(evidence.body.requestContext).toMatchObject({ method: 'POST' });
    expect(evidence.body.requestContext.route).toContain('/activity-audit/export');
  });
  it('rejects changed intent and real competing exports; identical concurrent retries return one result', async () => {
    const list = await get(),
      body = { version: list.body.version, through: list.body.through, filters: list.body.filters };
    const race = await Promise.all([exportRequest(body), exportRequest(body)]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const next = await get(),
      intent = {
        version: next.body.version,
        through: next.body.through,
        filters: next.body.filters,
      },
      key = randomUUID();
    const same = await Promise.all([exportRequest(intent, key), exportRequest(intent, key)]);
    expect(same.map((r) => r.status)).toEqual([201, 201]);
    expect(same[0].body).toEqual(same[1].body);
    await exportRequest({ ...intent, ids: [inventory] }, key).expect(409);
  });
  it('fails closed for selected foreign IDs, invalid key/version and unverified export without an audit', async () => {
    const list = await get(),
      body = { version: list.body.version, through: list.body.through, filters: list.body.filters };
    await exportRequest({ ...body, ids: [inventory, foreign] }).expect(404);
    expect((await get()).body.version).toBe(body.version);
    await http().post(`${base}/export`).set('Cookie', cookies.get(owner)!).send(body).expect(400);
    await exportRequest({ ...body, version: -1 }).expect(400);
    await exportRequest(body, randomUUID(), unverified).expect(403);
  });
  it('keeps staff exports private and rejects a cached file after permissions change', async () => {
    const list = await get(finance),
      body = {
        version: list.body.version,
        through: list.body.through,
        filters: { ...list.body.filters, family: 'Payments' },
      },
      key = randomUUID();
    const first = await exportRequest(body, key, finance).expect(201);
    expect(first.body.csv).not.toContain(email(owner));
    expect(first.body.csv).not.toContain(owner);
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${finance}::uuid,id,false FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='payments.view' ON CONFLICT(tenant_id,property_id,user_id,capability_id) DO UPDATE SET granted=false`;
    await exportRequest(body, key, finance).expect(409);
  });
  it('enforces tenant/property isolation and forced RLS on file receipts', async () => {
    await http()
      .get(`/tenants/${otherTenantId}/properties/${foreignPropertyId}/activity-audit`)
      .set('Cookie', cookies.get(owner)!)
      .expect(403);
    await http()
      .get(`/tenants/${tenantId}/properties/${otherPropertyId}/activity-audit`)
      .set('Cookie', cookies.get(finance)!)
      .expect(403);
    const rows = await db.withTenantTransaction(
      { tenantId, propertyId: otherPropertyId },
      (tx) =>
        tx.$queryRaw<
          unknown[]
        >`SELECT response FROM audit_export_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
    );
    expect(rows).toEqual([]);
    await expect(
      db.withTenantTransaction(
        { tenantId, propertyId: otherPropertyId },
        (tx) =>
          tx.$executeRaw`INSERT INTO audit_export_operations(tenant_id,property_id,user_id,idempotency_key,request_hash,response) VALUES(${tenantId}::uuid,${propertyId}::uuid,${owner}::uuid,'forbidden','hash','{}')`,
      ),
    ).rejects.toThrow();
  });
  it('observes future account events only in authorized properties and stores no session/IP/device values', async () => {
    const login = await http()
      .post('/auth/login')
      .set('X-Forwarded-For', '192.0.2.50')
      .set('User-Agent', 'private-device')
      .send({ email: email(finance), password })
      .expect(201);
    const session = login.headers['set-cookie'][0] as string;
    const signedOut = await Promise.all([
      http().post('/auth/logout').set('Cookie', session),
      http().post('/auth/logout').set('Cookie', session),
    ]);
    expect(signedOut.map((r) => r.status)).toEqual([204, 204]);
    const logs = await admin.$queryRaw<
      { propertyId: string; details: unknown; context: unknown }[]
    >`SELECT property_id AS "propertyId",details,request_context AS context FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND actor_user_id=${finance}::uuid AND action='auth.session_revoked'`;
    expect(logs).toHaveLength(1);
    expect(logs[0].propertyId).toBe(propertyId);
    const text = JSON.stringify(logs);
    expect(text).not.toContain('private-device');
    expect(text).not.toContain('192.0.2.50');
    expect(text).not.toContain(session.split(';')[0].split('=')[1]);
  });
  it('records a successful password reset in the same database transaction without password evidence', async () => {
    await http()
      .post('/auth/password-reset/request')
      .send({ email: email(second) })
      .expect(202);
    expect(resetToken).toBeTruthy();
    await http()
      .post('/auth/password-reset/confirm')
      .send({ token: resetToken, password: 'new-audit-fixture-password' })
      .expect(204);
    const events = await admin.$queryRaw<
      { propertyId: string; details: unknown }[]
    >`SELECT property_id AS "propertyId",details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND actor_user_id=${second}::uuid AND action='auth.password_changed'`;
    expect(events.map((e) => e.propertyId).sort()).toEqual([propertyId, otherPropertyId].sort());
    expect(JSON.stringify(events)).not.toContain('new-audit-fixture-password');
  });
  it('hard caps export size instead of silently truncating and rolls back the version', async () => {
    await admin.$executeRaw`INSERT INTO audit_logs(tenant_id,property_id,action,target_type,target_id) SELECT ${tenantId}::uuid,${propertyId}::uuid,'inventory_block.create','bulk-cap',n::text FROM generate_series(1,5001)n`;
    const list = await get(),
      body = {
        version: list.body.version,
        through: list.body.through,
        filters: { ...list.body.filters, target: 'bulk-cap' },
      };
    const r = await exportRequest(body).expect(400);
    expect(r.body.message).toContain('5000');
    expect((await get()).body.version).toBe(body.version);
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_type='bulk-cap'`;
    expect(service).toBeDefined();
  });
  it('expires temporary CSV receipts once while retaining the immutable export audit', async () => {
    await admin.$executeRaw`UPDATE audit_export_operations SET created_at=now()-interval '25 hours' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    const counts = await Promise.all([
      service.cleanupExports({ tenantId, propertyId }),
      service.cleanupExports({ tenantId, propertyId }),
    ]);
    expect(counts.filter((r) => r.removed > 0)).toHaveLength(1);
    expect((await service.cleanupExports({ tenantId, propertyId })).removed).toBe(0);
    const evidence = await admin.$queryRaw<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='audit.exported'`;
    expect(evidence[0].count).toBeGreaterThan(0);
  });
  it('rejects a byte-heavy export and keeps its version unchanged', async () => {
    const evidence = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => ['field' + i, 'e'.repeat(10000)]),
    );
    for (let i = 0; i < 3; i++)
      await admin.$executeRaw`INSERT INTO audit_logs(tenant_id,property_id,action,target_type,target_id,details) VALUES(${tenantId}::uuid,${propertyId}::uuid,'inventory_block.create','byte-limit',${String(i)},${JSON.stringify({ before: evidence })}::jsonb)`;
    const list = await get(),
      body = {
        version: list.body.version,
        through: list.body.through,
        filters: { ...list.body.filters, target: 'byte-limit' },
      };
    const response = await exportRequest(body).expect(400);
    expect(response.body.message).toContain('2MB');
    expect((await get()).body.version).toBe(body.version);
    await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_type='byte-limit'`;
  });
  it('also protects actor identity on the legacy accommodation audit contract', async () => {
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${finance}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='accommodations.manage' ON CONFLICT(tenant_id,property_id,user_id,capability_id) DO UPDATE SET granted=true`;
    const response = await http()
      .get(`/tenants/${tenantId}/properties/${propertyId}/audit-logs`)
      .set('Cookie', cookies.get(finance)!)
      .expect(200);
    expect(
      response.body.every((row: { actorUserId: string | null }) => row.actorUserId === null),
    ).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain(email(owner));
    expect(JSON.stringify(response.body)).not.toContain('Audit Operator');
  });
  it('rolls back the actual password change when its audit cannot commit', async () => {
    const before = await admin.$queryRaw<
      { hash: string }[]
    >`SELECT password_hash AS hash FROM users WHERE id=${second}::uuid`;
    await http()
      .post('/auth/password-reset/request')
      .send({ email: email(second) })
      .expect(202);
    const fail = vi
      .spyOn(app.get(AuditLogService), 'recordAccountEventInTransaction')
      .mockRejectedValueOnce(new Error('Injected audit failure'));
    try {
      await http()
        .post('/auth/password-reset/confirm')
        .send({ token: resetToken, password: 'must-not-be-applied-password' })
        .expect(500);
    } finally {
      fail.mockRestore();
    }
    const after = await admin.$queryRaw<
      { hash: string }[]
    >`SELECT password_hash AS hash FROM users WHERE id=${second}::uuid`;
    expect(after[0].hash).toBe(before[0].hash);
  });
});
