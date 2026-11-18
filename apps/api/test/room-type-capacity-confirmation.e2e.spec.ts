import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ClockBackgroundSyncService } from '../src/integrations/clock/clock-background-sync.service';
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

type RateCaps = { maxAdults: number | null; maxChildren: number | null };

/** Task 40-4b: the hotel confirms a room type's capacity, and the Clock rates sync never overwrites it. */
describe('room type capacity confirmation', () => {
  let app: INestApplication | undefined;
  let tenantId: string;
  let propertyId: string;
  let userId: string;
  let verificationToken = '';
  const email = `capacity-${randomUUID()}@example.test`;
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
  });

  afterAll(async () => {
    if (tenantId) await cleanupTenant(admin, tenantId);
    if (userId) await admin.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('keeps a confirmed capacity through the Clock rates sync and stores the rate limit as a suggestion', async () => {
    const signup = await request(app!.getHttpServer())
      .post('/auth/signup')
      .send({
        organizationName: 'Capacity Hotel Group',
        propertyName: 'Capacity Property',
        propertyAddress: '1 Main Street',
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

    const create = (name: string) =>
      request(app!.getHttpServer())
        .post(`${propertyUrl}/room-types`)
        .set('Cookie', cookie)
        .send({ name, maxOccupancy: 2 })
        .expect(201);
    const confirmed = (await create('Family Suite')).body as { id: string };
    const unconfirmed = (await create('Double Room')).body as { id: string };

    const save = (id: string, body: Record<string, unknown>) =>
      request(app!.getHttpServer())
        .patch(`${propertyUrl}/room-types/${id}`)
        .set('Cookie', cookie)
        .send({ name: 'Family Suite', ...body });
    await save(confirmed.id, { maxOccupancy: 'four', capacityConfirmed: true }).expect(400);
    await save(confirmed.id, { maxOccupancy: 4, capacityConfirmed: 'yes' }).expect(400);
    const saved = await save(confirmed.id, { maxOccupancy: 4, capacityConfirmed: true }).expect(
      200,
    );
    expect(saved.body).toMatchObject({ maxOccupancy: 4 });
    expect(saved.body.capacityConfirmedAt).toBeTruthy();

    // Saving again with the same number keeps the first confirmation time; leaving the flag out leaves it alone.
    const firstConfirmedAt = saved.body.capacityConfirmedAt as string;
    const again = await save(confirmed.id, { maxOccupancy: 4, capacityConfirmed: true }).expect(
      200,
    );
    expect(again.body.capacityConfirmedAt).toBe(firstConfirmedAt);
    const untouched = await save(confirmed.id, { maxOccupancy: 4 }).expect(200);
    expect(untouched.body.capacityConfirmedAt).toBe(firstConfirmedAt);

    // The Clock rates sync: both room types now have rates allowing 3 adults and 1 child.
    const sync = app!.get(ClockBackgroundSyncService) as unknown as {
      refreshDisplayedOccupancy: (
        scope: { tenantId: string; propertyId: string; connectionId: string },
        rates: Map<string, RateCaps[]>,
      ) => Promise<void>;
    };
    const fourGuests: RateCaps[] = [{ maxAdults: 3, maxChildren: 1 }];
    const noLimit: RateCaps[] = [{ maxAdults: null, maxChildren: null }];
    await sync.refreshDisplayedOccupancy(
      { tenantId, propertyId, connectionId: randomUUID() },
      new Map([
        [confirmed.id, [{ maxAdults: 5, maxChildren: 1 }]],
        [unconfirmed.id, fourGuests],
      ]),
    );
    const read = async () =>
      admin.$queryRaw<
        Array<{
          id: string;
          maxOccupancy: number;
          clockRateCapacity: number | null;
          confirmed: boolean;
        }>
      >`
        SELECT id, max_occupancy AS "maxOccupancy", clock_rate_capacity AS "clockRateCapacity",
          capacity_confirmed_at IS NOT NULL AS confirmed
        FROM room_types WHERE tenant_id = ${tenantId}::uuid ORDER BY name
      `;
    expect(await read()).toEqual([
      { id: unconfirmed.id, maxOccupancy: 4, clockRateCapacity: 4, confirmed: false },
      { id: confirmed.id, maxOccupancy: 4, clockRateCapacity: 6, confirmed: true },
    ]);

    // A rate with no adult limit clears the suggestion and leaves the capacity as it was.
    await sync.refreshDisplayedOccupancy(
      { tenantId, propertyId, connectionId: randomUUID() },
      new Map([[unconfirmed.id, noLimit]]),
    );
    expect((await read())[0]).toMatchObject({ maxOccupancy: 4, clockRateCapacity: null });

    // The list returns the fields the dialog shows.
    const list = await request(app!.getHttpServer())
      .get(`${propertyUrl}/room-types`)
      .set('Cookie', cookie)
      .expect(200);
    const listed = (list.body as Array<Record<string, unknown>>).find(
      (roomType) => roomType.id === confirmed.id,
    );
    expect(listed).toMatchObject({ clockRateCapacity: 6, mostBookedGuests: null });
    expect(listed?.capacityConfirmedAt).toBeTruthy();

    // Unconfirming lets the sync update the capacity again.
    await save(confirmed.id, { maxOccupancy: 4, capacityConfirmed: false }).expect(200);
    await sync.refreshDisplayedOccupancy(
      { tenantId, propertyId, connectionId: randomUUID() },
      new Map([[confirmed.id, [{ maxAdults: 5, maxChildren: 1 }]]]),
    );
    expect((await read())[1]).toMatchObject({ maxOccupancy: 6, confirmed: false });
  });
});
