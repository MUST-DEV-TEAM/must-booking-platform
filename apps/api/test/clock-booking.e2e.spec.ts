import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

// Milestone 11 Task 10's real-sandbox gate. Booking CRUD isn't reachable
// through an HTTP endpoint yet (same reason as Task 8's getAvailability —
// ClockPmsProvider isn't the DI-bound PMS_PROVIDER), so this exercises the
// real service directly out of the app's DI container.
//
// The demo sandbox account has no rate/availability configured for any room
// type (confirmed during this task's research — see docs/CLOCK_ENDPOINT_MATRIX.md)
// and its API user lacks the "Booking: Rate Availability Control Override"
// right, so a real booking CREATE always comes back as a clean validation
// rejection from Clock, never a success. That rejection path (and the
// idempotency replay around it) is exactly what this test verifies for
// real — update/cancel against an actually-confirmed Clock booking could
// not be exercised in this account and remains a gap for Task 16 or once
// the account is reconfigured.
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

describe.skipIf(!hasSandboxCredentials)('Clock booking CRUD (real sandbox)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let pmsPlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-booking-${randomUUID()}@example.test`;
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
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('rejects a booking Clock has no availability for, cleanly and idempotently', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Clock Booking Hotel',
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
      VALUES (${pmsPlanId}::uuid, ${'Clock Booking Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const url = new URL(process.env.CLOCK_SANDBOX_PMS_API_URL!);
    const [, , accountId, subscriptionId] = url.pathname.split('/');
    const tenantUrl = `/tenants/${tenantId}`;

    await request(app!.getHttpServer())
      .post(`${tenantUrl}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Sandbox Clock',
        credentials: {
          host: url.host,
          accountId,
          subscriptionId,
          apiUser: process.env.CLOCK_SANDBOX_API_USER!,
          apiKey: process.env.CLOCK_SANDBOX_API_KEY!,
        },
      })
      .expect(201)
      .then((connection) =>
        request(app!.getHttpServer())
          .patch(
            `${tenantUrl}/properties/${propertyId}/integration-connections/${connection.body.id}`,
          )
          .set('Cookie', cookie)
          .send({ enabled: true })
          .expect(200),
      );

    await request(app!.getHttpServer())
      .post(`${tenantUrl}/properties/${propertyId}/clock-catalog/sync`)
      .set('Cookie', cookie)
      .expect(201);
    const mappings = await request(app!.getHttpServer())
      .get(`${tenantUrl}/properties/${propertyId}/clock-catalog/mappings`)
      .set('Cookie', cookie)
      .expect(200);
    const roomTypeMapping = mappings.body.find(
      (m: { entityType: string }) => m.entityType === 'ROOM_TYPE',
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
    const ratePlanId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency, is_active)
      VALUES (${ratePlanId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard Rate', 'EUR', true)
    `;

    const bookingService = app!.get(ClockBookingService);
    const context = { tenantId, propertyId };
    const idempotencyKey = `clock-booking-e2e-${randomUUID()}`;
    const command = {
      idempotencyKey,
      externalReference: `must-e2e-${randomUUID()}`,
      roomTypeId: localRoomType[0]!.id,
      ratePlanId,
      startsOn: '2026-09-15',
      endsOn: '2026-09-17',
      guest: { email: 'guest@example.test', firstName: 'E2E', lastName: 'Guest', phone: null },
      total: { amount: '100.00', currency: 'EUR' },
    };

    const first = await bookingService.createBooking(context, command);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.error.retryable).toBe(false);
      expect(first.error.message.length).toBeGreaterThan(0);
    }

    const bookingRow = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    expect(bookingRow[0]?.status).toBe('PMS_REJECTED');

    // Idempotency: the exact same key + request replays the stored result
    // rather than calling Clock (and therefore creating a second row) again.
    const replay = await bookingService.createBooking(context, command);
    expect(replay).toEqual(first);
    const bookingRowsAfterReplay = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    expect(bookingRowsAfterReplay.length).toBe(1);

    const operation = await admin.$queryRaw<Array<{ attempts: number; status: string }>>`
      SELECT attempts, status FROM integration_operations
      WHERE tenant_id = ${tenantId}::uuid AND idempotency_key = ${idempotencyKey}
    `;
    expect(operation[0]?.status).toBe('FAILED');
    expect(operation[0]?.attempts).toBe(2);
  }, 30_000);
});
