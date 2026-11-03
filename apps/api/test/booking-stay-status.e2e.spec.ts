import { randomUUID } from 'node:crypto';
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
import { BookingProjectionService } from '../src/booking/booking-projection.service';
import { BookingStayStatusController } from '../src/booking/booking-stay-status.controller';
import { BookingFrontDeskController } from '../src/booking/booking-front-desk.controller';
import { BookingStayStatusService } from '../src/booking/booking-stay-status.service';
import { LifecycleEmailService } from '../src/mail/lifecycle-email.service';

// Real HTTP, capability guard, audit and Postgres. Trusted fixture identities replace session
// establishment; the guest email is a stub so nothing is sent.
const schema = 'stay_test_' + randomUUID().replaceAll('-', '');
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
  owner = randomUUID(),
  guest = randomUUID(),
  roomType = randomUUID(),
  ratePlan = randomUUID();
const c = { tenantId, propertyId, userId: owner };
const guestEmail = vi.fn().mockResolvedValue(undefined);
let app: INestApplication;
const tables = [
  'properties',
  'room_types',
  'rate_plans',
  'guests',
  'bookings',
  'users',
  'tenant_memberships',
  'capabilities',
  'property_staff_assignments',
  'property_role_template_capabilities',
  'property_staff_capability_overrides',
  'property_role_templates',
  'property_integration_connections',
  'integration_connections',
  'audit_logs',
  'payments',
  'rooms',
  'booking_requests',
  'clock_sync_jobs',
  'booking_stay_events',
];
/** A day counted from today in the property's own time zone, as YYYY-MM-DD. */
async function day(offset: number) {
  const rows = await admin.$queryRaw<
    Array<{ d: string }>
  >`SELECT ((now() AT TIME ZONE 'Europe/Tirane')::date + ${offset}::int)::text AS d`;
  return rows[0]!.d;
}
async function stay(
  startOffset: number,
  endOffset: number,
  extra: { external?: string; paid?: number; total?: number } = {},
) {
  const id = randomUUID();
  const [starts, ends] = [await day(startOffset), await day(endOffset)];
  await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,guest_id,room_type_id,rate_plan_id,external_reference,external_booking_id,starts_on,ends_on,total_amount,status,payment_method,source) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${guest}::uuid,${roomType}::uuid,${ratePlan}::uuid,${'STAY-' + id},${extra.external ?? null},${starts}::date,${ends}::date,${extra.total ?? 100},'CONFIRMED','PAY_AT_HOTEL','DIRECT')`;
  if (extra.paid)
    await admin.$executeRaw`INSERT INTO payments(tenant_id,property_id,booking_id,kind,provider,external_payment_id,status,amount,currency) VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'CHARGE','manual',${id},'PAID',${extra.paid},'EUR')`;
  return id;
}
const move = (id: string, body: Record<string, unknown>) =>
  request(app.getHttpServer())
    .patch(`/tenants/${tenantId}/properties/${propertyId}/bookings/${id}/stay-status`)
    .send(body);
const row = async (id: string) =>
  (
    await admin.$queryRaw<
      Array<{ status: string | null; inAt: Date | null; outAt: Date | null }>
    >`SELECT pms_stay_status AS status, checked_in_at AS "inAt", checked_out_at AS "outAt" FROM bookings WHERE id=${id}::uuid`
  )[0]!;

beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      for (const t of tables)
        await tx.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${t}" (LIKE public."${t}" INCLUDING ALL)`,
        );
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
      await tx.$executeRawUnsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO must_booking_app`,
      );
    },
    { timeout: 30000 },
  );
  await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${propertyId}::uuid,${tenantId}::uuid,'Stay property',${schema},'Europe/Tirane')`;
  await admin.$executeRaw`INSERT INTO users(id,email) VALUES(${owner}::uuid,${owner + '@example.test'})`;
  await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${owner}::uuid,'OWNER'::public."TenantMembershipRole")`;
  for (const key of ['bookings.edit', 'bookings.view'])
    await admin.$executeRaw`INSERT INTO capabilities(tenant_id,key,description) VALUES(${tenantId}::uuid,${key},${key})`;
  await admin.$executeRaw`INSERT INTO guests(id,tenant_id,email,first_name,last_name,phone) VALUES(${guest}::uuid,${tenantId}::uuid,'guest@example.test','Stay','Guest','+355 12345')`;
  await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Stay room',3)`;
  await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,code,currency,lifecycle) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Stay rate','STAY','EUR','Active')`;
  const mod = await Test.createTestingModule({
    controllers: [BookingStayStatusController, BookingFrontDeskController],
    providers: [
      BookingStayStatusService,
      BookingProjectionService,
      CapabilitiesService,
      AuditLogService,
      { provide: LifecycleEmailService, useValue: { guest: guestEmail } },
      { provide: TenantDatabaseService, useValue: db },
    ],
  }).compile();
  app = mod.createNestApplication();
  app.use(
    (req: { originalUrl: string; tenantContext?: typeof c }, _res: unknown, next: () => void) => {
      const parts = req.originalUrl.split('/');
      req.tenantContext = { tenantId: parts[2]!, propertyId: parts[4]!, userId: owner };
      next();
    },
  );
  app.useGlobalGuards(
    new CapabilitiesGuard(new Reflector(), mod.get(CapabilitiesService), mod.get(AuditLogService)),
  );
  await app.init();
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (!/^stay_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});

it('checks a guest in on the arrival day, records the real time and who did it', async () => {
  const id = await stay(0, 2);
  await move(id, { status: 'checked_in', expectedFrom: 'expected' })
    .expect(200)
    .expect((r) => expect(r.body).toEqual({ stayStatus: 'checked_in' }));
  const saved = await row(id);
  expect(saved.status).toBe('checked_in');
  expect(saved.inAt).toBeInstanceOf(Date);
  const history = await request(app.getHttpServer())
    .get(`/tenants/${tenantId}/properties/${propertyId}/bookings/${id}/stay-events`)
    .expect(200);
  expect(history.body.events).toHaveLength(1);
  expect(history.body.events[0]).toMatchObject({ from: 'expected', to: 'checked_in' });
  expect(history.body.events[0].by).toContain('@example.test');
});

it('refuses a check-in before the arrival day and on or after the departure day', async () => {
  const future = await stay(3, 5);
  await move(future, { status: 'checked_in' })
    .expect(409)
    .expect((r) => expect(r.body.message).toMatch(/not come/));
  const over = await stay(-5, 0);
  await move(over, { status: 'checked_in' })
    .expect(409)
    .expect((r) => expect(r.body.message).toMatch(/departure day/));
  expect((await row(future)).status).toBeNull();
});

it('lets a late arrival inside the stay check in', async () => {
  const id = await stay(-1, 2);
  await move(id, { status: 'checked_in' }).expect(200);
});

it('will not check out with money owed unless staff explain why', async () => {
  const id = await stay(-1, 1, { total: 100, paid: 40 });
  await move(id, { status: 'checked_in' }).expect(200);
  await move(id, { status: 'checked_out' })
    .expect(409)
    .expect((r) => {
      expect(r.body).toMatchObject({ code: 'BALANCE_OUTSTANDING', outstanding: '60.00' });
    });
  await move(id, { status: 'checked_out', acknowledgeBalance: true })
    .expect(409)
    .expect((r) => expect(r.body.code).toBe('NOTE_REQUIRED'));
  expect((await row(id)).status).toBe('checked_in');
  await move(id, {
    status: 'checked_out',
    acknowledgeBalance: true,
    note: 'Bank transfer tomorrow',
  }).expect(200);
  const saved = await row(id);
  expect(saved.status).toBe('checked_out');
  expect(saved.outAt).toBeInstanceOf(Date);
  const history = await request(app.getHttpServer())
    .get(`/tenants/${tenantId}/properties/${propertyId}/bookings/${id}/stay-events`)
    .expect(200);
  expect(history.body.events.at(-1)).toMatchObject({
    to: 'checked_out',
    balanceOverridden: true,
    note: 'Bank transfer tomorrow',
  });
});

it('flags a check-out before the booked departure day as early', async () => {
  const id = await stay(-1, 3, { total: 100, paid: 100 });
  await move(id, { status: 'checked_in' }).expect(200);
  await move(id, { status: 'checked_out' })
    .expect(200)
    .expect((r) =>
      expect(r.body).toMatchObject({ stayStatus: 'checked_out', earlyDeparture: true }),
    );
  const history = await request(app.getHttpServer())
    .get(`/tenants/${tenantId}/properties/${propertyId}/bookings/${id}/stay-events`)
    .expect(200);
  expect(history.body.events.at(-1).earlyDeparture).toBe(true);
});

it('clears the recorded times when a step is undone', async () => {
  const id = await stay(-1, 1, { total: 100, paid: 100 });
  await move(id, { status: 'checked_in' }).expect(200);
  await move(id, { status: 'expected' }).expect(200);
  expect((await row(id)).inAt).toBeNull();
  await move(id, { status: 'checked_in' }).expect(200);
  await move(id, { status: 'checked_out' }).expect(200);
  await move(id, { status: 'checked_in' }).expect(200);
  expect((await row(id)).outAt).toBeNull();
});

it('never records arrival for a stay held in a hotel system', async () => {
  const id = await stay(0, 2, { external: 'CLOCK-1' });
  await move(id, { status: 'checked_in' })
    .expect(409)
    .expect((r) => expect(r.body.message).toMatch(/hotel system/));
});

it('rejects a stale screen', async () => {
  const id = await stay(0, 2);
  await move(id, { status: 'checked_in' }).expect(200);
  await move(id, { status: 'no_show', expectedFrom: 'expected' }).expect(409);
});

it('lists the front desk day: arrivals, departures, late arrivals and overdue departures', async () => {
  const arriving = await stay(0, 2);
  const leaving = await stay(-2, 0);
  const late = await stay(-1, 3);
  const overdue = await stay(-4, -1);
  await move(overdue, { status: 'checked_in' }).expect(409);
  await admin.$executeRaw`UPDATE bookings SET pms_stay_status='checked_in' WHERE id=${overdue}::uuid`;
  const res = await request(app.getHttpServer())
    .get(`/tenants/${tenantId}/properties/${propertyId}/front-desk`)
    .expect(200);
  const ids = (list: Array<{ id: string }>) => list.map((i) => i.id);
  expect(ids(res.body.arrivals)).toContain(arriving);
  expect(ids(res.body.departures)).toContain(leaving);
  expect(ids(res.body.lateArrivals)).toContain(late);
  expect(ids(res.body.overdueDepartures)).toContain(overdue);
  expect(res.body.arrivals.find((i: { id: string }) => i.id === arriving)).toMatchObject({
    guestFirstName: 'Stay',
    externalBookingId: null,
  });
});
