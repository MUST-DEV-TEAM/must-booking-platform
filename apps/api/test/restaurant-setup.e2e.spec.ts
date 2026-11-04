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

type Account = {
  email: string;
  tenantId: string;
  propertyId: string;
  userId: string;
  cookie: string;
};

describe('restaurant integration and first-time setup', () => {
  let app: INestApplication | undefined;
  let planId: string;
  const tokens = new Map<string, string>();
  const accounts: Account[] = [];
  const extraUserIds: string[] = [];
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

  async function signUp(label: string): Promise<Account> {
    const email = `restaurant-${label}-${randomUUID()}@example.test`;
    await clearSignupRateLimits();
    const signup = await http()
      .post('/auth/signup')
      .send({
        organizationName: `Restaurant ${label}`,
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
    const account = {
      email,
      tenantId: signup.body.organization.id as string,
      propertyId: signup.body.property.id as string,
      userId: signup.body.user.id as string,
      cookie: signup.headers['set-cookie'][0] as string,
    };
    accounts.push(account);
    return account;
  }

  const setDining = (tenantId: string, enabled: boolean, maxVenues: number) =>
    admin.$executeRaw`UPDATE plans SET dining_enabled = ${enabled}, max_venues = ${maxVenues} WHERE id = ${planId}::uuid`.then(
      () =>
        admin.$executeRaw`UPDATE organizations SET plan_id = ${planId}::uuid WHERE id = ${tenantId}::uuid`,
    );

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
      INSERT INTO plans (id, name, max_properties, max_staff_seats, max_pms_connections_per_property, is_public)
      VALUES (${planId}::uuid, ${`Restaurant setup e2e ${planId}`}, 5, 10, 0, false)`;
  });

  afterAll(async () => {
    for (const account of accounts) await cleanupTenant(admin, account.tenantId);
    for (const id of [...accounts.map((a) => a.userId), ...extraUserIds])
      await admin.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`;
    if (planId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${planId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  const restaurantUrl = (a: Account) =>
    `/tenants/${a.tenantId}/properties/${a.propertyId}/restaurant`;

  it('starts off and can be activated despite legacy plan dining being disabled', async () => {
    const owner = await signUp('plan');
    const status = await http().get(restaurantUrl(owner)).set('Cookie', owner.cookie).expect(200);
    expect(status.body).toEqual({ available: true, venue: null });
    const activated = await http()
      .post(`${restaurantUrl(owner)}/activate`)
      .set('Cookie', owner.cookie)
      .expect(201);
    expect(activated.body).toMatchObject({ available: true, venue: { active: true } });
  });

  it('switches on from the hotel details, off without losing anything, and on again', async () => {
    const owner = await signUp('toggle');
    await setDining(owner.tenantId, true, 1);

    const before = await http().get(restaurantUrl(owner)).set('Cookie', owner.cookie).expect(200);
    expect(before.body).toEqual({ available: true, venue: null });
    const usage = () =>
      http().get(`/tenants/${owner.tenantId}/plan-usage`).set('Cookie', owner.cookie);
    expect((await usage()).body.usage.venues).toBe(0);

    const on = await http()
      .post(`${restaurantUrl(owner)}/activate`)
      .set('Cookie', owner.cookie)
      .expect(201);
    expect(on.body.venue).toMatchObject({
      name: 'Hotel Restaurant',
      active: true,
      setupCompletedAt: null,
    });
    const venueId = on.body.venue.id as string;
    expect((await usage()).body.usage.venues).toBe(1);

    // It is linked to the hotel and inherits its time zone.
    const venue = await http()
      .get(`/tenants/${owner.tenantId}/venues/${venueId}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(venue.body).toMatchObject({ propertyId: owner.propertyId, timezone: 'Europe/Tirane' });

    const off = await http()
      .post(`${restaurantUrl(owner)}/deactivate`)
      .set('Cookie', owner.cookie)
      .expect(201);
    expect(off.body.venue).toMatchObject({ id: venueId, active: false });
    expect((await usage()).body.usage.venues).toBe(0);

    const again = await http()
      .post(`${restaurantUrl(owner)}/activate`)
      .set('Cookie', owner.cookie)
      .expect(201);
    expect(again.body.venue).toMatchObject({ id: venueId, active: true });
  });

  it('keeps the restaurant settings when it is switched off and on', async () => {
    const owner = await signUp('keep');
    await setDining(owner.tenantId, true, 1);
    const venueId = (
      await http()
        .post(`${restaurantUrl(owner)}/activate`)
        .set('Cookie', owner.cookie)
        .expect(201)
    ).body.venue.id as string;
    const url = `/tenants/${owner.tenantId}/venues/${venueId}`;
    await http()
      .patch(url)
      .set('Cookie', owner.cookie)
      .send({ description: 'Grilled fish by the sea', holdMinutes: 15 })
      .expect(200);
    await http()
      .post(`${restaurantUrl(owner)}/deactivate`)
      .set('Cookie', owner.cookie)
      .expect(201);
    await http()
      .post(`${restaurantUrl(owner)}/activate`)
      .set('Cookie', owner.cookie)
      .expect(201);
    const kept = await http().get(url).set('Cookie', owner.cookie).expect(200);
    expect(kept.body).toMatchObject({ description: 'Grilled fish by the sea', holdMinutes: 15 });
  });

  it('stores booking rules and the simple deposit rule, and rejects impossible values', async () => {
    const owner = await signUp('rules');
    await setDining(owner.tenantId, true, 1);
    const venueId = (
      await http()
        .post(`${restaurantUrl(owner)}/activate`)
        .set('Cookie', owner.cookie)
        .expect(201)
    ).body.venue.id as string;
    const url = `/tenants/${owner.tenantId}/venues/${venueId}`;

    const defaults = await http().get(url).set('Cookie', owner.cookie).expect(200);
    expect(defaults.body).toMatchObject({
      advanceBookingDays: 60,
      maxOnlinePartySize: 8,
      holdMinutes: 10,
      diningMinutes: 90,
      depositMode: 'none',
      depositValue: '0.00',
      freeCancelHours: 24,
    });

    const saved = await http()
      .patch(url)
      .set('Cookie', owner.cookie)
      .send({ depositMode: 'percent', depositValue: 30, depositMinParty: 6, freeCancelHours: 48 })
      .expect(200);
    expect(saved.body).toMatchObject({
      depositMode: 'percent',
      depositValue: '30.00',
      depositMinParty: 6,
      freeCancelHours: 48,
    });

    await http().patch(url).set('Cookie', owner.cookie).send({ holdMinutes: 2 }).expect(400);
    await http()
      .patch(url)
      .set('Cookie', owner.cookie)
      .send({ depositMode: 'percent', depositValue: 150 })
      .expect(400);
    // A percentage over 100 is also caught when only the amount is sent for a percentage restaurant.
    await http().patch(url).set('Cookie', owner.cookie).send({ depositValue: 150 }).expect(400);
  });

  it('only lets the setup be finished once the essentials exist', async () => {
    const owner = await signUp('finish');
    await setDining(owner.tenantId, true, 1);
    const venueId = (
      await http()
        .post(`${restaurantUrl(owner)}/activate`)
        .set('Cookie', owner.cookie)
        .expect(201)
    ).body.venue.id as string;
    const url = `/tenants/${owner.tenantId}/venues/${venueId}`;
    const finish = () => http().post(`${url}/complete-setup`).set('Cookie', owner.cookie);

    const empty = await finish();
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('SETUP_INCOMPLETE');
    expect(empty.body.missing).toEqual(expect.arrayContaining(['hours', 'tables']));

    // Opening hours: saved in one go, read back as HH:MM, and overlapping hours are refused.
    const hours = await http()
      .put(`${url}/services`)
      .set('Cookie', owner.cookie)
      .send({
        services: [
          { name: 'Dinner', days: [1, 2, 3, 4, 5, 6, 7], opensAt: '19:00', closesAt: '23:00' },
          { name: 'Lunch', days: [6, 7], opensAt: '12:00', closesAt: '15:30', slotMinutes: 15 },
        ],
      })
      .expect(200);
    expect(hours.body.map((s: { name: string }) => s.name)).toEqual(['Lunch', 'Dinner']);
    expect(hours.body[0]).toMatchObject({
      days: [6, 7],
      opensAt: '12:00',
      closesAt: '15:30',
      slotMinutes: 15,
    });
    await http()
      .put(`${url}/services`)
      .set('Cookie', owner.cookie)
      .send({
        services: [
          { name: 'A', days: [1], opensAt: '12:00', closesAt: '16:00' },
          { name: 'B', days: [1], opensAt: '15:00', closesAt: '20:00' },
        ],
      })
      .expect(400);
    const stillThere = await http().get(`${url}/services`).set('Cookie', owner.cookie).expect(200);
    expect(stillThere.body).toHaveLength(2);

    const noTables = await finish();
    expect(noTables.body.missing).toEqual(expect.arrayContaining(['tables']));
    expect(noTables.body.missing).not.toContain('hours');

    // Currency is part of the basics; the hotel may not have one, so set it explicitly.
    await http().patch(url).set('Cookie', owner.cookie).send({ currency: 'ALL' }).expect(200);
    const area = (
      await http()
        .post(`${url}/areas`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Terrace' })
        .expect(201)
    ).body;
    await http()
      .post(`${url}/areas/${area.id}/tables`)
      .set('Cookie', owner.cookie)
      .send({ label: 'T1', minSeats: 2, maxSeats: 4 })
      .expect(201);

    const done = await finish().expect(201);
    expect(done.body.setupCompletedAt).not.toBeNull();
    const again = await finish().expect(201);
    expect(again.body.setupCompletedAt).toBe(done.body.setupCompletedAt);
  });

  it("lets a waiter reach the hotel their restaurant belongs to, and nothing else of the hotel's", async () => {
    const owner = await signUp('waiter-hotel');
    await setDining(owner.tenantId, true, 2);
    const venueId = (
      await http()
        .post(`${restaurantUrl(owner)}/activate`)
        .set('Cookie', owner.cookie)
        .expect(201)
    ).body.venue.id as string;
    const standalone = (
      await http()
        .post(`/tenants/${owner.tenantId}/venues`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Stand-alone Bar' })
        .expect(201)
    ).body.id as string;
    const password = 'correct-horse-battery-1';
    const makeStaff = async (venue: string, label: string) => {
      const email = `${label}-${randomUUID()}@example.test`;
      const created = await http()
        .post(`/tenants/${owner.tenantId}/venues/${venue}/staff`)
        .set('Cookie', owner.cookie)
        .send({ firstName: label, email, password, role: 'HOST' })
        .expect(201);
      extraUserIds.push(created.body.userId);
      const login = await http().post('/auth/login').send({ email, password }).expect(201);
      return login.headers['set-cookie'][0] as string;
    };

    const hotelWaiter = await makeStaff(venueId, 'hotelwaiter');
    const barWaiter = await makeStaff(standalone, 'barwaiter');

    const hotels = await http()
      .get(`/tenants/${owner.tenantId}/properties`)
      .set('Cookie', hotelWaiter)
      .expect(200);
    expect(hotels.body.map((p: { id: string }) => p.id)).toEqual([owner.propertyId]);
    // A waiter at a stand-alone restaurant has no hotel to reach.
    const none = await http()
      .get(`/tenants/${owner.tenantId}/properties`)
      .set('Cookie', barWaiter)
      .expect(200);
    expect(none.body).toEqual([]);
    // Reaching the hotel does not open any of the hotel's own pages.
    await http()
      .get(`/tenants/${owner.tenantId}/properties/${owner.propertyId}/staff`)
      .set('Cookie', hotelWaiter)
      .expect(403);
    // Once their access is suspended, the hotel is no longer listed either.
    await http()
      .post(
        `/tenants/${owner.tenantId}/venues/${venueId}/staff/${extraUserIds[extraUserIds.length - 2]}/suspend`,
      )
      .set('Cookie', owner.cookie)
      .expect(201);
    const after = await http()
      .get(`/tenants/${owner.tenantId}/properties`)
      .set('Cookie', hotelWaiter)
      .expect(200);
    expect(after.body).toEqual([]);
  });

  it("lists the restaurant's staff, with their role, on the hotel's Staff page", async () => {
    const owner = await signUp('staff-page');
    await setDining(owner.tenantId, true, 2);
    const venueId = (
      await http()
        .post(`${restaurantUrl(owner)}/activate`)
        .set('Cookie', owner.cookie)
        .expect(201)
    ).body.venue.id as string;
    const password = 'correct-horse-battery-1';
    const create = async (firstName: string, role: 'HOST' | 'MANAGER') => {
      const created = await http()
        .post(`/tenants/${owner.tenantId}/venues/${venueId}/staff`)
        .set('Cookie', owner.cookie)
        .send({ firstName, email: `${firstName}-${randomUUID()}@example.test`, password, role })
        .expect(201);
      extraUserIds.push(created.body.userId);
      return created.body.userId as string;
    };
    const waiter = await create('Ana', 'HOST');
    const manager = await create('Bo', 'MANAGER');
    await http()
      .post(`/tenants/${owner.tenantId}/venues/${venueId}/staff/${waiter}/suspend`)
      .set('Cookie', owner.cookie)
      .expect(201);

    const staff = await http()
      .get(`/tenants/${owner.tenantId}/properties/${owner.propertyId}/staff`)
      .set('Cookie', owner.cookie)
      .expect(200);
    const byId = new Map(staff.body.map((s: { userId: string }) => [s.userId, s]));
    expect(byId.get(waiter)).toMatchObject({
      roleTemplateName: 'Waiter',
      status: 'SUSPENDED',
      restaurant: { venueId, venueName: 'Hotel Restaurant' },
      overrides: [],
    });
    expect(byId.get(manager)).toMatchObject({
      roleTemplateName: 'Restaurant Manager',
      status: 'ACTIVE',
    });
    // The hotel's own staff rows carry no restaurant marker.
    expect(byId.get(owner.userId)).toBeUndefined();
  });

  it('creates restaurant staff accounts like hotel staff, limited to that restaurant', async () => {
    const owner = await signUp('staff');
    await setDining(owner.tenantId, true, 2);
    const create = async (name: string) =>
      (
        await http()
          .post(`/tenants/${owner.tenantId}/venues`)
          .set('Cookie', owner.cookie)
          .send({ name })
          .expect(201)
      ).body.id as string;
    const venueA = await create('Waiter Venue A');
    const venueB = await create('Waiter Venue B');
    const staffUrl = `/tenants/${owner.tenantId}/venues/${venueA}/staff`;
    const email = `waiter-${randomUUID()}@example.test`;
    const password = 'correct-horse-battery-1';

    await http()
      .post(staffUrl)
      .set('Cookie', owner.cookie)
      .send({ firstName: 'Ana', email, password: 'short1', role: 'HOST' })
      .expect(400);
    const created = await http()
      .post(staffUrl)
      .set('Cookie', owner.cookie)
      .send({ firstName: 'Ana', lastName: 'Waiter', email, password, role: 'HOST' })
      .expect(201);
    expect(created.body).toMatchObject({ email, role: 'HOST', firstName: 'Ana' });
    extraUserIds.push(created.body.userId);
    await http()
      .post(staffUrl)
      .set('Cookie', owner.cookie)
      .send({ firstName: 'Ana', email, password, role: 'HOST' })
      .expect(409);

    // The new waiter can sign in and sees only their own restaurant.
    const login = await http().post('/auth/login').send({ email, password }).expect(201);
    const waiterCookie = login.headers['set-cookie'][0] as string;
    const mine = await http()
      .get(`/tenants/${owner.tenantId}/venues`)
      .set('Cookie', waiterCookie)
      .expect(200);
    expect(mine.body.map((v: { id: string }) => v.id)).toEqual([venueA]);
    await http()
      .get(`/tenants/${owner.tenantId}/venues/${venueB}`)
      .set('Cookie', waiterCookie)
      .expect(403);
    // A waiter cannot create more accounts.
    await http()
      .post(staffUrl)
      .set('Cookie', waiterCookie)
      .send({ firstName: 'Bo', email: `bo-${randomUUID()}@example.test`, password, role: 'HOST' })
      .expect(403);
  });
});
