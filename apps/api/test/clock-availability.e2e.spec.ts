import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { ClockAvailabilityService } from '../src/integrations/clock/clock-availability.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

// Milestone 11 Task 8's real-sandbox gate: getAvailability isn't reachable
// through an HTTP endpoint yet (ClockPmsProvider isn't the DI-bound
// PMS_PROVIDER — see clock-pms.provider.ts), so this exercises the real
// service directly out of the app's DI container, the same way it will be
// called once a property's PMS_PROVIDER actually resolves to Clock.
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

describe.skipIf(!hasSandboxCredentials)('Clock getAvailability (real sandbox)', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let pmsPlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `clock-availability-${randomUUID()}@example.test`;
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

  it('queries real Clock rate/availability for a confirmed, mapped room type', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Clock Availability Hotel',
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
      VALUES (${pmsPlanId}::uuid, ${'Clock Availability Test Plan ' + pmsPlanId}, 10, 10, true, 5)
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
    // Not every room type in this account has a Clock rate configured (Clock
    // allows 0..n rates per room type) — DBL is confirmed (2026-08-05) to have
    // a real rate (784160) and real availability, so target it by name for a
    // deterministic assertion rather than "whichever mapping comes first".
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

    const availability = app!.get(ClockAvailabilityService);
    const result = await availability.getAvailability(tenantId, propertyId, {
      roomTypeId: localRoomType[0].id,
      startsOn: '2026-08-16',
      endsOn: '2026-08-18',
    });

    // 2026-08-05: DBL has real rate/availability data configured in the
    // sandbox for these dates (confirmed directly against Clock, see
    // docs/CLOCK_SANDBOX_VALIDATION_REPORT.md) — this must be a genuine
    // success with real availability, not just a well-formed request.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.roomTypeId).toBe(localRoomType[0].id);
      expect(result.value.isAvailable).toBe(true);
      expect(result.value.availableUnits).toBeGreaterThan(0);
    }

    // Real live pricing via GET /products (this feature's own real-sandbox
    // proof) — same dates/room type as the availability assertion above.
    const quote = await availability.getQuote(tenantId, propertyId, {
      roomTypeId: localRoomType[0].id,
      startsOn: '2026-08-16',
      endsOn: '2026-08-18',
    });
    expect(quote.ok).toBe(true);
    if (quote.ok) {
      expect(Number(quote.value.amount)).toBeGreaterThan(0);
      expect(quote.value.currency).toBe('EUR');
    }

    // The same real price must be reachable through QuoteService.price() —
    // the actual entry point staff/guest booking flows call — proving the
    // Clock-connected branch is wired end to end, not just the raw service.
    const quoteService = app!.get((await import('../src/booking/quote.service')).QuoteService);
    const priced = await quoteService.price(tenantId, propertyId, {
      roomTypeId: localRoomType[0].id,
      startsOn: '2026-08-16',
      endsOn: '2026-08-18',
    });
    expect(Number(priced.amount)).toBeGreaterThan(0);
    expect(priced.currency).toBe('EUR');
    if (quote.ok) expect(priced.amount).toBe(quote.value.amount);

    // Whole-month calendar via a single real /rates_availability call
    // (previously only ever exercised with a 2-3 night range) — proves
    // Clock actually returns per-day data across a full month in one
    // request, and that the known-available 2026-08-16 shows up correctly
    // inside that larger result set.
    const calendar = await availability.getAvailabilityCalendar(tenantId, propertyId, {
      roomTypeId: localRoomType[0].id,
      month: '2026-08',
    });
    expect(calendar.ok).toBe(true);
    if (calendar.ok) {
      expect(calendar.value.length).toBe(31);
      expect(calendar.value[0]!.date).toBe('2026-08-01');
      expect(calendar.value.at(-1)!.date).toBe('2026-08-31');
      const knownAvailable = calendar.value.find((day) => day.date === '2026-08-16');
      expect(knownAvailable?.isAvailable).toBe(true);
    }
  }, 30_000);
});
