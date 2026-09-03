import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockFolioHydrationService } from '../src/integrations/clock/clock-folio-hydration.service';
import { ClockHttpClient, type ClockResponse } from '../src/integrations/clock/clock-http-client';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

// Real captured GET /folios/{id} response (Empire Beach Resort, 2026-09-03,
// base_api family — see docs/CLOCK_CERTIFICATION_GAPS_PLAN.md Task C),
// trimmed to the fields this service reads.
function realFolioDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 76090570,
    payer_type: 'Booking',
    payer_id: 38149736,
    balance: { cents: 45000, currency: 'EUR' },
    closed_at: null,
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

describe('Clock folio hydration (visibility only)', () => {
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
  const email = `clock-folio-${randomUUID()}@example.test`;
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
        organizationName: 'Clock Folio Hotel',
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
      VALUES (${pmsPlanId}::uuid, ${'Clock Folio Test Plan ' + pmsPlanId}, 10, 10, true, 5)
    `;
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${pmsPlanId}::uuid WHERE id = ${tenantId}::uuid`;

    const connection = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/integration-connections`)
      .set('Cookie', cookie)
      .send({
        kind: 'PMS',
        provider: 'CLOCK_PMS',
        name: 'Folio Test Clock',
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
    // A local shadow booking already hydrated (as ClockBookingHydrationService
    // would have created) — the folio service only ever updates an existing
    // booking, it never creates one.
    await admin.$executeRaw`
      INSERT INTO bookings (
        tenant_id, property_id, room_type_id, external_reference, external_booking_id,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount, guest_count
      ) VALUES (
        ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid, 'CLOCK-367', '38149736',
        'CONFIRMED', 'PAY_AT_HOTEL', '2026-09-30', '2026-10-01', ${ratePlanId}::uuid, 100.00, 3
      )
    `;
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('mirrors a real Clock folio onto the booking it belongs to, using payer_id — no separate lookup', async () => {
    queuedResponses = [{ status: 200, body: realFolioDetail() }];
    const folioHydration = app!.get(ClockFolioHydrationService);

    const outcome = await folioHydration.hydrateFolio(tenantId, propertyId, '76090570');
    expect(outcome).toEqual({ outcome: 'applied', bookingId: expect.any(String) });

    const rows = await admin.$queryRaw<
      Array<{
        clockFolioId: string;
        isDeposit: boolean;
        balance: string | null;
        closedAt: Date | null;
      }>
    >`
      SELECT clock_folio_id AS "clockFolioId", is_deposit AS "isDeposit",
        balance::text AS "balance", closed_at AS "closedAt"
      FROM clock_folios WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND clock_folio_id = '76090570'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isDeposit).toBe(false);
    expect(rows[0]!.balance).toBe('450.00');
    expect(rows[0]!.closedAt).toBeNull();
  });

  it('records a real close event, never touching payments/payment_provider_sessions', async () => {
    queuedResponses = [
      { status: 200, body: realFolioDetail({ closed_at: '2026-09-03T19:00:00.000Z' }) },
    ];
    const folioHydration = app!.get(ClockFolioHydrationService);

    const outcome = await folioHydration.hydrateFolio(tenantId, propertyId, '76090570');
    expect(outcome.outcome).toBe('applied');

    const rows = await admin.$queryRaw<Array<{ closedAt: Date | null }>>`
      SELECT closed_at AS "closedAt" FROM clock_folios
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid AND clock_folio_id = '76090570'
    `;
    expect(rows[0]!.closedAt).not.toBeNull();

    const payments = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM payments WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    expect(payments).toHaveLength(0);
  });

  it('keeps a deposit folio and a general folio for the same booking as two separate rows', async () => {
    queuedResponses = [
      { status: 200, body: realFolioDetail({ id: 76090571, deposit: true, balance: null }) },
    ];
    const folioHydration = app!.get(ClockFolioHydrationService);
    const depositOutcome = await folioHydration.hydrateFolio(tenantId, propertyId, '76090571');
    expect(depositOutcome).toEqual({ outcome: 'applied', bookingId: expect.any(String) });

    queuedResponses = [{ status: 200, body: realFolioDetail({ deposit: false }) }];
    const generalOutcome = await folioHydration.hydrateFolio(tenantId, propertyId, '76090570');
    expect(generalOutcome).toEqual({ outcome: 'applied', bookingId: expect.any(String) });

    const rows = await admin.$queryRaw<
      Array<{ clockFolioId: string; isDeposit: boolean; balance: string | null }>
    >`
      SELECT clock_folio_id AS "clockFolioId", is_deposit AS "isDeposit", balance::text AS "balance"
      FROM clock_folios WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND clock_folio_id IN ('76090570', '76090571')
      ORDER BY is_deposit DESC
    `;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ clockFolioId: '76090571', isDeposit: true, balance: null });
    expect(rows[1]).toMatchObject({
      clockFolioId: '76090570',
      isDeposit: false,
      balance: '450.00',
    });
  });

  it('skips a folio that does not belong to a single booking (visibility-only scope)', async () => {
    queuedResponses = [
      { status: 200, body: realFolioDetail({ id: 99999, payer_type: 'Company', payer_id: null }) },
    ];
    const folioHydration = app!.get(ClockFolioHydrationService);

    const outcome = await folioHydration.hydrateFolio(tenantId, propertyId, '99999');
    expect(outcome).toEqual({ outcome: 'not_a_booking_folio' });
  });

  it('reports booking_not_found when the folio references a Clock booking with no local shadow yet', async () => {
    queuedResponses = [{ status: 200, body: realFolioDetail({ id: 12345, payer_id: 999999999 }) }];
    const folioHydration = app!.get(ClockFolioHydrationService);

    const outcome = await folioHydration.hydrateFolio(tenantId, propertyId, '12345');
    expect(outcome).toEqual({ outcome: 'booking_not_found' });
  });
});
