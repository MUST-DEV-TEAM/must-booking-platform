import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { PokPayPaymentProvider } from '../src/payments/pokpay-payment.provider';
import { VenueDepositPaymentsService } from '../src/payments/venue-deposit-payments.service';
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

/** A calendar date in the restaurant's time zone, some days from now. */
const localDate = (daysAhead: number) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Tirane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + daysAhead * 86_400_000));

describe('restaurant reservations', () => {
  let app: INestApplication | undefined;
  let planId: string;
  const tokens = new Map<string, string>();
  const tenants: string[] = [];
  const users: string[] = [];
  const mail: MailProvider = {
    async sendVerificationEmail(command) {
      tokens.set(command.to, new URL(command.verificationUrl).searchParams.get('token')!);
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
  const http = () => request(app!.getHttpServer());

  // One restaurant shared by the tests: a Terrace with T1 (2-4), T2 (2-4) and T3 (4-8 seats).
  let cookie: string;
  let tenantId: string;
  let propertyId: string;
  let venueId: string;
  let base: string;
  let day = localDate(3);
  let nextDay = 4;
  // Tests after the shared-day ones each get their own day so earlier bookings never fill their tables.
  const ownDay = () => {
    day = localDate(nextDay++);
  };
  const instant = async (date: string, time: string) =>
    (
      await admin.$queryRaw<Array<{ at: Date }>>`
        SELECT ((${date}::date + ${time}::time) AT TIME ZONE 'Europe/Tirane') AS "at"`
    )[0]!.at;

  const book = (body: Record<string, unknown>, as = cookie) =>
    http()
      .post(`${base}/reservations`)
      .set('Cookie', as)
      .send({ date: day, partySize: 2, guestName: 'Guest', ...body });
  const slot = async (time: string, partySize = 2) => {
    const response = await http()
      .get(`${base}/availability?date=${day}&partySize=${partySize}`)
      .set('Cookie', cookie)
      .expect(200);
    return response.body.services[0].slots.find((s: { time: string }) => s.time === time);
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

    planId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plans (id, name, max_properties, max_staff_seats, max_pms_connections_per_property, is_public, dining_enabled, max_venues)
      VALUES (${planId}::uuid, ${`Reservations e2e ${planId}`}, 5, 10, 0, false, true, 3)`;
    const email = `reservations-${randomUUID()}@example.test`;
    const signup = await http()
      .post('/auth/signup')
      .send({
        organizationName: 'Reservations',
        propertyName: 'Hotel',
        propertyAddress: '1 Main Street',
        propertyTimezone: 'Europe/Tirane',
        email,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    await http()
      .post('/auth/email-verification/confirm')
      .send({ token: tokens.get(email) })
      .expect(204);
    tenantId = signup.body.organization.id;
    propertyId = signup.body.property.id;
    tenants.push(tenantId);
    users.push(signup.body.user.id);
    cookie = signup.headers['set-cookie'][0];
    await admin.$executeRaw`UPDATE organizations SET plan_id = ${planId}::uuid WHERE id = ${tenantId}::uuid`;

    venueId = (
      await http()
        .post(`/tenants/${tenantId}/properties/${propertyId}/restaurant/activate`)
        .set('Cookie', cookie)
        .expect(201)
    ).body.venue.id;
    base = `/tenants/${tenantId}/venues/${venueId}`;
    await http().patch(base).set('Cookie', cookie).send({ currency: 'ALL' }).expect(200);
    await http()
      .put(`${base}/services`)
      .set('Cookie', cookie)
      .send({
        services: [
          { name: 'Dinner', days: [1, 2, 3, 4, 5, 6, 7], opensAt: '19:00', closesAt: '23:00' },
        ],
      })
      .expect(200);
    const area = (
      await http().post(`${base}/areas`).set('Cookie', cookie).send({ name: 'Terrace' }).expect(201)
    ).body;
    for (const [label, min, max] of [
      ['T1', 2, 4],
      ['T2', 2, 4],
      ['T3', 4, 8],
    ] as const)
      await http()
        .post(`${base}/areas/${area.id}/tables`)
        .set('Cookie', cookie)
        .send({ label, minSeats: min, maxSeats: max })
        .expect(201);
    await http().post(`${base}/complete-setup`).set('Cookie', cookie).expect(201);
  });

  afterAll(async () => {
    for (const id of tenants) await cleanupTenant(admin, id);
    for (const id of users) await admin.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`;
    if (planId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${planId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('lists the bookable times of the day with the tables that fit each party', async () => {
    const response = await http()
      .get(`${base}/availability?date=${day}&partySize=2`)
      .set('Cookie', cookie)
      .expect(200);
    expect(response.body.reason).toBeNull();
    const [dinner] = response.body.services;
    expect(dinner.name).toBe('Dinner');
    expect(dinner.slots.map((s: { time: string }) => s.time)).toEqual([
      '19:00',
      '19:30',
      '20:00',
      '20:30',
      '21:00',
      '21:30',
      '22:00',
    ]);
    // A party of two fits T1 and T2 (T3 seats 4 to 8).
    expect(dinner.slots[0].freeTables.map((t: { label: string }) => t.label)).toEqual(['T1', 'T2']);
    expect(dinner.slots[0].bookable).toBe(true);
    const large = await slot('20:00', 6);
    expect(large.freeTables.map((t: { label: string }) => t.label)).toEqual(['T3']);
    const tooBig = await slot('20:00', 9);
    expect(tooBig.freeTables).toEqual([]);
    expect(tooBig.bookable).toBe(false);
  });

  it('applies the online rules only to the online channel', async () => {
    const big = await http()
      .get(`${base}/availability?date=${day}&partySize=9&channel=online`)
      .set('Cookie', cookie)
      .expect(200);
    expect(big.body.reason).toBe('PARTY_TOO_LARGE');
    const far = await http()
      .get(`${base}/availability?date=${localDate(70)}&partySize=2&channel=online`)
      .set('Cookie', cookie)
      .expect(200);
    expect(far.body.reason).toBe('TOO_FAR_AHEAD');
    const staff = await http()
      .get(`${base}/availability?date=${localDate(70)}&partySize=2`)
      .set('Cookie', cookie)
      .expect(200);
    expect(staff.body.reason).toBeNull();
  });

  it('serves anonymous availability with public table IDs, excludes private records and respects the full stay', async () => {
    ownDay();
    const publicBase = `/v1/tenants/${tenantId}/restaurants/${venueId}`;
    const info = await http().get(publicBase).expect(200);
    expect(info.body.maxPartySize).toBe(8);
    expect(info.body).not.toHaveProperty('state');
    const large = await http()
      .get(`${publicBase}/availability?date=${day}&partySize=9&channel=staff`)
      .expect(200);
    expect(large.body.reason).toBe('PARTY_TOO_LARGE');
    const first = await slot('19:00');
    const [table1, table2] = first.freeTables;
    await book({ time: '20:30', tableId: table1.id }).expect(201);
    await admin.$executeRaw`UPDATE venue_tables SET online_bookable=false WHERE tenant_id=${tenantId}::uuid AND id=${table2.id}::uuid`;
    try {
      const short = await http()
        .get(`${publicBase}/availability?date=${day}&partySize=2&durationMinutes=90`)
        .expect(200);
      expect(short.body.services[0].slots).toContainEqual({
        time: '19:00',
        freeTableIds: [table1.id],
      });
      expect(short.body.services[0].slots[0]).not.toHaveProperty('freeTables');
      const long = await http()
        .get(`${publicBase}/availability?date=${day}&partySize=2&durationMinutes=120`)
        .expect(200);
      expect(long.body.services[0].slots.map((slot: { time: string }) => slot.time)).not.toContain(
        '19:00',
      );
    } finally {
      await admin.$executeRaw`UPDATE venue_tables SET online_bookable=true WHERE tenant_id=${tenantId}::uuid AND id=${table2.id}::uuid`;
    }
  });

  it('accepts a staff clock time inside the service without snapping to online intervals or cutoffs', async () => {
    ownDay();
    const availability = await http()
      .get(`${base}/availability?date=${day}&partySize=2&time=22:45`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      availability.body.services[0].slots.find((s: { time: string }) => s.time === '22:45')
        .bookable,
    ).toBe(true);
    const online = await http()
      .get(
        `/v1/tenants/${tenantId}/restaurants/${venueId}/availability?date=${day}&partySize=2&time=22:45`,
      )
      .expect(200);
    expect(online.body.services[0].slots.map((slot: { time: string }) => slot.time)).not.toContain(
      '22:45',
    );
    await book({ time: '22:45', guestName: 'Late staff booking' }).expect(201);
    const closing = await http()
      .get(`${base}/availability?date=${day}&partySize=2&time=23:00`)
      .set('Cookie', cookie)
      .expect(200);
    expect(closing.body.services[0].slots.some((s: { time: string }) => s.time === '23:00')).toBe(
      false,
    );
    ownDay();
  });

  it('creates one website reservation from a signed quote and protects its status with a scoped token', async () => {
    ownDay();
    const publicBase = `/v1/tenants/${tenantId}/restaurants/${venueId}`;
    const quote = await http()
      .post(`${publicBase}/quote`)
      .send({ date: day, time: '19:00', partySize: 2 })
      .expect(201);
    expect(quote.body.amount).toBe('0.00');
    const body = {
      quoteToken: quote.body.quoteToken,
      guestName: 'Website Guest',
      guestEmail: 'website-guest@example.test',
      source: 'hotel_reception',
      depositAmount: '0.00',
      time: '22:00',
    };
    const created = await http().post(`${publicBase}/reservations`).send(body).expect(201);
    const repeated = await http().post(`${publicBase}/reservations`).send(body).expect(201);
    expect(repeated.body.id).toBe(created.body.id);
    const unusedQuote = await http()
      .post(`${publicBase}/quote`)
      .send({ date: day, time: '21:00', partySize: 2 })
      .expect(201);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    try {
      const recovered = await http().post(`${publicBase}/reservations`).send(body).expect(201);
      expect(recovered.body.id).toBe(created.body.id);
      await http()
        .post(`${publicBase}/reservations`)
        .send({ ...body, quoteToken: unusedQuote.body.quoteToken })
        .expect(400);
    } finally {
      clock.mockRestore();
    }
    expect(created.body).not.toHaveProperty('guestEmail');
    expect(created.body).not.toHaveProperty('tables');
    const saved = await http()
      .get(`${base}/reservations/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(saved.body.source).toBe('website');
    expect(saved.body.startsAt).toBe((await instant(day, '19:00')).toISOString());
    await http().get(`${publicBase}/reservations/${created.body.id}`).expect(400);
    await http()
      .get(`${publicBase}/reservations/${created.body.id}`)
      .set('Authorization', `Bearer ${created.body.accessToken}`)
      .expect(200);
    await http()
      .get(`/v1/tenants/${randomUUID()}/restaurants/${venueId}/reservations/${created.body.id}`)
      .set('Authorization', `Bearer ${created.body.accessToken}`)
      .expect(400);
    await http()
      .get(`${publicBase}/reservations/${randomUUID()}`)
      .set('Authorization', `Bearer ${created.body.accessToken}`)
      .expect(404);
    await http()
      .post(`${publicBase}/reservations`)
      .send({ ...body, quoteToken: `${quote.body.quoteToken}tampered` })
      .expect(400);
    await http()
      .post(`${publicBase}/reservations`)
      .send({ ...body, guestName: 'Different payload' })
      .expect(409);
  });

  it('rechecks online table eligibility at submission, even after issuing a valid quote', async () => {
    ownDay();
    const publicBase = `/v1/tenants/${tenantId}/restaurants/${venueId}`;
    const quote = await http()
      .post(`${publicBase}/quote`)
      .send({ date: day, time: '19:00', partySize: 2 })
      .expect(201);
    const payload = JSON.parse(
      Buffer.from(quote.body.quoteToken.split('.')[0], 'base64url').toString(),
    );
    const tableId = payload.selection.tableId;
    await admin.$executeRaw`UPDATE venue_tables SET online_bookable=false WHERE tenant_id=${tenantId}::uuid AND id=${tableId}::uuid`;
    try {
      await http()
        .post(`${publicBase}/reservations`)
        .send({ quoteToken: quote.body.quoteToken, guestName: 'Late website guest' })
        .expect(409);
    } finally {
      await admin.$executeRaw`UPDATE venue_tables SET online_bookable=true WHERE tenant_id=${tenantId}::uuid AND id=${tableId}::uuid`;
    }
  });

  it('books the smallest fitting table, then the next, and refuses when none is free', async () => {
    const first = await book({
      time: '20:00',
      guestName: 'Ana Hoxha',
      guestPhone: '+355 69 1',
    }).expect(201);
    expect(first.body).toMatchObject({ status: 'confirmed', partySize: 2, source: 'other' });
    expect(first.body.reference).toMatch(/^R[A-HJ-NP-Z2-9]{6}$/);
    expect(first.body.tables.map((t: { label: string }) => t.label)).toEqual(['T1']);
    const second = await book({ time: '20:00', guestName: 'Bo' }).expect(201);
    expect(second.body.tables.map((t: { label: string }) => t.label)).toEqual(['T2']);
    const third = await book({ time: '20:00', guestName: 'Cy' });
    expect(third.status).toBe(409);
    expect(third.body.code).toBe('NO_TABLE_AVAILABLE');
    // A party of six still has T3.
    const big = await book({ time: '20:00', partySize: 6, guestName: 'Dee' }).expect(201);
    expect(big.body.tables.map((t: { label: string }) => t.label)).toEqual(['T3']);
  });

  it('shows the table as busy for the whole time it is used, and free again after', async () => {
    expect((await slot('19:30')).bookable).toBe(false); // 19:30 to 21:00 overlaps 20:00
    expect((await slot('20:30')).bookable).toBe(false);
    expect((await slot('19:00')).bookable).toBe(false); // 19:00 to 20:30 overlaps 20:00
    expect((await slot('21:30')).bookable).toBe(true); // the 20:00 stay ends exactly at 21:30
  });

  it('refuses times outside the opening hours, in the past, and tables that do not fit', async () => {
    const closed = await book({ time: '17:00' });
    expect(closed.status).toBe(400);
    expect(closed.body.code).toBe('OUTSIDE_OPENING_HOURS');
    const past = await http()
      .post(`${base}/reservations`)
      .set('Cookie', cookie)
      .send({ date: localDate(-2), time: '20:00', partySize: 2, guestName: 'Late' });
    expect(past.status).toBe(400);
    expect(past.body.code).toBe('IN_THE_PAST');
    const [t3] = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM venue_tables WHERE venue_id = ${venueId}::uuid AND label = 'T3'`;
    const wrongTable = await book({ time: '22:00', tableId: t3!.id });
    expect(wrongTable.status).toBe(409);
    expect(wrongTable.body.code).toBe('TABLE_NOT_AVAILABLE');
  });

  it('never gives the same table to two requests that arrive together', async () => {
    const results = await Promise.all(
      ['Race A', 'Race B', 'Race C'].map((guestName) => book({ time: '22:00', guestName })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    const tables = results.filter((r) => r.status === 201).map((r) => r.body.tables[0].label);
    expect(new Set(tables).size).toBe(2);
  });

  it('lists a day or a range, filtered and searched', async () => {
    const all = await http()
      .get(`${base}/reservations?from=${day}&to=${day}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(all.body.timezone).toBe('Europe/Tirane');
    const times = all.body.reservations.map((r: { startsAt: string }) => r.startsAt);
    expect([...times].sort()).toEqual(times);
    const ana = await http()
      .get(`${base}/reservations?from=${day}&q=hoxha`)
      .set('Cookie', cookie)
      .expect(200);
    expect(ana.body.reservations.map((r: { guestName: string }) => r.guestName)).toEqual([
      'Ana Hoxha',
    ]);
    const none = await http()
      .get(`${base}/reservations?from=${day}&status=cancelled`)
      .set('Cookie', cookie)
      .expect(200);
    expect(none.body.reservations).toEqual([]);
    await http().get(`${base}/reservations`).set('Cookie', cookie).expect(400);
  });

  it('moves a booking through seated and completed, and rejects impossible changes', async () => {
    ownDay();
    const created = await book({ time: '19:00', guestName: 'Flow' }).expect(201);
    const id = created.body.id as string;
    const status = (s: string) =>
      http().post(`${base}/reservations/${id}/status`).set('Cookie', cookie).send({ status: s });
    expect((await status('seated')).body).toMatchObject({ status: 'seated' });
    expect((await status('seated')).status).toBe(201);
    expect((await status('completed')).body).toMatchObject({ status: 'completed' });
    const done = await http().get(`${base}/reservations/${id}`).set('Cookie', cookie).expect(200);
    expect(done.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'confirmed',
      'seated',
      'completed',
    ]);
    expect((await status('seated')).status).toBe(409);
    // A booking in the future cannot be a no-show yet.
    const later = await book({ time: '21:30', guestName: 'Future' }).expect(201);
    const early = await http()
      .post(`${base}/reservations/${later.body.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'no_show' });
    expect(early.status).toBe(409);
    // Cancelling frees the table.
    await http()
      .post(`${base}/reservations/${later.body.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'cancelled', note: 'Guest called' })
      .expect(201);
    expect((await slot('21:30')).freeTables.length).toBeGreaterThan(0);
  });

  it('changes a booking: time, party and details, re-checking the table', async () => {
    ownDay();
    const created = await book({ time: '21:00', guestName: 'Move Me' }).expect(201);
    const url = `${base}/reservations/${created.body.id}`;
    const moved = await http().patch(url).set('Cookie', cookie).send({ time: '21:30' }).expect(200);
    expect(moved.body.startsAt).not.toBe(created.body.startsAt);
    const bigger = await http().patch(url).set('Cookie', cookie).send({ partySize: 5 }).expect(200);
    expect(bigger.body.tables.map((t: { label: string }) => t.label)).toEqual(['T3']);
    const noted = await http()
      .patch(url)
      .set('Cookie', cookie)
      .send({ notes: 'Birthday', guestPhone: '' })
      .expect(200);
    expect(noted.body).toMatchObject({ notes: 'Birthday', guestPhone: null });
    // Moving onto a time when every fitting table is taken is refused.
    await book({ time: '20:00', partySize: 6, guestName: 'Big Table' }).expect(201);
    const clash = await http()
      .patch(url)
      .set('Cookie', cookie)
      .send({ time: '20:00', partySize: 6 });
    expect(clash.status).toBe(409);
  });

  it('shows what every table looks like at a moment, for the live floor plan', async () => {
    ownDay();
    const created = await book({ time: '19:00', guestName: 'Floor' }).expect(201);
    const at = await instant(day, '19:20');
    const floor = await http()
      .get(`${base}/floor?at=${encodeURIComponent(at.toISOString())}`)
      .set('Cookie', cookie)
      .expect(200);
    const tables = floor.body.areas[0].tables as Array<{
      label: string;
      status: string;
      current: { guestName: string } | null;
    }>;
    const t1 = tables.find((t) => t.label === 'T1')!;
    expect(['reserved', 'free']).toContain(t1.status);
    expect(tables.some((t) => t.current?.guestName === 'Floor' && t.status === 'reserved')).toBe(
      true,
    );
    await http()
      .post(`${base}/reservations/${created.body.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'seated' })
      .expect(201);
    const seated = await http()
      .get(`${base}/floor?at=${encodeURIComponent(at.toISOString())}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (
        seated.body.areas[0].tables as Array<{
          status: string;
          current: { guestName: string } | null;
        }>
      ).some((t) => t.current?.guestName === 'Floor' && t.status === 'seated'),
    ).toBe(true);
    await http().get(`${base}/floor?at=not-a-date`).set('Cookie', cookie).expect(400);
    await http()
      .post(`${base}/reservations/${created.body.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'completed' })
      .expect(201);
  });

  it("puts a booking with an email on the hotel guest's profile, once", async () => {
    ownDay();
    const email = `guest-${randomUUID()}@example.test`;
    const one = await book({
      time: '19:30',
      partySize: 3,
      guestName: 'Eli Dema',
      guestEmail: email,
    }).expect(201);
    const two = await book({
      time: '21:30',
      partySize: 3,
      guestName: 'Eli Dema',
      guestEmail: email,
    }).expect(201);
    expect(one.body.guestId).toBeTruthy();
    expect(two.body.guestId).toBe(one.body.guestId);
    const guests = await admin.$queryRaw<Array<{ n: number; first: string; last: string }>>`
      SELECT COUNT(*)::int AS n, MIN(first_name) AS first, MIN(last_name) AS last FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}`;
    expect(guests[0]).toEqual({ n: 1, first: 'Eli', last: 'Dema' });
  });

  it('shows a hotel guest as in-house when their stay covers the booking date', async () => {
    ownDay();
    const email = `inhouse-${randomUUID()}@example.test`;
    const made = await book({ time: '20:30', guestName: 'Room Guest', guestEmail: email }).expect(
      201,
    );
    const guestId = made.body.guestId as string;
    const reservationUrl = `${base}/reservations/${made.body.id}`;
    const before = await http().get(reservationUrl).set('Cookie', cookie).expect(200);
    expect(before.body.stay).toBeNull();

    // The same guest has a confirmed stay at the hotel that covers the booking date.
    const roomType = randomUUID();
    const ratePlan = randomUUID();
    const stay = randomUUID();
    await admin.$executeRaw`
      INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
      VALUES (${roomType}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Double', 2)`;
    await admin.$executeRaw`
      INSERT INTO rate_plans (id, tenant_id, property_id, name, currency)
      VALUES (${ratePlan}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, 'Standard', 'ALL')`;
    await admin.$executeRaw`
      INSERT INTO bookings (id, tenant_id, property_id, guest_id, room_type_id, rate_plan_id, external_reference, starts_on, ends_on, total_amount, status, payment_method, source)
      VALUES (${stay}::uuid, ${tenantId}::uuid, ${propertyId}::uuid, ${guestId}::uuid, ${roomType}::uuid, ${ratePlan}::uuid,
              ${'RES-' + stay}, ${day}::date - 1, ${day}::date + 2, 200, 'CONFIRMED', 'PAY_AT_HOTEL', 'DIRECT')`;
    const during = await http().get(reservationUrl).set('Cookie', cookie).expect(200);
    expect(during.body.stay).toMatchObject({ bookingId: stay, room: null });
    const listed = await http()
      .get(`${base}/reservations?from=${day}&q=Room Guest`)
      .set('Cookie', cookie)
      .expect(200);
    expect(listed.body.reservations[0].stay).toMatchObject({ bookingId: stay });
  });

  it('refuses a restaurant that has not finished its setup, and people without access', async () => {
    ownDay();
    const fresh = (
      await http()
        .post(`/tenants/${tenantId}/venues`)
        .set('Cookie', cookie)
        .send({ name: 'Unfinished' })
        .expect(201)
    ).body.id as string;
    const blocked = await http()
      .post(`/tenants/${tenantId}/venues/${fresh}/reservations`)
      .set('Cookie', cookie)
      .send({ date: day, time: '20:00', partySize: 2, guestName: 'Nobody' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('SETUP_NOT_COMPLETE');

    // A waiter of this restaurant may book; a workspace member with no restaurant access may not.
    const password = 'correct-horse-battery-1';
    const waiterEmail = `waiter-${randomUUID()}@example.test`;
    const waiter = await http()
      .post(`${base}/staff`)
      .set('Cookie', cookie)
      .send({ firstName: 'Wai', email: waiterEmail, password, role: 'HOST' })
      .expect(201);
    users.push(waiter.body.userId);
    const waiterCookie = (
      await http().post('/auth/login').send({ email: waiterEmail, password }).expect(201)
    ).headers['set-cookie'][0] as string;
    await book({ time: '19:00', guestName: 'By Waiter' }, waiterCookie).expect(201);

    // A workspace member with no restaurant access cannot even read the bookings.
    const outsiderEmail = `outsider-${randomUUID()}@example.test`;
    await clearSignupRateLimits();
    const outsider = await http()
      .post('/auth/signup')
      .send({
        organizationName: 'Outsider Group',
        propertyName: 'Elsewhere',
        propertyAddress: '2 Side Street',
        propertyTimezone: 'Europe/Tirane',
        email: outsiderEmail,
        password: 'correct-horse-battery-staple',
      })
      .expect(201);
    tenants.push(outsider.body.organization.id);
    users.push(outsider.body.user.id);
    await admin.$executeRaw`
      INSERT INTO tenant_memberships (tenant_id, user_id, role)
      VALUES (${tenantId}::uuid, ${outsider.body.user.id}::uuid, 'STAFF')`;
    const outsiderCookie = outsider.headers['set-cookie'][0] as string;
    await http().get(`${base}/reservations?from=${day}`).set('Cookie', outsiderCookie).expect(403);
    await book({ time: '19:00' }, outsiderCookie).expect(403);
  });
  it('stores table options, limits online offers, and uses priority for the best fit', async () => {
    ownDay();
    const layout = (await http().get(`${base}/layout`).set('Cookie', cookie).expect(200)).body;
    const [one, two] = layout.areas[0].tables;
    await http()
      .patch(`${base}/tables/${two.id}`)
      .set('Cookie', cookie)
      .send({
        notes: 'Near window',
        features: ['window', 'accessible'],
        onlineBookable: false,
        priority: 30,
      })
      .expect(200);
    try {
      const online = (
        await http()
          .get(`${base}/availability?date=${day}&partySize=2&channel=online`)
          .set('Cookie', cookie)
          .expect(200)
      ).body.services[0].slots[0];
      expect(online.freeTables.map((t: { id: string }) => t.id)).toEqual([one.id]);
      const staff = await slot('19:00');
      expect(staff.bestTableId).toBe(two.id);
      const stored = (
        await http().get(`${base}/layout`).set('Cookie', cookie).expect(200)
      ).body.areas[0].tables.find((t: { id: string }) => t.id === two.id);
      expect(stored).toMatchObject({
        notes: 'Near window',
        features: ['window', 'accessible'],
        onlineBookable: false,
        priority: 30,
      });
      const booking = await book({ time: '19:00' }).expect(201);
      expect(booking.body.tables[0].id).toBe(two.id);
    } finally {
      await http()
        .patch(`${base}/tables/${two.id}`)
        .set('Cookie', cookie)
        .send({ onlineBookable: true, priority: 0 })
        .expect(200);
    }
  });
  it('returns state at from and only bookings overlapping an end-exclusive floor period', async () => {
    ownDay();
    const first = await book({ time: '19:00', guestName: 'First period booking' }).expect(201);
    const tableId = first.body.tables[0].id;
    const second = await book({
      time: '20:30',
      tableId,
      guestName: 'Second period booking',
    }).expect(201);
    const from = await instant(day, '18:45');
    const to = await instant(day, '20:30');
    const floor = (
      await http()
        .get(
          `${base}/floor?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        )
        .set('Cookie', cookie)
        .expect(200)
    ).body;
    expect(floor.from).toBe(from.toISOString());
    expect(floor.to).toBe(to.toISOString());
    const table = floor.areas[0].tables.find((t: { id: string }) => t.id === tableId);
    expect(table.bookings.map((b: { id: string }) => b.id)).toEqual([first.body.id]);
    expect(table.bookings.some((b: { id: string }) => b.id === second.body.id)).toBe(false);
    const moment = (
      await http()
        .get(`${base}/floor?at=${encodeURIComponent((await instant(day, '19:15')).toISOString())}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body;
    expect(moment.areas[0].tables.find((t: { id: string }) => t.id === tableId).status).toBe(
      'reserved',
    );
    await http()
      .get(`${base}/floor?from=${encodeURIComponent(from.toISOString())}`)
      .set('Cookie', cookie)
      .expect(400);
  });
  it('pages and sorts the directory, groups free tables by area, and searches guest contacts', async () => {
    ownDay();
    await book({
      time: '19:00',
      guestName: 'Zebra',
      guestEmail: 'zebra@example.test',
      guestPhone: '+355691112233',
      source: 'instagram',
      durationMinutes: 120,
    }).expect(201);
    await book({
      time: '19:00',
      guestName: 'Alpha',
      guestEmail: 'alpha@example.test',
      source: 'whatsapp',
    }).expect(201);
    const page = await http()
      .get(`${base}/reservations?from=${day}&sort=guestName&order=asc&limit=1&offset=1`)
      .set('Cookie', cookie)
      .expect(200);
    expect(page.body.total).toBe(2);
    expect(page.body.reservations[0].guestName).toBe('Zebra');
    const available = await http()
      .get(`${base}/availability?date=${day}&partySize=2&time=20:45&durationMinutes=120`)
      .set('Cookie', cookie)
      .expect(200);
    const at = available.body.services[0].slots.find((r: { time: string }) => r.time === '20:45');
    expect(at.freeAreas[0].name).toBe('Terrace');
    expect(
      at.freeTables.some((t: { id: string }) => t.id === page.body.reservations[0].tables[0].id),
    ).toBe(false);
    const guests = await http()
      .get(`${base}/guests?search=zebra`)
      .set('Cookie', cookie)
      .expect(200);
    expect(guests.body[0]).toMatchObject({ email: 'zebra@example.test', bookingCount: 1 });
    const phoneMatch = await http()
      .get(`${base}/guests?search=69111`)
      .set('Cookie', cookie)
      .expect(200);
    expect(
      phoneMatch.body.some((guest: { email: string }) => guest.email === 'zebra@example.test'),
    ).toBe(true);
    await http()
      .get(`${base}/reservations?from=${day}&sort=guestName;DROP`)
      .set('Cookie', cookie)
      .expect(400);
  });

  it('preserves service rules through hours edits and freezes exact deposits with idempotent payment/expiry', async () => {
    ownDay();
    const services = (await http().get(`${base}/services`).set('Cookie', cookie).expect(200)).body;
    const layout = (await http().get(`${base}/layout`).set('Cookie', cookie).expect(200)).body;
    const areaId = layout.areas[0].id,
      tableId = layout.areas[0].tables[0].id;
    const rules = [
      {
        serviceId: null,
        areaId: null,
        mode: 'per_booking',
        amount: '10.00',
        minParty: 1,
        freeCancelHours: 24,
      },
      {
        serviceId: services[0].id,
        areaId,
        mode: 'per_guest',
        amount: '20.00',
        minParty: 2,
        freeCancelHours: 24,
      },
    ];
    const policy = await http().get(`${base}/deposit-rules`).set('Cookie', cookie).expect(200);
    const saved = await http()
      .put(`${base}/deposit-rules`)
      .set('Cookie', cookie)
      .send({ version: policy.body.version, rules })
      .expect(200);
    const hours = await http()
      .put(`${base}/services`)
      .set('Cookie', cookie)
      .send({ services: services.map((r: Record<string, unknown>) => ({ ...r, slotMinutes: 15 })) })
      .expect(200);
    expect(hours.body[0].id).toBe(services[0].id);
    expect(
      (await http().get(`${base}/deposit-rules`).set('Cookie', cookie)).body.rules,
    ).toHaveLength(2);
    await http()
      .put(`${base}/deposit-rules`)
      .set('Cookie', cookie)
      .send({ version: saved.body.version, rules: [] })
      .expect(409);
    const payload = { date: day, time: '19:00', partySize: 2, tableId, durationMinutes: 90 };
    const quote = await http()
      .post(`${base}/deposit-rules/quote`)
      .set('Cookie', cookie)
      .send(payload)
      .expect(201);
    expect(quote.body).toMatchObject({ amount: '40.00', currency: 'ALL', canOverride: true });
    const waiterEmail = `deposit-waiter-${randomUUID()}@example.test`;
    const waiter = await http()
      .post(`${base}/staff`)
      .set('Cookie', cookie)
      .send({
        firstName: 'Deposit waiter',
        email: waiterEmail,
        password: 'local-waiter-test-2026',
        role: 'HOST',
      })
      .expect(201);
    users.push(waiter.body.userId);
    const waiterCookie = (
      await http()
        .post('/auth/login')
        .send({ email: waiterEmail, password: 'local-waiter-test-2026' })
        .expect(201)
    ).headers['set-cookie'][0] as string;
    await http()
      .post(`${base}/deposit-rules/quote`)
      .set('Cookie', waiterCookie)
      .send({ ...payload, depositAmount: '0.00', depositOverrideReason: 'Waive charge' })
      .expect(403);
    await http()
      .put(`${base}/deposit-rules`)
      .set('Cookie', waiterCookie)
      .send({ version: quote.body.version, rules: [] })
      .expect(403);
    await http()
      .post(`${base}/deposit-rules/quote`)
      .set('Cookie', cookie)
      .send({ ...payload, depositAmount: '0.00' })
      .expect(400);
    const payments = app!.get(VenueDepositPaymentsService),
      gateway = app!.get(PokPayPaymentProvider);
    const stage = vi.spyOn(payments, 'requireStaging').mockResolvedValue(undefined);
    const create = vi.spyOn(gateway, 'createCheckoutSession').mockImplementation(async () => ({
      ok: true,
      value: { id: randomUUID(), url: 'https://staging.example.test/pay' },
    }));
    const reread = vi.spyOn(gateway, 'getPayment');
    const refund = vi.spyOn(gateway, 'refund').mockResolvedValue({
      ok: true,
      value: {
        id: 'refund-test',
        bookingId: 'unused',
        status: 'REFUNDED',
        amount: { amount: '40.00', currency: 'ALL' },
      },
    });
    try {
      const requestKey = randomUUID();
      const body = {
        ...payload,
        guestName: 'Deposit guest',
        guestEmail: `deposit-${randomUUID()}@example.test`,
        requestKey,
        depositQuoteHash: quote.body.quoteHash,
      };
      const booking = await book(body).expect(201);
      expect(booking.body.status).toBe('pending_payment');
      expect(booking.body.checkout.url).toContain('staging');
      const replay = await book(body).expect(201);
      expect(replay.body.id).toBe(booking.body.id);
      expect(create).toHaveBeenCalledTimes(1);
      await http()
        .post(`${base}/reservations/${booking.body.id}/send-payment-link`)
        .set('Cookie', cookie)
        .expect(201);
      await http()
        .post(`${base}/reservations/${booking.body.id}/send-payment-link`)
        .set('Cookie', cookie)
        .expect(201);
      expect(
        (
          await admin.$queryRaw<
            Array<{ n: number }>
          >`SELECT count(*)::integer AS n FROM email_messages WHERE tenant_id=${tenantId}::uuid AND idempotency_key=${`restaurant-deposit-link:${booking.body.id}`}`
        )[0]!.n,
      ).toBe(1);

      await book({ ...body, guestName: 'Changed' }).expect(409);
      await http()
        .post(`${base}/reservations/${booking.body.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'confirmed' })
        .expect(409);
      const order = await admin.$queryRaw<
        Array<{ id: string }>
      >`SELECT external_payment_id AS id FROM venue_deposit_operations WHERE tenant_id=${tenantId}::uuid AND reservation_id=${booking.body.id}::uuid AND kind='checkout'`;
      reread.mockResolvedValue({
        id: order[0]!.id,
        bookingId: 'unused',
        status: 'PAID',
        amount: { amount: '39.00', currency: 'ALL' },
      });
      expect((await payments.process(tenantId, propertyId, order[0]!.id)).ok).toBe(false);
      reread.mockResolvedValue({
        id: order[0]!.id,
        bookingId: 'unused',
        status: 'PAID',
        amount: { amount: '40.00', currency: 'ALL' },
      });
      await http().post('/webhooks/pokpay').send({ orderId: order[0]!.id }).expect(200);
      expect(await payments.process(tenantId, propertyId, order[0]!.id)).toMatchObject({
        ok: true,
        value: { duplicate: true },
      });
      const detail = await http()
        .get(`${base}/reservations/${booking.body.id}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(detail.body).toMatchObject({
        status: 'confirmed',
        paidDeposit: '40.00',
        depositTerms: { amount: '40.00' },
      });
      await http()
        .post(`${base}/reservations/${booking.body.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'cancelled' })
        .expect(201);
      expect(refund).toHaveBeenCalledTimes(1);
      await http()
        .post(`${base}/reservations/${booking.body.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'cancelled' })
        .expect(201);
      expect(refund).toHaveBeenCalledTimes(1);
      const late = await book({ ...body, requestKey: randomUUID() }).expect(201);
      const lateOrder = (
        await admin.$queryRaw<
          Array<{ id: string }>
        >`SELECT external_payment_id AS id FROM venue_deposit_operations WHERE tenant_id=${tenantId}::uuid AND reservation_id=${late.body.id}::uuid AND kind='checkout'`
      )[0]!.id;
      await admin.$executeRaw`UPDATE venue_reservations SET payment_hold_expires_at=now()-interval '1 minute' WHERE tenant_id=${tenantId}::uuid AND id=${late.body.id}::uuid`;
      expect((await slot('19:00')).freeTables.some((t: { id: string }) => t.id === tableId)).toBe(
        true,
      );
      reread.mockResolvedValue({
        id: lateOrder,
        bookingId: 'unused',
        status: 'PAID',
        amount: { amount: '40.00', currency: 'ALL' },
      });
      await payments.sweep();
      const expired = (
        await http().get(`${base}/reservations/${late.body.id}`).set('Cookie', cookie)
      ).body;
      expect(expired).toMatchObject({
        status: 'cancelled',
        requiresRefundReview: true,
        paidDeposit: '40.00',
      });
      const uncertainBody = { ...body, requestKey: randomUUID() };
      create.mockRejectedValueOnce(new Error('simulated lost provider response'));
      const countBefore = create.mock.calls.length;
      const uncertain = await book(uncertainBody).expect(201);
      expect(uncertain.body.checkout.state).toBe('UNCERTAIN');
      expect((await book(uncertainBody).expect(201)).body.id).toBe(uncertain.body.id);
      expect(create.mock.calls.length).toBe(countBefore + 1);
      await expect(
        app!
          .get(TenantDatabaseService)
          .withTenantTransaction(
            { tenantId },
            (tx) =>
              tx.$executeRaw`UPDATE venue_deposit_receipts SET amount=1 WHERE tenant_id=${tenantId}::uuid`,
          ),
      ).rejects.toThrow();
      await expect(
        admin.$executeRaw`UPDATE venue_reservations SET deposit_terms='{}'::jsonb WHERE tenant_id=${tenantId}::uuid AND id=${booking.body.id}::uuid`,
      ).rejects.toThrow();
      expect(
        (
          await admin.$queryRaw<
            Array<{ n: number }>
          >`SELECT count(*)::integer AS n FROM payments WHERE tenant_id=${tenantId}::uuid AND external_payment_id=${lateOrder}`
        )[0]!.n,
      ).toBe(0);
      const expanded = (
        await http()
          .put(`${base}/services`)
          .set('Cookie', cookie)
          .send({
            services: [
              ...hours.body,
              {
                name: 'Lunch',
                days: [1, 2, 3, 4, 5, 6, 7],
                opensAt: '12:00',
                closesAt: '15:00',
                slotMinutes: 30,
              },
            ],
          })
          .expect(200)
      ).body;
      const renamed = (
        await http()
          .put(`${base}/services`)
          .set('Cookie', cookie)
          .send({
            services: expanded.map((r: { id: string; name: string }) => ({
              ...r,
              name: r.id === services[0].id ? 'Lunch' : 'Dinner',
            })),
          })
          .expect(200)
      ).body;
      expect(renamed.find((r: { id: string }) => r.id === services[0].id).name).toBe('Lunch');
      expect(
        (await http().get(`${base}/deposit-rules`).set('Cookie', cookie)).body.rules.some(
          (r: { serviceId: string }) => r.serviceId === services[0].id,
        ),
      ).toBe(true);
      const current = (await http().get(`${base}/deposit-rules`).set('Cookie', cookie)).body;
      await http()
        .put(`${base}/deposit-rules`)
        .set('Cookie', cookie)
        .send({ version: current.version, rules: [] })
        .expect(200);
      expect(
        (await http().get(`${base}/reservations/${booking.body.id}`).set('Cookie', cookie)).body
          .depositTerms.amount,
      ).toBe('40.00');
      ownDay();
      const nonePolicy = (await http().get(`${base}/deposit-rules`).set('Cookie', cookie)).body;
      const minimumPolicy = await http()
        .put(`${base}/deposit-rules`)
        .set('Cookie', cookie)
        .send({
          version: nonePolicy.version,
          rules: [
            {
              serviceId: null,
              areaId: null,
              mode: 'per_guest',
              amount: '20.00',
              minParty: 3,
              freeCancelHours: 24,
            },
          ],
        })
        .expect(200);
      const small = await book({
        time: '19:00',
        partySize: 2,
        guestName: 'Below deposit minimum',
      }).expect(201);
      expect(small.body).toMatchObject({
        status: 'confirmed',
        depositTerms: { amount: '0.00', minParty: 3 },
      });
      await http()
        .patch(`${base}/reservations/${small.body.id}`)
        .set('Cookie', waiterCookie)
        .send({ partySize: 3 })
        .expect(409);
      expect(
        (await http().get(`${base}/reservations/${small.body.id}`).set('Cookie', cookie)).body
          .partySize,
      ).toBe(2);
      const publicBase = `/v1/tenants/${tenantId}/restaurants/${venueId}`;
      const websiteQuote = await http()
        .post(`${publicBase}/quote`)
        .send({ date: day, time: '21:00', partySize: 3 })
        .expect(201);
      expect(websiteQuote.body.amount).toBe('60.00');
      const website = await http()
        .post(`${publicBase}/reservations`)
        .send({
          quoteToken: websiteQuote.body.quoteToken,
          guestName: 'Website deposit guest',
          depositAmount: '0.00',
          depositOverrideReason: 'Trying to waive',
        })
        .expect(201);
      expect(website.body).toMatchObject({
        status: 'pending_payment',
        deposit: { amount: '60.00', currency: 'ALL' },
        checkout: { url: 'https://staging.example.test/pay' },
      });
      const websiteOrder = await admin.$queryRaw<
        Array<{ id: string }>
      >`SELECT external_payment_id AS id FROM venue_deposit_operations WHERE tenant_id=${tenantId}::uuid AND reservation_id=${website.body.id}::uuid AND kind='checkout'`;
      reread.mockResolvedValue({
        id: websiteOrder[0].id,
        bookingId: 'unused',
        status: 'PAID',
        amount: { amount: '60.00', currency: 'ALL' },
      });
      expect((await payments.process(tenantId, propertyId, websiteOrder[0].id)).ok).toBe(true);
      const websiteStatus = await http()
        .get(`${publicBase}/reservations/${website.body.id}`)
        .set('Authorization', `Bearer ${website.body.accessToken}`)
        .expect(200);
      expect(websiteStatus.body.status).toBe('confirmed');
      expect(websiteStatus.body).not.toHaveProperty('guestName');
      await http()
        .put(`${base}/deposit-rules`)
        .set('Cookie', cookie)
        .send({ version: minimumPolicy.body.version, rules: [] })
        .expect(200);
    } finally {
      stage.mockRestore();
      create.mockRestore();
      reread.mockRestore();
      refund.mockRestore();
    }
  });
});
