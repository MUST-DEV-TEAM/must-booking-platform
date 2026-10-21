import { PaymentRefundService } from '../src/payments/payment-refund.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider-registry';
import { PaymentNotificationService } from '../src/mail/payment-notification.service';
import { NotificationsService } from '../src/tenancy/notifications.service';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { ManualReviewService } from '../src/integrations/manual-review.service';
import { AvailabilityService } from '../src/tenancy/availability.service';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { ClockAvailabilityService } from '../src/integrations/clock/clock-availability.service';
import { InventoryStockService } from '../src/tenancy/inventory-stock.service';
import { BookingUpdateNotificationService } from '../src/mail/booking-update-notification.service';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { CapabilitiesService } from '../src/tenancy/capabilities.service';
import { CapabilitiesGuard } from '../src/tenancy/capabilities.guard';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { BookingAmendService } from '../src/booking/booking-amend.service';
import { BookingAmendController } from '../src/booking/booking-amend.controller';
// Real HTTP, capability guard, pricing, audit and Postgres; trusted fixture identities
// replace session establishment. No workers, provider clients or external requests.
const schema = 'b2b_test_' + randomUUID().replaceAll('-', '');
const admin = new PrismaClient({
  datasources: {
    db: {
      url:
        'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=' + schema,
    },
  },
});
const db = new TenantDatabaseService({
  datasources: {
    db: {
      url:
        'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=' +
        schema,
    },
  },
});
const original = db.withTenantTransaction.bind(db);
db.withTenantTransaction = (c, op, options) =>
  original(
    c,
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      return op(tx);
    },
    options,
  );
const tenantId = randomUUID(),
  propertyId = randomUUID(),
  otherProperty = randomUUID(),
  owner = randomUUID(),
  staff = randomUUID(),
  guest = randomUUID(),
  roomType = randomUUID(),
  ratePlan = randomUUID();
const c: { tenantId: string; propertyId: string; userId: string } = {
  tenantId,
  propertyId,
  userId: owner,
};
let app: INestApplication;
const receipt = { sendRefundConfirmationEmailSafely: vi.fn(async () => {}) };
const email = { sendBookingChanged: vi.fn(async () => {}) };
const tables = [
  'inventory_units',
  'inventory_restrictions',
  'availability_blocks',
  'availability_block_rooms',
  'availability_block_room_types',
  'room_availability',
  'properties',
  'room_types',
  'rate_plans',
  'rate_rules',
  'pricing_daily_prices',
  'pricing_adjustments',
  'pricing_charges',
  'room_price_overrides',
  'guests',
  'bookings',
  'integration_operations',
  'users',
  'tenant_memberships',
  'capabilities',
  'property_staff_assignments',
  'property_role_template_capabilities',
  'property_staff_capability_overrides',
  'property_integration_connections',
  'integration_connections',
  'audit_logs',
  'booking_requests',
  'payments',
  'rooms',
  'clock_folios',
  'email_messages',
  'notification_recipient_rules',
  'property_role_templates',
];
const base = `/tenants/${tenantId}/properties/${propertyId}/bookings`;
const patch = (
  id: string,
  body: Record<string, unknown>,
  key: string = randomUUID(),
  user: string = owner,
  property: string = propertyId,
) =>
  request(app.getHttpServer())
    .patch(`/tenants/${tenantId}/properties/${property}/bookings/${id}/amend`)
    .set('X-Fixture-User', user)
    .set('Idempotency-Key', key)
    .send(body);
async function fixture(paid = 0, assigned = false) {
  const id = randomUUID(),
    type = randomUUID(),
    room = assigned ? randomUUID() : null;
  await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy,status) VALUES(${type}::uuid,${tenantId}::uuid,${propertyId}::uuid,${'Amend ' + type},3,'PUBLISHED')`;
  await admin.$executeRaw`INSERT INTO rate_rules(tenant_id,property_id,room_type_id,rate_plan_id,amount) VALUES(${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,${ratePlan}::uuid,100)`;
  if (room)
    await admin.$executeRaw`INSERT INTO rooms(id,tenant_id,property_id,room_type_id,name) VALUES(${room}::uuid,${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,${'Same room ' + room})`;
  await admin.$executeRaw`INSERT INTO inventory_units(tenant_id,property_id,room_type_id,stays_on,available_units,booked_units) SELECT ${tenantId}::uuid,${propertyId}::uuid,${type}::uuid,d::date,1,CASE WHEN ${!assigned} AND d::date IN ('2030-07-10','2030-07-11') THEN 1 ELSE 0 END FROM generate_series('2030-07-01'::date,'2030-07-31'::date,'1 day') d`;
  await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,guest_id,room_type_id,room_id,rate_plan_id,external_reference,starts_on,ends_on,total_amount,status,payment_method,source) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${guest}::uuid,${type}::uuid,${room}::uuid,${ratePlan}::uuid,${'B2B-' + id},'2030-07-10','2030-07-12',200,'CONFIRMED','PAY_AT_HOTEL','DIRECT')`;
  if (paid)
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'CHARGE','manual',${id},'PAID',${paid},'EUR')`;
  return { id, type, room };
}
const dates = { startsOn: '2030-07-11', endsOn: '2030-07-14' };
const preview = (id: string, d = dates, user = owner, property = propertyId) =>
  request(app.getHttpServer())
    .get(`/tenants/${tenantId}/properties/${property}/bookings/${id}/amend-preview`)
    .set('X-Fixture-User', user)
    .query(d);
const input = (p: { version: number; previewHash: string }, d = dates) => ({
  ...d,
  expectedVersion: p.version,
  previewHash: p.previewHash,
  reason: 'Guest requested a new stay',
  notifyGuest: false,
});
async function stock(type: string) {
  return admin.$queryRaw<
    { day: string; units: number }[]
  >`SELECT stays_on::text AS day,booked_units AS units FROM inventory_units WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${type}::uuid AND stays_on BETWEEN '2030-07-10' AND '2030-07-14' ORDER BY stays_on`;
}
beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      for (const t of tables)
        await tx.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${t}" (LIKE public."${t}" INCLUDING ALL)`,
        );
      const migration = readFileSync(
        'prisma/migrations/20261020140000_booking_details/migration.sql',
        'utf8',
      ).replace(/--[^\n]*/g, '');
      for (let n = 0; n < 2; n++)
        for (const sql of migration.split(';').filter((s) => s.trim()))
          await tx.$executeRawUnsafe(sql);
      for (const name of [
        '20261021090000_payment_brand_settings',
        '20261021100000_richer_property_settings',
      ]) {
        const sql = readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
          .split('-- Same privileged')[0]!
          .replace(/--[^\n]*/g, '');
        for (const statement of sql.split(';').filter((x) => x.trim()))
          await tx.$executeRawUnsafe(statement);
      }
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
      await tx.$executeRawUnsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO must_booking_app`,
      );
      await tx.$executeRawUnsafe(`ALTER TABLE "${schema}".bookings ENABLE ROW LEVEL SECURITY`);
      await tx.$executeRawUnsafe(`ALTER TABLE "${schema}".bookings FORCE ROW LEVEL SECURITY`);
      await tx.$executeRawUnsafe(
        `CREATE POLICY scope ON "${schema}".bookings USING(tenant_id=public.app_current_tenant_id() AND property_id=public.app_current_property_id()) WITH CHECK(tenant_id=public.app_current_tenant_id() AND property_id=public.app_current_property_id())`,
      );
    },
    { timeout: 30000 },
  );
  for (const id of [propertyId, otherProperty])
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${id}::uuid,${tenantId}::uuid,'B2a property',${schema + id},'Europe/Tirane')`;
  for (const id of [owner, staff]) {
    await admin.$executeRaw`INSERT INTO users(id,email) VALUES(${id}::uuid,${id + '@example.test'})`;
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${id}::uuid,${id === owner ? 'OWNER' : 'STAFF'}::public."TenantMembershipRole")`;
  }
  for (const key of ['bookings.edit', 'bookings.view', 'payments.refund'])
    await admin.$executeRaw`INSERT INTO capabilities(tenant_id,key,description) VALUES(${tenantId}::uuid,${key},${key})`;
  await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email,first_name,last_name,phone) VALUES(${guest}::uuid,${tenantId}::uuid,'original@example.test','Original','Guest','+355 12345')`;
  await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Details room',3)`;
  await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,code,currency,lifecycle) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Amend rate','B2B','EUR','Active')`;
  await admin.$executeRaw`INSERT INTO rate_rules(tenant_id,property_id,room_type_id,rate_plan_id,amount) VALUES(${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,100)`;
  const mod = await Test.createTestingModule({
    controllers: [BookingAmendController],
    providers: [
      BookingAmendService,
      PaymentRefundService,
      { provide: PaymentProviderRegistry, useValue: {} },
      { provide: PaymentNotificationService, useValue: receipt },
      { provide: NotificationsService, useValue: { recordInTransaction: vi.fn(async () => {}) } },
      { provide: ClockBookingService, useValue: {} },
      { provide: ManualReviewService, useValue: {} },
      AvailabilityService,
      { provide: IntegrationConnectionsService, useValue: {} },
      { provide: ClockAvailabilityService, useValue: {} },
      { provide: InventoryStockService, useValue: {} },
      { provide: BookingUpdateNotificationService, useValue: email },
      CapabilitiesService,
      AuditLogService,
      { provide: TenantDatabaseService, useValue: db },
    ],
  }).compile();
  app = mod.createNestApplication();
  app.use(
    (
      req: { originalUrl: string; headers: Record<string, string>; tenantContext?: typeof c },
      _res: unknown,
      next: () => void,
    ) => {
      const parts = req.originalUrl.split('/');
      req.tenantContext = {
        tenantId: parts[2]!,
        propertyId: parts[4]!,
        userId: req.headers['x-fixture-user'] ?? owner,
      };
      next();
    },
  );
  app.useGlobalGuards(new CapabilitiesGuard(new Reflector(), mod.get(CapabilitiesService)));
  await app.init();
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (!/^b2b_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});

it('reprices upward, moves stock including overlapping own nights, audits once, and replays concurrent same-key confirms', async () => {
  const f = await fixture(100),
    before = await stock(f.type),
    p = await preview(f.id);
  expect(p.status, p.text).toBe(200);
  expect(p.body).toMatchObject({
    available: true,
    oldTotal: '200.00',
    newTotal: '300.00',
    difference: '100.00',
    balance: '200.00',
    balanceState: 'due',
  });
  expect(await stock(f.type)).toEqual(before);
  const body = { ...input(p.body), notifyGuest: true },
    key = randomUUID();
  const results = await Promise.all([patch(f.id, body, key), patch(f.id, body, key)]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(results[0]!.body).toEqual(results[1]!.body);
  expect((await stock(f.type)).map((r) => r.units)).toEqual([0, 1, 1, 1, 0]);
  expect(email.sendBookingChanged).toHaveBeenCalledTimes(1);
  expect((await patch(f.id, { ...body, reason: 'Different' }, key)).status).toBe(409);
  const audit = await admin.$queryRaw<
    { details: any }[]
  >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_id=${f.id} AND action='booking.dates_amended'`;
  expect(audit).toHaveLength(1);
  expect(audit[0]!.details.changes.total).toEqual({ old: '200.00', new: '300.00' });
  expect(
    (
      await admin.$queryRaw<
        { total: string; starts: string }[]
      >`SELECT total_amount::text AS total,starts_on::text AS starts FROM bookings WHERE id=${f.id}::uuid`
    )[0],
  ).toEqual({ total: '300.00', starts: dates.startsOn });
});
it('reprices downward without refund permission and leaves a ledger-derived refund due without moving money', async () => {
  const f = await fixture(200),
    d = { startsOn: '2030-07-11', endsOn: '2030-07-12' };
  const editUser = randomUUID();
  await admin.$executeRaw`INSERT INTO users(id,email) VALUES(${editUser}::uuid,${editUser + '@example.test'})`;
  await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${editUser}::uuid,'STAFF')`;
  await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${editUser}::uuid,${randomUUID()}::uuid)`;
  await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${editUser}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='bookings.edit'`;
  const p = await preview(f.id, d, editUser);
  expect(p.status, p.text).toBe(200);
  expect(p.body).toMatchObject({
    newTotal: '100.00',
    difference: '-100.00',
    balance: '-100.00',
    balanceState: 'refund_due',
  });
  const result = await patch(f.id, input(p.body, d), randomUUID(), editUser);
  expect(result.status, result.text).toBe(200);
  expect(result.body.balanceState).toBe('refund_due');
  expect(
    (
      await admin.$queryRaw<
        { n: bigint }[]
      >`SELECT count(*) AS n FROM payments WHERE booking_id=${f.id}::uuid AND kind='REFUND'`
    )[0]!.n,
  ).toBe(0n);
});
it('refuses unavailable dates and leaves old inventory intact', async () => {
  const f = await fixture(),
    p = await preview(f.id),
    before = await stock(f.type);
  await admin.$executeRaw`UPDATE inventory_units SET available_units=0 WHERE room_type_id=${f.type}::uuid AND stays_on='2030-07-13'`;
  expect((await patch(f.id, input(p.body))).status).toBe(409);
  const blocked = await preview(f.id);
  expect(blocked.body.available).toBe(false);
  const refused = await patch(f.id, input(blocked.body));
  expect(refused.status).toBe(409);
  expect(refused.body.message).toContain('unavailable');
  expect(await stock(f.type)).toEqual(before);
});
it('rejects stale versions and makes concurrent different-key confirms yield one winner', async () => {
  const f = await fixture(),
    p = await preview(f.id);
  const results = await Promise.all([patch(f.id, input(p.body)), patch(f.id, input(p.body))]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await stock(f.type)).map((r) => r.units)).toEqual([0, 1, 1, 1, 0]);
});
it('fails closed for missing edit capability, wrong hotel and wrong tenant', async () => {
  const f = await fixture(),
    p = await preview(f.id);
  expect((await preview(f.id, dates, staff)).status).toBe(403);
  expect((await patch(f.id, input(p.body), randomUUID(), staff)).status).toBe(403);
  expect((await patch(f.id, input(p.body), randomUUID(), owner, otherProperty)).status).toBe(404);
  const c2 = { tenantId: randomUUID(), propertyId, userId: owner };
  const service = app.get(BookingAmendService);
  await expect(service.preview(c2, f.id, dates)).rejects.toThrow('Requires bookings.edit');
});
it('refuses Clock-managed and cancelled reservations without changing inventory', async () => {
  const f = await fixture(),
    p = await preview(f.id),
    before = await stock(f.type);
  await admin.$executeRaw`UPDATE bookings SET external_booking_id='clock-managed' WHERE id=${f.id}::uuid`;
  const clock = await patch(f.id, input(p.body));
  expect(clock.status).toBe(409);
  expect(clock.body.message).toContain('managed in Clock');
  await admin.$executeRaw`UPDATE bookings SET external_booking_id=NULL,status='CANCELLED' WHERE id=${f.id}::uuid`;
  expect((await patch(f.id, input(p.body))).status).toBe(409);
  expect(await stock(f.type)).toEqual(before);
  await admin.$executeRaw`UPDATE bookings SET status='CONFIRMED',pms_stay_status='checked_out' WHERE id=${f.id}::uuid`;
  expect((await patch(f.id, input(p.body))).status).toBe(409);
  await admin.$executeRaw`UPDATE bookings SET status='CONFIRMED',starts_on='2000-01-01',ends_on='2000-01-03' WHERE id=${f.id}::uuid`;
  const ended = await patch(f.id, input(p.body));
  expect(ended.status).toBe(409);
  expect(ended.body.message).toContain('stay has ended');
});
it('keeps an assigned room, excludes its own nights and refuses a different overlapping booking', async () => {
  const f = await fixture(0, true),
    p = await preview(f.id);
  expect(p.status, p.text).toBe(200);
  expect(p.body.available).toBe(true);
  expect((await patch(f.id, input(p.body))).status).toBe(200);
  const row = (
    await admin.$queryRaw<
      { room: string }[]
    >`SELECT room_id AS room FROM bookings WHERE id=${f.id}::uuid`
  )[0];
  expect(row!.room).toBe(f.room);
  expect((await stock(f.type)).every((r) => r.units === 0)).toBe(true);
  const sibling = randomUUID();
  await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,guest_id,room_type_id,room_id,rate_plan_id,external_reference,starts_on,ends_on,total_amount,status,payment_method,source) VALUES(${sibling}::uuid,${tenantId}::uuid,${propertyId}::uuid,${guest}::uuid,${f.type}::uuid,${f.room}::uuid,${ratePlan}::uuid,${'OTHER-' + sibling},'2030-07-14','2030-07-16',200,'CONFIRMED','PAY_AT_HOTEL','DIRECT')`;
  const blocked = await preview(f.id, { startsOn: '2030-07-13', endsOn: '2030-07-16' });
  expect(blocked.body.available).toBe(false);
  expect(
    (await patch(f.id, input(blocked.body, { startsOn: '2030-07-13', endsOn: '2030-07-16' })))
      .status,
  ).toBe(409);
});

it('rolls back dates, price, both inventory ranges and operation when the audit write fails', async () => {
  const f = await fixture(),
    p = await preview(f.id),
    before = await stock(f.type),
    key = randomUUID();
  const audit = vi
    .spyOn(app.get(AuditLogService), 'recordInTransaction')
    .mockRejectedValueOnce(new Error('Fixture audit failure'));
  try {
    expect((await patch(f.id, input(p.body), key)).status).toBe(500);
    expect(await stock(f.type)).toEqual(before);
    expect(
      (
        await admin.$queryRaw<
          { version: number; total: string }[]
        >`SELECT version,total_amount::text AS total FROM bookings WHERE id=${f.id}::uuid`
      )[0],
    ).toEqual({ version: 1, total: '200.00' });
  } finally {
    audit.mockRestore();
  }
  expect((await patch(f.id, input(p.body), key)).status).toBe(200);
});
it('enforces the shared minimum-stay rule and refuses changed pricing previews', async () => {
  const f = await fixture();
  await admin.$executeRaw`UPDATE properties SET min_stay_nights=4 WHERE id=${propertyId}::uuid`;
  try {
    const p = await preview(f.id);
    expect(p.status, p.text).toBe(200);
    expect(p.body.available).toBe(false);
    expect(p.body.policyNotes.join(' ')).toContain('minimum stay of 4');
    expect((await patch(f.id, input(p.body))).status).toBe(409);
  } finally {
    await admin.$executeRaw`UPDATE properties SET min_stay_nights=NULL WHERE id=${propertyId}::uuid`;
  }
  const p = await preview(f.id);
  await admin.$executeRaw`UPDATE rate_rules SET amount=110,version=version+1 WHERE room_type_id=${f.type}::uuid`;
  expect((await patch(f.id, input(p.body))).status).toBe(409);
  expect((await stock(f.type)).map((r) => r.units)).toEqual([1, 1, 0, 0, 0]);
});
it('keeps a locally stored booking read-only when the hotel is connected to Clock', async () => {
  const f = await fixture(),
    p = await preview(f.id),
    connection = randomUUID();
  await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Fixture only','not-a-credential')`;
  await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind,enabled) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS',true)`;
  try {
    const r = await patch(f.id, input(p.body));
    expect(r.status).toBe(409);
    expect(r.body.message).toContain('managed in Clock');
  } finally {
    await admin.$executeRaw`DELETE FROM property_integration_connections WHERE connection_id=${connection}::uuid`;
  }
});

it('fails closed for an ambiguous order capture and uses booking-owned amounts when the split is clear', async () => {
  const first = await fixture(200),
    second = await fixture(),
    reference = 'ORDER-' + randomUUID();
  await admin.$executeRaw`UPDATE bookings SET order_reference=${reference} WHERE id IN (${first.id}::uuid,${second.id}::uuid)`;
  const ambiguous = await preview(first.id);
  expect(ambiguous.status).toBe(409);
  expect(ambiguous.body.message).toContain('payment is split');
  await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${second.id}::uuid,'CHARGE','manual',${second.id},'PAID',200,'EUR')`;
  const clear = await preview(first.id);
  expect(clear.status, clear.text).toBe(200);
  expect(clear.body.paid).toBe('200.00');
  expect(clear.body.balance).toBe('100.00');
});

it('waives an increase only with permission and a reason, binds the choice to the hash, and keeps the recorded total', async () => {
  const f = await fixture(),
    p = await preview(f.id);
  const waived = await request(app.getHttpServer())
    .get(`${base}/${f.id}/amend-preview`)
    .query({ ...dates, outcome: 'waive', outcomeReason: 'Honor the original quote' });
  expect(waived.status, waived.text).toBe(200);
  expect(waived.body).toMatchObject({
    newTotal: '300.00',
    recordedTotal: '200.00',
    difference: '100.00',
    outcome: 'waive',
  });
  expect(
    (
      await patch(f.id, {
        ...input(p.body),
        outcome: 'waive',
        outcomeReason: 'Honor the original quote',
      })
    ).status,
  ).toBe(409);
  const empty = await request(app.getHttpServer())
    .get(`${base}/${f.id}/amend-preview`)
    .query({ ...dates, outcome: 'waive' });
  expect((await patch(f.id, { ...input(empty.body), outcome: 'waive' })).status).toBe(400);
  const result = await patch(f.id, {
    ...input(waived.body),
    outcome: 'waive',
    outcomeReason: 'Honor the original quote',
  });
  expect(result.status, result.text).toBe(200);
  expect(result.body.total).toBe('200.00');
  const audit = await admin.$queryRaw<
    { details: any }[]
  >`SELECT details FROM audit_logs WHERE target_id=${f.id} AND action='booking.dates_amended'`;
  expect(audit[0]!.details).toMatchObject({
    outcome: 'waive',
    outcomeReason: 'Honor the original quote',
    difference: '100.00',
    changes: { total: { old: '200.00', new: '200.00' } },
  });
});
it('refunds a paid decrease once under concurrent replay through the existing ledger and receipt path', async () => {
  const f = await fixture(200),
    d = { startsOn: '2030-07-11', endsOn: '2030-07-12' },
    p = await preview(f.id, d),
    key = randomUUID();
  expect(p.body).toMatchObject({ outcome: 'refund', refundToIssue: '100.00', balance: '0.00' });
  const before = receipt.sendRefundConfirmationEmailSafely.mock.calls.length;
  const body = { ...input(p.body, d), outcome: 'refund', outcomeReason: '' };
  const results = await Promise.all([patch(f.id, body, key), patch(f.id, body, key)]);
  expect(
    results.map((r) => r.status),
    results.map((r) => r.text).join(' '),
  ).toEqual([200, 200]);
  expect(results[0]!.body).toMatchObject({
    total: '100.00',
    refundIssued: '100.00',
    balanceState: 'settled',
  });
  expect(results[0]!.body).toEqual(results[1]!.body);
  const refunds = await admin.$queryRaw<
    { amount: string }[]
  >`SELECT amount::text AS amount FROM payments WHERE booking_id=${f.id}::uuid AND kind='REFUND'`;
  expect(refunds).toEqual([{ amount: '100.00' }]);
  expect(receipt.sendRefundConfirmationEmailSafely.mock.calls.length - before).toBe(1);
  expect((await patch(f.id, { ...body, outcome: 'no_refund' }, key)).status).toBe(409);
});
it('keeps the agreed total for no-refund, lowers an unpaid decrease without refunding, and handles equal prices', async () => {
  const d = { startsOn: '2030-07-11', endsOn: '2030-07-12' };
  const f = await fixture(200);
  const p = await request(app.getHttpServer())
    .get(`${base}/${f.id}/amend-preview`)
    .query({ ...d, outcome: 'no_refund', outcomeReason: 'Agreed fixed price' });
  expect(p.status, p.text).toBe(200);
  const saved = await patch(f.id, {
    ...input(p.body, d),
    outcome: 'no_refund',
    outcomeReason: 'Agreed fixed price',
  });
  expect(saved.body).toMatchObject({
    total: '200.00',
    refundIssued: '0.00',
    balanceState: 'settled',
  });
  const unpaid = await fixture(),
    u = await preview(unpaid.id, d);
  expect(u.body).toMatchObject({ outcome: 'refund', refundToIssue: '0.00' });
  expect((await patch(unpaid.id, input(u.body, d))).body).toMatchObject({
    total: '100.00',
    balance: '100.00',
  });
  const equal = await fixture(),
    same = { startsOn: '2030-07-11', endsOn: '2030-07-13' },
    e = await preview(equal.id, same);
  expect(e.body).toMatchObject({
    outcome: 'equal',
    availableOutcomes: ['equal'],
    difference: '0.00',
  });
  expect((await patch(equal.id, input(e.body, same))).body).toMatchObject({
    total: '200.00',
    refundIssued: '0.00',
  });
});
it('offers only charge or refund-due without refund permission and refuses forged money choices', async () => {
  const user = randomUUID();
  await admin.$executeRaw`INSERT INTO users(id,email) VALUES(${user}::uuid,${user + '@example.test'})`;
  await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${user}::uuid,'STAFF')`;
  await admin.$executeRaw`INSERT INTO property_staff_assignments(tenant_id,property_id,user_id,role_template_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${user}::uuid,${randomUUID()}::uuid)`;
  await admin.$executeRaw`INSERT INTO property_staff_capability_overrides(tenant_id,property_id,user_id,capability_id,granted) SELECT ${tenantId}::uuid,${propertyId}::uuid,${user}::uuid,id,true FROM capabilities WHERE tenant_id=${tenantId}::uuid AND key='bookings.edit'`;
  const f = await fixture(200),
    up = await preview(f.id, dates, user),
    d = { startsOn: '2030-07-11', endsOn: '2030-07-12' },
    down = await preview(f.id, d, user);
  expect(up.body.availableOutcomes).toEqual(['charge']);
  expect(down.body.availableOutcomes).toEqual(['refund_due']);
  for (const outcome of ['waive', 'no_refund', 'refund']) {
    const selected = outcome === 'waive' ? dates : d;
    expect(
      (
        await patch(
          f.id,
          { ...input(down.body, selected), outcome, outcomeReason: 'Not authorized' },
          randomUUID(),
          user,
        )
      ).status,
    ).toBe(403);
  }
});
it('calendar uses preview rules and own-night exclusion for pooled and assigned accommodation', async () => {
  for (const assigned of [false, true]) {
    const f = await fixture(0, assigned);
    if (assigned) {
      await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,guest_id,room_type_id,room_id,rate_plan_id,external_reference,starts_on,ends_on,total_amount,status,payment_method,source) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,${propertyId}::uuid,${guest}::uuid,${f.type}::uuid,${f.room}::uuid,${ratePlan}::uuid,${randomUUID()},'2030-07-15','2030-07-16',100,'CONFIRMED','PAY_AT_HOTEL','DIRECT')`;
    } else {
      await admin.$executeRaw`UPDATE inventory_units SET booked_units=1 WHERE room_type_id=${f.type}::uuid AND stays_on='2030-07-15'`;
    }
    const response = await request(app.getHttpServer())
      .get(`${base}/${f.id}/amend-calendar`)
      .query({
        startsOn: '2030-07-10',
        endsOn: '2030-07-12',
        edge: 'start',
        from: '2030-07-10',
        to: '2030-07-17',
      });
    expect(response.status, response.text).toBe(200);
    expect(response.body.days.find((d: any) => d.date === '2030-07-10').disabled).toBe(false);
    expect(response.body.days.find((d: any) => d.date === '2030-07-15')).toMatchObject({
      disabled: true,
      reason: expect.stringMatching(/Booked/),
    });
    expect((await stock(f.type)).find((d) => d.day === '2030-07-10')!.units).toBe(assigned ? 0 : 1);
  }
});

it('calendar explains manual blocks, stop sale, arrival/departure closure and minimum stay through the same preview evaluator', async () => {
  const f = await fixture();
  const calendar = (edge = 'start') =>
    request(app.getHttpServer())
      .get(`${base}/${f.id}/amend-calendar`)
      .query({
        startsOn: '2030-07-14',
        endsOn: '2030-07-17',
        edge,
        from: '2030-07-15',
        to: '2030-07-16',
      });
  for (const [type, value, edge, reason] of [
    ['minimum_stay', 3, 'start', 'minimum stay'],
    ['closed_to_arrival', 1, 'start', 'Arrival is closed'],
    ['closed_to_departure', 1, 'end', 'Departure is closed'],
    ['stop_sell', 1, 'start', 'Sales are closed'],
  ] as const) {
    const rule = randomUUID();
    await admin.$executeRaw`INSERT INTO inventory_restrictions(id,tenant_id,property_id,reference,name,type,value,scope,target_ids,starts_on,ends_on,lifecycle,created_by_user_id,updated_by_user_id) VALUES(${rule}::uuid,${tenantId}::uuid,${propertyId}::uuid,${rule.slice(0, 20)},'Amend calendar',${type},${value},'room_type',ARRAY[${f.type}::uuid],'2030-07-15','2030-07-15','Active',${owner}::uuid,${owner}::uuid)`;
    const result = await calendar(edge);
    expect(result.status, result.text).toBe(200);
    expect(result.body.days[0]).toMatchObject({
      disabled: true,
      reason: expect.stringContaining(reason),
    });
    await admin.$executeRaw`UPDATE inventory_restrictions SET lifecycle='Paused' WHERE id=${rule}::uuid`;
  }
  const block = randomUUID();
  await admin.$executeRaw`INSERT INTO availability_blocks(id,tenant_id,property_id,starts_on,ends_on,blocks_all,lifecycle) VALUES(${block}::uuid,${tenantId}::uuid,${propertyId}::uuid,'2030-07-15','2030-07-16',false,'Active')`;
  await admin.$executeRaw`INSERT INTO availability_block_room_types(tenant_id,property_id,block_id,room_type_id) VALUES(${tenantId}::uuid,${propertyId}::uuid,${block}::uuid,${f.type}::uuid)`;
  const result = await calendar();
  expect(result.status, result.text).toBe(200);
  expect(result.body.days[0]).toMatchObject({
    disabled: true,
    reason: expect.stringContaining('Blocked'),
  });
});
