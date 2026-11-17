import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockStaleStayCheckService } from '../src/integrations/clock/clock-stale-stay-check.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('Clock stale stay check', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let connectionId: string;
  let pmsPlanId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-cancel-${randomUUID()}@example.test`;
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
        organizationName: 'Clock Cancel Hotel',
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
      VALUES (${pmsPlanId}::uuid, ${'Clock Cancel Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const connection = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Cancel Test Clock',
        credentials: { host: 'h', accountId: '1', subscriptionId: '2', apiUser: 'u', apiKey: 'k' },
      })
      .expect(201);
    connectionId = connection.body.id;
    await request(app.getHttpServer())
      .patch(
        `/tenants/${tenantId}/properties/${propertyId}/integration-connections/${connectionId}`,
      )
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    roomTypeId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomTypeId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rooms', 2)
    `;
    ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Test Plan', 'EUR')
    `;
    await admin.$executeRaw`UPDATE integration_connections SET status = 'CONNECTED' WHERE id = ${connectionId}::uuid`;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  const scope = () => ({ tenantId, propertyId });

  async function newBooking(opts: {
    daysAgo: number;
    status?: string;
    stay?: string | null;
    external?: string | null;
  }) {
    const id = randomUUID();
    const external =
      opts.external === undefined ? String(Math.floor(Math.random() * 1e9)) : opts.external;
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, external_reference, external_booking_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, adults, children,
        guest_count, pms_stay_status
      ) VALUES (
        ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${'REF-' + id.slice(0, 8)}, ${external},
        ${opts.status ?? 'CONFIRMED'}::"BookingStatus", 'PAY_AT_HOTEL',
        current_date - ${opts.daysAgo}::int, current_date - ${opts.daysAgo - 1}::int,
        ${ratePlanId}::uuid, 100.00, 2, 0, 2, ${opts.stay === undefined ? 'expected' : opts.stay}
      )`;
    return id;
  }

  const notes = (bookingId: string) =>
    admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM manual_review_items
      WHERE tenant_id = ${tenantId}::uuid AND reference_id = ${bookingId}
        AND context->>'kind' = 'STAY_STILL_EXPECTED'`;
  const notices = (bookingId: string) =>
    admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM notifications WHERE tenant_id = ${tenantId}::uuid
        AND type = 'BOOKING_NEEDS_ATTENTION' AND payload->>'bookingId' = ${bookingId}`;

  it('flags a stay still expected 2+ days after arrival once, and closes the note when it changes', async () => {
    const service = app!.get(ClockStaleStayCheckService);
    const bookingId = await newBooking({ daysAgo: 10 });

    expect((await service.checkHotel(scope())).flagged).toBeGreaterThanOrEqual(1);
    expect(await notes(bookingId)).toEqual([{ status: 'OPEN' }]);
    expect(await notices(bookingId)).toHaveLength(1);

    // A second run adds nothing.
    await service.checkHotel(scope());
    expect(await notes(bookingId)).toHaveLength(1);
    expect(await notices(bookingId)).toHaveLength(1);

    await admin.$executeRaw`UPDATE bookings SET pms_stay_status = 'checked_in' WHERE id = ${bookingId}::uuid`;
    const result = await service.checkHotel(scope());
    expect(result.resolved).toBeGreaterThanOrEqual(1);
    expect(await notes(bookingId)).toEqual([{ status: 'RESOLVED' }]);
  });

  it('leaves alone a recent arrival, an old one, a real status, a cancelled booking and a local booking', async () => {
    const service = app!.get(ClockStaleStayCheckService);
    const ids = [
      await newBooking({ daysAgo: 1 }),
      await newBooking({ daysAgo: 90 }),
      await newBooking({ daysAgo: 10, stay: 'no_show' }),
      await newBooking({ daysAgo: 10, status: 'CANCELLED' }),
      await newBooking({ daysAgo: 10, external: null }),
    ];
    await service.checkHotel(scope());
    for (const id of ids) expect(await notes(id)).toHaveLength(0);
  });
});
