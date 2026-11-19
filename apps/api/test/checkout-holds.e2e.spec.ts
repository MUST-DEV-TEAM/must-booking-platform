import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { pendingCheckoutHolds, pendingCheckoutRooms } from '../src/booking/checkout-holds';

const schema = 'checkout_holds_' + randomUUID().replaceAll('-', '');
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
const tenantId = randomUUID(),
  propertyId = randomUUID(),
  type = randomUUID(),
  room = randomUUID();
const first = randomUUID();

beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$executeRawUnsafe(`CREATE TABLE "${schema}".bookings (
    id uuid PRIMARY KEY, tenant_id uuid, property_id uuid, room_type_id uuid, room_id uuid,
    starts_on date, ends_on date, status text, external_booking_id text)`);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
  await admin.$executeRawUnsafe(`GRANT SELECT ON "${schema}".bookings TO must_booking_app`);
  await admin.$executeRawUnsafe(`ALTER TABLE "${schema}".bookings ENABLE ROW LEVEL SECURITY`);
  await admin.$executeRawUnsafe(`ALTER TABLE "${schema}".bookings FORCE ROW LEVEL SECURITY`);
  await admin.$executeRawUnsafe(`CREATE POLICY scope ON "${schema}".bookings USING (
    tenant_id=public.app_current_tenant_id() AND property_id=public.app_current_property_id())`);
  const seed = async (
    id: string,
    tenant: string,
    property: string,
    status: string,
    external: string | null,
    from = '2030-04-14',
    to = '2030-04-16',
  ) => admin.$executeRaw`
      INSERT INTO bookings VALUES (${id}::uuid,${tenant}::uuid,${property}::uuid,${type}::uuid,${room}::uuid,
        ${from}::date,${to}::date,${status},${external})`;
  await seed(first, tenantId, propertyId, 'PAYMENT_PENDING', null);
  await seed(
    randomUUID(),
    tenantId,
    propertyId,
    'PAYMENT_PENDING',
    null,
    '2030-04-15',
    '2030-04-16',
  );
  await seed(
    randomUUID(),
    tenantId,
    propertyId,
    'PAYMENT_PENDING',
    null,
    '2030-04-16',
    '2030-04-17',
  );
  await seed(randomUUID(), tenantId, propertyId, 'CONFIRMED', 'clock-booking');
  await seed(randomUUID(), tenantId, propertyId, 'PAYMENT_PENDING', 'clock-booking');
  await seed(randomUUID(), tenantId, propertyId, 'EXPIRED', null);
  await seed(randomUUID(), tenantId, randomUUID(), 'PAYMENT_PENDING', null);
  await seed(randomUUID(), randomUUID(), propertyId, 'PAYMENT_PENDING', null);
});

afterAll(async () => {
  await db.$disconnect();
  if (!/^checkout_holds_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});

it('counts pending nights without double counting linked reservations or another hotel', async () => {
  const holds = await pendingCheckoutHolds(
    db,
    tenantId,
    propertyId,
    [type],
    '2030-04-14',
    '2030-04-17',
  );
  expect(Object.fromEntries(holds.get(type)!)).toEqual({
    '2030-04-14': 1,
    '2030-04-15': 2,
    '2030-04-16': 1,
  });
  expect(await pendingCheckoutRooms(db, tenantId, propertyId, '2030-04-14', '2030-04-17')).toEqual(
    new Set([room]),
  );
  expect(
    await pendingCheckoutHolds(db, randomUUID(), propertyId, [type], '2030-04-14', '2030-04-17'),
  ).toEqual(new Map());
});

it('makes a released hold disappear from the next read and respects checkout-exclusive dates', async () => {
  await admin.$executeRaw`UPDATE bookings SET status='EXPIRED' WHERE id=${first}::uuid`;
  const holds = await pendingCheckoutHolds(
    db,
    tenantId,
    propertyId,
    [type],
    '2030-04-14',
    '2030-04-17',
  );
  expect(Object.fromEntries(holds.get(type)!)).toEqual({ '2030-04-15': 1, '2030-04-16': 1 });
  expect(await pendingCheckoutRooms(db, tenantId, propertyId, '2030-04-14', '2030-04-15')).toEqual(
    new Set(),
  );
});
