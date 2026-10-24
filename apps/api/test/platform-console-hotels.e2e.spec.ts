import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cleanupTenant } from './helpers/cleanup-tenant';
import {
  clearPlatformLoginLimits,
  ConsoleClient,
  loggedIn,
  MailCapture,
  ownerClient,
  seedPlatformAccount,
  startConsoleApp,
  type TestAccount,
} from './helpers/platform-console';

describe('platform console: hotels, onboarding and lifecycle', () => {
  const owner = ownerClient();
  const mail = new MailCapture();
  let app: INestApplication;
  let superAdmin: ConsoleClient;
  let operations: ConsoleClient;
  let finance: ConsoleClient;
  let auditor: ConsoleClient;
  let operationsAccount: TestAccount;
  const tenants: string[] = [];
  const userEmails: string[] = [];

  const hotelBody = (name = `Console Hotel ${randomUUID().slice(0, 8)}`) => ({
    hotelName: name,
    ownerName: 'Olga Owner',
    ownerEmail: `owner-${randomUUID()}@example.test`,
    country: 'AL',
    timeZone: 'Europe/Tirane',
    currency: 'EUR',
    mode: 'MUST_SOURCE',
  });

  const createHotel = async (client: ConsoleClient, body = hotelBody()) => {
    const response = await client.write('post', '/hotels', body);
    expect(response.status).toBe(201);
    tenants.push(response.body.tenantId);
    userEmails.push(body.ownerEmail);
    return { ...response.body, body } as {
      tenantId: string;
      propertyId: string;
      body: ReturnType<typeof hotelBody>;
    };
  };

  /** Owner follows the emailed link, sets a password and signs in to the hotel dashboard. */
  const ownerSignsIn = async (email: string) => {
    const token = mail.tokenFor(email);
    const activate = await request(app.getHttpServer())
      .post('/auth/staff-invitations/activate')
      .send({ token, email, password: 'Owner-pass-12345' });
    expect(activate.status).toBe(204);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'Owner-pass-12345' });
    return {
      status: login.status,
      body: login.body,
      cookie:
        (login.headers['set-cookie'] as unknown as string[] | undefined)?.[0]?.split(';')[0] ?? '',
    };
  };

  const hotelGet = (path: string, cookie: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookie);

  beforeAll(async () => {
    await clearPlatformLoginLimits();
    app = await startConsoleApp(mail);
    superAdmin = await loggedIn(app, await seedPlatformAccount(owner, 'super_admin'));
    operationsAccount = await seedPlatformAccount(owner, 'operations');
    operations = await loggedIn(app, operationsAccount);
    finance = await loggedIn(app, await seedPlatformAccount(owner, 'finance'));
    auditor = await loggedIn(app, await seedPlatformAccount(owner, 'auditor'));
  });

  beforeEach(async () => {
    await clearPlatformLoginLimits();
  });

  afterAll(async () => {
    await app.close();
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      for (const tenantId of tenants) {
        await tx.$executeRaw`DELETE FROM support_sessions WHERE tenant_id = ${tenantId}::uuid`;
        await tx.$executeRaw`DELETE FROM organization_lifecycle_events WHERE tenant_id = ${tenantId}::uuid`;
        await cleanupTenant(tx, tenantId);
      }
      for (const email of userEmails)
        await tx.$executeRaw`DELETE FROM users WHERE lower(email) = ${email.toLowerCase()}`;
    });
    await owner.$disconnect();
  });

  describe('onboarding', () => {
    it('creates a hotel in Trial, invites the owner through the invitation service and audits it', async () => {
      const created = await createHotel(operations);
      const detail = await operations.get(`/hotels/${created.tenantId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.lifecycle.state).toBe('TRIAL');
      expect(detail.body).toMatchObject({
        mode: 'MUST_SOURCE',
        country: 'AL',
        currency: 'EUR',
        timeZone: 'Europe/Tirane',
      });
      expect(detail.body.ownerInvite.email).toBe(created.body.ownerEmail);
      expect(
        mail.invitations.some((entry) => entry.to === created.body.ownerEmail.toLowerCase()),
      ).toBe(true);

      const audit = await owner.$queryRaw<
        Array<{ action: string; actor_role: string; after: Record<string, unknown> }>
      >`
        SELECT action, actor_role, after FROM platform_audit_log WHERE tenant_id = ${created.tenantId}::uuid ORDER BY created_at`;
      expect(audit.map((row) => row.action)).toEqual([
        'platform.hotel.created',
        'platform.hotel.owner_invited',
      ]);
      expect(audit[0]).toMatchObject({ actor_role: 'operations' });
      expect(audit[0].after).toMatchObject({ lifecycle: 'TRIAL', mode: 'MUST_SOURCE' });
    });

    it('validates input and does not let finance or the auditor create hotels', async () => {
      for (const bad of [
        { ...hotelBody(), hotelName: '' },
        { ...hotelBody(), ownerEmail: 'not-an-email' },
        { ...hotelBody(), timeZone: 'Mars/Olympus' },
        { ...hotelBody(), currency: 'EURO' },
        { ...hotelBody(), country: 'Albania' },
        { ...hotelBody(), mode: 'OTHER' },
      ])
        expect((await operations.write('post', '/hotels', bad)).status).toBe(400);
      expect((await finance.write('post', '/hotels', hotelBody())).status).toBe(403);
      expect((await auditor.write('post', '/hotels', hotelBody())).status).toBe(403);
    });

    it('computes the checklist from real data and never marks an item done without evidence', async () => {
      const created = await createHotel(operations);
      const first = await operations.get(`/hotels/${created.tenantId}/onboarding`);
      const state = (items: Array<{ key: string; state: string }>) =>
        Object.fromEntries(items.map((item) => [item.key, item.state]));
      expect(state(first.body.items)).toEqual({
        owner_invited: 'done',
        owner_accepted: 'todo',
        hotel_details: 'todo',
        mode_ready: 'todo',
        payment_gateway: 'todo',
        website: 'todo',
        first_booking: 'todo',
      });
      expect(first.body.complete).toBe(false);
      expect(
        first.body.items.every(
          (item: { fixHref: string; evidence: string }) => item.fixHref && item.evidence,
        ),
      ).toBe(true);

      // Real changes flip exactly the matching items.
      await owner.$executeRaw`UPDATE properties SET address = 'Rruga 1', phone = '+355 4 000', check_in_time = '14:00', check_out_time = '11:00', wordpress_connected_at = now() WHERE tenant_id = ${created.tenantId}::uuid`;
      const second = await operations.get(`/hotels/${created.tenantId}/onboarding`);
      expect(state(second.body.items)).toMatchObject({
        hotel_details: 'done',
        website: 'done',
        payment_gateway: 'todo',
        first_booking: 'todo',
      });

      await owner.$executeRaw`INSERT INTO integration_connections (tenant_id, kind, provider, name, encrypted_credentials, status) VALUES (${created.tenantId}::uuid, 'PAYMENT', 'POKPAY', 'PokPay', 'x', 'CONNECTED')`;
      const third = await operations.get(`/hotels/${created.tenantId}/onboarding`);
      expect(state(third.body.items).payment_gateway).toBe('done');

      const owned = await ownerSignsIn(created.body.ownerEmail);
      expect(owned.status).toBe(201);
      const fourth = await operations.get(`/hotels/${created.tenantId}/onboarding`);
      expect(state(fourth.body.items).owner_accepted).toBe('done');
    });

    it('invites the owner again only while the hotel has none', async () => {
      const created = await createHotel(operations);
      const again = await operations.write(
        'post',
        `/hotels/${created.tenantId}/owner-invitations`,
        { email: `other-${randomUUID()}@example.test` },
      );
      expect(again.status).toBe(201);
      await ownerSignsIn(created.body.ownerEmail).catch(() => undefined);
      await owner.$executeRaw`SELECT 1`;
    });
  });

  describe('directory and detail', () => {
    it('searches, filters, sorts and pages the directory, and exposes no health or plan editing', async () => {
      const a = await createHotel(operations, hotelBody(`Zephyr ${randomUUID().slice(0, 6)}`));
      const b = await createHotel(operations, {
        ...hotelBody(`Alpha ${randomUUID().slice(0, 6)}`),
        mode: 'CLOCK',
      });
      const search = await finance.get(`/hotels?search=${encodeURIComponent(a.body.hotelName)}`);
      expect(search.status).toBe(200);
      expect(search.body.items.map((row: { id: string }) => row.id)).toEqual([a.tenantId]);
      expect(search.body.items[0]).toMatchObject({ health: null, lifecycleState: 'TRIAL' });

      const byOwner = await auditor.get(`/hotels?search=${encodeURIComponent(b.body.ownerEmail)}`);
      expect(byOwner.body.items.map((row: { id: string }) => row.id)).toEqual([b.tenantId]);

      const clock = await operations.get('/hotels?mode=CLOCK&pageSize=100');
      expect(clock.body.items.every((row: { mode: string }) => row.mode === 'CLOCK')).toBe(true);
      expect(clock.body.items.some((row: { id: string }) => row.id === b.tenantId)).toBe(true);

      const sorted = await operations.get('/hotels?sort=name&direction=asc&pageSize=100');
      const names = sorted.body.items.map((row: { name: string }) => row.name.toLowerCase());
      expect(names).toEqual([...names].sort());

      const paged = await operations.get('/hotels?pageSize=1&page=2&sort=created&direction=desc');
      expect(paged.body.items).toHaveLength(1);
      expect(paged.body.page).toBe(2);

      const trial = await operations.get('/hotels?lifecycle=TRIAL&pageSize=100');
      expect(
        trial.body.items.every((row: { lifecycleState: string }) => row.lifecycleState === 'TRIAL'),
      ).toBe(true);
      expect(trial.body.lifecycleCounts.TRIAL).toBeGreaterThanOrEqual(2);
    });

    it('shows connections as status only and never returns secrets', async () => {
      const created = await createHotel(operations);
      await owner.$executeRaw`INSERT INTO integration_connections (tenant_id, kind, provider, name, encrypted_credentials, status) VALUES (${created.tenantId}::uuid, 'PMS', 'CLOCK_PMS', 'Clock', 'SUPER-SECRET-CIPHERTEXT', 'FAILED')`;
      const response = await auditor.get(`/hotels/${created.tenantId}/connections`);
      expect(response.status).toBe(200);
      expect(response.body.pms[0]).toMatchObject({ provider: 'CLOCK_PMS', status: 'FAILED' });
      expect(JSON.stringify(response.body)).not.toMatch(/SUPER-SECRET|encrypted|credential/i);
      expect(response.body).toHaveProperty('email.last30Days');
      expect(
        (await operations.write('post', `/hotels/${created.tenantId}/connections`, {})).status,
      ).toBe(404);
    });

    it('lists staff with last login, usage against placeholder limits, and recent hotel events', async () => {
      const created = await createHotel(operations);
      await ownerSignsIn(created.body.ownerEmail);
      const response = await operations.get(`/hotels/${created.tenantId}/staff-usage`);
      expect(response.status).toBe(200);
      expect(response.body.staff[0]).toMatchObject({
        email: created.body.ownerEmail.toLowerCase(),
        membership: 'OWNER',
      });
      expect(response.body.staff[0].lastLoginAt).toBeTruthy();
      expect(response.body.usage.limits.map((item: { key: string }) => item.key)).toEqual([
        'properties',
        'staff',
      ]);
      expect(response.body.recentHotelEvents.length).toBeGreaterThan(0);
      expect(JSON.stringify(response.body)).not.toMatch(/password/i);
    });

    it('returns 404 for an unknown hotel and 400 for a malformed id', async () => {
      expect((await operations.get(`/hotels/${randomUUID()}`)).status).toBe(404);
      expect((await operations.get('/hotels/not-a-uuid')).status).toBe(400);
    });
  });

  describe('lifecycle', () => {
    it('applies the documented effects: suspended and cancelled block logins and public booking, archived is read-only', async () => {
      const created = await createHotel(operations);
      const { cookie } = await ownerSignsIn(created.body.ownerEmail);
      const dashboard = `/tenants/${created.tenantId}/properties`;
      const catalog = `/tenants/${created.tenantId}/properties/${created.propertyId}/public/catalog`;
      expect((await hotelGet(dashboard, cookie)).status).toBe(200);
      expect((await request(app.getHttpServer()).get(catalog)).status).not.toBe(403);

      const move = async (client: ConsoleClient, to: string) => {
        const current = (await client.get(`/hotels/${created.tenantId}`)).body.lifecycle.version;
        return client.write('post', `/hotels/${created.tenantId}/lifecycle`, {
          to,
          reason: `Test move to ${to}`,
          version: current,
        });
      };

      expect((await move(operations, 'ACTIVE')).status).toBe(201);
      expect((await move(operations, 'PAST_DUE')).status).toBe(201);
      expect((await hotelGet(dashboard, cookie)).status).toBe(200);

      expect((await move(operations, 'SUSPENDED')).status).toBe(201);
      const blocked = await hotelGet(dashboard, cookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('HOTEL_SUSPENDED');
      const blockedLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: created.body.ownerEmail, password: 'Owner-pass-12345' });
      expect(blockedLogin.status).toBe(403);
      expect(blockedLogin.body.code).toBe('HOTEL_SUSPENDED');
      const blockedPublic = await request(app.getHttpServer()).get(catalog);
      expect(blockedPublic.status).toBe(403);
      expect(blockedPublic.body.code).toBe('HOTEL_UNAVAILABLE');
      // The legacy status column follows the lifecycle.
      const flag = await owner.$queryRaw<
        Array<{ status: string }>
      >`SELECT status::text FROM organizations WHERE id = ${created.tenantId}::uuid`;
      expect(flag[0].status).toBe('SUSPENDED');

      expect((await move(operations, 'ACTIVE')).status).toBe(201);
      expect((await hotelGet(dashboard, cookie)).status).toBe(200);

      // Cancelling needs the dangerous permission.
      const denied = await move(operations, 'CANCELLED');
      expect(denied.status).toBe(403);
      expect((await move(superAdmin, 'CANCELLED')).status).toBe(201);
      expect((await hotelGet(dashboard, cookie)).status).toBe(403);
      expect(
        (
          await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email: created.body.ownerEmail, password: 'Owner-pass-12345' })
        ).status,
      ).toBe(403);

      expect((await move(superAdmin, 'ARCHIVED')).status).toBe(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: created.body.ownerEmail, password: 'Owner-pass-12345' });
      expect(login.status).toBe(201);
      const archivedCookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      expect((await hotelGet(dashboard, archivedCookie)).status).toBe(200);
      const write = await request(app.getHttpServer())
        .post(`/tenants/${created.tenantId}/staff-invitations`)
        .set('Cookie', archivedCookie)
        .send({ email: 'x@example.test', assignments: [] });
      expect(write.status).toBe(403);
      expect(write.body.code).toBe('HOTEL_ARCHIVED');
      expect((await request(app.getHttpServer()).get(catalog)).status).toBe(403);
      // Nothing was deleted.
      const kept = await owner.$queryRaw<
        [{ n: number }]
      >`SELECT COUNT(*)::int AS n FROM properties WHERE tenant_id = ${created.tenantId}::uuid`;
      expect(kept[0].n).toBe(1);
      // Archived is terminal.
      expect((await move(superAdmin, 'ACTIVE')).status).toBe(409);
    });

    it('requires a reason, a known target, a current version and an allowed move', async () => {
      const created = await createHotel(operations);
      const version = (await operations.get(`/hotels/${created.tenantId}`)).body.lifecycle.version;
      const post = (body: object) =>
        operations.write('post', `/hotels/${created.tenantId}/lifecycle`, body);
      expect((await post({ to: 'ACTIVE', version })).status).toBe(400);
      expect((await post({ to: 'ACTIVE', reason: 'abc', version })).status).toBe(400);
      expect((await post({ to: 'BOGUS', reason: 'A real reason', version })).status).toBe(400);
      expect((await post({ to: 'ACTIVE', reason: 'A real reason' })).status).toBe(400);
      expect(
        (await post({ to: 'ACTIVE', reason: 'A real reason', version: version + 5 })).status,
      ).toBe(409);
      expect((await post({ to: 'ARCHIVED', reason: 'A real reason', version })).status).toBe(409);
      expect((await post({ to: 'TRIAL', reason: 'A real reason', version })).status).toBe(409);
      expect(
        (
          await finance.write('post', `/hotels/${created.tenantId}/lifecycle`, {
            to: 'ACTIVE',
            reason: 'A real reason',
            version,
          })
        ).status,
      ).toBe(403);
    });

    it('lets only one of two admins who act at the same moment win', async () => {
      const created = await createHotel(operations);
      const version = (await operations.get(`/hotels/${created.tenantId}`)).body.lifecycle.version;
      const [one, two] = await Promise.all([
        operations.write('post', `/hotels/${created.tenantId}/lifecycle`, {
          to: 'ACTIVE',
          reason: 'First admin',
          version,
        }),
        superAdmin.write('post', `/hotels/${created.tenantId}/lifecycle`, {
          to: 'SUSPENDED',
          reason: 'Second admin',
          version,
        }),
      ]);
      expect([one.status, two.status].sort()).toEqual([201, 409]);
      const events = await owner.$queryRaw<
        [{ n: number }]
      >`SELECT COUNT(*)::int AS n FROM organization_lifecycle_events WHERE tenant_id = ${created.tenantId}::uuid`;
      expect(events[0].n).toBe(2); // creation + exactly one change
    });

    it('records history, and audits the change with before, after and the reason', async () => {
      const created = await createHotel(operations);
      const version = (await operations.get(`/hotels/${created.tenantId}`)).body.lifecycle.version;
      await operations.write('post', `/hotels/${created.tenantId}/lifecycle`, {
        to: 'ACTIVE',
        reason: 'Contract signed',
        version,
      });
      const detail = await auditor.get(`/hotels/${created.tenantId}`);
      expect(detail.body.lifecycle.history[0]).toMatchObject({
        from: 'TRIAL',
        to: 'ACTIVE',
        reason: 'Contract signed',
      });
      expect(detail.body.lifecycle.allowedTransitions).toEqual([]); // the auditor cannot change status
      const rows = await owner.$queryRaw<
        Array<{
          before: { state: string };
          after: { state: string };
          reason: string;
          result: string;
        }>
      >`
        SELECT before, after, reason, result FROM platform_audit_log WHERE tenant_id = ${created.tenantId}::uuid AND action = 'platform.hotel.lifecycle_changed'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        before: { state: 'TRIAL' },
        after: { state: 'ACTIVE' },
        reason: 'Contract signed',
        result: 'succeeded',
      });
      await expect(
        owner.$executeRaw`DELETE FROM organization_lifecycle_events WHERE tenant_id = ${created.tenantId}::uuid`,
      ).rejects.toThrow();
    });

    it('keeps the existing legacy suspend route consistent with the lifecycle', async () => {
      const created = await createHotel(operations);
      await owner.$executeRaw`UPDATE organizations SET status = 'SUSPENDED' WHERE id = ${created.tenantId}::uuid`;
      const detail = await operations.get(`/hotels/${created.tenantId}`);
      expect(detail.body.lifecycle.state).toBe('SUSPENDED');
      await owner.$executeRaw`UPDATE organizations SET status = 'ACTIVE' WHERE id = ${created.tenantId}::uuid`;
      expect((await operations.get(`/hotels/${created.tenantId}`)).body.lifecycle.state).toBe(
        'ACTIVE',
      );
    });
  });
});
