import { randomUUID, randomBytes } from 'node:crypto';
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
import { IntegrationConnectionsController } from '../src/integrations/integration-connections.controller';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { CredentialCipherService } from '../src/integrations/credential-cipher';
import { ConnectionTestRegistry } from '../src/integrations/connection-tester';
import { renderBrandedEmail } from '../src/mail/email-layout';
const schema = 'settings_test_' + randomUUID().replaceAll('-', '');
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
  roomType = randomUUID(),
  ratePlan = randomUUID();

let app: INestApplication;
const oldCipher = process.env.INTEGRATION_CREDENTIALS_KEY;
const tester = { test: vi.fn(async () => ({ ok: true, message: 'Connected.' })) };
const tables = [
  'properties',
  'bookings',
  'payments',
  'users',
  'tenant_memberships',
  'capabilities',
  'property_staff_assignments',
  'property_role_template_capabilities',
  'property_staff_capability_overrides',
  'integration_connections',
  'property_integration_connections',
  'audit_logs',
];
const url = `/tenants/${tenantId}/properties/${propertyId}`;
beforeAll(async () => {
  process.env.INTEGRATION_CREDENTIALS_KEY = randomBytes(32).toString('base64');
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}",public`);
      for (const t of tables)
        await tx.$executeRawUnsafe(
          `CREATE TABLE "${schema}"."${t}" (LIKE public."${t}" INCLUDING ALL)`,
        );
      const migration = readFileSync(
        'prisma/migrations/20261021090000_payment_brand_settings/migration.sql',
        'utf8',
      )
        .replace(/--[^\n]*/g, '')
        .replace('SET search_path=public', `SET search_path="${schema}",public`);
      for (let n = 0; n < 2; n++)
        for (const sql of migration.split(';').filter((x) => x.trim()))
          await tx.$executeRawUnsafe(sql);
      await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO must_booking_app`);
      await tx.$executeRawUnsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO must_booking_app`,
      );
      for (const t of ['properties', 'integration_connections']) {
        await tx.$executeRawUnsafe(`ALTER TABLE "${schema}"."${t}" ENABLE ROW LEVEL SECURITY`);
        await tx.$executeRawUnsafe(`ALTER TABLE "${schema}"."${t}" FORCE ROW LEVEL SECURITY`);
        await tx.$executeRawUnsafe(
          `CREATE POLICY scope ON "${schema}"."${t}" USING(tenant_id=public.app_current_tenant_id()) WITH CHECK(tenant_id=public.app_current_tenant_id())`,
        );
      }
    },
    { timeout: 30000 },
  );
  await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${propertyId}::uuid,${tenantId}::uuid,'Brand hotel',${schema},'Europe/Tirane'),(${otherProperty}::uuid,${tenantId}::uuid,'Other hotel',${schema + 'other'},'Europe/Tirane')`;
  for (const id of [owner, staff]) {
    await admin.$executeRaw`INSERT INTO users(id,email) VALUES(${id}::uuid,${id + '@example.test'})`;
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${tenantId}::uuid,${id}::uuid,${id === owner ? 'OWNER' : 'STAFF'}::public."TenantMembershipRole")`;
  }
  await admin.$executeRaw`INSERT INTO capabilities(tenant_id,key,description) VALUES(${tenantId}::uuid,'settings.manage','Settings')`;
  const module = await Test.createTestingModule({
    controllers: [PropertiesController, IntegrationConnectionsController],
    providers: [
      PropertiesService,
      IntegrationConnectionsService,
      CapabilitiesService,
      AuditLogService,
      CredentialCipherService,
      { provide: TenantDatabaseService, useValue: db },
      { provide: PropertyRoleTemplatesService, useValue: {} },
      { provide: ConnectionTestRegistry, useValue: tester },
    ],
  }).compile();
  app = module.createNestApplication();
  app.use(
    (
      req: {
        originalUrl: string;
        headers: Record<string, string | undefined>;
        tenantContext?: unknown;
      },
      _res: unknown,
      next: () => void,
    ) => {
      const parts = req.originalUrl.split('/');
      req.tenantContext = {
        tenantId: parts[2],
        propertyId: parts[4],
        userId: req.headers['x-fixture-user'] ?? owner,
      };
      next();
    },
  );
  app.useGlobalGuards(
    new CapabilitiesGuard(
      new Reflector(),
      module.get(CapabilitiesService),
      module.get(AuditLogService),
    ),
  );
  await app.init();
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
  if (!/^settings_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe schema');
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.$disconnect();
  if (oldCipher === undefined) delete process.env.INTEGRATION_CREDENTIALS_KEY;
  else process.env.INTEGRATION_CREDENTIALS_KEY = oldCipher;
});
it('defaults, validates and atomically saves the new fields with payment methods, preserving other hotels', async () => {
  const list = await request(app.getHttpServer()).get(`/tenants/${tenantId}/properties`);
  expect(list.status, list.text).toBe(200);
  expect(list.body.find((p: { id: string }) => p.id === propertyId)).toMatchObject({
    onlinePaymentHoldMinutes: 30,
    autoRefundOnFreeCancellation: true,
    brandColour: null,
  });
  for (const body of [
    { logoUrl: 'https://photos.test/logo.svg' },
    { logoUrl: 'http://photos.test/logo.png' },
    { onlinePaymentHoldMinutes: 9 },
    { onlinePaymentHoldMinutes: 1441 },
    { onlinePaymentHoldMinutes: 10.5 },
    { autoRefundOnFreeCancellation: 'yes' },
    { brandColour: 'red' },
    { termsUrl: 'http://hotel.test/terms' },
    { emailFooterText: 'a'.repeat(301) },
  ])
    expect((await request(app.getHttpServer()).patch(url).send(body)).status).toBe(400);
  const saved = await request(app.getHttpServer())
    .patch(url)
    .send({
      onlinePaymentHoldMinutes: 45,
      autoRefundOnFreeCancellation: false,
      brandColour: '#123ABC',
      emailFooterText: '<b>Plain footer</b>',
      termsUrl: 'https://hotel.test/terms',
      paymentGateways: { stripe: false, pokpay: true, payAtHotel: false },
    });
  expect(saved.status, saved.text).toBe(200);
  expect(saved.body).toMatchObject({
    onlinePaymentHoldMinutes: 45,
    autoRefundOnFreeCancellation: false,
    brandColour: '#123ABC',
    paymentGateways: { stripe: false, pokpay: true, payAtHotel: false },
  });
  const others = await request(app.getHttpServer()).get(`/tenants/${tenantId}/properties`);
  expect(
    others.body.find((p: { id: string }) => p.id === otherProperty).onlinePaymentHoldMinutes,
  ).toBe(30);
  expect(
    (
      await request(app.getHttpServer())
        .patch(url)
        .set('X-Fixture-User', staff)
        .send({ brandColour: '#abcdef' })
    ).status,
  ).toBe(403);
  const html = renderBrandedEmail({
    subject: 'Booking',
    brand: { ...saved.body, logoUrl: 'https://photos.test/logo.png' },
    heading: 'Confirmed',
    content: 'Welcome',
    cta: { label: 'View booking', url: 'https://hotel.test/booking' },
  });
  expect(html).toContain('alt="Brand hotel"');
  // The redesigned layout applies the brand colour to the top border and the call-to-action button.
  expect(html).toContain('border-top:4px solid #123ABC');
  expect(html).toContain('background-color:#123ABC');
  expect(html).toContain('&lt;b&gt;Plain footer&lt;/b&gt;');
  expect(html).toContain('https://hotel.test/terms');
});
it('selects expiry candidates using each property hold rather than the old universal 30-minute window', async () => {
  await request(app.getHttpServer()).patch(url).send({ onlinePaymentHoldMinutes: 45 }).expect(200);
  const id = randomUUID();
  await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,rate_plan_id,external_reference,starts_on,ends_on,total_amount,status,payment_method,created_at) VALUES(${id}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomType}::uuid,${ratePlan}::uuid,${id},'2030-01-01','2030-01-02',100,'PAYMENT_PENDING','POKPAY',now()-interval '35 minutes')`;
  const query = () =>
    admin.$queryRawUnsafe<{ bookingId: string }[]>(
      `SELECT * FROM "${schema}".payment_pending_expiry_candidates(now()-interval '30 minutes',100)`,
    );
  expect((await query()).some((r) => r.bookingId === id)).toBe(false);
  await request(app.getHttpServer()).patch(url).send({ onlinePaymentHoldMinutes: 10 }).expect(200);
  expect((await query()).some((r) => r.bookingId === id)).toBe(true);
});
it('uses the existing encrypted PokPay create/test/assignment path without returning secrets and replaces only this hotel assignment', async () => {
  const base = `/tenants/${tenantId}/integration-connections`,
    credentials = {
      keyId: 'fixture-key',
      keySecret: 'fixture-private-secret',
      merchantId: 'fixture-merchant',
      webhookUrl: 'https://hotel.test/api/webhooks/pokpay',
    };
  const create = async () =>
    request(app.getHttpServer())
      .post(base)
      .send({
        kind: 'PAYMENT',
        provider: 'POKPAY',
        name: 'PokPay fixture ' + randomUUID(),
        credentials,
      });
  const old = await create();
  expect(old.status, old.text).toBe(201);
  expect(JSON.stringify(old.body)).not.toContain('fixture-private-secret');
  await request(app.getHttpServer())
    .patch(`${url}/integration-connections/${old.body.id}`)
    .send({ enabled: true })
    .expect(200);
  await request(app.getHttpServer())
    .patch(
      `/tenants/${tenantId}/properties/${otherProperty}/integration-connections/${old.body.id}`,
    )
    .send({ enabled: true })
    .expect(200);
  const next = await create();
  const tested = await request(app.getHttpServer()).post(`${base}/${next.body.id}/test`);
  expect(tested.status, tested.text).toBe(201);
  expect(tested.body.status).toBe('CONNECTED');
  expect(tester.test).toHaveBeenCalledWith('POKPAY', credentials);
  await request(app.getHttpServer())
    .patch(`${url}/integration-connections/${next.body.id}`)
    .send({ enabled: true })
    .expect(200);
  const assignments = await request(app.getHttpServer()).get(`${url}/integration-connections`);
  expect(
    assignments.body.find((a: { connectionId: string }) => a.connectionId === old.body.id).enabled,
  ).toBe(false);
  expect(
    assignments.body.find((a: { connectionId: string }) => a.connectionId === next.body.id).enabled,
  ).toBe(true);
  const other = await request(app.getHttpServer()).get(
    `/tenants/${tenantId}/properties/${otherProperty}/integration-connections`,
  );
  expect(
    other.body.find((a: { connectionId: string }) => a.connectionId === old.body.id).enabled,
  ).toBe(true);
  const list = await request(app.getHttpServer()).get(base);
  expect(list.text).not.toContain('fixture-private-secret');
  expect(list.text).not.toContain('encryptedCredentials');
  expect(
    (
      await request(app.getHttpServer())
        .post(base)
        .set('X-Fixture-User', staff)
        .send({ kind: 'PAYMENT', provider: 'POKPAY', name: 'Forbidden', credentials })
    ).status,
  ).toBe(403);
});
