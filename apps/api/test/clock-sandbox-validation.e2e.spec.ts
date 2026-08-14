import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockAvailabilityService } from '../src/integrations/clock/clock-availability.service';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

// Milestone 11 Task 16: the milestone's actual "done" gate — one chained
// real-sandbox flow covering connect, sync catalog, confirm mappings, check
// availability, create a real booking, cancel it. See
// docs/CLOCK_SANDBOX_VALIDATION_REPORT.md for the Definition of Done
// checklist this test backs.
//
// 2026-08-05: this now runs the full flow to a genuine Clock-confirmed
// success. What used to look like an account limitation (no rate/availability
// data, missing "Rate Availability Control Override" right) traced to a real
// code bug: booking creation used the Clock *rate plan* id (`/rate_plans`, a
// parent grouping) as the booking's `rate_id`, instead of the room-type-scoped
// *rate* id from `/rates/` (Clock's own docs: "1 Rate belongs to 1 Room
// Type"). DBL is the room type confirmed to have a real Clock rate.
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

describe.skipIf(!hasSandboxCredentials)('Clock sandbox validation (Task 16, real sandbox)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let pmsPlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-sandbox-validation-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
    async sendPasswordResetEmail() {},
    async sendPaymentConfirmationEmail() {},
    async sendNewBookingStaffNotification() {},
    async sendRefundConfirmationEmail() {},
    async sendBookingCancelledEmail() {},
    async sendBookingCancelledStaffNotification() {},
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
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('connects, syncs, confirms, checks availability, and attempts a booking create/cancel end to end', async () => {
    // 1. Connect: signup, plan, real Clock credentials.
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Clock Sandbox Validation Hotel',
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
    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);

    pmsPlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, pms_enabled, max_pms_connections_per_property)
      VALUES (${pmsPlanId}::uuid, ${'Clock Sandbox Validation Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const url = new URL(process.env.CLOCK_SANDBOX_PMS_API_URL!);
    const [, , accountId, subscriptionId] = url.pathname.split('/');
    const tenantUrl = `/tenants/${tenantId}`;

    const connection = await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Sandbox Validation Clock',
        credentials: {
          host: url.host,
          accountId,
          subscriptionId,
          apiUser: process.env.CLOCK_SANDBOX_API_USER!,
          apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
        },
      })
      .expect(201);
    expect(connection.body.webhookPublicId).toMatch(/^[0-9a-f-]{36}$/);
    await request(app!.getHttpServer())
      .patch(`${tenantUrl}/properties/${propertyId}/integration-connections/${connection.body.id}`)
      .set('Cookie', cookie)
      .send({ enabled: true })
      .expect(200);

    // 1b. testConnection: real Digest-authenticated call succeeds.
    const testResult = await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections/${connection.body.id}/test`)
      .set('Cookie', cookie)
      .expect(201);
    expect(testResult.body.status).toBe('CONNECTED');

    // 2. Sync catalog: real room types/rooms fetched and staged as PROPOSED.
    const sync = await request(app!.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/clock-catalog/sync`)
      .set('Cookie', cookie)
      .expect(201);
    expect(sync.body.proposed + sync.body.updated).toBeGreaterThan(0);

    // 3. Confirm mappings: PROPOSED -> CONFIRMED creates real local rows.
    const mappings = await request(app!.getHttpServer())
      .get(`${tenantUrl}/properties/${propertyId}/clock-catalog/mappings`)
      .set('Cookie', cookie)
      .expect(200);
    // DBL is confirmed (2026-08-05) to have a real Clock rate and real
    // availability — target it by name for a deterministic assertion.
    const roomTypeMapping = mappings.body.find(
      (m: { entityType: string; externalName: string }) =>
        m.entityType === 'ROOM_TYPE' && m.externalName === 'DBL',
    );
    expect(roomTypeMapping).toBeDefined();
    await request(app!.getHttpServer())
      .post(
        `${tenantUrl}/properties/${propertyId}/clock-catalog/mappings/${roomTypeMapping.id}/confirm`,
      )
      .set('Cookie', cookie)
      .expect(201);
    const localRoomType = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM room_types WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid LIMIT 1
    `;
    expect(localRoomType[0]).toBeDefined();

    // 4. Check availability: real /rates_availability call against DBL,
    // which has real rate/price data configured in this sandbox.
    const availability = app!.get(ClockAvailabilityService);
    const availabilityResult = await availability.getAvailability(tenantId, propertyId, {
      roomTypeId: localRoomType[0]!.id,
      startsOn: '2026-08-16',
      endsOn: '2026-08-18',
    });
    expect(availabilityResult.ok).toBe(true);
    if (availabilityResult.ok) expect(availabilityResult.value.isAvailable).toBe(true);

    // 5. Create a real booking. Genuine Clock-confirmed success.
    const ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency, is_active)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rate', 'EUR', true)
    `;
    const bookingService = app!.get(ClockBookingService);
    const context = { tenantId, propertyId };
    const createResult = await bookingService.createBooking(context, {
      idempotencyKey: `clock-sandbox-validation-${randomUUID()}`,
      externalReference: `must-validation-${randomUUID()}`,
      roomTypeId: localRoomType[0]!.id,
      ratePlanId,
      startsOn: '2026-08-16',
      endsOn: '2026-08-18',
      guest: {
        email: 'validation-guest@example.test',
        firstName: 'Val',
        lastName: 'Guest',
        phone: null,
      },
      total: { amount: '100.00', currency: 'EUR' },
    });
    expect(createResult.ok).toBe(true);
    if (createResult.ok) expect(createResult.value.externalBookingId).toMatch(/^\d+$/);

    const bookingRow = await admin.$queryRaw<
      Array<{ id: string; status: string; externalBookingId: string | null }>
    >`
      SELECT id, status, external_booking_id AS "externalBookingId" FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    expect(bookingRow[0]?.status).toBe('CONFIRMED');
    expect(bookingRow[0]?.externalBookingId).toMatch(/^\d+$/);

    // 6. Cancel: real Clock-side cancellation (lock_version re-fetch + PUT
    // status=canceled) against a real, Clock-confirmed booking.
    const cancelResult = await bookingService.cancelBooking(context, {
      idempotencyKey: `clock-sandbox-validation-cancel-${randomUUID()}`,
      bookingId: bookingRow[0]!.id,
      expectedVersion: 1,
      reason: 'Sandbox validation — end-to-end cleanup.',
    });
    expect(cancelResult.ok).toBe(true);
    const cancelledRow = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings WHERE id = ${bookingRow[0]!.id}::uuid
    `;
    expect(cancelledRow[0]?.status).toBe('CANCELLED');
  }, 60_000);
});
