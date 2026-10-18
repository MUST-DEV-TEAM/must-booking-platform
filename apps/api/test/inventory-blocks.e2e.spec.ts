import { AvailabilityService } from '../src/tenancy/availability.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('Inventory blocks I2', () => {
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

  it('protects lifecycle, scope, real replay and concurrent writes', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Blocks group',
        propertyName: 'Blocks hotel',
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
      url = `${root}/inventory/blocks`;
    const type = await request(app.getHttpServer())
      .post(`${root}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = type.body.id;
    const input = {
      title: 'Maintenance',
      reason: 'maintenance',
      startsOn: '2035-11-03',
      endsOn: '2035-11-05',
      all: false,
      roomTypeIds: [roomTypeId],
      roomIds: [],
      responsibleStaffId: userId,
    };
    const create = (key: string, body: unknown = input) =>
      request(app.getHttpServer())
        .post(url)
        .set('Cookie', cookie)
        .set('Idempotency-Key', key)
        .send(body);
    const key = randomUUID();
    const replay = await Promise.all(Array.from({ length: 4 }, () => create(key).expect(201)));
    expect(new Set(replay.map((r) => r.body.id)).size).toBe(1);
    const draft = replay[0].body;
    expect(draft).toMatchObject({ version: 1, lifecycle: 'Draft', scopeLocked: false });
    await create(key, { ...input, title: 'Different' }).expect(409);
    await request(app.getHttpServer()).post(url).set('Cookie', cookie).send(input).expect(400);
    await create(randomUUID(), { ...input, roomTypeIds: [randomUUID()] }).expect(400);
    const second = (await create(randomUUID()).expect(201)).body;
    const action = (id: string, name: string, version: number, extra = {}) =>
      request(app.getHttpServer())
        .post(`${url}/${id}/${name}`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', randomUUID())
        .send({ version, ...extra });
    const race = await Promise.all([
      action(draft.id, 'activate', 1),
      action(second.id, 'activate', 1),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    const active = race.find((r) => r.status === 201)!.body;
    expect(active.lifecycle).toBe('Scheduled');
    const edits = await Promise.all(
      ['A', 'B'].map((title) =>
        request(app.getHttpServer())
          .patch(`${url}/${active.id}`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', randomUUID())
          .send({ ...input, title, version: 2 }),
      ),
    );
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = edits.find((r) => r.status === 200)!.body;
    await action(saved.id, 'cancel', 3).expect(201);
    const history = await request(app.getHttpServer())
      .get(`${url}/${saved.id}/history`)
      .set('Cookie', cookie)
      .expect(200);
    expect(history.body).toHaveLength(4);
    // Draft has no stock effect; cancelled block has none either.
    await request(app.getHttpServer())
      .put(`${root}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: input.startsOn, endsOn: input.endsOn, availableUnits: 3 })
      .expect(204);
    const availability = app.get(AvailabilityService);
    expect(
      (
        await availability.getAvailability(tenantId, propertyId, {
          roomTypeId,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
        })
      ).availableUnits,
    ).toBe(3);
    // Activation sees payment-pending holds and never changes the booking.
    const plan = await request(app.getHttpServer())
      .post(`${root}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Local plan', currency: 'EUR' })
      .expect(201);
    const bookingId = randomUUID();
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,status,starts_on,ends_on,total_amount,rate_plan_id,external_reference) VALUES(${bookingId}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomTypeId}::uuid,'PAYMENT_PENDING','2035-11-03','2035-11-05',0,${plan.body.id}::uuid,${'BLOCK-HOLD-' + randomUUID()})`;
    const other = race[0].status === 409 ? draft : second;
    const blocked = await action(other.id, 'activate', 1).expect(409);
    expect(blocked.body.conflicts.some((x: { kind: string }) => x.kind === 'hold')).toBe(true);
    const snapshot =
      await admin.$queryRaw`SELECT * FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${bookingId}::uuid`;
    // Boundary: checkout on block start is not an overlap.
    const adjacent = (
      await create(randomUUID(), { ...input, startsOn: '2035-11-05', endsOn: '2035-11-07' }).expect(
        201,
      )
    ).body;
    await action(adjacent.id, 'activate', 1).expect(201);
    expect(
      await admin.$queryRaw`SELECT * FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${bookingId}::uuid`,
    ).toEqual(snapshot);
    // Active scope lock and early-end reason using actual property-local today.
    const list = await request(app.getHttpServer()).get(url).set('Cookie', cookie).expect(200);
    const today = list.body.today;
    const tomorrow = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
    const now = (
      await create(randomUUID(), { ...input, startsOn: today, endsOn: tomorrow }).expect(201)
    ).body;
    const enabled = (await action(now.id, 'activate', 1).expect(201)).body;
    expect(enabled).toMatchObject({ lifecycle: 'Active', scopeLocked: true });
    await request(app.getHttpServer())
      .patch(`${url}/${now.id}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, startsOn: today, endsOn: tomorrow, all: true, roomTypeIds: [], version: 2 })
      .expect(400);
    await action(now.id, 'end', 2).expect(400);
    const endKey = randomUUID();
    const end = () =>
      request(app.getHttpServer())
        .post(`${url}/${now.id}/end`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', endKey)
        .send({ version: 2, endReason: 'Maintenance finished' });
    const ended = await end().expect(201);
    expect((await end().expect(201)).body).toEqual(ended.body);
    // Real reservation transaction holds the shared property lock; activation waits and then sees its booking.
    const racingInput = { ...input, startsOn: '2035-12-01', endsOn: '2035-12-03' };
    const racingDraft = (await create(randomUUID(), racingInput).expect(201)).body;
    await request(app.getHttpServer())
      .patch(`${root}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2, status: 'PUBLISHED' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${root}/inventory-units`)
      .set('Cookie', cookie)
      .send({
        roomTypeId,
        startsOn: racingInput.startsOn,
        endsOn: racingInput.endsOn,
        availableUnits: 3,
      })
      .expect(204);
    let release!: () => void, locked!: () => void;
    const barrier = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (locked = r));
    const reserving = app
      .get(TenantDatabaseService)
      .withTenantTransaction({ tenantId, propertyId }, async (tx) => {
        expect(
          await availability.reserveBookedUnits(tx, tenantId, propertyId, {
            roomTypeId,
            startsOn: racingInput.startsOn,
            endsOn: racingInput.endsOn,
            units: 1,
          }),
        ).toBe(true);
        locked();
        await barrier;
        await tx.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,status,starts_on,ends_on,total_amount,rate_plan_id,external_reference) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomTypeId}::uuid,'CONFIRMED','2035-12-01','2035-12-03',0,${plan.body.id}::uuid,${'RACE-' + randomUUID()})`;
      });
    await ready;
    const activating = action(racingDraft.id, 'activate', 1).then((r) => r);
    release();
    await reserving;
    expect((await activating).status).toBe(409);
    // Scoped misses, capability gates and forced RLS.
    await request(app.getHttpServer())
      .get(`${url}/${randomUUID()}`)
      .set('Cookie', cookie)
      .expect(404);
    const db = app.get(TenantDatabaseService);
    expect(
      await db.withTenantTransaction(
        { tenantId, propertyId: randomUUID() },
        (tx) =>
          tx.$queryRaw`SELECT * FROM inventory_block_operations WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
      ),
    ).toEqual([]);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    await create(randomUUID()).expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    const connectionId = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES(${connectionId}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Read-only fixture','not-real-credentials','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(id,tenant_id,property_id,connection_id,kind,enabled) VALUES(${randomUUID()}::uuid,${tenantId}::uuid,${propertyId}::uuid,${connectionId}::uuid,'PMS',true)`;
    await create(randomUUID()).expect(403);
  });
});
