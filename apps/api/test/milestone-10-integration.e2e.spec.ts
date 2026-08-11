import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

type Room = { id: string; name: string };
type RoomType = { id: string; rooms: Room[] };
type Catalog = {
  bookingMode?: 'INDIVIDUAL_ROOM_ONLY' | 'MIXED';
  paymentMethods: string[];
  roomTypes: Array<{
    id: string;
    ratePlans: Array<{ id: string }>;
    rooms?: Array<{ id: string; isAvailable: boolean; name: string }>;
  }>;
};

type PropertyFixture = {
  id: string;
  url: string;
  ratePlanId: string;
  standard: RoomType;
  suite: RoomType;
};

describe('Milestone 10 individual-room booking integration', () => {
  let app: INestApplication;
  let tenantId: string;
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
    async sendNewBookingStaffNotification() {},
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
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (ownerId) await admin.$executeRaw`DELETE FROM users WHERE id = ${ownerId}::uuid`;
    await app.close();
    await admin.$disconnect();
  });

  it('completes real guest journeys in every booking mode, with manual blocks and pooled isolation', async () => {
    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Milestone 10 Integration Group',
        propertyName: 'Pooled Integration Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email: `milestone-10-integration-${randomUUID()}@example.test`,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    ownerId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];

    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    const pooled = await createFixture(signup.body.property.id, 'Pooled Integration Hotel');
    const individual = await createPropertyFixture(
      'Individual Integration Hotel',
      'INDIVIDUAL_ROOM_ONLY',
    );
    const mixed = await createPropertyFixture('Mixed Integration Hotel', 'MIXED');
    const pooledDates = { startsOn: '2040-08-10', endsOn: '2040-08-12' };
    const individualDates = { startsOn: '2040-08-14', endsOn: '2040-08-16' };
    const mixedDates = { startsOn: '2040-08-18', endsOn: '2040-08-20' };

    await request(app.getHttpServer())
      .put(`${pooled.url}/inventory-units`)
      .set('Cookie', cookie)
      .send({ ...pooledDates, roomTypeId: pooled.standard.id, availableUnits: 3 })
      .expect(204);
    // This mirrors Task 2's isolation proof: room-level data must not affect a pooled property.
    await admin.$executeRaw`
      INSERT INTO room_availability (tenant_id, property_id, room_id, stays_on, is_available)
      VALUES (${tenantId}::uuid, ${pooled.id}::uuid, ${pooled.standard.rooms[0].id}::uuid,
        ${pooledDates.startsOn}::date, false)
    `;
    await expectPooledAvailability(pooled, pooledDates, 3);

    const pooledJourney = await completeGuestJourney(pooled.url, pooledDates, (catalog) => {
      expect(catalog).toMatchObject({ paymentMethods: ['pay_at_hotel'] });
      expect(catalog.bookingMode).toBeUndefined();
      const roomType = catalog.roomTypes.find((candidate) => candidate.id === pooled.standard.id);
      expect(roomType).toBeDefined();
      expect(roomType?.rooms).toBeUndefined();
      return { roomTypeId: roomType!.id, ratePlanId: roomType!.ratePlans[0]!.id };
    });
    expect(pooledJourney.booking).toMatchObject({
      ok: true,
      value: { roomId: null, status: 'CONFIRMED' },
    });
    await expectPooledAvailability(pooled, pooledDates, 2);

    await request(app.getHttpServer())
      .patch(
        `${individual.url}/rate-plans/${individual.ratePlanId}/rooms/${individual.standard.rooms[0].id}/price-override`,
      )
      .set('Cookie', cookie)
      .send({ amount: '125.00' })
      .expect(200);
    const individualJourney = await completeGuestJourney(
      individual.url,
      individualDates,
      (catalog) => {
        expect(catalog.bookingMode).toBe('INDIVIDUAL_ROOM_ONLY');
        const roomType = catalog.roomTypes.find(
          (candidate) => candidate.id === individual.standard.id,
        )!;
        const selectedRoom = roomType.rooms?.find(
          (room) => room.id === individual.standard.rooms[0].id && room.isAvailable,
        );
        expect(selectedRoom).toBeDefined();
        return {
          roomTypeId: roomType.id,
          ratePlanId: roomType.ratePlans[0]!.id,
          roomId: selectedRoom!.id,
        };
      },
    );
    expect(individualJourney.quote.total).toEqual({ amount: '250.00', currency: 'EUR' });
    expect(individualJourney.booking).toMatchObject({
      ok: true,
      value: { roomId: individual.standard.rooms[0].id, status: 'CONFIRMED' },
    });

    await request(app.getHttpServer())
      .patch(
        `${mixed.url}/rate-plans/${mixed.ratePlanId}/rooms/${mixed.standard.rooms[1].id}/price-override`,
      )
      .set('Cookie', cookie)
      .send({ amount: '140.00' })
      .expect(200);
    const mixedJourney = await completeGuestJourney(mixed.url, mixedDates, (catalog) => {
      expect(catalog.bookingMode).toBe('MIXED');
      const roomType = catalog.roomTypes.find((candidate) => candidate.id === mixed.standard.id)!;
      expect(roomType.rooms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: mixed.standard.rooms[0].id, isAvailable: true }),
          expect.objectContaining({ id: mixed.standard.rooms[1].id, isAvailable: true }),
        ]),
      );
      return { roomTypeId: roomType.id, ratePlanId: roomType.ratePlans[0]!.id };
    });
    expect(mixedJourney.quote.total).toEqual({ amount: '200.00', currency: 'EUR' });
    expect(mixedJourney.booking).toMatchObject({ ok: true, value: { status: 'CONFIRMED' } });
    expect([mixed.standard.rooms[0].id]).toContain(mixedJourney.booking.value.roomId);

    const allBlockDates = { startsOn: '2040-09-01', endsOn: '2040-09-03' };
    await createAvailabilityBlock(individual.url, { ...allBlockDates, all: true });
    await expectCatalogRooms(individual.url, allBlockDates, [
      { id: individual.standard.rooms[0].id, isAvailable: false },
      { id: individual.standard.rooms[1].id, isAvailable: false },
    ]);

    const typeBlockDates = { startsOn: '2040-09-04', endsOn: '2040-09-06' };
    await createAvailabilityBlock(mixed.url, {
      ...typeBlockDates,
      roomTypeIds: [mixed.standard.id],
    });
    await expectCatalogRooms(mixed.url, typeBlockDates, [
      { id: mixed.standard.rooms[0].id, isAvailable: false },
      { id: mixed.standard.rooms[1].id, isAvailable: false },
      { id: mixed.suite.rooms[0].id, isAvailable: true },
    ]);

    const roomBlockDates = { startsOn: '2040-09-07', endsOn: '2040-09-09' };
    await createAvailabilityBlock(mixed.url, {
      ...roomBlockDates,
      roomIds: [mixed.standard.rooms[0].id, mixed.standard.rooms[1].id],
    });
    await expectCatalogRooms(mixed.url, roomBlockDates, [
      { id: mixed.standard.rooms[0].id, isAvailable: false },
      { id: mixed.standard.rooms[1].id, isAvailable: false },
      { id: mixed.suite.rooms[0].id, isAvailable: true },
    ]);

    const combinedBlockDates = { startsOn: '2040-09-10', endsOn: '2040-09-12' };
    await createAvailabilityBlock(mixed.url, {
      ...combinedBlockDates,
      roomTypeIds: [mixed.standard.id],
      roomIds: [mixed.suite.rooms[0].id],
    });
    await expectCatalogRooms(mixed.url, combinedBlockDates, [
      { id: mixed.standard.rooms[0].id, isAvailable: false },
      { id: mixed.standard.rooms[1].id, isAvailable: false },
      { id: mixed.suite.rooms[0].id, isAvailable: false },
    ]);

    const pooledBlockDates = { startsOn: '2040-09-13', endsOn: '2040-09-15' };
    await request(app.getHttpServer())
      .put(`${pooled.url}/inventory-units`)
      .set('Cookie', cookie)
      .send({ ...pooledBlockDates, roomTypeId: pooled.standard.id, availableUnits: 3 })
      .expect(204);
    await createAvailabilityBlock(pooled.url, {
      ...pooledBlockDates,
      roomTypeIds: [pooled.standard.id],
    });
    await request(app.getHttpServer())
      .get(`${pooled.url}/public/availability`)
      .query({ ...pooledBlockDates, roomTypeId: pooled.standard.id })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ isAvailable: false, availableUnits: 0 });
      });
    const pooledCounter = await admin.$queryRaw<Array<{ bookedUnits: number }>>`
      SELECT booked_units AS "bookedUnits"
      FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid
        AND property_id = ${pooled.id}::uuid
        AND room_type_id = ${pooled.standard.id}::uuid
        AND stays_on = ${pooledBlockDates.startsOn}::date
    `;
    expect(pooledCounter).toEqual([{ bookedUnits: 0 }]);
  });

  async function createPropertyFixture(
    name: string,
    bookingMode: 'INDIVIDUAL_ROOM_ONLY' | 'MIXED',
  ): Promise<PropertyFixture> {
    const propertyId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO properties (id, tenant_id, name, slug, address, timezone)
      VALUES (
        ${propertyId}::uuid,
        ${tenantId}::uuid,
        ${name},
        ${`${name.toLowerCase().replaceAll(' ', '-')}-${propertyId.slice(0, 8)}`},
        '2 Main Street',
        'Europe/Tirane'
      )
    `;
    await request(app.getHttpServer())
      .patch(`/tenants/${tenantId}/properties/${propertyId}`)
      .set('Cookie', cookie)
      .send({ bookingMode })
      .expect(200);
    return createFixture(propertyId, name);
  }

  async function createFixture(propertyId: string, name: string): Promise<PropertyFixture> {
    const url = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(app.getHttpServer())
      .patch(`${url}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);
    const standard = await createRoomType(url, `${name} Standard`, ['101', '102']);
    const suite = await createRoomType(url, `${name} Suite`, ['201']);
    const ratePlan = await request(app.getHttpServer())
      .post(`${url}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: `${name} Flexible`, currency: 'EUR' })
      .expect(201);
    for (const roomType of [standard, suite]) {
      await request(app.getHttpServer())
        .post(`${url}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId: roomType.id, startsOn: null, endsOn: null, amount: '100.00' })
        .expect(201);
    }
    return { id: propertyId, url, ratePlanId: ratePlan.body.id, standard, suite };
  }

  async function createRoomType(url: string, name: string, roomNames: string[]): Promise<RoomType> {
    const roomType = await request(app.getHttpServer())
      .post(`${url}/room-types`)
      .set('Cookie', cookie)
      .send({ name, maxOccupancy: 2 })
      .expect(201);
    const rooms: Room[] = [];
    for (const roomName of roomNames) {
      const room = await request(app.getHttpServer())
        .post(`${url}/room-types/${roomType.body.id}/rooms`)
        .set('Cookie', cookie)
        .send({ name: `${name} ${roomName}` })
        .expect(201);
      rooms.push({ id: room.body.id, name: room.body.name });
    }
    return { id: roomType.body.id, rooms };
  }

  async function completeGuestJourney(
    url: string,
    dates: { startsOn: string; endsOn: string },
    select: (catalog: Catalog) => { ratePlanId: string; roomId?: string; roomTypeId: string },
  ) {
    const catalogResponse = await request(app.getHttpServer())
      .get(`${url}/public/catalog`)
      .query(dates)
      .expect(200);
    const catalog = catalogResponse.body as Catalog;
    const setCookies = catalogResponse.headers['set-cookie'] as unknown;
    const guestCookie = Array.isArray(setCookies)
      ? setCookies.find((value) => value.startsWith('must_guest_session='))
      : typeof setCookies === 'string' && setCookies.startsWith('must_guest_session=')
        ? setCookies
        : undefined;
    if (!guestCookie) throw new Error('Public catalog did not establish a guest session.');
    const selection = select(catalog);
    const quote = await request(app.getHttpServer())
      .post(`${url}/quotes`)
      .set('Cookie', guestCookie)
      .send({ ...dates, ...selection })
      .expect(201);
    const booking = await request(app.getHttpServer())
      .post(`${url}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        ...dates,
        ...selection,
        guest: {
          email: `integration-guest-${randomUUID()}@example.test`,
          firstName: 'Integration',
          lastName: 'Guest',
          phone: null,
        },
        total: quote.body.total,
        quoteToken: quote.body.quoteToken,
        paymentMethod: 'pay_at_hotel',
      })
      .expect(201);
    return { booking: booking.body, catalog, quote: quote.body };
  }

  async function createAvailabilityBlock(
    url: string,
    body: {
      startsOn: string;
      endsOn: string;
      all?: boolean;
      roomIds?: string[];
      roomTypeIds?: string[];
    },
  ) {
    await request(app.getHttpServer())
      .post(`${url}/availability-blocks`)
      .set('Cookie', cookie)
      .send(body)
      .expect(201);
  }

  async function expectCatalogRooms(
    url: string,
    dates: { startsOn: string; endsOn: string },
    expected: Array<{ id: string; isAvailable: boolean }>,
  ) {
    const catalog = await request(app.getHttpServer())
      .get(`${url}/public/catalog`)
      .query(dates)
      .expect(200);
    const rooms = (catalog.body as Catalog).roomTypes.flatMap((roomType) => roomType.rooms ?? []);
    expect(rooms).toEqual(
      expect.arrayContaining(expected.map((room) => expect.objectContaining(room))),
    );
  }

  async function expectPooledAvailability(
    pooled: PropertyFixture,
    dates: { startsOn: string; endsOn: string },
    availableUnits: number,
  ) {
    await request(app.getHttpServer())
      .get(`${pooled.url}/public/availability`)
      .query({ ...dates, roomTypeId: pooled.standard.id })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ isAvailable: true, availableUnits });
      });
  }
});
