import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockBookingHydrationService } from '../src/integrations/clock/clock-booking-hydration.service';
import { ClockHttpClient, type ClockResponse } from '../src/integrations/clock/clock-http-client';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

// Real captured GET /bookings/{id} response (Empire Beach Resort, 2026-09-03
// — see docs/CLOCK_WEBHOOK_FLOW.md), trimmed to the fields this service
// reads. Only ClockHttpClient is stubbed (same pattern as
// clock-webhook.e2e.spec.ts's ClockWebhookVerificationService override) —
// everything else (real DB, real catalog-mapping lookup, real shadow rate
// plan auto-creation, real upsert/idempotency, real guest resolution) runs
// for real.
function realBookingDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 38144004,
    number: '364',
    arrival: '2026-09-23',
    departure: '2026-09-24',
    status: 'expected',
    adults: 1,
    children: 1,
    arrival_room_type_id: 42023,
    arrival_room_id: 606441,
    current_room_id: 606441,
    total_booking_value: { cents: 45000, currency: 'EUR' },
    rate_calculation: [{ date: '2026-09-23', cents: 45000, currency: 'EUR' }],
    guest_e_mail: '',
    guest_first_name: '',
    guest_last_name: '',
    ...overrides,
  };
}

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('Clock booking hydration', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let connectionId: string;
  let pmsPlanId: string;
  let roomTypeId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-hydration-${randomUUID()}@example.test`;
  let queuedResponses: ClockResponse[] = [];
  const httpClientStub: Pick<ClockHttpClient, 'request'> = {
    request: async <T = unknown>() => {
      const next = queuedResponses.shift();
      if (!next) throw new Error('No stubbed Clock response queued.');
      return next as ClockResponse<T>;
    },
  };
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
      .overrideProvider(ClockHttpClient)
      .useValue(httpClientStub)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const signup = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Clock Hydration Hotel',
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
      VALUES (${pmsPlanId}::uuid, ${'Clock Hydration Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const connection = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Hydration Test Clock',
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
    await admin.$executeRaw`
      INSERT INTO clock_catalog_mappings
        (tenant_id, property_id, connection_id, entity_type, external_entity_id, external_name, sync_status, local_entity_id)
      VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${connectionId}::uuid, 'ROOM_TYPE'::"ClockCatalogEntityType",
        '42023', 'Standard Rooms', 'CONFIRMED'::"ClockSyncStatus", ${roomTypeId}::uuid)
    `;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('mirrors a real Clock booking into a local shadow booking, auto-creating its shadow rate plan', async () => {
    queuedResponses = [{ status: 200, body: realBookingDetail() }];
    const hydration = app!.get(ClockBookingHydrationService);

    const outcome = await hydration.hydrateBooking(tenantId, propertyId, connectionId, '38144004');
    expect(outcome.outcome).toBe('created');
    expect(outcome).toHaveProperty('bookingId');

    const rows = await admin.$queryRaw<
      Array<{
        status: string;
        externalReference: string;
        externalBookingId: string;
        startsOn: Date;
        endsOn: Date;
        totalAmount: string;
        guestCount: number;
        paymentMethod: string;
        guestId: string | null;
        ratePlanId: string;
      }>
    >`
      SELECT status, external_reference AS "externalReference", external_booking_id AS "externalBookingId",
        starts_on AS "startsOn", ends_on AS "endsOn", total_amount AS "totalAmount", guest_count AS "guestCount",
        payment_method AS "paymentMethod", guest_id AS "guestId", rate_plan_id AS "ratePlanId"
      FROM bookings WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND external_booking_id = '38144004'
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('CONFIRMED');
    expect(row.externalReference).toBe('CLOCK-364');
    expect(row.totalAmount).toBe('450.00');
    expect(row.guestCount).toBe(2);
    expect(row.paymentMethod).toBe('PAY_AT_HOTEL');
    expect(row.guestId).toBeNull(); // real captured response had a blank guest email

    const shadowRatePlan = await admin.$queryRaw<
      Array<{ id: string; clockShadowRoomTypeId: string }>
    >`
      SELECT id, clock_shadow_room_type_id AS "clockShadowRoomTypeId" FROM rate_plans
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND clock_shadow_room_type_id = ${roomTypeId}::uuid
    `;
    expect(shadowRatePlan).toHaveLength(1);
    expect(row.ratePlanId).toBe(shadowRatePlan[0]!.id);
  });

  it('is idempotent — re-hydrating the same Clock booking updates the same row instead of duplicating', async () => {
    queuedResponses = [{ status: 200, body: realBookingDetail({ departure: '2026-09-25' }) }];
    const hydration = app!.get(ClockBookingHydrationService);

    const outcome = await hydration.hydrateBooking(tenantId, propertyId, connectionId, '38144004');
    expect(outcome.outcome).toBe('updated');

    const rows = await admin.$queryRaw<Array<{ id: string; endsOn: Date }>>`
      SELECT id, ends_on AS "endsOn" FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND external_booking_id = '38144004'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endsOn.toISOString().slice(0, 10)).toBe('2026-09-25');
  });

  it('creates a real Guest when Clock has captured a real email, reusing it on re-hydration', async () => {
    queuedResponses = [
      {
        status: 200,
        body: realBookingDetail({
          id: 38144005,
          number: '365',
          guest_e_mail: `hydration-guest-${randomUUID()}@example.test`,
          guest_first_name: 'Ada',
          guest_last_name: 'Lovelace',
        }),
      },
    ];
    const hydration = app!.get(ClockBookingHydrationService);

    const outcome = await hydration.hydrateBooking(tenantId, propertyId, connectionId, '38144005');
    expect(outcome.outcome).toBe('created');

    const rows = await admin.$queryRaw<Array<{ guestId: string | null }>>`
      SELECT guest_id AS "guestId" FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND external_booking_id = '38144005'
    `;
    expect(rows[0]!.guestId).not.toBeNull();
  });

  it('raises a MISSING_MAPPING review item and creates no booking when the room type is unmapped', async () => {
    queuedResponses = [
      {
        status: 200,
        body: realBookingDetail({ id: 99999999, number: '999', arrival_room_type_id: 77777 }),
      },
    ];
    const hydration = app!.get(ClockBookingHydrationService);

    const outcome = await hydration.hydrateBooking(tenantId, propertyId, connectionId, '99999999');
    expect(outcome.outcome).toBe('missing_room_type_mapping');

    const bookingRows = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM bookings WHERE tenant_id = ${tenantId}::uuid AND external_booking_id = '99999999'
    `;
    expect(bookingRows).toHaveLength(0);

    const reviewRows = await admin.$queryRaw<Array<{ category: string; referenceId: string }>>`
      SELECT category, reference_id AS "referenceId" FROM manual_review_items
      WHERE tenant_id = ${tenantId}::uuid AND reference_type = 'clock_booking' AND reference_id = '99999999'
    `;
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]!.category).toBe('MISSING_MAPPING');
  });
});
