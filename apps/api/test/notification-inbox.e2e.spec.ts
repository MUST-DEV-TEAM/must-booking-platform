import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailDeliveryService } from '../src/mail/mail-delivery.service';
import { NotificationInboxService } from '../src/tenancy/notification-inbox.service';
import { NotificationRetentionService } from '../src/tenancy/notification-retention.service';
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
describe('personal notification inbox over real scoped Postgres records', () => {
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
  const booking = randomUUID(),
    roomType = randomUUID(),
    ratePlan = randomUUID(),
    created = randomUUID(),
    attention = randomUUID(),
    refund = randomUUID(),
    seat = randomUUID(),
    unknown = randomUUID(),
    foreign = randomUUID();
  const base = `/tenants/${tenantId}/properties/${propertyId}/notifications`,
    scope = { tenantId, propertyId, userId: owner };
  let app: INestApplication,
    inbox: NotificationInboxService,
    db: TenantDatabaseService,
    retention: NotificationRetentionService;
  const cookies = new Map<string, string>();
  const http = () => request(app.getHttpServer());
  const get = (user = owner, query = '') =>
    http()
      .get(base + query)
      .set('Cookie', cookies.get(user)!);
  const mark = (id: string, version: number, key = randomUUID(), user = owner) =>
    http()
      .patch(`${base}/${id}`)
      .set('Cookie', cookies.get(user)!)
      .set('Idempotency-Key', key)
      .send({ version });
  beforeAll(async () => {
    process.env.APP_PORT = '3000';
    process.env.DATABASE_URL =
      'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.WEB_APP_URL = 'http://localhost:3001';
    const hash = await bcrypt.hash('notification-fixture-password', 4);
    await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${tenantId}::uuid,'Notification fixture'),(${otherTenantId}::uuid,'Other notification fixture')`;
    for (const [t, p] of [
      [tenantId, propertyId],
      [tenantId, otherPropertyId],
      [otherTenantId, foreignPropertyId],
    ])
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${p}::uuid,${t}::uuid,'Notification property',${'inbox-' + p},'Pacific/Kiritimati')`;
    for (const user of [owner, second, finance, unverified, noAccess]) {
      await admin.$executeRaw`INSERT INTO users(id,email,password_hash,email_verified_at) VALUES(${user}::uuid,${'inbox-' + user + '@example.test'},${hash},${user === unverified ? null : new Date()})`;
      await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${user}::uuid,${user === owner ? 'OWNER' : [second, unverified].includes(user) ? 'ADMIN' : 'STAFF'}::"TenantMembershipRole")`;
    }
    const { AppModule } = await import('../src/app.module');
    const module = await withoutExternalWorkers(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(MailDeliveryService)
        .useValue({ async dispatch() {} }),
    ).compile();
    app = module.createNestApplication();
    await app.init();
    inbox = module.get(NotificationInboxService);
    db = module.get(TenantDatabaseService);
    retention = module.get(NotificationRetentionService);
    await module.get(PropertyRoleTemplatesService).ensureBuiltInTemplates(tenantId, propertyId);
    const roles = await admin.$queryRaw<
      { id: string; name: string }[]
    >`SELECT id,name FROM property_role_templates WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    for (const user of [finance, noAccess])
      await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${user}::uuid,${roles.find((r) => r.name === 'Finance')!.id}::uuid)`;
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${finance}::uuid,id,false FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='bookings.view'`;
    await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${noAccess}::uuid,id,false FROM capabilities WHERE tenant_id=${tenantId}::uuid`;
    for (const user of [owner, second, finance, unverified, noAccess]) {
      const login = await http()
        .post('/auth/login')
        .send({
          email: 'inbox-' + user + '@example.test',
          password: 'notification-fixture-password',
        })
        .expect(201);
      cookies.set(user, login.headers['set-cookie'][0]);
    }
    await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Inbox room',2)`;
    await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,currency) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Inbox rate','EUR')`;
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,status,starts_on,ends_on,total_amount) VALUES(${booking}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,'INBOX-REFERENCE','MANUAL_REVIEW','2027-01-01','2027-01-03',100)`;
    for (const [id, type] of [
      [created, 'BOOKING_CREATED'],
      [attention, 'BOOKING_NEEDS_ATTENTION'],
      [refund, 'PAYMENT_REFUNDED'],
      [seat, 'STAFF_SEAT_CAP_REACHED'],
      [unknown, 'NOT_REGISTERED'],
    ])
      await admin.$executeRaw`INSERT INTO notifications(id,tenant_id,property_id,type,payload,read_at) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type},${JSON.stringify({ bookingId: booking, password: 'must-not-escape', reason: 'unsafe-payload' })}::jsonb,now())`;
    await admin.$executeRaw`INSERT INTO notifications(id,tenant_id,property_id,type) VALUES(${foreign}::uuid,${tenantId}::uuid,${otherPropertyId}::uuid,'BOOKING_CREATED')`;
  });
  afterAll(async () => {
    if (app) await app.close();
    await cleanupTenant(admin, tenantId);
    await cleanupTenant(admin, otherTenantId);
    for (const user of [owner, second, finance, unverified, noAccess])
      await admin.$executeRaw`DELETE FROM users WHERE id=${user}::uuid`;
    await admin.$disconnect();
  });
  it('registry routes existing types, ignores legacy shared reads and never returns arbitrary payload', async () => {
    const r = await get().expect(200);
    expect(r.body.total).toBe(4);
    expect(r.body.unreadTotal).toBe(4);
    expect(r.body.version).toBe(0);
    expect(r.body.categories).toHaveLength(5);
    expect(r.body.priorities).toHaveLength(4);
    expect(r.body.counts).toMatchObject({ critical: 0, needsAction: 1 });
    expect(r.body.items.every((r: { readAt: unknown }) => r.readAt === null)).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('must-not-escape');
    expect(r.body.items.find((r: { id: string }) => r.id === attention).needsAction).toBe(true);
  });
  it('routes staff by capability and hides reservation context and deep links without bookings.view', async () => {
    const r = await get(finance).expect(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({
      id: refund,
      booking: null,
      href: null,
      limitedContext: 'bookings.view',
    });
    await http().get(`${base}/${created}`).set('Cookie', cookies.get(finance)!).expect(404);
    expect((await get(noAccess).expect(200)).body).toMatchObject({ items: [], unreadTotal: 0 });
  });
  it('isolates personal reads, retries once and rejects changed intent/stale versions', async () => {
    const key = randomUUID();
    const first = await mark(created, 0, key).expect(200);
    expect(first.body).toEqual({ updated: 1, version: 1 });
    expect((await mark(created, 0, key).expect(200)).body).toEqual(first.body);
    await mark(attention, 0, key).expect(409);
    await mark(attention, 0).expect(409);
    expect((await get().expect(200)).body.unreadTotal).toBe(3);
    expect((await get(second).expect(200)).body.unreadTotal).toBe(4);
    const logs = await admin.$queryRaw<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND actor_user_id=${owner}::uuid AND action='notifications.mark_read'`;
    expect(logs[0].n).toBe(1);
  });
  it('serializes real concurrent edits and identical retries on the same personal inbox', async () => {
    const version = (await get(second)).body.version;
    const racing = await Promise.all([
      mark(created, version, randomUUID(), second),
      mark(refund, version, randomUUID(), second),
    ]);
    expect(racing.map((r) => r.status).sort()).toEqual([200, 409]);
    const next = (await get(second)).body.version,
      key = randomUUID();
    const retry = await Promise.all([mark(seat, next, key, second), mark(seat, next, key, second)]);
    expect(retry.map((r) => r.status)).toEqual([200, 200]);
    expect(retry[0].body).toEqual(retry[1].body);
  });
  it('rejects missing keys, versions, unverified writes and mixed authorized/foreign selections atomically', async () => {
    await http()
      .patch(`${base}/${refund}`)
      .set('Cookie', cookies.get(owner)!)
      .send({ version: 1 })
      .expect(400);
    await http()
      .patch(`${base}/${refund}`)
      .set('Cookie', cookies.get(owner)!)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(400);
    await mark(created, 0, randomUUID(), unverified).expect(403);
    const current = await get();
    await http()
      .patch(`${base}/mark-visible-read`)
      .set('Cookie', cookies.get(owner)!)
      .set('Idempotency-Key', randomUUID())
      .send({ version: current.body.version, ids: [refund, foreign] })
      .expect(404);
    expect((await get()).body.version).toBe(current.body.version);
  });
  it('enforces property and tenant boundaries in HTTP and forced RLS', async () => {
    await http()
      .get(`/tenants/${otherTenantId}/properties/${foreignPropertyId}/notifications`)
      .set('Cookie', cookies.get(owner)!)
      .expect(403);
    await http().get(`${base}/${foreign}`).set('Cookie', cookies.get(owner)!).expect(404);
    await http()
      .get(`/tenants/${tenantId}/properties/${otherPropertyId}/notifications`)
      .set('Cookie', cookies.get(finance)!)
      .expect(403);
    const rows = await db.withTenantTransaction(
      { tenantId, propertyId: otherPropertyId },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT notification_id AS id FROM notification_reads WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
    );
    expect(rows).toEqual([]);
    await expect(
      db.withTenantTransaction(
        { tenantId, propertyId: otherPropertyId },
        (tx) =>
          tx.$executeRaw`INSERT INTO notification_inbox_states(tenant_id,property_id,user_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${noAccess}::uuid)`,
      ),
    ).rejects.toThrow();
  });
  it('marks only visible ids and never resolves the underlying needs-action issue', async () => {
    const version = (await get()).body.version;
    await http()
      .patch(`${base}/mark-visible-read`)
      .set('Cookie', cookies.get(owner)!)
      .set('Idempotency-Key', randomUUID())
      .send({ version, ids: [attention] })
      .expect(200);
    expect(
      (await get(owner, '?unread=1')).body.items.some((r: { id: string }) => r.id === attention),
    ).toBe(false);
    const action = await get(owner, '?needsAction=1');
    expect(action.body.items).toHaveLength(1);
    expect(action.body.items[0]).toMatchObject({ id: attention, needsAction: true });
    expect(action.body.items[0].readAt).not.toBeNull();
  });
  it('resolves a needs-action item for everyone with who, when and a note, and reopens it', async () => {
    const patch = (path: string, user = owner, body: object = {}) =>
      http().patch(`${base}/${path}`).set('Cookie', cookies.get(user)!).send(body);
    await patch(`${created}/resolve`).expect(400);
    await patch(`${foreign}/resolve`).expect(404);
    await patch(`${attention}/resolve`, unverified).expect(403);
    const first = await patch(`${attention}/resolve`, owner, { note: 'Called the guest.' }).expect(
      200,
    );
    expect(first.body).toEqual({ changed: true, resolved: true });
    expect((await patch(`${attention}/resolve`).expect(200)).body.changed).toBe(false);
    const detail = (await http().get(`${base}/${attention}`).set('Cookie', cookies.get(owner)!))
      .body;
    expect(detail.resolution).toMatchObject({
      state: 'resolved',
      source: 'manual',
      note: 'Called the guest.',
    });
    expect(detail.resolution.at).toBeTruthy();
    expect(Array.isArray(detail.readBy)).toBe(true);
    expect(
      (await get(owner, '?needsAction=1')).body.items.some(
        (r: { id: string }) => r.id === attention,
      ),
    ).toBe(false);
    expect(
      (await get(owner, '?resolved=1')).body.items.some((r: { id: string }) => r.id === attention),
    ).toBe(true);
    expect((await patch(`${attention}/reopen`).expect(200)).body.changed).toBe(true);
    expect((await patch(`${attention}/reopen`).expect(200)).body.changed).toBe(false);
    expect(
      (await get(owner, '?needsAction=1')).body.items.some(
        (r: { id: string }) => r.id === attention,
      ),
    ).toBe(true);
    const race = await Promise.all([
      patch(`${attention}/resolve`, owner),
      patch(`${attention}/resolve`, second),
    ]);
    expect(race.map((r) => r.status)).toEqual([200, 200]);
    expect(race.filter((r) => r.body.changed).length).toBe(1);
    await patch(`${attention}/reopen`).expect(200);
    const events = await admin.$queryRaw<{ action: string }[]>`
      SELECT action FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND target_id=${attention}
        AND action IN ('notifications.resolve','notifications.reopen')`;
    expect(events.length).toBeGreaterThanOrEqual(4);
  });
  it('uses current stored review/status evidence; missing booking stays Unknown', async () => {
    await admin.$executeRaw`UPDATE bookings SET status='CONFIRMED' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking}::uuid`;
    await admin.$executeRaw`INSERT INTO manual_review_items(tenant_id,property_id,category,reference_type,reference_id,message) VALUES(${tenantId}::uuid,${propertyId}::uuid,'PAYMENT_BOOKING_MISMATCH','booking',${booking},'Fixture issue')`;
    expect(
      (await http().get(`${base}/${attention}`).set('Cookie', cookies.get(owner)!)).body
        .needsAction,
    ).toBe(true);
    await admin.$executeRaw`UPDATE manual_review_items SET status='RESOLVED' WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND reference_id=${booking}`;
    expect(
      (await http().get(`${base}/${attention}`).set('Cookie', cookies.get(owner)!)).body
        .needsAction,
    ).toBe(false);
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO notifications(id,tenant_id,property_id,type) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,'BOOKING_NEEDS_ATTENTION')`;
    expect(
      (await http().get(`${base}/${id}`).set('Cookie', cookies.get(owner)!)).body.needsAction,
    ).toBeNull();
    expect(
      (await get(owner, '?needsAction=1')).body.items.map((row: { id: string }) => row.id),
    ).toContain(id);
  });
  it('filters across the server inbox, validates real dates and uses property-local date edges', async () => {
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO notifications(id,tenant_id,property_id,type,created_at) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,'BOOKING_CREATED',date_trunc('day',now())-interval '12 hours')`;
    const date = await admin.$queryRaw<
      { d: string }[]
    >`SELECT ((date_trunc('day',now())-interval '12 hours') AT TIME ZONE 'Pacific/Kiritimati')::date::text AS d`;
    const result = await get(
      owner,
      `?from=${date[0].d}&to=${date[0].d}&category=Reservations&priority=Low&pageSize=1`,
    ).expect(200);
    expect(result.body.total).toBeGreaterThanOrEqual(1);
    const exact = await get(owner, '?search=INBOX-REFERENCE&category=Payments').expect(200);
    expect(exact.body.items.map((r: { id: string }) => r.id)).toEqual([refund]);
    expect((await get(finance, '?search=INBOX-REFERENCE')).body.total).toBe(0);
    for (const query of [
      '?from=2026-02-30',
      '?from=2026-03-01&to=2026-02-01',
      '?priority=Invented',
      '?category=Invented',
      '?pageSize=101',
    ])
      await get(owner, query).expect(400);
    expect((await get(owner, '?category=Providers')).body.total).toBe(0);
  });
  it('mark all respects the observed cutoff so newly arriving alerts stay unread', async () => {
    const before = await get();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = randomUUID();
    await admin.$executeRaw`INSERT INTO notifications(id,tenant_id,property_id,type) VALUES(${newer}::uuid,${tenantId}::uuid,${propertyId}::uuid,'BOOKING_CREATED')`;
    await http()
      .patch(`${base}/mark-all-read`)
      .set('Cookie', cookies.get(owner)!)
      .set('Idempotency-Key', randomUUID())
      .send({ version: before.body.version, through: before.body.through })
      .expect(200);
    expect((await get(owner, '?unread=1')).body.items.map((r: { id: string }) => r.id)).toEqual([
      newer,
    ]);
  });
  it('concurrent retention is repeat-safe, retains exact boundary, cascades reads, preserves source records', async () => {
    const now = new Date(),
      cutoff = new Date(now.getTime() - 90 * 86400000),
      old = randomUUID(),
      edge = randomUUID();
    await admin.$executeRaw`INSERT INTO notifications(id,tenant_id,property_id,type,created_at) VALUES(${old}::uuid,${tenantId}::uuid,${propertyId}::uuid,'BOOKING_NEEDS_ATTENTION',${new Date(cutoff.getTime() - 1)}),(${edge}::uuid,${tenantId}::uuid,${propertyId}::uuid,'BOOKING_CREATED',${cutoff})`;
    await admin.$executeRaw`INSERT INTO notification_reads(tenant_id,property_id,user_id,notification_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${owner}::uuid,${old}::uuid)`;
    await admin.$executeRaw`INSERT INTO notification_operations(tenant_id,property_id,user_id,idempotency_key,request_hash,response,created_at) VALUES(${tenantId}::uuid,${propertyId}::uuid,${owner}::uuid,'expired','hash','{}',${new Date(cutoff.getTime() - 1)})`;
    expect((await get()).body.items.map((r: { id: string }) => r.id)).not.toContain(old);
    const results = await Promise.all([inbox.cleanup(scope, now), inbox.cleanup(scope, now)]);
    expect(results.map((r) => r.deleted).sort()).toEqual([0, 1]);
    expect(results.map((r) => r.receipts).sort()).toEqual([0, 1]);
    const retained = await admin.$queryRaw<
      { id: string }[]
    >`SELECT id FROM notifications WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=ANY(${[old, edge]}::uuid[])`;
    expect(retained).toEqual([{ id: edge }]);
    const source = await admin.$queryRaw<
      { id: string }[]
    >`SELECT id FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${booking}::uuid`;
    expect(source).toHaveLength(1);
    expect((await inbox.cleanup(scope, now)).deleted).toBe(0);
  });
  it('nightly sweep discovery carries exact scope into each cleanup', async () => {
    // An isolated worker instance avoids touching any other local hotel during the behavior test.
    const calls: { tenantId: string; propertyId: string }[] = [];
    const discovery = {
      async $queryRaw() {
        return [{ tenantId, propertyId }];
      },
    } as unknown as TenantDatabaseService;
    const cleanup = {
      async cleanup(c: { tenantId: string; propertyId: string }) {
        calls.push(c);
        return { deleted: 0, receipts: 0 };
      },
    } as unknown as NotificationInboxService;
    const worker = new NotificationRetentionService(discovery, cleanup);
    await worker.sweep();
    await worker.sweep();
    expect(calls).toEqual([
      { tenantId, propertyId },
      { tenantId, propertyId },
    ]);
    expect(retention).toBeDefined();
  });
});
