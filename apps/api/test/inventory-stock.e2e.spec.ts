import { InventoryStockService } from '../src/tenancy/inventory-stock.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { stockDay } from '../src/tenancy/inventory-stock-input';
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

describe('Inventory stock bulk changes', () => {
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

  let today: string;
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
      url = `${root}/inventory`;
    const type = await request(app.getHttpServer())
      .post(`${root}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = type.body.id;
    await request(app.getHttpServer())
      .patch(`${root}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2, status: 'PUBLISHED' })
      .expect(200);

    const grid = await request(app.getHttpServer())
      .get(`${url}/stock`)
      .set('Cookie', cookie)
      .expect(200);
    today = grid.body.today;
    Object.assign(fixture, { root, url });
  });
  const fixture = { root: '', url: '' };
  const send = (body: Record<string, unknown>, key = randomUUID()) =>
    request(app.getHttpServer())
      .put(`${fixture.root}/inventory-units`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const preview = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`${fixture.url}/stock/preview`)
      .set('Cookie', cookie)
      .send(body);
  const body = (value = 5) => ({
    roomTypeIds: [roomTypeId],
    startsOn: today,
    endsOn: stockDay(today, 3),
    operation: 'set',
    value,
  });
  it('requires a key, previews before/after counts, retries once and detects key reuse', async () => {
    await request(app.getHttpServer())
      .put(`${fixture.root}/inventory-units`)
      .set('Cookie', cookie)
      .send(body())
      .expect(400);
    const p = await preview(body()).expect(201);
    expect(p.body.changes).toHaveLength(3);
    expect(p.body.changes[0]).toMatchObject({ before: 0, after: 5, soldHeld: 0 });
    const key = randomUUID(),
      input = { ...body(), previewToken: p.body.previewToken };
    await Promise.all([send(input, key).expect(204), send(input, key).expect(204)]);
    await send(input, key).expect(204);
    await send({ ...input, value: 7 }, key).expect(409);
    const logs = await admin.$queryRaw<
      Array<{ details: { beforeCount: number; afterCount: number } }>
    >`SELECT details FROM audit_logs WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND action='inventory_units.bulk_change'`;
    expect(logs).toHaveLength(1);
    expect(logs[0]?.details).toMatchObject({ beforeCount: 0, afterCount: 15 });
  });
  it('serializes concurrent additions and rejects stale previews without lost updates', async () => {
    const input = { ...body(1), operation: 'add' },
      p = await preview(input).expect(201);
    await Promise.all([send(input).expect(204), send(input).expect(204)]);
    const next = await preview(body()).expect(201);
    expect(next.body.changes[0].before).toBe(7);
    await send({ ...input, previewToken: p.body.previewToken }).expect(409);
  });
  it('rejects below sold/held atomically including reset and concurrent claims', async () => {
    await admin.$executeRaw`UPDATE inventory_units SET booked_units=3 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid AND stays_on=${today}::date`;
    const p = await preview(body(2)).expect(201);
    expect(p.body.valid).toBe(false);
    expect(p.body.changes[0].error).toContain('3 sold/held');
    const fail = await send(body(2)).expect(409);
    expect(fail.body.message).toContain(today);
    await send({ ...body(), operation: 'reset' }).expect(409);
    expect(
      (await preview(body()).expect(201)).body.changes.map((c: { before: number }) => c.before),
    ).toEqual([7, 7, 7]);
    const db = app.get(TenantDatabaseService);
    let acquired!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (acquired = r)),
      gate = new Promise<void>((r) => (release = r));
    const claim = db.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid FOR UPDATE`;
      acquired();
      await gate;
      await tx.$executeRaw`UPDATE inventory_units SET booked_units=6 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid AND stays_on=${today}::date`;
    });
    await ready;
    const edit = send(body(5)).then((r) => r);
    release();
    await claim;
    expect((await edit).status).toBe(409);
  });
  it('filters weekdays, handles leap/month boundaries, resets zero and uses property local today', async () => {
    const start = '2036-02-28',
      end = '2036-03-03';
    const input = { ...body(4), startsOn: start, endsOn: end, weekdays: [5, 6, 7] };
    const p = await preview(input).expect(201);
    expect(p.body.changes.map((c: { date: string }) => c.date)).toEqual([
      '2036-02-29',
      '2036-03-01',
      '2036-03-02',
    ]);
    await send(input).expect(204);
    await send({ ...input, operation: 'reset' }).expect(204);
    expect(
      (await preview(input).expect(201)).body.changes.every(
        (c: { before: number }) => c.before === 0,
      ),
    ).toBe(true);
    const local = (
      await request(app.getHttpServer())
        .get(`${fixture.url}/stock`)
        .set('Cookie', cookie)
        .expect(200)
    ).body;
    expect(local.timezone).toBe('Pacific/Auckland');
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Auckland',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(local.today).toBe(expected);
    await send({ ...body(), startsOn: stockDay(today, -1), endsOn: today }).expect(409);
    await send({ ...body(), startsOn: '2036-02-30' }).expect(400);
    await send({ ...body(), endsOn: stockDay(today, 1001) }).expect(400);
    await send({ ...body(), weekdays: [] }).expect(400);
  });
  it('isolates tenant/property cells and receipts with forced RLS', async () => {
    const second = { body: { id: randomUUID() } };
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${second.body.id}::uuid,${tenantId}::uuid,'Second stock hotel','stock-second','UTC')`;
    try {
      const service = app.get(InventoryStockService);
      await expect(
        service.apply(tenantId, second.body.id, userId, body(), randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.grid(randomUUID(), propertyId, {})).rejects.toMatchObject({
        status: 404,
      });
      const db = app.get(TenantDatabaseService);
      expect(
        await db.withTenantTransaction(
          { tenantId, propertyId: second.body.id },
          (tx) =>
            tx.$queryRaw`SELECT * FROM inventory_stock_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
        ),
      ).toEqual([]);
      const flags = await admin.$queryRaw<
        Array<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>
      >`SELECT relforcerowsecurity,relrowsecurity FROM pg_class WHERE relname='inventory_stock_operations'`;
      expect(flags[0]).toEqual({ relforcerowsecurity: true, relrowsecurity: true });
    } finally {
      await admin.$executeRaw`DELETE FROM properties WHERE tenant_id=${tenantId}::uuid AND id=${second.body.id}::uuid`;
    }
  });
  it('marks saved stop-sell, arrival/departure closures and room-type blocks without changing raw pool stock', async () => {
    const date = stockDay(today, 10),
      next = stockDay(date, 1);
    for (const type of ['stop_sell', 'closed_to_arrival', 'closed_to_departure']) {
      const r = await request(app.getHttpServer())
        .post(`${fixture.url}/restrictions`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({
          name: type,
          type,
          value: 1,
          scope: 'room_type',
          targetIds: [roomTypeId],
          startsOn: date,
          endsOn: date,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          priority: 50,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`${fixture.url}/restrictions/${r.body.id}/activate`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ version: 1 })
        .expect(201);
    }
    const b = await request(app.getHttpServer())
      .post(`${fixture.url}/blocks`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        title: 'Stock block',
        reason: 'maintenance',
        startsOn: date,
        endsOn: next,
        all: false,
        roomTypeIds: [roomTypeId],
        roomIds: [],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${fixture.url}/blocks/${b.body.id}/activate`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 1 })
      .expect(201);
    const grid = await request(app.getHttpServer())
      .get(`${fixture.url}/stock`)
      .query({ startsOn: date })
      .set('Cookie', cookie)
      .expect(200);
    const cell = grid.body.rows[0].days[0];
    expect(cell).toMatchObject({ blocked: true, stock: 0, remaining: 0 });
    expect(cell.markers.join(' ')).toContain('Sales are closed');
    expect(cell.markers.join(' ')).toContain('Arrival is closed');
    expect(cell.markers.join(' ')).toContain('Departure closed');
    expect(cell.markers.join(' ')).toContain('Stock block');
    expect(grid.body.rows[0].days[1].blocked).toBe(false);
  });
  it('requires view/write capability and verified email, and respects property-local midnight', async () => {
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    await send(body()).expect(403);
    await request(app.getHttpServer())
      .get(`${fixture.url}/stock`)
      .set('Cookie', cookie)
      .expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    await admin.$executeRaw`UPDATE users SET email_verified_at=NULL WHERE id=${userId}::uuid`;
    await send(body()).expect(403);
    await preview(body()).expect(403);
    await admin.$executeRaw`UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=${userId}::uuid`;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2036-02-28T11:30:00Z'));
      const service = app.get(InventoryStockService);
      const local = await service.grid(tenantId, propertyId, {});
      expect(local.today).toBe('2036-02-29');
      await expect(
        service.apply(
          tenantId,
          propertyId,
          userId,
          { ...body(), startsOn: '2036-02-28', endsOn: '2036-02-29' },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 409 });
      await service.apply(
        tenantId,
        propertyId,
        userId,
        { ...body(), startsOn: '2036-02-29', endsOn: '2036-03-01' },
        randomUUID(),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects actual cross-tenant targets and cannot read another tenant receipt', async () => {
    const otherTenant = randomUUID(),
      otherProperty = randomUUID(),
      otherType = randomUUID();
    await admin.$executeRaw`INSERT INTO organizations(id,name) VALUES(${otherTenant}::uuid,'Foreign stock test')`;
    try {
      await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES(${otherProperty}::uuid,${otherTenant}::uuid,'Foreign stock','foreign-stock','UTC')`;
      await admin.$executeRaw`INSERT INTO room_types(id,tenant_id,property_id,name,max_occupancy) VALUES(${otherType}::uuid,${otherTenant}::uuid,${otherProperty}::uuid,'Foreign type',2)`;
      await send({ ...body(), roomTypeIds: [otherType] }).expect(404);
      const service = app.get(InventoryStockService);
      await expect(service.grid(tenantId, otherProperty, {})).rejects.toMatchObject({
        status: 404,
      });
      const db = app.get(TenantDatabaseService);
      expect(
        await db.withTenantTransaction(
          { tenantId: otherTenant, propertyId: otherProperty },
          (tx) =>
            tx.$queryRaw`SELECT * FROM inventory_stock_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
        ),
      ).toEqual([]);
    } finally {
      await cleanupTenant(admin, otherTenant);
    }
  });
  it('shows physical stock read-only and fails closed for any enabled Clock assignment', async () => {
    await admin.$executeRaw`UPDATE properties SET booking_mode='INDIVIDUAL_ROOM_ONLY' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    const physicalRoom = randomUUID();
    await admin.$executeRaw`INSERT INTO rooms(id,tenant_id,property_id,room_type_id,name,is_active) VALUES(${physicalRoom}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomTypeId}::uuid,'101',true)`;
    const physical = await request(app.getHttpServer())
      .get(`${fixture.url}/stock`)
      .set('Cookie', cookie)
      .expect(200);
    expect(physical.body.readOnly).toBe(true);
    expect(physical.body.rows[0].days[0].stock).toBe(1);
    expect(physical.body.rows[0].days[0].soldHeld).toBe(0);
    await admin.$executeRaw`UPDATE rooms SET is_active=false WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${physicalRoom}::uuid`;
    const inactive = await request(app.getHttpServer())
      .get(`${fixture.url}/stock`)
      .set('Cookie', cookie)
      .expect(200);
    expect(inactive.body.rows[0].days[0].stock).toBe(0);
    await send(body()).expect(403);
    await preview(body()).expect(403);
    await admin.$executeRaw`UPDATE properties SET booking_mode='ROOM_TYPE_ONLY' WHERE tenant_id=${tenantId}::uuid AND id=${propertyId}::uuid`;
    const connectionId = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connectionId}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Stock readonly test','not-real-credentials','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind,enabled) VALUES(${tenantId}::uuid,${propertyId}::uuid,${connectionId}::uuid,'PMS',true)`;
    const clock = await request(app.getHttpServer())
      .get(`${fixture.url}/stock`)
      .set('Cookie', cookie)
      .expect(200);
    expect(clock.body).toMatchObject({ source: 'CLOCK_PMS', readOnly: true });
    expect(clock.body.rows[0].days[0].stock).toBeNull();
    await send(body()).expect(403);
    await preview(body()).expect(403);
    await admin.$executeRaw`DELETE FROM property_integration_connections WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND connection_id=${connectionId}::uuid`;
    await admin.$executeRaw`DELETE FROM integration_connections WHERE tenant_id=${tenantId}::uuid AND id=${connectionId}::uuid`;
  });
});
