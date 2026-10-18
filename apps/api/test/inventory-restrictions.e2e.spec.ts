import * as crypto from 'node:crypto';
import { QuoteService } from '../src/booking/quote.service';
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

describe('Inventory restrictions I1', () => {
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

  it('enforces scoped, versioned and idempotent restriction lifecycle with real concurrent requests', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Restrictions group',
        propertyName: 'Restrictions hotel',
        propertyAddress: 'Local test',
        propertyTimezone: 'Europe/Tirane',
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
    const root = `/tenants/${tenantId}/properties/${propertyId}`;
    const url = `${root}/inventory/restrictions`;
    const type = await request(app.getHttpServer())
      .post(`${root}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = type.body.id;
    const category = await request(app.getHttpServer())
      .post(`${root}/room-categories`)
      .set('Cookie', cookie)
      .send({ name: 'Suites' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${root}/room-types/${roomTypeId}`)
      .set('Cookie', cookie)
      .send({ name: 'King', maxOccupancy: 2, categoryId: category.body.id, status: 'PUBLISHED' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`${root}/inventory-units`)
      .set('Idempotency-Key', crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2035-11-01', endsOn: '2035-12-01', availableUnits: 2 })
      .expect(204);
    const plan = await request(app.getHttpServer())
      .post(`${root}/rate-plans`)
      .set('Idempotency-Key', globalThis.crypto.randomUUID())
      .set('Cookie', cookie)
      .send({ name: 'Existing stay plan', currency: 'EUR' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${root}/rate-plans/${plan.body.id}/rules`)
      .set('Idempotency-Key', randomUUID())
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '100.00' })
      .expect(201);
    const bookingId = randomUUID();
    await admin.$executeRaw`INSERT INTO bookings(id,tenant_id,property_id,room_type_id,external_reference,status,starts_on,ends_on,rate_plan_id,total_amount) VALUES (${bookingId}::uuid,${tenantId}::uuid,${propertyId}::uuid,${roomTypeId}::uuid,'EXISTING-BEFORE-RESTRICTIONS','CONFIRMED','2035-11-02'::date,'2035-11-03'::date,${plan.body.id}::uuid,100)`;
    await admin.$executeRaw`UPDATE inventory_units SET booked_units=1 WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND room_type_id=${roomTypeId}::uuid AND stays_on='2035-11-02'::date`;
    const originalBooking =
      await admin.$queryRaw`SELECT * FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${bookingId}::uuid`;
    const input = {
      name: 'Minimum stay',
      type: 'minimum_stay',
      value: 3,
      scope: 'category',
      targetIds: [category.body.id],
      startsOn: '2035-11-01',
      endsOn: '2035-11-30',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      priority: 50,
    };
    const createKey = randomUUID();
    const repeated = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        request(app.getHttpServer())
          .post(url)
          .set('Cookie', cookie)
          .set('Idempotency-Key', createKey)
          .send(
            index ? { ...input, targetIds: input.targetIds.map((id) => id.toUpperCase()) } : input,
          ),
      ),
    );
    expect(repeated.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const first = repeated[0].body;
    repeated.forEach((r) => expect(r.body).toEqual(first));
    expect(first).toMatchObject({
      reference: expect.stringMatching(/^RST-\d{4}-0001$/),
      version: 1,
      lifecycle: 'Draft',
      createdByUserId: userId,
      updatedByUserId: userId,
    });
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', createKey)
      .send({ ...input, name: 'Other' })
      .expect(409);
    await request(app.getHttpServer()).post(url).set('Cookie', cookie).send(input).expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, targetIds: [randomUUID()] })
      .expect(400);
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, scope: 'room_type', targetIds: [randomUUID()] })
      .expect(400);
    const second = await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...input,
        name: 'Contradicting stay',
        value: 4,
        scope: 'room_type',
        targetIds: [roomTypeId],
      })
      .expect(201);
    // Two contradictory drafts really activate concurrently. The property lock admits exactly one.
    const activations = await Promise.all(
      [first, second.body].map((r) =>
        request(app.getHttpServer())
          .post(`${url}/${r.id}/activate`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', randomUUID())
          .send({ version: r.version }),
      ),
    );
    expect(activations.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(activations.find((r) => r.status === 409)!.body.code).toBe(
      'RESTRICTION_PRIORITY_CONFLICT',
    );
    const active = activations.find((r) => r.status === 201)!.body;
    expect(active).toMatchObject({ version: 2, lifecycle: 'Scheduled' });
    const loser = active.id === first.id ? second.body : first;
    await request(app.getHttpServer())
      .get(`${url}/${active.id.toUpperCase()}`)
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .post(`${url}/validate`)
      .set('Cookie', cookie)
      .send({ ...input, id: loser.id, value: active.value === 3 ? 4 : 3 })
      .expect((r) =>
        expect(r.body).toMatchObject({
          valid: false,
          conflicts: [expect.objectContaining({ id: active.id })],
        }),
      );
    const range = { roomTypeId, startsOn: '2035-11-02', endsOn: '2035-11-03' };
    await request(app.getHttpServer())
      .post(`${root}/quotes`)
      .send({ ...range, ratePlanId: plan.body.id, adults: 1, children: 0 })
      .expect((r) => {
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('MIN_STAY');
      });
    await request(app.getHttpServer())
      .get(`${root}/public/catalog`)
      .query(range)
      .expect((r) => expect(r.body.roomTypes).toEqual([]));
    const database = app.get(TenantDatabaseService);
    const quote = app.get(QuoteService);
    await expect(
      quote.enforceBookingRules(tenantId, propertyId, { ...range, adults: 1, children: 0 }),
    ).rejects.toMatchObject({ status: 400 });
    await request(app.getHttpServer())
      .get(`${root}/availability`)
      .set('Cookie', cookie)
      .query(range)
      .expect((r) =>
        expect(r.body).toMatchObject({
          isAvailable: false,
          availableUnits: 0,
          restrictionErrors: [expect.objectContaining({ code: 'MIN_STAY' })],
        }),
      );
    await request(app.getHttpServer())
      .get(`${root}/booking-rules/evaluate`)
      .set('Cookie', cookie)
      .query(range)
      .expect((r) =>
        expect(r.body.booking).toMatchObject({
          valid: false,
          errors: [expect.objectContaining({ code: 'MIN_STAY' })],
        }),
      );
    // A previously acquired quote cannot bypass a newly active restriction at the reservation boundary.
    const availability = app.get(AvailabilityService);
    await database.withTenantTransaction({ tenantId, propertyId }, async (tx) =>
      expect(
        await availability.reserveBookedUnits(tx, tenantId, propertyId, { ...range, units: 1 }),
      ).toBe(false),
    );
    // Different-priority exception relaxes the general restriction for a short period.
    const exception = await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...input,
        name: 'Short-stay exception',
        value: 1,
        scope: 'property',
        targetIds: [],
        priority: 75,
        endsOn: '2035-11-02',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${url}/${exception.body.id}/activate`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 1 })
      .expect(201);
    await expect(
      quote.enforceBookingRules(tenantId, propertyId, { ...range, adults: 1, children: 0 }),
    ).resolves.toBeUndefined();
    await request(app.getHttpServer())
      .get(`${root}/availability`)
      .set('Cookie', cookie)
      .query(range)
      .expect((r) => expect(r.body.isAvailable).toBe(true));
    await request(app.getHttpServer())
      .get(`${root}/public/catalog`)
      .query(range)
      .expect((r) =>
        expect(r.body.roomTypes.map((t: { id: string }) => t.id)).toContain(roomTypeId),
      );
    const closure = await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...input,
        name: 'Closed nights',
        type: 'stop_sell',
        value: 1,
        scope: 'property',
        targetIds: [],
        startsOn: '2035-11-15',
        endsOn: '2035-11-16',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${url}/${closure.body.id}/activate`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .get(`${root}/availability-calendar`)
      .set('Cookie', cookie)
      .query({ roomTypeId, month: '2035-11' })
      .expect((r) => {
        expect(r.body.days.find((d: { date: string }) => d.date === '2035-11-15')).toMatchObject({
          isAvailable: false,
          status: 'unavailable',
          restrictionErrors: expect.arrayContaining([
            expect.objectContaining({ code: 'STOP_SELL' }),
          ]),
        });
      });
    // One stale editor loses even while another request changes the same rule concurrently.
    const edits = await Promise.all(
      ['First editor', 'Second editor'].map((name) =>
        request(app.getHttpServer())
          .patch(`${url}/${active.id}`)
          .set('Cookie', cookie)
          .set('Idempotency-Key', randomUUID())
          .send({
            ...input,
            name,
            value: active.value,
            scope: active.scope,
            targetIds: active.targetIds,
            version: 2,
          }),
      ),
    );
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const edited = edits.find((r) => r.status === 200)!.body;
    expect(edited.version).toBe(3);
    const pauseKey = randomUUID();
    const paused = await request(app.getHttpServer())
      .post(`${url}/${active.id}/pause`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', pauseKey)
      .send({ version: 3 })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(`${url}/${active.id}/pause`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', pauseKey)
      .send({ version: 3 })
      .expect(201);
    expect(replay.body).toEqual(paused.body);
    expect(paused.body).toMatchObject({ lifecycle: 'Paused', version: 4 });
    await request(app.getHttpServer())
      .delete(`${url}/${active.id}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 4 })
      .expect(400);
    const archived = await request(app.getHttpServer())
      .post(`${url}/${active.id}/archive`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 4 })
      .expect(201);
    expect(archived.body).toMatchObject({ lifecycle: 'Archived', version: 5 });
    await request(app.getHttpServer())
      .patch(`${url}/${active.id}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, version: 5 })
      .expect(400);
    const copy = await request(app.getHttpServer())
      .post(`${url}/${active.id}/duplicate`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 5 })
      .expect(201);
    expect(copy.body).toMatchObject({ lifecycle: 'Draft', version: 1 });
    expect(copy.body.id).not.toBe(active.id);
    await request(app.getHttpServer())
      .delete(`${url}/${copy.body.id}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ version: 1 })
      .expect(200);
    const afterDelete = await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(201);
    expect(afterDelete.body.reference).not.toBe(copy.body.reference);
    const history = await request(app.getHttpServer())
      .get(`${url}/${active.id}/history`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      history.body.filter((e: { action: string }) => e.action === 'inventory_restriction.pause'),
    ).toHaveLength(1);
    expect(
      history.body.map((e: { details: { after: { version: number } } }) => e.details.after.version),
    ).toEqual([1, 2, 3, 4, 5]);
    // Non-owner application connection proves FORCE RLS, including same-tenant wrong-property access.
    const otherProperty = randomUUID();
    await admin.$executeRaw`INSERT INTO properties(id,tenant_id,name,slug,timezone) VALUES (${otherProperty}::uuid,${tenantId}::uuid,'Other','other','UTC')`;
    for (const context of [
      { tenantId, propertyId: otherProperty },
      { tenantId: randomUUID(), propertyId },
    ]) {
      const rows = await database.withTenantTransaction(
        context,
        (tx) =>
          tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM inventory_restrictions WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`,
      );
      expect(rows).toEqual([]);
      await expect(
        database.withTenantTransaction(
          context,
          (tx) =>
            tx.$executeRaw`INSERT INTO inventory_restriction_sequences(tenant_id,property_id,year,last_value) VALUES (${tenantId}::uuid,${propertyId}::uuid,9998,1)`,
        ),
      ).rejects.toThrow();
    }
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${otherProperty}/inventory/restrictions/${active.id}`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({ ...input, scope: 'property', targetIds: [], version: 5 })
      .expect(404);
    const rls = await admin.$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('inventory_restrictions','inventory_restriction_sequences','inventory_restriction_operations')`;
    expect(rls).toHaveLength(3);
    expect(rls.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    const noBookings = await admin.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid`;
    expect(noBookings[0].count).toBe(1);
    expect(
      await admin.$queryRaw`SELECT * FROM bookings WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid AND id=${bookingId}::uuid`,
    ).toEqual(originalBooking);
    // Existing catalog entries are not extended. A denied capability blocks the write route.
    await admin.$executeRaw`UPDATE tenant_memberships SET role='STAFF' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(403);
    await admin.$executeRaw`UPDATE tenant_memberships SET role='OWNER' WHERE tenant_id=${tenantId}::uuid AND user_id=${userId}::uuid`;
    // An enabled Clock assignment is read-only even when FAILED. No provider request is made.
    const connectionId = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status) VALUES (${connectionId}::uuid,${tenantId}::uuid,'PMS','CLOCK_PMS','Read-only fixture','not-real-credentials','FAILED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(id,tenant_id,property_id,connection_id,kind,enabled) VALUES (${randomUUID()}::uuid,${tenantId}::uuid,${propertyId}::uuid,${connectionId}::uuid,'PMS',true)`;
    await request(app.getHttpServer())
      .post(url)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send(input)
      .expect(403);
    await request(app.getHttpServer())
      .get(url)
      .set('Cookie', cookie)
      .expect((r) =>
        expect(r.body).toMatchObject({
          source: 'CLOCK_PMS',
          readOnly: true,
          items: [],
          providerRestrictions: null,
        }),
      );
    await expect(
      quote.enforceBookingRules(tenantId, propertyId, {
        roomTypeId,
        startsOn: '2035-11-03',
        endsOn: '2035-11-04',
        adults: 1,
        children: 0,
      }),
    ).resolves.toBeUndefined();
  });
});
