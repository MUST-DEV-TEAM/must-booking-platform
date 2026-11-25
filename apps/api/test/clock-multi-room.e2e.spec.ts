import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { QuoteService } from '../src/booking/quote.service';
import { MultiRoomBookingService } from '../src/booking/multi-room-booking.service';
import { ClockHttpClient } from '../src/integrations/clock/clock-http-client';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { STAY_STARTS_ON, STAY_ENDS_ON } from './helpers/future-stay';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';
import { paceClockRequests } from './helpers/clock-pacing';

const sandboxCredentials = () => {
  const url = new URL(process.env.CLOCK_SANDBOX_PMS_API_URL!);
  const [, , accountId, subscriptionId] = url.pathname.split('/');
  return {
    host: url.host,
    accountId: accountId!,
    subscriptionId: subscriptionId!,
    apiUser: process.env.CLOCK_SANDBOX_API_USER!,
    apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
  };
};

// G-39 against the REAL Clock sandbox: a guest multi-room order on a Clock hotel creates one real Clock
// reservation per room, with and without a coupon on each room. Everything is cancelled for real afterwards.
const hasSandboxCredentials =
  !!process.env.CLOCK_SANDBOX_API_USER &&
  !!process.env.CLOCK_SANDBOX_API_KEY &&
  !!process.env.CLOCK_SANDBOX_PMS_API_URL;

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe.skipIf(!hasSandboxCredentials)('Clock multi-room orders (G-39, real sandbox)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let pmsPlanId: string;
  let cookie: string;
  let verificationToken = '';
  let ratePlanId: string;
  let localRoomTypeId: string;
  const email = `clock-multi-room-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
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
    paceClockRequests();
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

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Clock Multi Room Hotel',
        propertyName: 'Main Property',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    await request(app.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'Clock Multi Room Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const url = new URL(process.env.CLOCK_SANDBOX_PMS_API_URL!);
    const [, , accountId, subscriptionId] = url.pathname.split('/');
    const tenantUrl = `/tenants/${tenantId}`;
    const connection = await request(app.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Multi Room Clock',
        credentials: {
          host: url.host,
          accountId,
          subscriptionId,
          apiUser: process.env.CLOCK_SANDBOX_API_USER!,
          apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${connection.body.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);
    await request(app.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/clock-catalog/sync`)
      .set('Cookie', cookie)
      .expect(201);
    const mappings = await request(app.getHttpServer())
      .get(`${tenantUrl}/properties/${propertyId}/clock-catalog/mappings`)
      .set('Cookie', cookie)
      .expect(200);
    const dblMapping = mappings.body.find(
      (m: { entityType: string; externalName: string }) =>
        m.entityType === 'ROOM_TYPE' && m.externalName === 'DBL',
    );
    expect(dblMapping).toBeDefined();
    await request(app.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/clock-catalog/mappings/${dblMapping.id}/confirm`)
      .set('Cookie', cookie)
      .expect(201);
    const localRoomType = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_types WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid LIMIT 1
    `;
    localRoomTypeId = localRoomType[0]!.id;
    ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency, is_active)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rate', 'EUR', true)
    `;
    await request(app.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);
  });

  afterAll(async () => {
    // Cleanup real sandbox reservations even when an assertion fails mid-test.
    if (app && tenantId && propertyId) {
      const remaining = await admin.$queryRaw<{ externalBookingId: string }[]>`
        SELECT external_booking_id AS "externalBookingId" FROM bookings
        WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
          AND external_booking_id IS NOT NULL AND status<>'CANCELLED'`;
      for (const row of remaining) {
        const result = await app
          .get(ClockBookingService)
          .cancelRealReservation({ tenantId, propertyId }, row.externalBookingId);
        expect(result.ok).toBe(true);
      }
    }
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  async function placeOrder(withCoupon: boolean) {
    const sessionId = randomUUID();
    const quotes = app!.get(QuoteService);
    const quoteInput = {
      roomTypeId: localRoomTypeId,
      ratePlanId,
      startsOn: STAY_STARTS_ON,
      endsOn: STAY_ENDS_ON,
      adults: 1,
      children: 0,
      ...(withCoupon ? { promoCode: 'TWIN10' } : {}),
    };
    const first = await quotes.create(tenantId, propertyId, sessionId, quoteInput);
    const second = await quotes.create(tenantId, propertyId, sessionId, quoteInput);
    return app!.get(MultiRoomBookingService).create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        startsOn: STAY_STARTS_ON,
        endsOn: STAY_ENDS_ON,
        quoteSessionId: sessionId,
        paymentMethod: 'pay_at_hotel',
        guest: {
          email: `clock-multi-room-guest-${randomUUID()}@example.test`,
          firstName: 'Multi',
          lastName: 'Room',
          phone: null,
        },
        rooms: [first, second].map((quote) => ({
          roomTypeId: localRoomTypeId,
          ratePlanId,
          adults: 1,
          children: 0,
          total: quote.total,
          quoteToken: quote.quoteToken,
          ...(withCoupon ? { promoCode: 'TWIN10' } : {}),
        })),
      },
    );
  }

  async function expectRealClockReservations(orderReference: string, expected: number) {
    const rows = await admin.$queryRaw<
      Array<{ status: string; externalBookingId: string | null; promo: string | null }>
    >`SELECT status::text, external_booking_id AS "externalBookingId", promo_code AS promo FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${orderReference}
      ORDER BY order_room_number`;
    expect(rows).toHaveLength(expected);
    const clock = app!.get(ClockHttpClient);
    for (const row of rows) {
      expect(row.status).toBe('CONFIRMED');
      expect(row.externalBookingId).toMatch(/^\d+$/);
      const remote = await clock.request<{ status: string }>(sandboxCredentials(), {
        api: 'pms_api',
        method: 'GET',
        path: `/bookings/${row.externalBookingId}`,
      });
      expect(remote.status).toBe(200);
      expect((remote.body as { status: string }).status).not.toBe('canceled');
    }
    return rows;
  }

  async function cancelOrder(orderReference: string) {
    const anchor = await admin.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT id::text, version FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${orderReference} AND order_room_number = 1`;
    await admin.$executeRaw`UPDATE properties SET free_cancellation_days_before_arrival = 0 WHERE id = ${propertyId}::uuid`;
    const { LocalPmsProvider } = await import('../src/booking/local-pms.provider');
    const result = await app!.get(LocalPmsProvider).cancelBooking(
      { tenantId, propertyId },
      {
        idempotencyKey: `clock-multi-room-cancel-${randomUUID()}`,
        bookingId: anchor[0]!.id,
        guestSessionId: null as unknown as string,
        staffActorId: userId,
        expectedVersion: anchor[0]!.version,
        reason: 'Multi-room e2e cleanup.',
      },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }

  it('creates one real Clock reservation per room of an order, then cancels them', async () => {
    const order = await placeOrder(false);
    expect(order.ok, JSON.stringify(order)).toBe(true);
    if (!order.ok) return;
    await expectRealClockReservations(order.value.orderReference, 2);
    await cancelOrder(order.value.orderReference);
  }, 240_000);

  it('accepts a coupon on every room of an order on a Clock hotel and still books both rooms in Clock', async () => {
    await request(app!.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/promo-codes`)
      .set('Cookie', cookie)
      .send({ code: 'TWIN10', kind: 'PERCENT', value: 10 })
      .expect(201);
    const order = await placeOrder(true);
    expect(order.ok, JSON.stringify(order)).toBe(true);
    if (!order.ok) return;
    const rows = await expectRealClockReservations(order.value.orderReference, 2);
    expect(rows.every((row) => row.promo === 'TWIN10')).toBe(true);
    await cancelOrder(order.value.orderReference);
  }, 240_000);

  it('lets staff book several rooms in one order (staff channel) and creates one real Clock reservation per room', async () => {
    const response = await request(app!.getHttpServer())
      .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings/orders`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .send({
        startsOn: STAY_STARTS_ON,
        endsOn: STAY_ENDS_ON,
        paymentMethod: 'pay_at_hotel',
        guest: {
          email: `staff-order-guest-${randomUUID()}@example.test`,
          firstName: 'Staff',
          lastName: 'Order',
          phone: '+355690000000',
        },
        rooms: [
          { roomTypeId: localRoomTypeId, ratePlanId, adults: 1, children: 0 },
          {
            roomTypeId: localRoomTypeId,
            ratePlanId,
            adults: 1,
            children: 0,
            guest: { firstName: 'Second', lastName: 'Sleeper' },
          },
        ],
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.ok, JSON.stringify(response.body)).toBe(true);
    const orderReference = response.body.value.orderReference as string;
    const rows = await expectRealClockReservations(orderReference, 2);
    const meta = await admin.$queryRaw<Array<{ source: string; roomGuest: string | null }>>`
      SELECT source::text, room_guest_last_name AS "roomGuest" FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${orderReference} ORDER BY order_room_number`;
    expect(meta.map((row) => row.source)).toEqual(['DIRECT', 'DIRECT']);
    expect(meta[1]!.roomGuest).toBe('Sleeper');
    expect(rows).toHaveLength(2);
    await cancelOrder(orderReference);
  }, 240_000);

  it('lets staff cancel one room of an order on its own: only that room goes in MUST and in Clock, the other stays booked', async () => {
    const order = await placeOrder(false);
    expect(order.ok, JSON.stringify(order)).toBe(true);
    if (!order.ok) return;
    const reference = order.value.orderReference;
    await expectRealClockReservations(reference, 2);
    await admin.$executeRaw`UPDATE properties SET free_cancellation_days_before_arrival = 0 WHERE id = ${propertyId}::uuid`;
    const rooms = await admin.$queryRaw<
      Array<{ id: string; version: number; externalBookingId: string }>
    >`SELECT id::text, version, external_booking_id AS "externalBookingId" FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${reference} ORDER BY order_room_number`;
    const { LocalPmsProvider } = await import('../src/booking/local-pms.provider');
    const cancelRoom = (room: { id: string; version: number }) =>
      app!.get(LocalPmsProvider).cancelBooking(
        { tenantId, propertyId },
        {
          idempotencyKey: `clock-one-room-cancel-${randomUUID()}`,
          bookingId: room.id,
          guestSessionId: null as unknown as string,
          staffActorId: userId,
          expectedVersion: room.version,
          reason: 'One room of the order is cancelled.',
          singleBooking: true,
        },
      );
    const second = await cancelRoom(rooms[1]!);
    expect(second.ok, JSON.stringify(second)).toBe(true);

    const states = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM bookings WHERE tenant_id = ${tenantId}::uuid AND order_reference = ${reference} ORDER BY order_room_number`;
    expect(states.map((row) => row.status)).toEqual(['CONFIRMED', 'CANCELLED']);
    const clock = app!.get(ClockHttpClient);
    const remote = async (id: string) =>
      (
        (
          await clock.request<{ status: string }>(sandboxCredentials(), {
            api: 'pms_api',
            method: 'GET',
            path: `/bookings/${id}`,
          })
        ).body as { status: string }
      ).status;
    expect(await remote(rooms[1]!.externalBookingId)).toBe('canceled');
    expect(await remote(rooms[0]!.externalBookingId)).not.toBe('canceled');

    // The first room can still be cancelled by itself afterwards.
    const fresh = await admin.$queryRaw<Array<{ id: string; version: number }>>`
      SELECT id::text, version FROM bookings WHERE id = ${rooms[0]!.id}::uuid`;
    const first = await cancelRoom(fresh[0]!);
    expect(first.ok, JSON.stringify(first)).toBe(true);
    expect(await remote(rooms[0]!.externalBookingId)).toBe('canceled');
  }, 240_000);
});
