import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { QuoteService } from '../src/booking/quote.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { AvailabilityService } from '../src/tenancy/availability.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('manual availability blocks', () => {
  let app: INestApplication;
  let tenantId: string;
  let propertyId: string;
  let otherPropertyId: string;
  let pooledPropertyId: string;
  let ownerId: string;
  let cookie: string;
  let verificationToken = '';
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendRefundConfirmationEmail() {},
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
    if (tenantId) {
      await cleanupTenant(admin, tenantId);
    }
    if (ownerId) await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  it('blocks all, room types, rooms, and combined targets in the availability and booking paths', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Manual Blocks Group',
        propertyName: 'Manual Blocks Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `manual-blocks-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    ownerId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    await request(app.getHttpServer())
      .patch(propertyUrl)
      .set('Cookie', cookie)
      .send({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const firstType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Classic', maxOccupancy: 2 })
      .expect(201);
    const secondType = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Suite', maxOccupancy: 2 })
      .expect(201);
    const firstRoom = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${firstType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Classic 101' })
      .expect(201);
    const firstTypeSibling = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${firstType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Classic 102' })
      .expect(201);
    const secondRoom = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${secondType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Suite 201' })
      .expect(201);
    const secondTypeSibling = await request(app.getHttpServer())
      .post(`${propertyUrl}/room-types/${secondType.body.id}/rooms`)
      .set('Cookie', cookie)
      .send({ name: 'Suite 202' })
      .expect(201);
    const ratePlan = await request(app.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Flexible', currency: 'EUR' })
      .expect(201);
    for (const roomTypeId of [firstType.body.id, secondType.body.id])
      await request(app.getHttpServer())
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId, startsOn: null, endsOn: null, amount: '100.00' })
        .expect(201);

    const roomAvailability = (roomId: string, startsOn: string, endsOn: string) =>
      request(app.getHttpServer())
        .get(`${propertyUrl}/rooms/${roomId}/availability`)
        .set('Cookie', cookie)
        .query({ startsOn, endsOn });
    const block = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`${propertyUrl}/availability-blocks`)
        .set('Cookie', cookie)
        .send(body);

    await block({
      startsOn: '2036-10-10',
      endsOn: '2036-10-12',
      roomTypeIds: [firstType.body.id],
    }).expect(201);
    await roomAvailability(firstRoom.body.id, '2036-10-10', '2036-10-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(false));
    await roomAvailability(firstTypeSibling.body.id, '2036-10-10', '2036-10-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(false));
    await roomAvailability(secondRoom.body.id, '2036-10-10', '2036-10-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(true));

    await block({ startsOn: '2036-11-10', endsOn: '2036-11-12', all: true }).expect(201);
    await roomAvailability(secondTypeSibling.body.id, '2036-11-10', '2036-11-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(false));

    await block({
      startsOn: '2036-12-10',
      endsOn: '2036-12-12',
      roomIds: [secondRoom.body.id],
    }).expect(201);
    await roomAvailability(secondRoom.body.id, '2036-12-10', '2036-12-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(false));
    await roomAvailability(secondTypeSibling.body.id, '2036-12-10', '2036-12-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(true));
    await request(app.getHttpServer())
      .get(`${propertyUrl}/public/catalog`)
      .query({ startsOn: '2036-12-10', endsOn: '2036-12-12' })
      .expect(200)
      .expect((response) => {
        const suite = response.body.roomTypes.find(
          (roomType: { id: string }) => roomType.id === secondType.body.id,
        );
        expect(suite.rooms).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: secondRoom.body.id, isAvailable: false }),
            expect.objectContaining({ id: secondTypeSibling.body.id, isAvailable: true }),
          ]),
        );
      });

    await block({
      startsOn: '2037-01-10',
      endsOn: '2037-01-12',
      roomTypeIds: [firstType.body.id],
      roomIds: [secondRoom.body.id],
    })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          all: false,
          roomTypeIds: [firstType.body.id],
          roomIds: [secondRoom.body.id],
        });
      });
    await roomAvailability(firstRoom.body.id, '2037-01-10', '2037-01-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(false));
    await roomAvailability(secondRoom.body.id, '2037-01-10', '2037-01-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(false));
    await roomAvailability(secondTypeSibling.body.id, '2037-01-10', '2037-01-12')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(true));
    await roomAvailability(secondTypeSibling.body.id, '2037-01-12', '2037-01-13')
      .expect(200)
      .expect((response) => expect(response.body.isAvailable).toBe(true));

    const quotes = app.get(QuoteService);
    const provider = app.get(LocalPmsProvider);
    const quoteSessionId = randomUUID();
    const quote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId: secondType.body.id,
      roomId: secondRoom.body.id,
      ratePlanId: ratePlan.body.id,
      startsOn: '2036-12-10',
      endsOn: '2036-12-12',
    });
    await expect(
      provider.createBooking(
        { tenantId, propertyId },
        {
          idempotencyKey: randomUUID(),
          externalReference: `must-${randomUUID()}`,
          roomTypeId: secondType.body.id,
          roomId: secondRoom.body.id,
          ratePlanId: ratePlan.body.id,
          startsOn: '2036-12-10',
          endsOn: '2036-12-12',
          guest: {
            email: `guest-${randomUUID()}@example.test`,
            firstName: 'Manual',
            lastName: 'Block',
            phone: null,
          },
          total: quote.total,
          quoteToken: quote.quoteToken,
          quoteSessionId,
          paymentMethod: 'pay_at_hotel',
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AVAILABILITY_FAILED' } });

    await request(app.getHttpServer())
      .post(`/tenants/${randomUUID()}/properties/${propertyId}/availability-blocks`)
      .set('Cookie', cookie)
      .send({ startsOn: '2037-02-10', endsOn: '2037-02-11', all: true })
      .expect(403);

    otherPropertyId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug, address, timezone)
      VALUES (
        ${otherPropertyId}::uuid,
        ${tenantId}::uuid,
        'Other Manual Blocks Hotel',
        ${`other-manual-blocks-${otherPropertyId.slice(0, 8)}`},
        '2 Main Street',
        'Europe/Tirane'
      )
    `;
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${otherPropertyId}`)
      .set('Cookie', cookie)
      .send({ bookingMode: 'INDIVIDUAL_ROOM_ONLY' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${otherPropertyId}/availability-blocks`)
      .set('Cookie', cookie)
      .send({ startsOn: '2037-02-10', endsOn: '2037-02-11', roomIds: [firstRoom.body.id] })
      .expect(404);

    pooledPropertyId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug, address, timezone)
      VALUES (
        ${pooledPropertyId}::uuid,
        ${tenantId}::uuid,
        'Pooled Manual Blocks Hotel',
        ${`pooled-manual-blocks-${pooledPropertyId.slice(0, 8)}`},
        '3 Main Street',
        'Europe/Tirane'
      )
    `;
    const pooledUrl = `/tenants/${tenantId}/properties/${pooledPropertyId}`;
    const pooledType = await request(app.getHttpServer())
      .post(`${pooledUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Pooled Classic', maxOccupancy: 2 })
      .expect(201);
    await request(app.getHttpServer())
      .put(`${pooledUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({
        roomTypeId: pooledType.body.id,
        startsOn: '2037-03-10',
        endsOn: '2037-03-12',
        availableUnits: 2,
      })
      .expect(204);
    await request(app.getHttpServer())
      .post(`${pooledUrl}/availability-blocks`)
      .set('Cookie', cookie)
      .send({
        startsOn: '2037-03-10',
        endsOn: '2037-03-12',
        roomTypeIds: [pooledType.body.id],
      })
      .expect(201);
    await request(app.getHttpServer())
      .get(`${pooledUrl}/availability`)
      .set('Cookie', cookie)
      .query({ roomTypeId: pooledType.body.id, startsOn: '2037-03-10', endsOn: '2037-03-12' })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ isAvailable: false, availableUnits: 0 });
      });
    const availability = app.get(AvailabilityService);
    const database = app.get(TenantDatabaseService);
    await database.withTenantTransaction({ tenantId, propertyId: pooledPropertyId }, async (tx) => {
      await expect(
        availability.reserveBookedUnits(tx, tenantId, pooledPropertyId, {
          roomTypeId: pooledType.body.id,
          startsOn: '2037-03-10',
          endsOn: '2037-03-12',
          units: 1,
        }),
      ).resolves.toBe(false);
    });
  });
});
