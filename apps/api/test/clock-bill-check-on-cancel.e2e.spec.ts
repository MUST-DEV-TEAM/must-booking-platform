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

describe('Clock bill check on cancel', () => {
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

  const jobs = (bookingId: string) =>
    admin.$queryRaw<Array<{ status: string; requestedAt: Date | null; nextRunAt: Date }>>`
      SELECT status, requested_at AS "requestedAt", next_run_at AS "nextRunAt" FROM clock_sync_jobs
      WHERE tenant_id = ${tenantId}::uuid AND resource = ${'financial:' + bookingId}`;

  async function newBooking(status: string, externalId: string) {
    const id = randomUUID();
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, external_reference, external_booking_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, adults, children, guest_count
      ) VALUES (
        ${id}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, ${'CLOCK-' + externalId}, ${externalId},
        ${status}::"BookingStatus", 'PAY_AT_HOTEL', '2026-09-30', '2026-10-01', ${ratePlanId}::uuid, 100.00, 2, 0, 2
      )`;
    return id;
  }

  it('queues the bill check when a confirmed Clock booking is cancelled, even if an old check exists', async () => {
    const bookingId = await newBooking('CONFIRMED', '9001');
    await admin.$executeRaw`INSERT INTO clock_sync_jobs (tenant_id, property_id, connection_id, resource, status, next_run_at)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${connectionId}::uuid, ${'financial:' + bookingId}, 'SYNCED', now() + interval '30 days')`;
    await admin.$executeRaw`UPDATE bookings SET status = 'CANCELLED' WHERE id = ${bookingId}::uuid`;
    const rows = await jobs(bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requestedAt).not.toBeNull();
    expect(rows[0]!.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it('queues nothing for a cancelled booking that is only imported as cancelled', async () => {
    const bookingId = await newBooking('CANCELLED', '9002');
    expect(await jobs(bookingId)).toHaveLength(0);
  });

  it('queues nothing for a booking that has no Clock booking', async () => {
    const bookingId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO bookings (id, tenant_id, property_id, room_type_id, external_reference, status, payment_method,
        starts_on, ends_on, rate_plan_id, total_amount, adults, children, guest_count)
      VALUES (${bookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, 'LOCAL-1',
        'CONFIRMED', 'PAY_AT_HOTEL', '2026-09-30', '2026-10-01', ${ratePlanId}::uuid, 100.00, 2, 0, 2)`;
    await admin.$executeRaw`UPDATE bookings SET status = 'CANCELLED' WHERE id = ${bookingId}::uuid`;
    expect(await jobs(bookingId)).toHaveLength(0);
  });
});
