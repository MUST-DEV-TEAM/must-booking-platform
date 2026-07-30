import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalPmsProvider, PMS_PROVIDER } from '../src/booking/local-pms.provider';
import { QuoteService } from '../src/booking/quote.service';
import { MAIL_PROVIDER, type MailProvider } from '../src/mail/mail.provider';
import { clearSignupRateLimits } from './helpers/clear-signup-rate-limits';

const isoDateFromToday = (offsetDays: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('LocalPmsProvider', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let roomTypeId: string;
  let ratePlanId: string;
  let cookie: string;
  let verificationToken = '';
  const email = `local-pms-${randomUUID()}@example.test`;
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      verificationToken = new URL(command.verificationUrl).searchParams.get('token')!;
    },
    async sendWelcomeEmail() {},
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
    if (tenantId) {
      await admin.$executeRaw`DELETE FROM integration_operations WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM bookings WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM guests WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM inventory_units WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM rate_rules WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM rate_plans WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`;
      await admin.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
    }
    if (propertyId) await admin.$executeRaw`DELETE FROM properties WHERE id = ${propertyId}::uuid`;
    if (tenantId) await admin.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('implements the local provider contract with synchronous booking confirmation', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Local PMS Hotel Group',
        propertyName: 'Local PMS Property',
        propertyAddress: '1 Provider Way',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    userId = signup.body.user.id;
    cookie = signup.headers['set-cookie'][0];
    const propertyUrl = `/tenants/${tenantId}/properties/${propertyId}`;

    await request(app!.getHttpServer())
      .post('/auth/email-verification/confirm')
      .send({ token: verificationToken })
      .expect(204);
    const roomType = await request(app!.getHttpServer())
      .post(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .send({ name: 'Provider Suite', maxOccupancy: 2 })
      .expect(201);
    roomTypeId = roomType.body.id;
    const ratePlan = await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Provider Flexible', currency: 'EUR', freeCancellationUntilHours: 48 })
      .expect(201);
    ratePlanId = ratePlan.body.id;
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: '2026-09-01', endsOn: '2026-09-03', availableUnits: 1 })
      .expect(204);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${ratePlanId}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '90.00' })
      .expect(201);

    const provider = app!.get(LocalPmsProvider);
    expect(app!.get<LocalPmsProvider>(PMS_PROVIDER)).toBe(provider);
    const context = { tenantId, propertyId };
    await expect(provider.testConnection(context)).resolves.toEqual({ ok: true, value: undefined });
    const catalog = await provider.syncCatalog(context);
    expect(catalog.nextCursor).toBeNull();
    expect(catalog.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'room_type', id: roomTypeId }),
        expect.objectContaining({ kind: 'rate_plan', id: ratePlanId, currency: 'EUR' }),
      ]),
    );
    await expect(
      provider.getAvailability(context, {
        roomTypeId,
        startsOn: '2026-09-01',
        endsOn: '2026-09-03',
      }),
    ).resolves.toMatchObject({ ok: true, value: { availableUnits: 1, isAvailable: true } });

    const quote = await request(app!.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .send({ roomTypeId, ratePlanId, startsOn: '2026-09-01', endsOn: '2026-09-03' })
      .expect(201);
    const guestCookie = quote.headers['set-cookie'][0] as string;
    expect(guestCookie).toContain('must_guest_session=');
    expect(quote.body).toMatchObject({
      roomTypeId,
      ratePlanId,
      startsOn: '2026-09-01',
      endsOn: '2026-09-03',
      total: { amount: '180.00', currency: 'EUR' },
    });
    expect(quote.body.quoteToken).toEqual(expect.any(String));
    expect(new Date(quote.body.expiresAt).valueOf()).toBeGreaterThan(Date.now());
    const quoteSessionId = guestCookie
      .split(';')
      .map((part) => part.trim().split('=', 2))
      .find(([key]) => key === 'must_guest_session')?.[1];
    if (!quoteSessionId) throw new Error('Expected anonymous guest session cookie.');

    const bookingRequest = {
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2026-09-01',
      endsOn: '2026-09-03',
      guest: { email: 'guest@example.test', firstName: 'Guest', lastName: 'Example', phone: null },
      total: quote.body.total,
      quoteToken: quote.body.quoteToken,
    };
    const bookingIdempotencyKey = randomUUID();
    const createdResponse = await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', bookingIdempotencyKey)
      .send(bookingRequest)
      .expect(201);
    const created = createdResponse.body;
    expect(created).toMatchObject({ ok: true, value: { status: 'CONFIRMED', version: 1 } });
    if (!created.ok) throw new Error('Expected local booking creation to succeed.');
    await request(app!.getHttpServer())
      .get(`${propertyUrl}/bookings`)
      .set('Cookie', cookie)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual([
          expect.objectContaining({
            id: created.value.id,
            guestId: created.value.guestId,
            guestEmail: 'guest@example.test',
            guestPhone: null,
            roomTypeId,
            roomTypeName: 'Provider Suite',
            ratePlanId,
            ratePlanName: 'Provider Flexible',
            startsOn: '2026-09-01',
            endsOn: '2026-09-03',
            status: 'CONFIRMED',
            total: { amount: '180.00', currency: 'EUR' },
          }),
        ]);
      });
    await expect(
      provider.createBooking(context, {
        ...bookingRequest,
        idempotencyKey: randomUUID(),
        guest: { ...bookingRequest.guest, email: '   ' },
        quoteSessionId,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_GUEST_EMAIL' } });
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', bookingIdempotencyKey)
      .send(bookingRequest)
      .expect(201)
      .expect(created);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/bookings`)
      .set('Cookie', guestCookie)
      .set('Idempotency-Key', bookingIdempotencyKey)
      .send({ ...bookingRequest, externalReference: `must-${randomUUID()}` })
      .expect(409);
    const operationRows = await admin.$queryRaw<Array<{ attempts: number; bookingCount: bigint }>>`
      SELECT io.attempts, (
        SELECT count(*)::bigint FROM bookings WHERE tenant_id = ${tenantId}::uuid
          AND external_reference = ${bookingRequest.externalReference}
      ) AS "bookingCount"
      FROM integration_operations io
      WHERE io.tenant_id = ${tenantId}::uuid AND io.idempotency_key = ${bookingIdempotencyKey}
    `;
    expect(operationRows).toEqual([{ attempts: 2, bookingCount: 1n }]);

    await expect(provider.getBooking(context, created.value.externalBookingId!)).resolves.toEqual(
      created.value,
    );
    await expect(
      provider.findBookingByExternalReference(context, created.value.externalReference),
    ).resolves.toEqual(created.value);

    const updateIdempotencyKey = randomUUID();
    const updateCommand = {
      idempotencyKey: updateIdempotencyKey,
      bookingId: created.value.id,
      expectedVersion: created.value.version,
      total: { amount: '190.00', currency: 'EUR' },
    };
    const updated = await provider.updateBooking(context, updateCommand);
    expect(updated).toMatchObject({ ok: true, value: { version: 2, total: { amount: '190.00' } } });
    if (!updated.ok) throw new Error('Expected local booking update to succeed.');
    await expect(provider.updateBooking(context, updateCommand)).resolves.toEqual(updated);

    const cancelIdempotencyKey = randomUUID();
    const cancelCommand = {
      idempotencyKey: cancelIdempotencyKey,
      bookingId: updated.value.id,
      expectedVersion: updated.value.version,
      reason: null,
    };
    const cancelled = await provider.cancelBooking(context, cancelCommand);
    expect(cancelled).toMatchObject({ ok: true, value: { status: 'CANCELLED', version: 3 } });
    await expect(provider.cancelBooking(context, cancelCommand)).resolves.toEqual(cancelled);

    const bookingAuditEntries = await admin.$queryRaw<
      Array<{
        action: string;
        targetId: string;
        actorUserId: string | null;
        details: {
          guestId: string;
          cancellation?: {
            isFree: boolean;
            freeCancellationUntilHours: number | null;
            cutoffAt: string | null;
          };
        };
      }>
    >`
      SELECT action, target_id AS "targetId", actor_user_id AS "actorUserId", details
      FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND target_id = ${updated.value.id}
      ORDER BY action
    `;
    expect(bookingAuditEntries).toEqual([
      expect.objectContaining({
        action: 'booking.cancelled',
        targetId: updated.value.id,
        actorUserId: null,
        details: expect.objectContaining({
          guestId: created.value.guestId,
          cancellation: expect.objectContaining({
            isFree: true,
            freeCancellationUntilHours: 48,
            cutoffAt: expect.any(String),
          }),
        }),
      }),
      {
        action: 'booking.created',
        targetId: updated.value.id,
        actorUserId: null,
        details: { guestId: created.value.guestId },
      },
    ]);
    const freeCancellationPolicy = await admin.$queryRaw<
      Array<{ isFree: boolean; freeUntilHours: number | null; cutoffAt: Date | null }>
    >`
      SELECT cancellation_is_free AS "isFree",
        cancellation_free_until_hours AS "freeUntilHours",
        cancellation_cutoff_at AS "cutoffAt"
      FROM bookings WHERE id = ${updated.value.id}::uuid
    `;
    expect(freeCancellationPolicy).toEqual([
      { isFree: true, freeUntilHours: 48, cutoffAt: expect.any(Date) },
    ]);

    const availableAfterCancellation = await provider.getAvailability(context, {
      roomTypeId,
      startsOn: '2026-09-01',
      endsOn: '2026-09-03',
    });
    expect(availableAfterCancellation).toMatchObject({ ok: true, value: { availableUnits: 1 } });

    const draftBookingId = randomUUID();
    const draftGuestId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO guests (id, tenant_id, email, phone)
      VALUES (${draftGuestId}::uuid, ${tenantId}::uuid, ${`draft-${randomUUID()}@example.test`}, NULL)
    `;
    await admin.$executeRaw`
      INSERT INTO bookings (
        id, tenant_id, property_id, room_type_id, guest_id, external_reference,
        status, starts_on, ends_on, rate_plan_id, total_amount
      ) VALUES (
        ${draftBookingId}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${roomTypeId}::uuid,
        ${draftGuestId}::uuid, ${`must-${randomUUID()}`}, 'DRAFT'::"BookingStatus",
        '2026-09-01'::date, '2026-09-03'::date, ${ratePlanId}::uuid, 180.00
      )
    `;
    await expect(
      provider.cancelBooking(context, {
        idempotencyKey: randomUUID(),
        bookingId: draftBookingId,
        expectedVersion: 1,
        reason: null,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: 'CANCELLED', version: 2 } });

    const availabilityAfterDraftCancellation = await provider.getAvailability(context, {
      roomTypeId,
      startsOn: '2026-09-01',
      endsOn: '2026-09-03',
    });
    expect(availabilityAfterDraftCancellation).toMatchObject({
      ok: true,
      value: { availableUnits: 1 },
    });

    const quotes = app!.get(QuoteService);
    const expiredQuote = await quotes.create(
      tenantId,
      propertyId,
      quoteSessionId,
      { roomTypeId, ratePlanId, startsOn: '2026-09-01', endsOn: '2026-09-03' },
      1,
    );
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const expiredReference = `must-${randomUUID()}`;
    await expect(
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: expiredReference,
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-01',
        endsOn: '2026-09-03',
        guest: {
          email: 'expired@example.test',
          firstName: 'Expired',
          lastName: 'Quote',
          phone: null,
        },
        total: expiredQuote.total,
        quoteToken: expiredQuote.quoteToken,
        quoteSessionId,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'QUOTE_EXPIRED' } });
    await expect(
      provider.findBookingByExternalReference(context, expiredReference),
    ).resolves.toMatchObject({
      status: 'AVAILABILITY_FAILED',
    });

    const tamperedReference = `must-${randomUUID()}`;
    await expect(
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: tamperedReference,
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-01',
        endsOn: '2026-09-03',
        guest: {
          email: 'tampered@example.test',
          firstName: 'Tampered',
          lastName: 'Quote',
          phone: null,
        },
        total: quote.body.total,
        quoteToken: `${quote.body.quoteToken}x`,
        quoteSessionId,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'QUOTE_INVALID' } });
    await expect(
      provider.findBookingByExternalReference(context, tamperedReference),
    ).resolves.toMatchObject({
      status: 'AVAILABILITY_FAILED',
    });

    const firstBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId,
      startsOn: '2026-09-01',
      endsOn: '2026-09-03',
      guest: {
        email: 'GUEST@example.test',
        firstName: 'Different',
        lastName: 'Name',
        phone: '+355000000',
      },
      total: quote.body.total,
      quoteToken: quote.body.quoteToken,
      quoteSessionId,
    });
    expect(firstBooking).toMatchObject({ ok: true, value: { status: 'CONFIRMED' } });
    if (!firstBooking.ok) throw new Error('Expected matching guest booking to succeed.');
    expect(firstBooking.value.guestId).toBe(created.value.guestId);

    const pastStartsOn = isoDateFromToday(-1);
    const pastEndsOn = isoDateFromToday(0);
    const pastCutoffRatePlan = await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans`)
      .set('Cookie', cookie)
      .send({ name: 'Provider Past Cutoff', currency: 'EUR', freeCancellationUntilHours: 0 })
      .expect(201);
    await request(app!.getHttpServer())
      .post(`${propertyUrl}/rate-plans/${pastCutoffRatePlan.body.id}/rules`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: null, endsOn: null, amount: '90.00' })
      .expect(201);
    await request(app!.getHttpServer())
      .put(`${propertyUrl}/inventory-units`)
      .set('Cookie', cookie)
      .send({ roomTypeId, startsOn: pastStartsOn, endsOn: pastEndsOn, availableUnits: 1 })
      .expect(204);
    const pastQuote = await quotes.create(tenantId, propertyId, quoteSessionId, {
      roomTypeId,
      ratePlanId: pastCutoffRatePlan.body.id,
      startsOn: pastStartsOn,
      endsOn: pastEndsOn,
    });
    const pastCutoffBooking = await provider.createBooking(context, {
      idempotencyKey: randomUUID(),
      externalReference: `must-${randomUUID()}`,
      roomTypeId,
      ratePlanId: pastCutoffRatePlan.body.id,
      startsOn: pastStartsOn,
      endsOn: pastEndsOn,
      guest: {
        email: `past-cutoff-${randomUUID()}@example.test`,
        firstName: 'Past',
        lastName: 'Cutoff',
        phone: null,
      },
      total: pastQuote.total,
      quoteToken: pastQuote.quoteToken,
      quoteSessionId,
    });
    if (!pastCutoffBooking.ok) throw new Error('Expected past-cutoff booking to succeed.');
    await expect(
      provider.cancelBooking(context, {
        idempotencyKey: randomUUID(),
        bookingId: pastCutoffBooking.value.id,
        expectedVersion: pastCutoffBooking.value.version,
        reason: null,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: 'CANCELLED' } });
    const pastCutoffPolicy = await admin.$queryRaw<
      Array<{ isFree: boolean; freeUntilHours: number | null; cutoffAt: Date | null }>
    >`
      SELECT cancellation_is_free AS "isFree",
        cancellation_free_until_hours AS "freeUntilHours",
        cancellation_cutoff_at AS "cutoffAt"
      FROM bookings WHERE id = ${pastCutoffBooking.value.id}::uuid
    `;
    expect(pastCutoffPolicy).toEqual([
      { isFree: false, freeUntilHours: 0, cutoffAt: expect.any(Date) },
    ]);

    const unavailableReference = `must-${randomUUID()}`;
    const unavailableQuote = await request(app!.getHttpServer())
      .post(`${propertyUrl}/quotes`)
      .set('Cookie', guestCookie)
      .send({ roomTypeId, ratePlanId, startsOn: '2026-09-01', endsOn: '2026-09-03' })
      .expect(201);
    await expect(
      provider.createBooking(context, {
        idempotencyKey: randomUUID(),
        externalReference: unavailableReference,
        roomTypeId,
        ratePlanId,
        startsOn: '2026-09-01',
        endsOn: '2026-09-03',
        guest: {
          email: 'second@example.test',
          firstName: 'Second',
          lastName: 'Guest',
          phone: '+355000000',
        },
        total: unavailableQuote.body.total,
        quoteToken: unavailableQuote.body.quoteToken,
        quoteSessionId,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'AVAILABILITY_FAILED' } });
    await expect(
      provider.findBookingByExternalReference(context, unavailableReference),
    ).resolves.toMatchObject({
      status: 'AVAILABILITY_FAILED',
    });
    const matchedGuests = await admin.$queryRaw<Array<{ email: string; phone: string | null }>>`
      SELECT email, phone FROM guests
      WHERE tenant_id = ${tenantId}::uuid
        AND lower(email) IN ('guest@example.test', 'second@example.test')
      ORDER BY email
    `;
    expect(matchedGuests).toEqual([
      { email: 'guest@example.test', phone: null },
      { email: 'second@example.test', phone: '+355000000' },
    ]);
  });
});
