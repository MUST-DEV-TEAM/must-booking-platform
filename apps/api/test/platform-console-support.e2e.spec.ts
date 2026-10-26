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

type Hotel = {
  tenantId: string;
  propertyId: string;
  ownerEmail: string;
  ownerCookie: string;
};

describe('platform console: support access (view-as and act-as)', () => {
  const owner = ownerClient();
  const mail = new MailCapture();
  let app: INestApplication;
  let operations: ConsoleClient;
  let operationsAccount: TestAccount;
  let approver: ConsoleClient;
  let superAdmin: ConsoleClient;
  let finance: ConsoleClient;
  const tenants: string[] = [];
  const userEmails: string[] = [];

  const hotelGet = (path: string, cookie: string) =>
    request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const hotelPost = (path: string, cookie: string, body: object = {}) =>
    request(app.getHttpServer()).post(path).set('Cookie', cookie).send(body);

  const createHotel = async (mode: 'CLOCK' | 'MUST_SOURCE' = 'MUST_SOURCE'): Promise<Hotel> => {
    const ownerEmail = `support-owner-${randomUUID()}@example.test`;
    const created = await operations.write('post', '/hotels', {
      hotelName: `Support Hotel ${randomUUID().slice(0, 8)}`,
      ownerName: 'Olga Owner',
      ownerEmail,
      country: 'AL',
      timeZone: 'Europe/Tirane',
      currency: 'EUR',
      mode,
    });
    expect(created.status).toBe(201);
    tenants.push(created.body.tenantId);
    userEmails.push(ownerEmail);
    const token = mail.tokenFor(ownerEmail);
    await request(app.getHttpServer())
      .post('/auth/staff-invitations/activate')
      .send({ token, email: ownerEmail, password: 'Owner-pass-12345' })
      .expect(204);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ownerEmail, password: 'Owner-pass-12345' })
      .expect(201);
    return {
      tenantId: created.body.tenantId,
      propertyId: created.body.propertyId,
      ownerEmail,
      ownerCookie: (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0],
    };
  };

  /** Opens a support session and enters it, returning the cookie a browser would hold. */
  const openSession = async (
    client: ConsoleClient,
    hotel: Hotel,
    kind: 'VIEW' | 'ACT' = 'VIEW',
    approveWith?: ConsoleClient,
  ) => {
    const created = await client.write('post', '/support-sessions', {
      tenantId: hotel.tenantId,
      kind,
      reason: 'Investigating a booking problem reported by the hotel',
    });
    expect(created.status).toBe(201);
    if (kind === 'ACT') {
      expect(created.body.status).toBe('PENDING_APPROVAL');
      const approved = await (approveWith ?? approver).write(
        'post',
        `/support-sessions/${created.body.id}/approve`,
      );
      expect(approved.status).toBe(201);
    }
    const entered = await client.write(
      'post',
      `/support-sessions/${created.body.id}/enter`,
      {},
      null,
    );
    expect(entered.status).toBe(200);
    const cookie = (entered.headers['set-cookie'] as unknown as string[])
      .find((entry) => entry.startsWith('must_support='))!
      .split(';')[0];
    return { id: created.body.id as string, cookie, entered };
  };

  beforeAll(async () => {
    await clearPlatformLoginLimits();
    app = await startConsoleApp(mail);
    operationsAccount = await seedPlatformAccount(owner, 'operations');
    operations = await loggedIn(app, operationsAccount);
    approver = await loggedIn(app, await seedPlatformAccount(owner, 'operations'));
    superAdmin = await loggedIn(app, await seedPlatformAccount(owner, 'super_admin'));
    finance = await loggedIn(app, await seedPlatformAccount(owner, 'finance'));
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

  describe.each([['MUST_SOURCE'], ['CLOCK']] as const)('view-as on a %s hotel', (mode) => {
    it('is read-only, time-limited, tied to one hotel and audited', async () => {
      const hotel = await createHotel(mode);
      if (mode === 'CLOCK')
        await owner.$executeRaw`INSERT INTO integration_connections (tenant_id, kind, provider, name, encrypted_credentials, status) VALUES (${hotel.tenantId}::uuid, 'PMS', 'CLOCK_PMS', 'Clock', 'x', 'CONNECTED')`;
      const { id, cookie } = await openSession(operations, hotel);
      const dashboard = `/tenants/${hotel.tenantId}/properties`;

      // The hotel dashboard loads for the platform user: session, memberships and data.
      const session = await hotelGet('/auth/session', cookie);
      expect(session.status).toBe(200);
      expect(session.body.support).toMatchObject({ kind: 'VIEW', tenantId: hotel.tenantId });
      expect(session.body.user.email).toBe(operationsAccount.email);
      const memberships = await hotelGet('/auth/memberships', cookie);
      expect(memberships.body.memberships).toHaveLength(1);
      expect(memberships.body.memberships[0].tenantId).toBe(hotel.tenantId);
      expect((await hotelGet(dashboard, cookie)).status).toBe(200);
      const banner = await hotelGet('/support/current', cookie);
      expect(banner.body).toMatchObject({
        active: true,
        session: { id, kind: 'VIEW', hotelName: expect.any(String) },
      });

      // Read access only: every write is refused, even one an owner could make.
      for (const attempt of [
        () =>
          hotelPost(
            `/tenants/${hotel.tenantId}/properties/${hotel.propertyId}/availability-blocks`,
            cookie,
            { startsOn: '2036-10-12', endsOn: '2036-10-13', all: true },
          ),
        () =>
          hotelPost(`/tenants/${hotel.tenantId}/staff-invitations`, cookie, {
            email: 'x@example.test',
            assignments: [],
          }),
        () =>
          request(app.getHttpServer())
            .delete(`/tenants/${hotel.tenantId}/properties/${hotel.propertyId}`)
            .set('Cookie', cookie),
      ]) {
        const response = await attempt();
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('SUPPORT_ACCESS_LIMITED');
      }

      // Every request is in the platform audit log, refusals included.
      const rows = await owner.$queryRaw<
        Array<{ result: string; details: { mode: string; method: string } }>
      >`
        SELECT result, details FROM platform_audit_log
        WHERE support_session_id = ${id}::uuid AND action = 'platform.support.request'`;
      expect(rows.filter((row) => row.result === 'succeeded').length).toBeGreaterThanOrEqual(4);
      expect(rows.filter((row) => row.result === 'denied').length).toBe(3);
      expect(rows.every((row) => row.details.mode === 'VIEW')).toBe(true);

      // The hotel owner can see the session in their own audit log.
      const hotelLog = await owner.$queryRaw<Array<{ action: string; actor_type: string }>>`
        SELECT action, actor_type::text FROM audit_logs WHERE tenant_id = ${hotel.tenantId}::uuid AND action LIKE 'support.%'`;
      expect(hotelLog.map((row) => row.action)).toContain('support.session.started');
      expect(hotelLog[0].actor_type).toBe('PLATFORM_ADMIN');
    });
  });

  it('can never cross to another hotel, and the two cookies are not interchangeable', async () => {
    const one = await createHotel();
    const two = await createHotel();
    const { cookie } = await openSession(operations, one);
    expect((await hotelGet(`/tenants/${one.tenantId}/properties`, cookie)).status).toBe(200);

    // The same cookie against the other hotel opens nothing.
    for (const path of [
      `/tenants/${two.tenantId}/properties`,
      `/tenants/${two.tenantId}/properties/${two.propertyId}/bookings`,
      `/tenants/${two.tenantId}/support-sessions`,
    ]) {
      const response = await hotelGet(path, cookie);
      expect([401, 403]).toContain(response.status);
    }
    // Property from the other hotel under this hotel's id is refused too.
    expect([401, 403]).toContain(
      (await hotelGet(`/tenants/${one.tenantId}/properties/${two.propertyId}/bookings`, cookie))
        .status,
    );

    // The support cookie grants nothing in the platform console and the console cookie nothing in hotels.
    const consoleWithSupport = await request(app.getHttpServer())
      .get('/platform-console/team')
      .set('Cookie', cookie);
    expect(consoleWithSupport.status).toBe(401);
    expect((await hotelGet(`/tenants/${one.tenantId}/properties`, operations.cookie)).status).toBe(
      401,
    );

    // A hotel owner's own session still works only on their hotel.
    expect((await hotelGet(`/tenants/${two.tenantId}/properties`, one.ownerCookie)).status).toBe(
      403,
    );
  });

  it('ends on expiry, revocation, suspension of the platform account and a role change', async () => {
    const hotel = await createHotel();
    const dashboard = `/tenants/${hotel.tenantId}/properties`;

    const expiring = await openSession(operations, hotel);
    await owner.$executeRaw`UPDATE support_sessions SET expires_at = now() - interval '1 second' WHERE id = ${expiring.id}::uuid`;
    expect((await hotelGet(dashboard, expiring.cookie)).status).toBe(401);
    expect((await hotelGet('/auth/session', expiring.cookie)).status).toBe(401);
    expect((await hotelGet('/support/current', expiring.cookie)).body.active).toBe(false);

    const revoked = await openSession(operations, hotel);
    expect((await hotelGet(dashboard, revoked.cookie)).status).toBe(200);
    expect((await operations.write('post', `/support-sessions/${revoked.id}/revoke`)).status).toBe(
      201,
    );
    expect((await hotelGet(dashboard, revoked.cookie)).status).toBe(401);

    // Suspending the platform account cuts a live session at once.
    const colleague = await seedPlatformAccount(owner, 'operations');
    const colleagueClient = await loggedIn(app, colleague);
    const live = await openSession(colleagueClient, hotel);
    expect((await hotelGet(dashboard, live.cookie)).status).toBe(200);
    await owner.$executeRaw`UPDATE platform_accounts SET status = 'SUSPENDED' WHERE id = ${colleague.id}::uuid`;
    expect((await hotelGet(dashboard, live.cookie)).status).toBe(401);

    // A role change that removes the capability does too.
    const demoted = await seedPlatformAccount(owner, 'operations');
    const demotedClient = await loggedIn(app, demoted);
    const second = await openSession(demotedClient, hotel);
    expect((await hotelGet(dashboard, second.cookie)).status).toBe(200);
    await owner.$executeRaw`UPDATE platform_accounts SET role_id = (SELECT id FROM platform_roles WHERE key = 'finance') WHERE id = ${demoted.id}::uuid`;
    expect((await hotelGet(dashboard, second.cookie)).status).toBe(401);
  });

  it('allows one open session per person per hotel, and the end button ends it', async () => {
    const hotel = await createHotel();
    const first = await openSession(operations, hotel);
    const again = await operations.write('post', '/support-sessions', {
      tenantId: hotel.tenantId,
      kind: 'VIEW',
      reason: 'A second attempt at the same hotel',
    });
    expect(again.status).toBe(409);
    const other = await openSession(approver, hotel); // a different person is fine
    expect((await hotelGet(`/tenants/${hotel.tenantId}/properties`, other.cookie)).status).toBe(
      200,
    );

    await request(app.getHttpServer()).post('/support/end').set('Cookie', first.cookie).expect(204);
    expect((await hotelGet(`/tenants/${hotel.tenantId}/properties`, first.cookie)).status).toBe(
      401,
    );
    expect(
      (
        await operations.write('post', '/support-sessions', {
          tenantId: hotel.tenantId,
          kind: 'VIEW',
          reason: 'Opening a new one after ending',
        })
      ).status,
    ).toBe(201);
  });

  it('requires a reason, a sane duration and the right platform permission', async () => {
    const hotel = await createHotel();
    const make = (body: object, client = operations) =>
      client.write('post', '/support-sessions', {
        tenantId: hotel.tenantId,
        kind: 'VIEW',
        ...body,
      });
    expect((await make({ reason: 'too short' })).status).toBe(400);
    expect((await make({ reason: 'A perfectly good reason', durationMinutes: 500 })).status).toBe(
      400,
    );
    expect((await make({ reason: 'A perfectly good reason', kind: 'ADMIN' })).status).toBe(400);
    expect((await make({ reason: 'Finance has no support permission' }, finance)).status).toBe(403);
    expect(
      (
        await operations.write('post', '/support-sessions', {
          tenantId: randomUUID(),
          kind: 'VIEW',
          reason: 'Unknown hotel for this test',
        })
      ).status,
    ).toBe(404);
    const ok = await make({ reason: 'Default duration applies here' });
    expect(ok.status).toBe(201);
    expect(ok.body.durationMinutes).toBe(60);
  });

  describe('act-as', () => {
    it('needs approval, limits what can be done, and audits it as performed on behalf of the hotel', async () => {
      const hotel = await createHotel();
      const pending = await operations.write('post', '/support-sessions', {
        tenantId: hotel.tenantId,
        kind: 'ACT',
        reason: 'Block dates the hotel asked us to close',
      });
      expect(pending.body.status).toBe('PENDING_APPROVAL');

      // Not usable until approved, and the requester cannot approve their own request.
      expect(
        (await operations.write('post', `/support-sessions/${pending.body.id}/enter`, {}, null))
          .status,
      ).toBe(409);
      expect(
        (await operations.write('post', `/support-sessions/${pending.body.id}/approve`)).status,
      ).toBe(403);
    });

    it('is approved by a different platform member, then acts within the allow-list only', async () => {
      const hotel = await createHotel();
      const { id, cookie } = await openSession(operations, hotel, 'ACT');
      const property = `/tenants/${hotel.tenantId}/properties/${hotel.propertyId}`;

      // Allowed: a calendar block (calendar.block is on the act-as list).
      const block = await hotelPost(`${property}/availability-blocks`, cookie, {
        startsOn: '2036-10-12',
        endsOn: '2036-10-13',
        all: true,
      });
      expect(block.status, JSON.stringify(block.body)).toBe(201);

      // Refused: staff, refunds, deletion, and owner-only support routes.
      const refusals = [
        () =>
          hotelPost(`/tenants/${hotel.tenantId}/staff-invitations`, cookie, {
            email: 'x@example.test',
            assignments: [],
          }),
        () => hotelPost(`${property}/payments/refunds`, cookie, {}),
        () =>
          request(app.getHttpServer())
            .delete(`${property}/availability-blocks/${randomUUID()}`)
            .set('Cookie', cookie),
        () => hotelPost(`/tenants/${hotel.tenantId}/support-sessions/${id}/approve`, cookie),
        () => hotelPost(`/tenants/${hotel.tenantId}/support-sessions/${id}/revoke`, cookie),
      ];
      for (const attempt of refusals) {
        const response = await attempt();
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('SUPPORT_ACCESS_LIMITED');
      }

      // The platform log keeps every attempt, and the hotel's own audit log says who acted.
      const platform = await owner.$queryRaw<Array<{ result: string }>>`
        SELECT result FROM platform_audit_log WHERE support_session_id = ${id}::uuid AND action = 'platform.support.request'`;
      expect(platform.filter((row) => row.result === 'denied')).toHaveLength(5);
      const hotelLog = await owner.$queryRaw<
        Array<{
          action: string;
          details: Record<string, unknown>;
          request_context: { support?: Record<string, unknown> } | null;
        }>
      >`
        SELECT action, details, request_context FROM audit_logs WHERE tenant_id = ${hotel.tenantId}::uuid ORDER BY created_at`;
      const performed = hotelLog.find((row) => row.action === 'support.action.performed');
      expect(performed?.details).toMatchObject({
        performedBy: operationsAccount.email,
        onBehalfOfHotel: true,
        method: 'POST',
      });
      const blockRow = hotelLog.find((row) => row.request_context?.support);
      expect(blockRow?.request_context?.support).toMatchObject({
        performedBy: operationsAccount.email,
        mode: 'ACT',
        onBehalfOfHotel: true,
      });
      expect(hotelLog.some((row) => row.action === 'support.action.refused')).toBe(true);
    });

    it('lets only one of two simultaneous approvals win, and the owner cannot approve it again', async () => {
      const hotel = await createHotel();
      const pending = await operations.write('post', '/support-sessions', {
        tenantId: hotel.tenantId,
        kind: 'ACT',
        reason: 'Two approvers click at the same moment',
      });
      const [one, two] = await Promise.all([
        approver.write('post', `/support-sessions/${pending.body.id}/approve`),
        superAdmin.write('post', `/support-sessions/${pending.body.id}/approve`),
      ]);
      expect([one.status, two.status].sort()).toEqual([201, 409]);
      const late = await hotelPost(
        `/tenants/${hotel.tenantId}/support-sessions/${pending.body.id}/approve`,
        hotel.ownerCookie,
      );
      expect(late.status).toBe(409);
      const rows = await owner.$queryRaw<
        Array<{ n: number }>
      >`SELECT COUNT(*)::int AS n FROM platform_audit_log WHERE support_session_id = ${pending.body.id}::uuid AND action = 'platform.support.act_approved' AND result = 'succeeded'`;
      expect(rows[0].n).toBe(1);
    });

    it('can be approved or denied by the hotel owner in the dashboard, and expires if nobody decides', async () => {
      const hotel = await createHotel();
      const pending = await operations.write('post', '/support-sessions', {
        tenantId: hotel.tenantId,
        kind: 'ACT',
        reason: 'Owner will decide this one in the dashboard',
      });

      const listed = await hotelGet(
        `/tenants/${hotel.tenantId}/support-sessions`,
        hotel.ownerCookie,
      );
      expect(listed.status).toBe(200);
      expect(listed.body.sessions[0]).toMatchObject({
        id: pending.body.id,
        status: 'PENDING_APPROVAL',
        kind: 'ACT',
        requestedBy: { email: operationsAccount.email },
      });

      const approved = await hotelPost(
        `/tenants/${hotel.tenantId}/support-sessions/${pending.body.id}/approve`,
        hotel.ownerCookie,
      );
      expect(approved.status).toBe(201);
      expect(approved.body).toMatchObject({ status: 'ACTIVE', approvalMethod: 'OWNER' });
      // A second platform admin cannot decide it again.
      expect(
        (await approver.write('post', `/support-sessions/${pending.body.id}/approve`)).status,
      ).toBe(409);

      // Another request, denied by the owner.
      const colleague = await loggedIn(app, await seedPlatformAccount(owner, 'operations'));
      const second = await colleague.write('post', '/support-sessions', {
        tenantId: hotel.tenantId,
        kind: 'ACT',
        reason: 'A request the owner will refuse',
      });
      expect(
        (
          await hotelPost(
            `/tenants/${hotel.tenantId}/support-sessions/${second.body.id}/deny`,
            hotel.ownerCookie,
          )
        ).body.status,
      ).toBe('DENIED');
      expect(
        (await colleague.write('post', `/support-sessions/${second.body.id}/enter`, {}, null))
          .status,
      ).toBe(409);

      // An unanswered request lapses.
      const third = await loggedIn(app, await seedPlatformAccount(owner, 'operations'));
      const lapsing = await third.write('post', '/support-sessions', {
        tenantId: hotel.tenantId,
        kind: 'ACT',
        reason: 'Nobody answers this request',
      });
      await owner.$executeRaw`UPDATE support_sessions SET expires_at = now() - interval '1 second' WHERE id = ${lapsing.body.id}::uuid`;
      expect(
        (await approver.write('post', `/support-sessions/${lapsing.body.id}/approve`)).status,
      ).toBe(409);

      // The owner's own audit log shows every step.
      const log = await owner.$queryRaw<
        Array<{ action: string }>
      >`SELECT action FROM audit_logs WHERE tenant_id = ${hotel.tenantId}::uuid AND action LIKE 'support.session.%'`;
      expect(log.map((row) => row.action)).toEqual(
        expect.arrayContaining([
          'support.session.requested',
          'support.session.approved',
          'support.session.denied',
        ]),
      );
    });

    it('is refused on a suspended hotel, and an owner of another hotel cannot decide its sessions', async () => {
      const hotel = await createHotel();
      const other = await createHotel();
      const pending = await operations.write('post', '/support-sessions', {
        tenantId: hotel.tenantId,
        kind: 'ACT',
        reason: 'Used to test cross-hotel owner approval',
      });
      const cross = await hotelPost(
        `/tenants/${other.tenantId}/support-sessions/${pending.body.id}/approve`,
        other.ownerCookie,
      );
      expect([403, 404]).toContain(cross.status);
      const still = await owner.$queryRaw<
        Array<{ status: string }>
      >`SELECT status FROM support_sessions WHERE id = ${pending.body.id}::uuid`;
      expect(still[0].status).toBe('PENDING_APPROVAL');

      const version = (await superAdmin.get(`/hotels/${other.tenantId}`)).body.lifecycle.version;
      await superAdmin.write('post', `/hotels/${other.tenantId}/lifecycle`, {
        to: 'SUSPENDED',
        reason: 'Testing act-as refusal',
        version,
      });
      const refused = await operations.write('post', '/support-sessions', {
        tenantId: other.tenantId,
        kind: 'ACT',
        reason: 'Trying act-as on a suspended hotel',
      });
      expect(refused.status).toBe(409);
      // View-as on a suspended hotel is still allowed so support can look at what is wrong.
      const view = await operations.write('post', '/support-sessions', {
        tenantId: other.tenantId,
        kind: 'VIEW',
        reason: 'Looking at a suspended hotel to help',
      });
      expect(view.status).toBe(201);
    });
  });
});
