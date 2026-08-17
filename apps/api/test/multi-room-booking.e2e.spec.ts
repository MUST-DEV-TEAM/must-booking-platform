import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MultiRoomBookingService } from '../src/booking/multi-room-booking.service';
import { LocalPmsProvider } from '../src/booking/local-pms.provider';
import { QuoteService } from '../src/booking/quote.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { PAYMENT_PROVIDER } from '../src/payments/payment.provider';
import { StripeWebhookService } from '../src/payments/stripe-webhook.service';
import { IntegrationConnectionsService } from '../src/integrations/integration-connections.service';
import { ClockBookingService } from '../src/integrations/clock/clock-booking.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('Multi-room booking orders', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let verificationToken = '';
  let clockConnected = false;
  let failSecondClockReservation = false;
  let failSecondClockCancellation = false;
  let clockCancellationAttempts = 0;
  const cancelledClockBookingIds: string[] = [];
  const refundCommands: Array<{
    paymentId: string;
    amount: { amount: string; currency: string };
    idempotencyKey: string;
  }> = [];
  const email = `multi-room-${randomUUID()}@example.test`;
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
  const payments = {
    async createCheckoutSession(_context: unknown, command: { bookingId: string }) {
      return {
        ok: true as const,
        value: {
          id: `cs_test_${command.bookingId}`,
          url: `https://checkout.stripe.test/${command.bookingId}`,
        },
      };
    },
    async verifyWebhookEvent() {
      return { ok: false as const, error: { code: 'NOT_USED', message: '', retryable: false } };
    },
    async refund(
      _context: unknown,
      command: {
        paymentId: string;
        amount: { amount: string; currency: string };
        idempotencyKey: string;
      },
    ) {
      refundCommands.push(command);
      return {
        ok: true as const,
        value: {
          id: `refund-${command.paymentId}`,
          bookingId: command.paymentId,
          amount: command.amount,
          status: 'REFUNDED',
        },
      };
    },
    async getPayment() {
      return null;
    },
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
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(payments)
      .overrideProvider(IntegrationConnectionsService)
      .useValue({
        activePmsConnectionCredentials: async () =>
          clockConnected ? { provider: 'CLOCK_PMS' } : null,
      })
      .overrideProvider(ClockBookingService)
      .useValue({
        attachRealReservation: async (
          tx: PrismaClient,
          context: { tenantId: string; propertyId: string },
          bookingId: string,
        ) => {
          const rows = await tx.$queryRaw<Array<{ orderRoomNumber: number }>>`
            SELECT order_room_number AS "orderRoomNumber" FROM bookings
            WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid
              AND property_id = ${context.propertyId}::uuid
          `;
          if (failSecondClockReservation && rows[0]?.orderRoomNumber === 2) {
            await tx.$executeRaw`
              UPDATE bookings SET status = 'PMS_UNKNOWN_RESULT'::"BookingStatus"
              WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid
                AND property_id = ${context.propertyId}::uuid
            `;
            await tx.$executeRaw`
              INSERT INTO manual_review_items (
                tenant_id, property_id, category, reference_type, reference_id, message
              ) VALUES (
                ${context.tenantId}::uuid, ${context.propertyId}::uuid,
                'UNKNOWN_RESULT'::"ManualReviewCategory", 'booking', ${bookingId},
                'Forced Clock create failure for multi-room order test.'
              )
            `;
            return {
              ok: false as const,
              error: { code: 'forced', message: 'forced', retryable: false },
            };
          }
          await tx.$executeRaw`
            UPDATE bookings
            SET external_booking_id = ${`clock-${bookingId}`}, status = 'CONFIRMED'::"BookingStatus"
            WHERE id = ${bookingId}::uuid AND tenant_id = ${context.tenantId}::uuid
              AND property_id = ${context.propertyId}::uuid
          `;
          return { ok: true as const, value: { id: bookingId, status: 'CONFIRMED' } };
        },
        async postDeposit() {
          return { ok: true as const, value: undefined };
        },
        async cancelRealReservation(_context: unknown, externalBookingId: string) {
          cancelledClockBookingIds.push(externalBookingId);
          clockCancellationAttempts += 1;
          if (failSecondClockCancellation && clockCancellationAttempts === 2)
            return {
              ok: false as const,
              error: {
                code: 'CLOCK_CANCELLATION_FAILED',
                message: 'Forced second-room Clock cancellation failure.',
                retryable: false,
              },
            };
          return { ok: true as const, value: undefined };
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('rejects the whole order and leaves no hold when any requested room is unavailable', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Multi Room Hotel Group',
        propertyName: 'Multi Room Property',
        propertyAddress: '1 Atomic Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    const cookie = signup.headers['set-cookie'][0];
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;
    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: false, pokpay: false, payAtHotel: true })
      .expect(200);

    const [firstType, secondType, ratePlan] = await Promise.all([
      request(app!.getHttpServer())
        .post(`${propertyUrl}/room-types`)
        .set('Cookie', cookie)
        .send({ name: 'Available Suite', maxOccupancy: 2 }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/room-types`)
        .set('Cookie', cookie)
        .send({ name: 'Unavailable Suite', maxOccupancy: 2 }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/rate-plans`)
        .set('Cookie', cookie)
        .send({ name: 'Flexible', currency: 'EUR', freeCancellationUntilHours: 48 }),
    ]);
    expect(firstType.status).toBe(201);
    expect(secondType.status).toBe(201);
    expect(ratePlan.status).toBe(201);
    const startsOn = '2026-11-01';
    const endsOn = '2026-11-03';
    await Promise.all([
      request(app!.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Cookie', cookie)
        .send({ roomTypeId: firstType.body.id, startsOn, endsOn, availableUnits: 1 }),
      request(app!.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Cookie', cookie)
        .send({ roomTypeId: secondType.body.id, startsOn, endsOn, availableUnits: 0 }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId: firstType.body.id, startsOn: null, endsOn: null, amount: '100.00' }),
      request(app!.getHttpServer())
        .post(`${propertyUrl}/rate-plans/${ratePlan.body.id}/rules`)
        .set('Cookie', cookie)
        .send({ roomTypeId: secondType.body.id, startsOn: null, endsOn: null, amount: '110.00' }),
    ]);

    const quotes = app!.get(QuoteService);
    const sessionId = randomUUID();
    const [firstQuote, secondQuote] = await Promise.all([
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: firstType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: secondType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
    ]);
    const orders = app!.get(MultiRoomBookingService);
    const result = await orders.create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        startsOn,
        endsOn,
        quoteSessionId: sessionId,
        paymentMethod: 'pay_at_hotel',
        guest: {
          email: `guest-${randomUUID()}@example.test`,
          firstName: 'Primary',
          lastName: 'Guest',
          phone: null,
        },
        rooms: [
          {
            roomTypeId: firstType.body.id,
            ratePlanId: ratePlan.body.id,
            total: firstQuote.total,
            quoteToken: firstQuote.quoteToken,
          },
          {
            roomTypeId: secondType.body.id,
            ratePlanId: ratePlan.body.id,
            total: secondQuote.total,
            quoteToken: secondQuote.quoteToken,
            guest: { firstName: 'Second', lastName: 'Guest' },
          },
        ],
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'AVAILABILITY_FAILED' } });

    const inventory = await admin.$queryRaw<Array<{ roomTypeId: string; bookedUnits: number }>>`
      SELECT room_type_id AS "roomTypeId", booked_units AS "bookedUnits"
      FROM inventory_units
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
      ORDER BY room_type_id, stays_on
    `;
    expect(inventory.every((row) => row.bookedUnits === 0)).toBe(true);
    const bookings = await admin.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    expect(bookings[0]!.count).toBe(0n);

    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId: secondType.body.id, startsOn, endsOn, availableUnits: 1 })
      .expect(204);
    const [availableFirstQuote, availableSecondQuote] = await Promise.all([
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: firstType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
      quotes.create(tenantId, propertyId, sessionId, {
        roomTypeId: secondType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
    ]);
    clockConnected = true;
    failSecondClockReservation = false;
    const held = await orders.create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        externalReference: `must-order-${randomUUID()}`,
        startsOn,
        endsOn,
        quoteSessionId: sessionId,
        paymentMethod: 'pay_at_hotel',
        guest: {
          email: `second-guest-${randomUUID()}@example.test`,
          firstName: 'Primary',
          lastName: 'Guest',
          phone: null,
        },
        rooms: [
          {
            roomTypeId: firstType.body.id,
            ratePlanId: ratePlan.body.id,
            total: availableFirstQuote.total,
            quoteToken: availableFirstQuote.quoteToken,
          },
          {
            roomTypeId: secondType.body.id,
            ratePlanId: ratePlan.body.id,
            total: availableSecondQuote.total,
            quoteToken: availableSecondQuote.quoteToken,
            guest: { firstName: 'Second', lastName: 'Guest' },
          },
        ],
      },
    );
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.value.bookings.map((booking) => booking.status)).toEqual([
      'CONFIRMED',
      'CONFIRMED',
    ]);
    const payAtHotelClockBookings = await admin.$queryRaw<
      Array<{ externalBookingId: string | null }>
    >`
      SELECT external_booking_id AS "externalBookingId"
      FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND order_reference = ${held.value.orderReference}
      ORDER BY order_room_number
    `;
    expect(payAtHotelClockBookings).toEqual([
      { externalBookingId: `clock-${held.value.bookings[0]!.id}` },
      { externalBookingId: `clock-${held.value.bookings[1]!.id}` },
    ]);
    const provider = app!.get(LocalPmsProvider);
    const cancelledOrder = await provider.cancelBooking(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        bookingId: held.value.bookings[0]!.id,
        guestSessionId: sessionId,
        expectedVersion: 1,
        reason: 'The family changed its plans.',
      },
    );
    expect(cancelledOrder).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    expect(cancelledClockBookingIds).toEqual([
      `clock-${held.value.bookings[0]!.id}`,
      `clock-${held.value.bookings[1]!.id}`,
    ]);
    const cancelledStatuses = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND order_reference = ${held.value.orderReference}
      ORDER BY order_room_number
    `;
    expect(cancelledStatuses).toEqual([{ status: 'CANCELLED' }, { status: 'CANCELLED' }]);
    const partialCancellationSessionId = randomUUID();
    clockConnected = false;
    const [partialFirstQuote, partialSecondQuote] = await Promise.all([
      quotes.create(tenantId, propertyId, partialCancellationSessionId, {
        roomTypeId: firstType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
      quotes.create(tenantId, propertyId, partialCancellationSessionId, {
        roomTypeId: secondType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn,
        endsOn,
      }),
    ]);
    clockConnected = true;
    const partialCancellationOrder = await orders.create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        externalReference: `must-order-${randomUUID()}`,
        startsOn,
        endsOn,
        quoteSessionId: partialCancellationSessionId,
        paymentMethod: 'pay_at_hotel',
        guest: {
          email: `partial-cancellation-${randomUUID()}@example.test`,
          firstName: 'Partial',
          lastName: 'Cancellation',
          phone: null,
        },
        rooms: [
          {
            roomTypeId: firstType.body.id,
            ratePlanId: ratePlan.body.id,
            total: partialFirstQuote.total,
            quoteToken: partialFirstQuote.quoteToken,
          },
          {
            roomTypeId: secondType.body.id,
            ratePlanId: ratePlan.body.id,
            total: partialSecondQuote.total,
            quoteToken: partialSecondQuote.quoteToken,
          },
        ],
      },
    );
    expect(partialCancellationOrder.ok).toBe(true);
    if (!partialCancellationOrder.ok) return;
    clockCancellationAttempts = 0;
    failSecondClockCancellation = true;
    const partialCancellation = await provider.cancelBooking(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        bookingId: partialCancellationOrder.value.bookings[0]!.id,
        guestSessionId: partialCancellationSessionId,
        expectedVersion: 1,
        reason: 'Force the second Clock cancellation to fail.',
      },
    );
    expect(partialCancellation).toMatchObject({
      ok: false,
      error: { code: 'ORDER_CANCELLATION_PARTIAL_FAILURE' },
    });
    expect(cancelledClockBookingIds.slice(-2)).toEqual([
      `clock-${partialCancellationOrder.value.bookings[0]!.id}`,
      `clock-${partialCancellationOrder.value.bookings[1]!.id}`,
    ]);
    const partialCancellationStatuses = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND order_reference = ${partialCancellationOrder.value.orderReference}
      ORDER BY order_room_number
    `;
    expect(partialCancellationStatuses).toEqual([{ status: 'CANCELLED' }, { status: 'CONFIRMED' }]);
    const cancellationFailures = await admin.$queryRaw<
      Array<{ category: string; referenceId: string }>
    >`
      SELECT category::text AS category, reference_id AS "referenceId" FROM manual_review_items
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND reference_id = ${partialCancellationOrder.value.bookings[1]!.id}
    `;
    expect(cancellationFailures).toEqual([
      { category: 'UNKNOWN_RESULT', referenceId: partialCancellationOrder.value.bookings[1]!.id },
    ]);
    failSecondClockCancellation = false;
    const roomGuests = await admin.$queryRaw<
      Array<{
        orderReference: string;
        orderRoomNumber: number;
        firstName: string | null;
        lastName: string | null;
      }>
    >`
      SELECT order_reference AS "orderReference", order_room_number AS "orderRoomNumber",
        room_guest_first_name AS "firstName", room_guest_last_name AS "lastName"
      FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND order_reference = ${held.value.orderReference}
      ORDER BY order_room_number
    `;
    expect(roomGuests).toEqual([
      {
        orderReference: held.value.orderReference,
        orderRoomNumber: 1,
        firstName: 'Primary',
        lastName: 'Guest',
      },
      {
        orderReference: held.value.orderReference,
        orderRoomNumber: 2,
        firstName: 'Second',
        lastName: 'Guest',
      },
    ]);
    // Later quotes intentionally exercise the local pricing path; Clock is
    // re-enabled just before the paid order's webhook fan-out below.
    clockConnected = false;

    await request(app!.getHttpServer())
      .patch(`${propertyUrl}/payment-gateways`)
      .set('Cookie', cookie)
      .send({ stripe: true, pokpay: false, payAtHotel: true })
      .expect(200);
    const paidStartsOn = '2026-12-01';
    const paidEndsOn = '2026-12-03';
    await Promise.all([
      request(app!.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Cookie', cookie)
        .send({
          roomTypeId: firstType.body.id,
          startsOn: paidStartsOn,
          endsOn: paidEndsOn,
          availableUnits: 1,
        }),
      request(app!.getHttpServer())
        .put(`${propertyUrl}/inventory-units`)
        .set('Cookie', cookie)
        .send({
          roomTypeId: secondType.body.id,
          startsOn: paidStartsOn,
          endsOn: paidEndsOn,
          availableUnits: 1,
        }),
    ]);
    const paidSessionId = randomUUID();
    const [paidFirstQuote, paidSecondQuote] = await Promise.all([
      quotes.create(tenantId, propertyId, paidSessionId, {
        roomTypeId: firstType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn: paidStartsOn,
        endsOn: paidEndsOn,
      }),
      quotes.create(tenantId, propertyId, paidSessionId, {
        roomTypeId: secondType.body.id,
        ratePlanId: ratePlan.body.id,
        startsOn: paidStartsOn,
        endsOn: paidEndsOn,
      }),
    ]);
    const paidOrder = await orders.create(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        externalReference: `must-order-${randomUUID()}`,
        startsOn: paidStartsOn,
        endsOn: paidEndsOn,
        quoteSessionId: paidSessionId,
        paymentMethod: 'stripe',
        guest: {
          email: `paid-guest-${randomUUID()}@example.test`,
          firstName: 'Paid',
          lastName: 'Guest',
          phone: null,
        },
        rooms: [
          {
            roomTypeId: firstType.body.id,
            ratePlanId: ratePlan.body.id,
            total: paidFirstQuote.total,
            quoteToken: paidFirstQuote.quoteToken,
          },
          {
            roomTypeId: secondType.body.id,
            ratePlanId: ratePlan.body.id,
            total: paidSecondQuote.total,
            quoteToken: paidSecondQuote.quoteToken,
          },
        ],
      },
    );
    expect(paidOrder.ok).toBe(true);
    if (!paidOrder.ok) return;
    expect(paidOrder.value.checkoutUrl).toContain(paidOrder.value.bookings[0]!.id);

    clockConnected = true;
    failSecondClockReservation = true;
    const webhook = app!.get(StripeWebhookService);
    await expect(
      webhook.processPaymentSucceeded({
        id: randomUUID(),
        type: 'checkout.session.completed',
        externalPaymentId: `cs_test_${paidOrder.value.bookings[0]!.id}`,
        tenantId,
        propertyId,
        bookingId: paidOrder.value.bookings[0]!.id,
      }),
    ).resolves.toMatchObject({ ok: true, value: { duplicate: false } });
    const paidRows = await admin.$queryRaw<
      Array<{ externalReference: string; status: string; externalBookingId: string | null }>
    >`
      SELECT external_reference AS "externalReference", status::text, external_booking_id AS "externalBookingId"
      FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND order_reference = ${paidOrder.value.orderReference}
      ORDER BY order_room_number
    `;
    expect(paidRows).toEqual([
      {
        externalReference: `${paidOrder.value.orderReference}-room1`,
        status: 'CONFIRMED',
        externalBookingId: `clock-${paidOrder.value.bookings[0]!.id}`,
      },
      {
        externalReference: `${paidOrder.value.orderReference}-room2`,
        status: 'PMS_UNKNOWN_RESULT',
        externalBookingId: null,
      },
    ]);
    const payment = await admin.$queryRaw<Array<{ amount: string }>>`
      SELECT amount::text AS amount FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND booking_id = ${paidOrder.value.bookings[0]!.id}::uuid
    `;
    expect(payment).toEqual([{ amount: '420.00' }]);
    const manualReviews = await admin.$queryRaw<Array<{ referenceId: string }>>`
      SELECT reference_id AS "referenceId" FROM manual_review_items
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND reference_id = ${paidOrder.value.bookings[1]!.id}
    `;
    expect(manualReviews).toEqual([{ referenceId: paidOrder.value.bookings[1]!.id }]);
    const paidAnchor = await admin.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM bookings
      WHERE id = ${paidOrder.value.bookings[0]!.id}::uuid
        AND tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
    `;
    const cancelledPaidOrder = await provider.cancelBooking(
      { tenantId, propertyId },
      {
        idempotencyKey: randomUUID(),
        bookingId: paidOrder.value.bookings[0]!.id,
        guestSessionId: paidSessionId,
        expectedVersion: paidAnchor[0]!.version,
        reason: 'The group needs to cancel.',
      },
    );
    expect(cancelledPaidOrder).toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    expect(refundCommands).toHaveLength(1);
    expect(refundCommands[0]).toMatchObject({
      paymentId: `cs_test_${paidOrder.value.bookings[0]!.id}`,
      amount: { amount: '420.00', currency: 'EUR' },
    });
    const paidRefund = await admin.$queryRaw<Array<{ amount: string; kind: string }>>`
      SELECT amount::text AS amount, kind::text AS kind FROM payments
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND booking_id = ${paidOrder.value.bookings[0]!.id}::uuid
      ORDER BY created_at
    `;
    expect(paidRefund).toEqual([
      { amount: '420.00', kind: 'CHARGE' },
      { amount: '420.00', kind: 'REFUND' },
    ]);
    const cancelledPaidStatuses = await admin.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM bookings
      WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
        AND order_reference = ${paidOrder.value.orderReference}
      ORDER BY order_room_number
    `;
    expect(cancelledPaidStatuses).toEqual([{ status: 'CANCELLED' }, { status: 'CANCELLED' }]);
  });
});
