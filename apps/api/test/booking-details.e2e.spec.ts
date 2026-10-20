import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { CapabilitiesService } from '../src/tenancy/capabilities.service';
import { CapabilitiesGuard } from '../src/tenancy/capabilities.guard';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { GlobalSearchService } from '../src/tenancy/global-search.service';
import { BookingProjectionService } from '../src/booking/booking-projection.service';
import { minor } from '../src/booking/pricing-evaluator';
import { BookingDetailsService } from '../src/booking/booking-details.service';
import { BookingDetailsController } from '../src/booking/booking-details.controller';
import { BookingConfirmationNotificationService } from '../src/mail/booking-confirmation-notification.service';
import { CancellationLinkService } from '../src/booking/cancellation-link.service';
import { PaymentNotificationService } from '../src/mail/payment-notification.service';
// Real HTTP, capability guard, pricing, audit and Postgres; trusted fixture identities
// replace session establishment. No workers, provider clients or external requests.
const schema = 'b2a_test_' + randomUUID().replaceAll('-', '');
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
let app: INestApplication, search: GlobalSearchService;
const tables = [
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
    .patch(`/tenants/${tenantId}/properties/${property}/bookings/${id}/details`)
    .set('X-Fixture-User', user)
    .set('Idempotency-Key', key)
    .send(body);
async function fixture() {
  const id = randomUUID();
  await db.withTenantTransaction(
    c,
    (tx) =>
      tx.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,guest_id,room_type_id,rate_plan_id,external_reference,starts_on,ends_on,total_amount,status,payment_method,source) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${guest}::uuid,${roomType}::uuid,${ratePlan}::uuid,${'B2A-' + id},'2030-07-10','2030-07-12',200,'CONFIRMED','PAY_AT_HOTEL','DIRECT')`,
  );
  return id;
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
  for (const key of ['bookings.edit', 'bookings.view'])
    await admin.$executeRaw`INSERT INTO capabilities(tenant_id,key,description) VALUES(${tenantId}::uuid,${key},${key})`;
  await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email,first_name,last_name,phone) VALUES(${guest}::uuid,${tenantId}::uuid,'original@example.test','Original','Guest','+355 12345')`;
  await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Details room',3)`;
  await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,code,currency,lifecycle) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Details rate','B2A','EUR','Active')`;
  await admin.$executeRaw`INSERT INTO rate_rules(tenant_id,property_id,room_type_id,rate_plan_id,amount) VALUES(${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,100)`;
  const mod = await Test.createTestingModule({
    controllers: [BookingDetailsController],
    providers: [
      BookingDetailsService,
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
  search = new GlobalSearchService(db, mod.get(CapabilitiesService));
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (!/^b2a_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});
it('edits non-financial details, preserves shared directory/sibling, updates history and permission-aware search', async () => {
  const id = await fixture(),
    sibling = await fixture();
  await patch(id, {
    expectedVersion: 1,
    firstName: 'Changed',
    lastName: 'Contact',
    email: 'changed@example.test',
    phone: '+355 67890',
    specialRequests: 'Late arrival',
    estimatedArrivalTime: '18:30',
    adults: 2,
    children: 1,
  })
    .expect(200)
    .expect((r) => expect(r.body).toMatchObject({ ok: true, version: 2 }));
  const detail = await new BookingProjectionService(db).detail(tenantId, propertyId, id);
  expect(detail).toMatchObject({
    guestFirstName: 'Changed',
    guestEmail: 'changed@example.test',
    guestPhone: '+355 67890',
    estimatedArrivalTime: '18:30',
    adults: 2,
    children: 1,
    total: { currency: 'EUR' },
  });
  expect(minor(detail!.total.amount)).toBe(20000n);
  expect(
    (await new BookingProjectionService(db).detail(tenantId, propertyId, sibling))?.guestFirstName,
  ).toBe('Original');
  const history = await db.withTenantTransaction(
    c,
    (tx) =>
      tx.$queryRaw<
        { actor: string; details: { changes: Record<string, { old: unknown; new: unknown }> } }[]
      >`SELECT actor_user_id::text AS actor,details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_id=${id}`,
  );
  expect(history[0]?.actor).toBe(owner);
  expect(history[0]?.details.changes.email).toEqual({
    old: 'original@example.test',
    new: 'changed@example.test',
  });
  for (const term of ['Changed', '67890'])
    expect(
      (await search.search(tenantId, propertyId, owner, term)).groups[0]?.items.some(
        (x) => x.id === id,
      ),
    ).toBe(true);
  expect((await search.search(tenantId, propertyId, staff, 'Changed')).groups).toEqual([]);
  expect(await admin.$queryRaw`SELECT * FROM email_messages`).toEqual([]);
  // Later confirmations use the scoped contact; the edit itself enqueues nothing.
  let sent: unknown;
  const notifications = {
    async sendPaymentConfirmationEmailSafely(command: unknown) {
      sent = command;
    },
    async sendNewBookingStaffNotificationSafely() {},
  } as unknown as PaymentNotificationService;
  await new BookingConfirmationNotificationService(
    db,
    {} as CancellationLinkService,
    notifications,
  ).sendAfterConfirmation(c, id, 'manual-fixture');
  expect(sent).toMatchObject({ to: 'changed@example.test', guest: { name: 'Changed Contact' } });
  await patch(id, { expectedVersion: 2, phone: null }).expect(200);
  expect(
    (await new BookingProjectionService(db).detail(tenantId, propertyId, id))?.guestPhone,
  ).toBeNull();
  expect(
    (await search.search(tenantId, propertyId, owner, '67890')).groups
      .flatMap((group) => group.items)
      .some((item) => item.id === id),
  ).toBe(false);
});
it('returns a plain 409 for stale versions', async () => {
  const id = await fixture();
  await patch(id, { expectedVersion: 1, specialRequests: 'First edit' }).expect(200);
  await patch(id, { expectedVersion: 1, specialRequests: 'Stale edit' })
    .expect(409)
    .expect((r) => expect(r.body.message).toContain('Reload'));
});
it('replays the same key without extra history and rejects reuse for different details', async () => {
  const id = await fixture(),
    key = randomUUID(),
    body = { expectedVersion: 1, specialRequests: 'Idempotent edit' };
  const results = await Promise.all([patch(id, body, key), patch(id, body, key)]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(results[0]?.body).toEqual(results[1]?.body);
  await patch(id, { ...body, specialRequests: 'Different' }, key).expect(409);
  const rows = await db.withTenantTransaction(
    c,
    (tx) =>
      tx.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) AS count FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND target_id=${id}`,
  );
  expect(Number(rows[0]?.count)).toBe(1);
});
it('fails closed without bookings.edit and for another hotel or tenant', async () => {
  const id = await fixture();
  await patch(id, { expectedVersion: 1, phone: '+355 99999' }, randomUUID(), staff).expect(403);
  await patch(
    id,
    { expectedVersion: 1, phone: '+355 99999' },
    randomUUID(),
    owner,
    otherProperty,
  ).expect(404);
  const rows = await db.withTenantTransaction(
    { ...c, tenantId: randomUUID() },
    (tx) => tx.$queryRaw`SELECT * FROM bookings WHERE id=${id}::uuid`,
  );
  expect(rows).toEqual([]);
});
it('keeps Clock-connected reservations read-only without contacting Clock', async () => {
  const id = await fixture(),
    connection = randomUUID();
  await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials) VALUES(${connection}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Fixture only','not-a-credential')`;
  await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind,enabled) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connection}::uuid,'PMS',true)`;
  try {
    await patch(id, { expectedVersion: 1, firstName: 'Do not change' })
      .expect(409)
      .expect((r) => expect(r.body.message).toContain('managed in Clock'));
    expect(
      (await new BookingProjectionService(db).detail(tenantId, propertyId, id))
        ?.detailsManagedInClock,
    ).toBe(true);
  } finally {
    await admin.$executeRaw`DELETE FROM property_integration_connections WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${connection}::uuid`;
  }
});
it('refuses over-occupancy and any financial/stay fields', async () => {
  const id = await fixture();
  await patch(id, { expectedVersion: 1, adults: 4 })
    .expect(400)
    .expect((r) => expect(r.body.message).toContain('no more than 3'));
  await patch(id, { expectedVersion: 1, total: { amount: '1.00', currency: 'EUR' } }).expect(400);
});
it('refuses an occupancy change that alters the price', async () => {
  const id = await fixture(),
    charge = randomUUID();
  await admin.$executeRaw`INSERT INTO pricing_charges(id,tenant_id,property_id,name,lifecycle,basis,value,currency,display,confirmed,starts_on) VALUES(${charge}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Per guest','Active','per_person_night',10,'EUR','included',true,'2030-01-01')`;
  try {
    await db.withTenantTransaction(
      c,
      (tx) =>
        tx.$executeRaw`UPDATE bookings SET total_amount=220 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${id}::uuid`,
    );
    await patch(id, { expectedVersion: 1, adults: 2 })
      .expect(409)
      .expect((r) => expect(r.body.message).toContain('amend stay'));
  } finally {
    await admin.$executeRaw`DELETE FROM pricing_charges WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${charge}::uuid`;
  }
});
