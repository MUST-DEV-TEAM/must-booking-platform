import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { ClockHttpClient } from '../src/integrations/clock/clock-http-client';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

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

// Milestone 11.5 Tasks 4 and 5: real sandbox proof that a Clock-connected
// property's booking creation actually creates a real Clock reservation —
// once for the immediate (pay-at-hotel) path, once for the payment-gated
// (continueAfterPayment, the real path a Stripe/PokPay webhook drives)
// path. Both must attach the real Clock reservation to the SAME local
// booking row (never a duplicate), per ClockBookingService.attachRealReservation.
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

describe.skipIf(!hasSandboxCredentials)(
  'Clock payment-gated booking (Task 4, real sandbox)',
  () => {
    let app: INestApplication | undefined;
    let tenantId: string;
    let propertyId: string;
    let userId: string;
    let pmsPlanId: string;
    let cookie: string;
    let verificationToken = '';
    let ratePlanId: string;
    let localRoomTypeId: string;
    const email = `clock-payment-gated-${randomUUID()}@example.test`;
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

      const signup = await request(app.getHttpServer())
        .post('/auth/signup')
        .send({
          organizationName: 'Clock Payment Gated Hotel',
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
      VALUES (${pmsPlanId}::uuid, ${'Clock Payment Gated Plan ' + pmsPlanId}, 10, 10, true, 5)
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
          name: 'Payment Gated Clock',
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
        .patch(
          `${tenantUrl}/properties/${propertyId}/integration-connections/${connection.body.id}`,
        )
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
        .post(
          `${tenantUrl}/properties/${propertyId}/clock-catalog/mappings/${dblMapping.id}/confirm`,
        )
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
      // Test A goes through the real staff-bookings HTTP endpoint, which prices
      // via QuoteService — needs a real rate rule, unlike the direct-service
      // Clock tests that bypass quoting entirely.
      await request(app.getHttpServer())
        .post(`${tenantUrl}/properties/${propertyId}/rate-plans/${ratePlanId}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId: localRoomTypeId, startsOn: null, endsOn: null, amount: '250.00' })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`${tenantUrl}/properties/${propertyId}/payment-gateways`)
        .set('Cookie', cookie)
        .send({ stripe: false, pokpay: true, payAtHotel: true })
        .expect(200);
      // Local inventory is separate from Clock's own availability — the local
      // reservation step (before the Clock call) needs its own capacity.
      await admin.$executeRaw`
      INSERT INTO inventory_units (tenant_id, property_id, room_type_id, stays_on, available_units)
      VALUES
        (${tenantId}::uuid, ${propertyId}::uuid, ${localRoomTypeId}::uuid, '2026-08-16'::date, 5),
        (${tenantId}::uuid, ${propertyId}::uuid, ${localRoomTypeId}::uuid, '2026-08-17'::date, 5)
    `;
    });

    afterAll(async () => {
      if (tenantId) await cleanupTenant(admin, tenantId);
      if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
      if (pmsPlanId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${pmsPlanId}::uuid`;
      if (app) await app.close();
      await admin.$disconnect();
    });

    it('public catalog marks a Clock-mapped room type as not needing rate-plan selection', async () => {
      const catalog = await request(app!.getHttpServer())
        .get(`/tenants/${tenantId}/properties/${propertyId}/public/catalog`)
        .expect(200);
      const roomType = catalog.body.roomTypes.find(
        (candidate: { id: string }) => candidate.id === localRoomTypeId,
      );
      // requiresRatePlanSelection is what the plugin actually gates on; this
      // property's beforeAll also seeds a real local rate plan/rule on this
      // same room type (needed for the staff-bookings-priced test below), so
      // ratePlans itself isn't guaranteed empty here.
      expect(roomType).toMatchObject({ requiresRatePlanSelection: false });
    });

    it('pay-at-hotel: creates a real Clock reservation immediately, on the same local row, then cancels it for real', async () => {
      const created = await request(app!.getHttpServer())
        .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', `pay-at-hotel-${randomUUID()}`)
        .send({
          roomTypeId: localRoomTypeId,
          ratePlanId,
          startsOn: '2026-08-16',
          endsOn: '2026-08-18',
          paymentMethod: 'pay_at_hotel',
          guest: {
            email: 'pay-at-hotel-guest@example.test',
            firstName: 'PayAtHotel',
            lastName: 'Guest',
          },
        })
        .expect(201);
      expect(created.body.ok).toBe(true);
      const bookingId = created.body.value.id as string;

      const row = await admin.$queryRaw<
        Array<{ status: string; externalBookingId: string | null }>
      >`
      SELECT status, external_booking_id AS "externalBookingId" FROM bookings WHERE id = ${bookingId}::uuid
    `;
      expect(row[0]?.status).toBe('CONFIRMED');
      expect(row[0]?.externalBookingId).toMatch(/^\d+$/);

      // Milestone 11.5 Task 6: cancellation now always goes through
      // LocalPmsProvider directly (matching BookingController.cancel), which
      // calls ClockBookingService.cancelRealReservation as a sub-step — real
      // proof the Clock reservation itself gets cancelled, not just the local
      // row. This booking's arrival (2026-08-16) is inside the property's
      // default 21-day self-service window relative to real "now" — widen the
      // window to 0 so this cleanup cancel isn't blocked by the guard the
      // dedicated window-guard test below exercises.
      await admin.$executeRaw`
      UPDATE properties SET free_cancellation_days_before_arrival = 0 WHERE id = ${propertyId}::uuid
    `;
      const bookings = app!.get(LocalPmsProvider);
      const cancelResult = await bookings.cancelBooking(
        { tenantId, propertyId },
        {
          idempotencyKey: `pay-at-hotel-cancel-${randomUUID()}`,
          bookingId,
          // Staff-created bookings carry no guest session (staff-booking.controller
          // never passes quoteSessionId). CancelBookingCommand's type is
          // `string | undefined` (production callers always have a real
          // session id), but the comparison against the row is a strict
          // `!==`, so this test must pass the literal null to match.
          guestSessionId: null as unknown as string,
          expectedVersion: 1,
          reason: 'Task 4 e2e cleanup.',
        },
      );
      expect(cancelResult.ok).toBe(true);
      const cancelled = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings WHERE id = ${bookingId}::uuid
    `;
      expect(cancelled[0]?.status).toBe('CANCELLED');

      const clockCredentials = sandboxCredentials();
      const clockClient = app!.get(ClockHttpClient);
      const clockBooking = await clockClient.request<{ status: string }>(clockCredentials, {
        api: 'pms_api',
        method: 'GET',
        path: `/bookings/${row[0]!.externalBookingId}`,
      });
      expect(clockBooking.status).toBe(200);
      expect((clockBooking.body as { status: string }).status).toBe('canceled');
    }, 30_000);

    it('walk-in redesign: creates a booking with no ratePlanId, auto-resolving the Clock shadow rate plan', async () => {
      const shadowRatePlan = await admin.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT id, name FROM rate_plans
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND clock_shadow_room_type_id = ${localRoomTypeId}::uuid
      `;
      expect(shadowRatePlan[0]?.name).toBe('Clock: DBL');

      const created = await request(app!.getHttpServer())
        .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', `no-rate-plan-${randomUUID()}`)
        .send({
          roomTypeId: localRoomTypeId,
          startsOn: '2026-08-16',
          endsOn: '2026-08-18',
          paymentMethod: 'pay_at_hotel',
          guest: {
            email: 'no-rate-plan-guest@example.test',
            firstName: 'NoRate',
            lastName: 'Plan',
          },
        })
        .expect(201);
      expect(created.body.ok).toBe(true);
      const bookingId = created.body.value.id as string;

      const row = await admin.$queryRaw<
        Array<{ status: string; externalBookingId: string | null; ratePlanId: string }>
      >`
        SELECT status, external_booking_id AS "externalBookingId", rate_plan_id AS "ratePlanId"
        FROM bookings WHERE id = ${bookingId}::uuid
      `;
      expect(row[0]?.status).toBe('CONFIRMED');
      expect(row[0]?.externalBookingId).toMatch(/^\d+$/);
      expect(row[0]?.ratePlanId).toBe(shadowRatePlan[0]!.id);

      await admin.$executeRaw`
        UPDATE properties SET free_cancellation_days_before_arrival = 0 WHERE id = ${propertyId}::uuid
      `;
      const bookings = app!.get(LocalPmsProvider);
      const cancelResult = await bookings.cancelBooking(
        { tenantId, propertyId },
        {
          idempotencyKey: `no-rate-plan-cancel-${randomUUID()}`,
          bookingId,
          guestSessionId: null as unknown as string,
          expectedVersion: 1,
          reason: 'Task cleanup.',
        },
      );
      expect(cancelResult.ok).toBe(true);
    }, 30_000);

    it('self-service cancellation window: blocks a near-future booking and leaves the real Clock reservation untouched', async () => {
      // Restore the property's default window (the pay-at-hotel test above
      // widened it to 0 to avoid being blocked by this same guard).
      await admin.$executeRaw`
      UPDATE properties SET free_cancellation_days_before_arrival = 21 WHERE id = ${propertyId}::uuid
    `;
      const created = await request(app!.getHttpServer())
        .post(`/tenants/${tenantId}/properties/${propertyId}/staff-bookings`)
        .set('Cookie', cookie)
        .set('Idempotency-Key', `window-guard-${randomUUID()}`)
        .send({
          roomTypeId: localRoomTypeId,
          ratePlanId,
          startsOn: '2026-08-16',
          endsOn: '2026-08-18',
          paymentMethod: 'pay_at_hotel',
          guest: {
            email: 'window-guard-guest@example.test',
            firstName: 'Window',
            lastName: 'Guard',
          },
        })
        .expect(201);
      expect(created.body.ok).toBe(true);
      const bookingId = created.body.value.id as string;
      const row = await admin.$queryRaw<Array<{ externalBookingId: string | null }>>`
      SELECT external_booking_id AS "externalBookingId" FROM bookings WHERE id = ${bookingId}::uuid
    `;
      expect(row[0]?.externalBookingId).toMatch(/^\d+$/);

      // Property default is 21 days before arrival; the booking's arrival
      // (2026-08-16) is far closer than that to "now" in the test environment,
      // so self-service cancellation must be blocked before Clock is ever
      // called.
      const bookings = app!.get(LocalPmsProvider);
      const cancelResult = await bookings.cancelBooking(
        { tenantId, propertyId },
        {
          idempotencyKey: `window-guard-cancel-${randomUUID()}`,
          bookingId,
          // CancelBookingCommand's type is `string | undefined` (production
          // callers always have a real session id), but staff-created bookings
          // store a null guest_session_id — the comparison in cancelBooking is
          // a strict `!==`, so this test must pass the literal null to match.
          guestSessionId: null as unknown as string,
          expectedVersion: 1,
          reason: null,
        },
      );
      expect(cancelResult).toMatchObject({
        ok: false,
        error: { code: 'CANCELLATION_WINDOW_CLOSED' },
      });

      const stillConfirmed = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM bookings WHERE id = ${bookingId}::uuid
    `;
      expect(stillConfirmed[0]?.status).toBe('CONFIRMED');

      const clockCredentials = sandboxCredentials();
      const clockClient = app!.get(ClockHttpClient);
      const clockBooking = await clockClient.request<{ status: string }>(clockCredentials, {
        api: 'pms_api',
        method: 'GET',
        path: `/bookings/${row[0]!.externalBookingId}`,
      });
      expect(clockBooking.status).toBe(200);
      expect((clockBooking.body as { status: string }).status).not.toBe('canceled');

      // Direct cleanup: cancel for real at Clock and locally, bypassing the
      // window guard (this is test teardown, not the scenario under test).
      const bookingService = app!.get(ClockBookingService);
      await bookingService.cancelRealReservation(
        { tenantId, propertyId },
        row[0]!.externalBookingId!,
      );
      await admin.$executeRaw`
      UPDATE bookings SET status = 'CANCELLED'::"BookingStatus", version = version + 1
      WHERE id = ${bookingId}::uuid
    `;
    }, 30_000);

    it('online payment: continueAfterPayment (the real webhook-driven path) attaches a real Clock reservation', async () => {
      const guestId = randomUUID();
      const bookingId = randomUUID();
      const externalReference = `must-payment-gated-${bookingId}`;
      await admin.$executeRaw`
      INSERT INTO guests (id, tenant_id, email, first_name, last_name)
      VALUES (${guestId}::uuid, ${tenantId}::uuid, 'payment-gated-guest@example.test', 'PaymentGated', 'Guest')
    `;
      // Mirrors exactly the row LocalPmsProvider.createBooking leaves for an
      // online-payment method once the checkout session exists — this test
      // starts from there deliberately, so it exercises continueAfterPayment
      // itself (the real code a payment webhook drives), not checkout
      // creation (already covered by Task 1's tests).
      await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, guest_id, external_reference,
        status, payment_method, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES (
        ${bookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${localRoomTypeId}::uuid,
        ${guestId}::uuid, ${externalReference}, 'PAYMENT_PENDING'::"BookingStatus",
        'POKPAY'::"BookingPaymentMethod", '2026-08-16'::date, '2026-08-18'::date,
        ${ratePlanId}::uuid, 500.00
      )
    `;

      const database = app!.get(TenantDatabaseService);
      const bookings = app!.get(LocalPmsProvider);
      const context = { tenantId, propertyId };
      const result = await database.withTenantTransaction(
        context,
        (tx) => bookings.continueAfterPayment(tx, context, bookingId),
        { timeoutMs: 45_000 },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.externalBookingId).toMatch(/^\d+$/);

      const row = await admin.$queryRaw<
        Array<{ status: string; externalBookingId: string | null }>
      >`
      SELECT status, external_booking_id AS "externalBookingId" FROM bookings WHERE id = ${bookingId}::uuid
    `;
      expect(row[0]?.status).toBe('CONFIRMED');
      expect(row[0]?.externalBookingId).toMatch(/^\d+$/);

      // Task 5, reverted to a real accounting entry after the owner reviewed
      // the live dashboard (2026-08-06): a genuine deposit=true folio +
      // credit_item, not a note. Clock nets any posted payment, on any
      // folio, into the booking's aggregate Balance — the owner accepted
      // that trade-off in exchange for a real, reportable financial record.
      // Verified directly against Clock: Balance nets to 0, a real open
      // deposit folio exists, and it carries a credit_item for our own
      // reference/amount/currency.
      const clockCredentials = sandboxCredentials();
      const clockClient = app!.get(ClockHttpClient);
      const externalBookingId = row[0]!.externalBookingId!;
      const clockBooking = await clockClient.request<{ balance: { cents: number } }>(
        clockCredentials,
        { api: 'pms_api', method: 'GET', path: `/bookings/${externalBookingId}` },
      );
      expect(clockBooking.status).toBe(200);
      expect((clockBooking.body as { balance: { cents: number } }).balance.cents).toBe(0);

      // GET .../folios/ returns bare numeric folio IDs, not objects
      // (confirmed for real) — each folio's own fields need GET /folios/{id}.
      const folioIds = await clockClient.request<number[]>(clockCredentials, {
        api: 'pms_api',
        method: 'GET',
        path: `/bookings/${externalBookingId}/folios/`,
      });
      expect(folioIds.status).toBe(200);
      let depositFolioId: number | undefined;
      for (const folioId of folioIds.body) {
        const folio = await clockClient.request<{ deposit?: boolean; closed_at?: string | null }>(
          clockCredentials,
          { api: 'base_api', method: 'GET', path: `/folios/${folioId}` },
        );
        if (folio.body.deposit === true && !folio.body.closed_at) {
          depositFolioId = folioId;
          break;
        }
      }
      expect(depositFolioId).toBeDefined();

      const creditItems = await clockClient.request<
        Array<{
          reference?: string;
          value_cents?: number;
          currency?: string;
          payment_sub_type?: string;
        }>
      >(clockCredentials, {
        api: 'base_api',
        method: 'GET',
        path: `/folios/${depositFolioId}/credit_items`,
      });
      expect(creditItems.status).toBe(200);
      const ourCreditItem = creditItems.body.find((item) => item.reference === externalReference);
      expect(ourCreditItem).toBeDefined();
      expect(ourCreditItem?.value_cents).toBe(50000);
      expect(ourCreditItem?.currency).toBe('EUR');
      expect(ourCreditItem?.payment_sub_type).toBe('PokPay');

      const auditRows = await admin.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND target_id = ${bookingId}
        AND action = 'booking.clock_deposit_posted'
    `;
      expect(auditRows.length).toBe(1);

      // The window-guard test restored the default 21-day window; widen it
      // again for this cleanup cancel (arrival is inside that window here too).
      await admin.$executeRaw`
      UPDATE properties SET free_cancellation_days_before_arrival = 0 WHERE id = ${propertyId}::uuid
    `;
      const cancelResult = await bookings.cancelBooking(context, {
        idempotencyKey: `payment-gated-cancel-${randomUUID()}`,
        bookingId,
        guestSessionId: null as unknown as string,
        expectedVersion: 1,
        reason: 'Task 4 e2e cleanup.',
      });
      expect(cancelResult.ok).toBe(true);

      const clockCancelled = await clockClient.request<{ status: string }>(clockCredentials, {
        api: 'pms_api',
        method: 'GET',
        path: `/bookings/${externalBookingId}`,
      });
      expect(clockCancelled.status).toBe(200);
      expect((clockCancelled.body as { status: string }).status).toBe('canceled');
    }, 30_000);
  },
);
