import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { PropertiesService } from '../src/tenancy/properties.service';
import { PropertiesController } from '../src/tenancy/properties.controller';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { CapabilitiesService } from '../src/tenancy/capabilities.service';
import { CapabilitiesGuard } from '../src/tenancy/capabilities.guard';
import { AuditLogService } from '../src/tenancy/audit-log.service';
import { QuoteController } from '../src/booking/quote.controller';
import { QuoteService } from '../src/booking/quote.service';
import { StaffBookingController } from '../src/booking/staff-booking.controller';
import { BookingController } from '../src/booking/booking.controller';
import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { MultiRoomBookingService } from '../src/booking/multi-room-booking.service';
import { BookingRequestsService } from '../src/booking/booking-requests.service';
import { BookingProjectionService } from '../src/booking/booking-projection.service';
import { CancellationLinkService } from '../src/booking/cancellation-link.service';
import { PmsProviderRegistry } from '../src/booking/pms-provider-registry';
import { AvailabilityService } from '../src/tenancy/availability.service';
import { BookingStateMachine } from '../src/booking/booking-state-machine';
import { PaymentProviderRegistry } from '../src/payments/payment-provider-registry';
import { PaymentRefundService } from '../src/payments/payment-refund.service';
import { PaymentNotificationService } from '../src/mail/payment-notification.service';
import { BookingConfirmationNotificationService } from '../src/mail/booking-confirmation-notification.service';
import { BookingCancellationNotificationService } from '../src/mail/booking-cancellation-notification.service';
import { NotificationsService } from '../src/tenancy/notifications.service';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { ManualReviewService } from '../src/integrations/manual-review.service';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { ClockAvailabilityService } from '../src/integrations/clock/clock-availability.service';
import { PrePaymentAvailabilityRegistry } from '../src/booking/pre-payment-availability';
import { PublicRateLimitGuard } from '../src/tenancy/public-rate-limit.guard';
const schema = 'rich_settings_test_' + randomUUID().replaceAll('-', '');
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
const session = randomUUID();
const availability = { lockRoom: vi.fn(async () => {}), lockBookedUnits: vi.fn(async () => {}) };
const tables = [
  'properties',
  'bookings',
  'integration_operations',
  'rate_plans',
  'room_types',
  'rate_rules',
  'pricing_daily_prices',
  'pricing_adjustments',
  'pricing_charges',
  'room_price_overrides',
  'rooms',
  'inventory_restrictions',
  'users',
  'tenant_memberships',
  'capabilities',
  'property_staff_assignments',
  'property_role_template_capabilities',
  'property_staff_capability_overrides',
  'property_integration_connections',
  'integration_connections',
  'audit_logs',
];
const base = `/tenants/${tenantId}/properties/${propertyId}`,
  url = base;
const stay = {
  roomTypeId: roomType,
  ratePlanId: ratePlan,
  startsOn: '2030-07-10',
  endsOn: '2030-07-12',
  adults: 2,
  children: 0,
};
const guestInput = {
  firstName: 'Ada',
  lastName: 'Guest',
  email: 'guest@example.test',
  phone: '+3551234567',
};
const patch = (body: Record<string, unknown>) => request(app.getHttpServer()).patch(url).send(body);
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-07-10T09:00:00Z'));
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      for (const t of tables)
        await tx.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${t}" (LIKE public."${t}" INCLUDING ALL)`,
        );
      // The baseline public database may predate the preceding settings change.
      const previous = readFileSync(
        'prisma/migrations/20261021090000_payment_brand_settings/migration.sql',
        'utf8',
      ).split('-- Same privileged')[0]!;
      const next = readFileSync(
        'prisma/migrations/20261021100000_richer_property_settings/migration.sql',
        'utf8',
      );
      for (let i = 0; i < 2; i++)
        for (const sql of (previous + '\n' + next)
          .replace(/--[^\n]*/g, '')
          .split(';')
          .filter((v) => v.trim()))
          await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
      await tx.$executeRawUnsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO must_booking_app`,
      );
      await tx.$executeRawUnsafe(`ALTER TABLE "${schema}".properties ENABLE ROW LEVEL SECURITY`);
      await tx.$executeRawUnsafe(`ALTER TABLE "${schema}".properties FORCE ROW LEVEL SECURITY`);
      await tx.$executeRawUnsafe(
        `CREATE POLICY scope ON "${schema}".properties USING(tenant_id=public.app_current_tenant_id()) WITH CHECK(tenant_id=public.app_current_tenant_id())`,
      );
    },
    { timeout: 30000 },
  );
  for (const id of [propertyId, otherProperty])
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${id}::uuid,${tenantId}::uuid,'Rich hotel',${schema + id},'Europe/Tirane')`;
  for (const id of [owner, staff]) {
    await admin.$executeRaw`INSERT INTO users(id,email) VALUES(${id}::uuid,${id + '@example.test'})`;
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${id}::uuid,${id === owner ? 'OWNER' : 'STAFF'}::public."TenantMembershipRole")`;
  }
  for (const key of ['settings.manage', 'bookings.create'])
    await admin.$executeRaw`INSERT INTO capabilities(tenant_id,key,description) VALUES(${tenantId}::uuid,${key},${key})`;
  await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,status,max_occupancy) VALUES(${roomType}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Room','PUBLISHED',8)`;
  await admin.$executeRaw`INSERT INTO rate_plans(id,tenant_id,property_id,name,code,currency,lifecycle) VALUES(${ratePlan}::uuid,${tenantId}::uuid,${propertyId}::uuid,'Rate','RICH','EUR','Active')`;
  await admin.$executeRaw`INSERT INTO rate_rules(tenant_id,property_id,room_type_id,rate_plan_id,amount) VALUES(${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,100)`;
  const real = [
    PropertiesService,
    CapabilitiesService,
    AuditLogService,
    QuoteService,
    LocalPmsProvider,
    MultiRoomBookingService,
  ];
  const empty = [
    PropertyRoleTemplatesService,
    BookingRequestsService,
    BookingProjectionService,
    CancellationLinkService,
    PmsProviderRegistry,
    BookingStateMachine,
    PaymentProviderRegistry,
    PaymentRefundService,
    PaymentNotificationService,
    BookingConfirmationNotificationService,
    BookingCancellationNotificationService,
    NotificationsService,
    ManualReviewService,
    ClockBookingService,
    ClockAvailabilityService,
    PrePaymentAvailabilityRegistry,
  ];
  const mod = await Test.createTestingModule({
    controllers: [PropertiesController, QuoteController, StaffBookingController, BookingController],
    providers: [
      ...real,
      ...empty.map((provide) => ({ provide, useValue: {} })),
      { provide: TenantDatabaseService, useValue: db },
      { provide: AvailabilityService, useValue: availability },
      {
        provide: IntegrationConnectionsService,
        useValue: { activePmsConnectionCredentials: async () => null },
      },
    ],
  })
    .overrideGuard(PublicRateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();
  app = mod.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const p = req.originalUrl.split('/');
    req.tenantContext = {
      tenantId: p[2],
      propertyId: p[4],
      userId: req.headers['x-fixture-user'] ?? owner,
    };
    req.guestSessionId = session;
    next();
  });
  app.useGlobalGuards(new CapabilitiesGuard(new Reflector(), mod.get(CapabilitiesService)));
  await app.init();
});
afterAll(async () => {
  vi.useRealTimers();
  await app?.close();
  await db.$disconnect();
  if (!/^rich_settings_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
});
it('round-trips the grouped settings, refuses invalid policies/currency changes and preserves another hotel', async () => {
  const list = await request(app.getHttpServer()).get(`/tenants/${tenantId}/properties`);
  expect(list.status, list.text).toBe(200);
  expect(list.body.find((p: any) => p.id === propertyId)).toMatchObject({
    allowSameDayBooking: true,
    noShowRule: 'flag_for_review',
    defaultCurrencyLocked: true,
    languages: [],
  });
  const values = {
    legalName: 'Hotel Ltd',
    taxNumber: 'NUIS: free text',
    country: 'AL',
    languages: ['sq', 'en'],
    website: 'https://hotel.test',
    reservationsEmail: 'book@hotel.test',
    description: 'Plain hotel text',
    starRating: 4,
    earlyCheckInPolicy: 'free_until',
    earlyCheckInUntil: '10:00',
    earlyCheckInNote: 'Ask reception',
    quietHoursFrom: '22:00',
    quietHoursTo: '07:00',
    childrenPolicy: 'allowed',
    petsPolicy: 'on_request',
    idRequiredAtArrival: true,
  };
  const saved = await patch(values);
  expect(saved.status, saved.text).toBe(200);
  expect(saved.body).toMatchObject({ ...values, languages: ['en', 'sq'] });
  for (const bad of [
    { country: 'XX' },
    { languages: ['xx'] },
    { website: 'http://hotel.test' },
    { starRating: 6 },
    { maxRoomsPerBooking: 1.5 },
    { noShowRule: 'charge_all' },
    { sameDayCutoffTime: '25:00' },
    { earlyCheckInUntil: null },
    { description: 'a'.repeat(1001) },
  ])
    expect((await patch(bad)).status, JSON.stringify(bad)).toBe(400);
  expect((await patch({ defaultCurrency: 'USD' })).status).toBe(409);
  expect(
    (
      await request(app.getHttpServer())
        .patch(url)
        .set('X-Fixture-User', staff)
        .send({ legalName: 'No' })
    ).status,
  ).toBe(403);
  const others = await request(app.getHttpServer()).get(`/tenants/${tenantId}/properties`);
  expect(others.body.find((p: any) => p.id === otherProperty).legalName).toBeNull();
});
it('applies the property-local same-day flag and cutoff to public quotes and staff bookings', async () => {
  await patch({ allowSameDayBooking: false }).expect(200);
  for (const path of ['/quotes', '/staff-bookings']) {
    const r = await request(app.getHttpServer())
      .post(base + path)
      .set('Idempotency-Key', randomUUID())
      .send({ ...stay, guest: guestInput, paymentMethod: 'pay_at_hotel' });
    expect(r.status, r.text).toBe(400);
    expect(r.body.code).toBe('SAME_DAY_CLOSED');
  }
  await patch({ allowSameDayBooking: true, sameDayCutoffTime: '11:00' }).expect(200);
  expect(
    (
      await request(app.getHttpServer())
        .post(base + '/quotes')
        .send(stay)
    ).status,
  ).toBe(400);
  await patch({ sameDayCutoffTime: '11:01' }).expect(200);
  const open = await request(app.getHttpServer())
    .post(base + '/quotes')
    .send(stay);
  expect(open.status, open.text).toBe(201);
  expect(open.body.total.amount).toBe('200.00');
  const staffPrice = await app.get(QuoteService).price(tenantId, propertyId, stay);
  expect(staffPrice.amount).toBe('200.00');
});
it('enforces guests including children and rechecks new limits when an older quote is submitted', async () => {
  await patch({
    sameDayCutoffTime: null,
    allowSameDayBooking: true,
    maxGuestsPerBooking: null,
    maxRoomsPerBooking: null,
  }).expect(200);
  const old = await request(app.getHttpServer())
    .post(base + '/quotes')
    .send(stay);
  expect(old.status, old.text).toBe(201);
  await patch({ maxGuestsPerBooking: 2 }).expect(200);
  const publicQuote = await request(app.getHttpServer())
    .post(base + '/quotes')
    .send({ ...stay, children: 1 });
  expect(publicQuote.status).toBe(400);
  expect(publicQuote.body.code).toBe('MAX_GUESTS_PER_BOOKING');
  const staffCreate = await request(app.getHttpServer())
    .post(base + '/staff-bookings')
    .set('Idempotency-Key', randomUUID())
    .send({ ...stay, children: 1, guest: guestInput, paymentMethod: 'pay_at_hotel' });
  expect(staffCreate.status).toBe(400);
  expect(staffCreate.body.code).toBe('MAX_GUESTS_PER_BOOKING');
  await patch({ maxGuestsPerBooking: 1 }).expect(200);
  const stale = await request(app.getHttpServer())
    .post(base + '/bookings')
    .set('Idempotency-Key', randomUUID())
    .send({
      ...stay,
      guest: guestInput,
      paymentMethod: 'pay_at_hotel',
      total: old.body.total,
      quoteToken: old.body.quoteToken,
    });
  expect(stale.status, stale.text).toBe(400);
  expect(stale.body.code).toBe('MAX_GUESTS_PER_BOOKING');
});
it('enforces aggregate room and guest limits before an order can hold inventory or move money', async () => {
  await patch({ maxRoomsPerBooking: 1, maxGuestsPerBooking: null }).expect(200);
  const rooms = Array.from({ length: 2 }, () => ({
    roomTypeId: roomType,
    ratePlanId: ratePlan,
    guestCount: 2,
    total: { amount: '200.00', currency: 'EUR' },
    quoteToken: 'not-used-before-limit-check',
  }));
  const body = {
    startsOn: stay.startsOn,
    endsOn: stay.endsOn,
    guest: guestInput,
    paymentMethod: 'pay_at_hotel',
    rooms,
  };
  const roomLimit = await request(app.getHttpServer())
    .post(base + '/bookings/orders')
    .set('Idempotency-Key', randomUUID())
    .send(body);
  expect(roomLimit.status, roomLimit.text).toBe(400);
  expect(roomLimit.body.code).toBe('MAX_ROOMS_PER_BOOKING');
  await patch({ maxRoomsPerBooking: 2, maxGuestsPerBooking: 3 }).expect(200);
  const guestLimit = await request(app.getHttpServer())
    .post(base + '/bookings/orders')
    .set('Idempotency-Key', randomUUID())
    .send(body);
  expect(guestLimit.status, guestLimit.text).toBe(400);
  expect(guestLimit.body.code).toBe('MAX_GUESTS_PER_BOOKING');
  expect((await admin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM bookings`)[0]!.n).toBe(
    0n,
  );
  expect(
    (await admin.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM integration_operations`)[0]!
      .n,
  ).toBe(0n);
});
