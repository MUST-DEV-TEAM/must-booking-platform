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

type Account = { email: string; tenantId: string; userId: string; cookie: string };

describe('venues', () => {
  let app: INestApplication | undefined;
  let planId: string;
  const tokens = new Map<string, string>();
  const accounts: Account[] = [];
  const staffUserIds: string[] = [];
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
    const email = `venues-${label}-${randomUUID()}@example.test`;
    // This file signs up many accounts; the signup limiter would otherwise start refusing them.
    await clearSignupRateLimits();
    const signup = await http()
      .post('/auth/signup')
      .send({
        organizationName: `Venues ${label}`,
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
      VALUES (${planId}::uuid, ${`Venues e2e ${planId}`}, 5, 10, 0, false)`;
  });

  afterAll(async () => {
    for (const account of accounts) {
      await cleanupTenant(admin, account.tenantId);
      await admin.$executeRaw`DELETE FROM users WHERE id = ${account.userId}::uuid`;
    }
    for (const id of staffUserIds) await admin.$executeRaw`DELETE FROM users WHERE id=${id}::uuid`;
    if (planId) await admin.$executeRaw`DELETE FROM plans WHERE id = ${planId}::uuid`;
    if (app) await app.close();
    await admin.$disconnect();
  });

  it('offers restaurants even when legacy plan dining is disabled', async () => {
    const owner = await signUp('gate');
    const base = `/tenants/${owner.tenantId}/venues`;
    const created = await http()
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'Grill' })
      .expect(201);
    const listed = await http().get(base).set('Cookie', owner.cookie).expect(200);
    expect(listed.body.map((venue: { id: string }) => venue.id)).toContain(created.body.id);
    const usage = await http()
      .get(`/tenants/${owner.tenantId}/plan-usage`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(usage.body.plan).toMatchObject({ diningEnabled: true, maxVenues: null });
  });

  it('creates, reads, updates and deactivates venues without legacy plan limits', async () => {
    const owner = await signUp('crud');
    await setDining(owner.tenantId, true, 1);
    const base = `/tenants/${owner.tenantId}/venues`;

    const created = await http()
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'Terrace Grill', timezone: 'Europe/Tirane', currency: 'ALL' })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Terrace Grill',
      slug: 'terrace-grill',
      propertyId: null,
      active: true,
    });
    const venueId = created.body.id as string;

    const second = await http()
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'Second' })
      .expect(201);

    const list = await http().get(base).set('Cookie', owner.cookie).expect(200);
    expect(list.body.map((v: { id: string }) => v.id).sort()).toEqual(
      [venueId, second.body.id].sort(),
    );

    await http()
      .patch(`${base}/${venueId}`)
      .set('Cookie', owner.cookie)
      .send({ phone: '+355 69 000 0000' })
      .expect(200);
    const read = await http().get(`${base}/${venueId}`).set('Cookie', owner.cookie).expect(200);
    expect(read.body.phone).toBe('+355 69 000 0000');

    await http().post(`${base}/${venueId}/deactivate`).set('Cookie', owner.cookie).expect(201);
    const after = await http().get(`${base}/${venueId}`).set('Cookie', owner.cookie).expect(200);
    expect(after.body.active).toBe(false);
  });

  it('links a venue to a hotel property of the same tenant only', async () => {
    const owner = await signUp('link');
    const other = await signUp('link-other');
    await setDining(owner.tenantId, true, 5);
    const [{ id: ownProperty }] = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM properties WHERE tenant_id = ${owner.tenantId}::uuid`;
    const [{ id: foreignProperty }] = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM properties WHERE tenant_id = ${other.tenantId}::uuid`;
    const base = `/tenants/${owner.tenantId}/venues`;
    const linked = await http()
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'Hotel Restaurant', propertyId: ownProperty })
      .expect(201);
    expect(linked.body.propertyId).toBe(ownProperty);
    await http()
      .post(base)
      .set('Cookie', owner.cookie)
      .send({ name: 'Wrong Link', propertyId: foreignProperty })
      .expect(400);
  });

  it('lets only a workspace owner or admin change the hotel link of a restaurant', async () => {
    const owner = await signUp('link-owner');
    const manager = await signUp('link-manager');
    await setDining(owner.tenantId, true, 5);
    await admin.$executeRaw`
      INSERT INTO tenant_memberships (tenant_id, user_id, role)
      VALUES (${owner.tenantId}::uuid, ${manager.userId}::uuid, 'STAFF')`;
    const [{ id: property }] = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM properties WHERE tenant_id = ${owner.tenantId}::uuid`;
    const base = `/tenants/${owner.tenantId}/venues`;
    const venue = (
      await http().post(base).set('Cookie', owner.cookie).send({ name: 'Link Venue' }).expect(201)
    ).body.id as string;
    await http()
      .put(`${base}/${venue}/staff/${manager.userId}`)
      .set('Cookie', owner.cookie)
      .send({ role: 'MANAGER' })
      .expect(200);

    // A venue manager can still edit their restaurant, but not move it to another hotel.
    await http()
      .patch(`${base}/${venue}`)
      .set('Cookie', manager.cookie)
      .send({ phone: '1' })
      .expect(200);
    await http()
      .patch(`${base}/${venue}`)
      .set('Cookie', manager.cookie)
      .send({ propertyId: property })
      .expect(403);
    const unchanged = await http().get(`${base}/${venue}`).set('Cookie', owner.cookie).expect(200);
    expect(unchanged.body.propertyId).toBeNull();

    // The workspace owner can.
    const linked = await http()
      .patch(`${base}/${venue}`)
      .set('Cookie', owner.cookie)
      .send({ propertyId: property })
      .expect(200);
    expect(linked.body.propertyId).toBe(property);
  });

  it("does not let one tenant's owner reach another tenant's venue", async () => {
    const a = await signUp('iso-a');
    const b = await signUp('iso-b');
    await setDining(a.tenantId, true, 5);
    await setDining(b.tenantId, true, 5);
    const created = await http()
      .post(`/tenants/${a.tenantId}/venues`)
      .set('Cookie', a.cookie)
      .send({ name: 'Private Venue' })
      .expect(201);
    await http()
      .get(`/tenants/${a.tenantId}/venues/${created.body.id}`)
      .set('Cookie', b.cookie)
      .expect(403);
    await http()
      .get(`/tenants/${b.tenantId}/venues/${created.body.id}`)
      .set('Cookie', b.cookie)
      .expect(403);
    const own = await http()
      .get(`/tenants/${b.tenantId}/venues`)
      .set('Cookie', b.cookie)
      .expect(200);
    expect(own.body).toEqual([]);
  });

  it('creates concurrent restaurants with distinct slugs despite a legacy venue limit', async () => {
    const owner = await signUp('race');
    await setDining(owner.tenantId, true, 1);
    const base = `/tenants/${owner.tenantId}/venues`;
    const results = await Promise.all(
      ['Race', 'Race'].map((name) => http().post(base).set('Cookie', owner.cookie).send({ name })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(new Set(results.map((r) => r.body.slug)).size).toBe(2);
  });

  it('limits venue staff to their assigned venue and drops access when suspended', async () => {
    const owner = await signUp('staff-owner');
    const person = await signUp('staff-person');
    await setDining(owner.tenantId, true, 5);
    await admin.$executeRaw`
      INSERT INTO tenant_memberships (tenant_id, user_id, role)
      VALUES (${owner.tenantId}::uuid, ${person.userId}::uuid, 'STAFF')`;
    const base = `/tenants/${owner.tenantId}/venues`;
    const create = async (name: string) =>
      (await http().post(base).set('Cookie', owner.cookie).send({ name }).expect(201)).body
        .id as string;
    const venueA = await create('Staff Venue A');
    const venueB = await create('Staff Venue B');
    const staffUrl = (venueId: string, userId = person.userId) =>
      `${base}/${venueId}/staff/${userId}`;

    // A workspace member with no assignment sees no venues and cannot open one.
    const none = await http().get(base).set('Cookie', person.cookie).expect(200);
    expect(none.body).toEqual([]);
    await http().get(`${base}/${venueA}`).set('Cookie', person.cookie).expect(403);

    // A person who is not in the workspace cannot be assigned.
    await http()
      .put(staffUrl(venueA, randomUUID()))
      .set('Cookie', owner.cookie)
      .send({ role: 'HOST' })
      .expect(404);
    await http()
      .put(staffUrl(venueA))
      .set('Cookie', owner.cookie)
      .send({ role: 'CHEF' })
      .expect(400);

    // A host reaches only the assigned venue, can view but not set it up, and cannot manage staff.
    await http()
      .put(staffUrl(venueA))
      .set('Cookie', owner.cookie)
      .send({ role: 'HOST' })
      .expect(200);
    const mine = await http().get(base).set('Cookie', person.cookie).expect(200);
    expect(mine.body.map((v: { id: string }) => v.id)).toEqual([venueA]);
    await http().get(`${base}/${venueA}`).set('Cookie', person.cookie).expect(200);
    await http().get(`${base}/${venueB}`).set('Cookie', person.cookie).expect(403);
    await http()
      .patch(`${base}/${venueA}`)
      .set('Cookie', person.cookie)
      .send({ phone: '1' })
      .expect(403);
    await http()
      .put(staffUrl(venueA))
      .set('Cookie', person.cookie)
      .send({ role: 'MANAGER' })
      .expect(403);

    // Assigning again changes the role instead of adding a second row.
    await http()
      .put(staffUrl(venueA))
      .set('Cookie', owner.cookie)
      .send({ role: 'MANAGER' })
      .expect(200);
    const rows = await admin.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM venue_staff_assignments
      WHERE tenant_id = ${owner.tenantId}::uuid AND venue_id = ${venueA}::uuid`;
    expect(rows[0]!.n).toBe(1);
    await http()
      .patch(`${base}/${venueA}`)
      .set('Cookie', person.cookie)
      .send({ phone: '2' })
      .expect(200);
    const listed = await http()
      .get(`${base}/${venueA}/staff`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ userId: person.userId, email: person.email, role: 'MANAGER' }),
    ]);

    // Suspending removes access straight away; resuming restores it.
    await http()
      .post(`${staffUrl(venueA)}/suspend`)
      .set('Cookie', owner.cookie)
      .expect(201);
    await http().get(`${base}/${venueA}`).set('Cookie', person.cookie).expect(403);
    await http()
      .post(`${staffUrl(venueA)}/resume`)
      .set('Cookie', owner.cookie)
      .expect(201);
    await http().get(`${base}/${venueA}`).set('Cookie', person.cookie).expect(200);
  });

  it('manages restaurant accounts with shared seats, invitation activation and scoped removal', async () => {
    const owner = await signUp('main-staff');
    await setDining(owner.tenantId, true, 5);
    const [{ id: propertyId }] = await admin.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM properties WHERE tenant_id=${owner.tenantId}::uuid`;
    const base = `/tenants/${owner.tenantId}/venues`;
    const venue = (
      await http()
        .post(base)
        .set('Cookie', owner.cookie)
        .send({ name: 'Staff restaurant', propertyId })
        .expect(201)
    ).body.id;
    const other = (
      await http()
        .post(base)
        .set('Cookie', owner.cookie)
        .send({ name: 'Other restaurant' })
        .expect(201)
    ).body.id;
    const url = `${base}/${venue}/staff`;
    const password = 'LocalStaffPassword9!';
    const create = async (role: 'HOST' | 'MANAGER', cookie = owner.cookie) => {
      const email = `restaurant-${randomUUID()}@example.test`;
      const result = await http()
        .post(url)
        .set('Cookie', cookie)
        .send({ firstName: 'Test', email, password, role })
        .expect(201);
      staffUserIds.push(result.body.userId);
      const login = await http().post('/auth/login').send({ email, password }).expect(201);
      return {
        userId: result.body.userId,
        email,
        cookie: login.headers['set-cookie'][0] as string,
      };
    };
    const manager = await create('MANAGER');
    await admin.$executeRaw`UPDATE plans SET max_staff_seats=2 WHERE id=${planId}::uuid`;
    try {
      await http()
        .post(url)
        .set('Cookie', manager.cookie)
        .send({
          firstName: 'Capped',
          email: `cap-${randomUUID()}@example.test`,
          password,
          role: 'HOST',
        })
        .expect(409);
    } finally {
      await admin.$executeRaw`UPDATE plans SET max_staff_seats=10 WHERE id=${planId}::uuid`;
    }
    const waiter = await create('HOST', manager.cookie);
    await http().get(url).set('Cookie', manager.cookie).expect(200);
    await http().get(url).set('Cookie', waiter.cookie).expect(403);
    await http()
      .post(`${url}/invitations`)
      .set('Cookie', waiter.cookie)
      .send({ email: 'refused@example.test', role: 'MANAGER' })
      .expect(403);
    await http().get(`${base}/${other}`).set('Cookie', manager.cookie).expect(403);
    await http()
      .get(`/tenants/${owner.tenantId}/properties/${propertyId}/staff`)
      .set('Cookie', manager.cookie)
      .expect(403);
    const listed = await http()
      .get(`/tenants/${owner.tenantId}/properties/${propertyId}/staff`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(listed.body).toContainEqual(
      expect.objectContaining({
        userId: waiter.userId,
        restaurant: { venueId: venue, venueName: 'Staff restaurant', role: 'HOST' },
      }),
    );
    await http()
      .put(`${url}/${waiter.userId}`)
      .set('Cookie', manager.cookie)
      .send({ role: 'MANAGER' })
      .expect(200);
    await http().post(`${url}/${waiter.userId}/suspend`).set('Cookie', manager.cookie).expect(201);
    await http().get(`${base}/${venue}`).set('Cookie', waiter.cookie).expect(403);
    await http().post(`${url}/${waiter.userId}/resume`).set('Cookie', manager.cookie).expect(201);
    await http().get(`${base}/${venue}`).set('Cookie', waiter.cookie).expect(200);
    const existing = await signUp('invited-existing');
    await admin.$executeRaw`INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES(${owner.tenantId}::uuid,${existing.userId}::uuid,'STAFF')`;
    await http().delete(`${url}/${existing.userId}`).set('Cookie', manager.cookie).expect(204);
    const [orphan] = await admin.$queryRaw<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id=${owner.tenantId}::uuid AND user_id=${existing.userId}::uuid`;
    expect(orphan.n).toBe(1);
    const existingInvite = await http()
      .post(`${url}/invitations`)
      .set('Cookie', manager.cookie)
      .send({ email: existing.email, role: 'HOST' })
      .expect(201);
    await http()
      .post('/auth/staff-invitations/accept')
      .set('Cookie', existing.cookie)
      .send({ token: existingInvite.body.token })
      .expect(204);
    await http().get(`${base}/${venue}`).set('Cookie', existing.cookie).expect(200);
    const wrongEmail = `wrong-invite-${randomUUID()}@example.test`;
    const wrongInvite = await http()
      .post(`${url}/invitations`)
      .set('Cookie', manager.cookie)
      .send({ email: 'expected@example.test', role: 'HOST' })
      .expect(201);
    await http()
      .post('/auth/staff-invitations/activate')
      .send({ token: wrongInvite.body.token, email: wrongEmail, password })
      .expect(400);
    const [wrong] = await admin.$queryRaw<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM users WHERE email=${wrongEmail}`;
    expect(wrong.n).toBe(0);
    const invitedEmail = `invited-${randomUUID()}@example.test`;
    const invitation = await http()
      .post(`${url}/invitations`)
      .set('Cookie', manager.cookie)
      .send({ email: invitedEmail, role: 'HOST' })
      .expect(201);
    await http()
      .post('/auth/staff-invitations/activate')
      .send({ token: invitation.body.token, email: invitedEmail, password })
      .expect(204);
    const [{ id: invitedId }] = await admin.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM users WHERE email=${invitedEmail}`;
    staffUserIds.push(invitedId);
    const [counts] = await admin.$queryRaw<
      Array<{ hotel: number; venue: number }>
    >`SELECT (SELECT count(*)::int FROM property_staff_assignments WHERE tenant_id=${owner.tenantId}::uuid AND user_id=${invitedId}::uuid) AS hotel,(SELECT count(*)::int FROM venue_staff_assignments WHERE tenant_id=${owner.tenantId}::uuid AND user_id=${invitedId}::uuid) AS venue`;
    expect(counts).toEqual({ hotel: 0, venue: 1 });
    await http()
      .post('/auth/staff-invitations/activate')
      .send({ token: invitation.body.token, email: invitedEmail, password })
      .expect(400);
    // Removing one restaurant preserves all other scopes and the shared seat.
    await http()
      .put(`${base}/${other}/staff/${waiter.userId}`)
      .set('Cookie', owner.cookie)
      .send({ role: 'HOST' })
      .expect(200);
    await http().delete(`${url}/${waiter.userId}`).set('Cookie', manager.cookie).expect(204);
    await http().delete(`${url}/${waiter.userId}`).set('Cookie', manager.cookie).expect(204);
    await http().get(`${base}/${venue}`).set('Cookie', waiter.cookie).expect(403);
    await http().get(`${base}/${other}`).set('Cookie', waiter.cookie).expect(200);
    await http()
      .delete(`${base}/${other}/staff/${waiter.userId}`)
      .set('Cookie', owner.cookie)
      .expect(204);
    const [remaining] = await admin.$queryRaw<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id=${owner.tenantId}::uuid AND user_id=${waiter.userId}::uuid`;
    expect(remaining.n).toBe(0);
    const [identity] = await admin.$queryRaw<
      Array<{ n: number }>
    >`SELECT count(*)::int AS n FROM users WHERE id=${waiter.userId}::uuid`;
    expect(identity.n).toBe(1);
  });

  it('builds a floor plan: areas, tables, combinations and bulk moves', async () => {
    const owner = await signUp('layout');
    await setDining(owner.tenantId, true, 5);
    const base = `/tenants/${owner.tenantId}/venues`;
    const venueId = (
      await http().post(base).set('Cookie', owner.cookie).send({ name: 'Layout Venue' }).expect(201)
    ).body.id as string;
    const url = `${base}/${venueId}`;
    const post = (path: string, body: object) =>
      http().post(`${url}${path}`).set('Cookie', owner.cookie).send(body);

    const terrace = (await post('/areas', { name: 'Terrace' }).expect(201)).body;
    await post('/areas', { name: 'Terrace' }).expect(409);
    const indoor = (await post('/areas', { name: 'Indoor' }).expect(201)).body;

    const t1 = (
      await post(`/areas/${terrace.id}/tables`, {
        label: 'T1',
        minSeats: 2,
        maxSeats: 4,
        mapX: 10,
        mapY: 10,
      }).expect(201)
    ).body;
    const t2 = (
      await post(`/areas/${terrace.id}/tables`, {
        label: 'T2',
        minSeats: 2,
        maxSeats: 6,
        mapX: 200,
        mapY: 10,
        shape: 'round',
      }).expect(201)
    ).body;
    await post(`/areas/${terrace.id}/tables`, { label: 'T1', minSeats: 2, maxSeats: 4 }).expect(
      409,
    );
    // Tables added without a position are placed apart, not stacked on one spot.
    const placed1 = (
      await post(`/areas/${indoor.id}/tables`, { label: 'T1', minSeats: 1, maxSeats: 2 }).expect(
        201,
      )
    ).body;
    const placed2 = (
      await post(`/areas/${indoor.id}/tables`, { label: 'T2', minSeats: 1, maxSeats: 2 }).expect(
        201,
      )
    ).body;
    expect([placed1.mapX, placed1.mapY]).toEqual([20, 20]);
    expect([placed2.mapX, placed2.mapY]).toEqual([110, 20]);
    await post(`/areas/${terrace.id}/tables`, { label: 'Bad', minSeats: 5, maxSeats: 2 }).expect(
      400,
    );
    await post(`/areas/${terrace.id}/tables`, {
      label: 'Off',
      minSeats: 1,
      maxSeats: 2,
      mapX: 990,
    }).expect(400);

    const combine = (tableId: string, tableIds: string[]) =>
      http()
        .put(`${url}/tables/${tableId}/combinable`)
        .set('Cookie', owner.cookie)
        .send({ tableIds });
    await combine(t1.id, [t1.id]).expect(400);
    await combine(t1.id, [randomUUID()]).expect(404);
    await combine(t1.id, [t2.id]).expect(200);

    const layout = await http().get(`${url}/layout`).set('Cookie', owner.cookie).expect(200);
    expect(layout.body.areas.map((a: { name: string }) => a.name)).toEqual(['Terrace', 'Indoor']);
    expect(layout.body.areas[0].tables.map((t: { label: string }) => t.label).sort()).toEqual([
      'T1',
      'T2',
    ]);
    const [low, high] = [t1.id, t2.id].sort();
    expect(layout.body.combinations).toEqual([{ tableAId: low, tableBId: high }]);

    // Setting the combination from the other side replaces it rather than adding a second row.
    await combine(t2.id, [t1.id]).expect(200);
    const again = await http().get(`${url}/layout`).set('Cookie', owner.cookie).expect(200);
    expect(again.body.combinations).toHaveLength(1);
    await combine(t2.id, []).expect(200);
    const cleared = await http().get(`${url}/layout`).set('Cookie', owner.cookie).expect(200);
    expect(cleared.body.combinations).toEqual([]);

    // A bulk move with one unknown table changes nothing.
    const move = (positions: object[]) =>
      http().put(`${url}/layout/positions`).set('Cookie', owner.cookie).send({ positions });
    await move([
      { tableId: t1.id, mapX: 300, mapY: 300 },
      { tableId: randomUUID(), mapX: 1, mapY: 1 },
    ]).expect(404);
    const unchanged = await http().get(`${url}/layout`).set('Cookie', owner.cookie).expect(200);
    const t1Row = unchanged.body.areas[0].tables.find((t: { id: string }) => t.id === t1.id);
    expect([t1Row.mapX, t1Row.mapY]).toEqual([10, 10]);
    await move([{ tableId: t1.id, mapX: 300, mapY: 300 }]).expect(200);
    const moved = await http().get(`${url}/layout`).set('Cookie', owner.cookie).expect(200);
    const movedRow = moved.body.areas[0].tables.find((t: { id: string }) => t.id === t1.id);
    expect([movedRow.mapX, movedRow.mapY]).toEqual([300, 300]);

    // Editing a table re-checks the whole table, so a seat range cannot be broken one field at a time.
    await http()
      .patch(`${url}/tables/${t1.id}`)
      .set('Cookie', owner.cookie)
      .send({ maxSeats: 1 })
      .expect(400);
    await http()
      .patch(`${url}/tables/${t1.id}`)
      .set('Cookie', owner.cookie)
      .send({ maxSeats: 8 })
      .expect(200);

    // An area with tables cannot be deleted until they are gone.
    await http().delete(`${url}/areas/${terrace.id}`).set('Cookie', owner.cookie).expect(409);
    for (const id of [t1.id, t2.id])
      await http().delete(`${url}/tables/${id}`).set('Cookie', owner.cookie).expect(204);
    await http().delete(`${url}/areas/${terrace.id}`).set('Cookie', owner.cookie).expect(204);
  });

  it('refuses to delete a hotel property that still has a linked restaurant, and says why', async () => {
    const owner = await signUp('linked-delete');
    await setDining(owner.tenantId, true, 5);
    const [{ id: propertyId }] = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM properties WHERE tenant_id = ${owner.tenantId}::uuid`;
    await http()
      .post(`/tenants/${owner.tenantId}/venues`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Hotel Restaurant', propertyId })
      .expect(201);

    const response = await http()
      .delete(`/tenants/${owner.tenantId}/properties/${propertyId}`)
      .set('Cookie', owner.cookie)
      .send({ confirmationName: 'Hotel' })
      .expect(409);
    expect(response.body.blockers).toContainEqual({ resource: 'linked restaurants', count: 1 });
    const remaining = await admin.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM properties WHERE id = ${propertyId}::uuid`;
    expect(remaining).toHaveLength(1);
  });

  it('removes a person from the workspace even when they have restaurant access', async () => {
    const owner = await signUp('remove-owner');
    const person = await signUp('remove-person');
    await setDining(owner.tenantId, true, 5);
    await admin.$executeRaw`
      INSERT INTO tenant_memberships (tenant_id, user_id, role)
      VALUES (${owner.tenantId}::uuid, ${person.userId}::uuid, 'STAFF')`;
    const base = `/tenants/${owner.tenantId}/venues`;
    const venueId = (
      await http()
        .post(base)
        .set('Cookie', owner.cookie)
        .send({ name: 'Removal Venue' })
        .expect(201)
    ).body.id as string;
    await http()
      .put(`${base}/${venueId}/staff/${person.userId}`)
      .set('Cookie', owner.cookie)
      .send({ role: 'HOST' })
      .expect(200);

    await http()
      .delete(`/tenants/${owner.tenantId}/memberships/${person.userId}`)
      .set('Cookie', owner.cookie)
      .expect(204);

    const left = await admin.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM venue_staff_assignments
      WHERE tenant_id = ${owner.tenantId}::uuid AND user_id = ${person.userId}::uuid`;
    expect(left[0]!.n).toBe(0);
    await http().get(`${base}/${venueId}`).set('Cookie', person.cookie).expect(403);
  });
});
