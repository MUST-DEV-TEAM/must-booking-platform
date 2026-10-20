import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';
import { cleanupTenant } from './helpers/cleanup-tenant';
import {
  clearPlatformLoginLimits,
  ConsoleClient,
  loggedIn,
  MailCapture,
  ownerClient,
  seedPlatformAccount,
  startConsoleApp,
} from './helpers/platform-console';

// TEMPORARY Super admin shortcut (owner decision 2026-10-20): enter a hotel as its owner at once.
describe('platform console: direct owner-level access (temporary)', () => {
  const owner = ownerClient();
  const mail = new MailCapture();
  let app: INestApplication;
  let superAdmin: ConsoleClient;
  let operations: ConsoleClient;
  let tenantId: string;
  let ownerCookie: string;
  const userEmails: string[] = [];

  const hotelPost = (path: string, cookie: string, body: object = {}) =>
    request(app.getHttpServer()).post(path).set('Cookie', cookie).send(body);

  const enterDirect = async (body: Record<string, unknown> = {}) => {
    const created = await superAdmin.write('post', '/support-sessions', {
      tenantId,
      direct: true,
      ...body,
    });
    expect(created.status).toBe(201);
    const entered = await superAdmin.write(
      'post',
      `/support-sessions/${created.body.id}/enter`,
      {},
      null,
    );
    expect(entered.status).toBe(200);
    const header = (entered.headers['set-cookie'] as unknown as string[]).find((entry) =>
      entry.startsWith('must_support='),
    )!;
    return { session: created.body, cookie: header.split(';')[0], header };
  };

  beforeAll(async () => {
    await clearPlatformLoginLimits();
    app = await startConsoleApp(mail);
    superAdmin = await loggedIn(app, await seedPlatformAccount(owner, 'super_admin'));
    operations = await loggedIn(app, await seedPlatformAccount(owner, 'operations'));

    const ownerEmail = `direct-owner-${randomUUID()}@example.test`;
    const created = await operations.write('post', '/hotels', {
      hotelName: `Direct Hotel ${randomUUID().slice(0, 8)}`,
      ownerName: 'Olga Owner',
      ownerEmail,
      country: 'AL',
      timeZone: 'Europe/Tirane',
      currency: 'EUR',
      mode: 'MUST_SOURCE',
    });
    expect(created.status).toBe(201);
    tenantId = created.body.tenantId;
    userEmails.push(ownerEmail);
    await request(app.getHttpServer())
      .post('/auth/staff-invitations/activate')
      .send({
        token: mail.tokenFor(ownerEmail),
        email: ownerEmail,
        password: 'Owner-pass-12345',
      })
      .expect(204);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ownerEmail, password: 'Owner-pass-12345' })
      .expect(201);
    ownerCookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  });

  beforeEach(async () => {
    await clearPlatformLoginLimits();
  });

  afterAll(async () => {
    await app.close();
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM support_sessions WHERE tenant_id = ${tenantId}::uuid`;
      await tx.$executeRaw`DELETE FROM organization_lifecycle_events WHERE tenant_id = ${tenantId}::uuid`;
      await cleanupTenant(tx, tenantId);
      for (const email of userEmails)
        await tx.$executeRaw`DELETE FROM users WHERE lower(email) = ${email.toLowerCase()}`;
    });
    await owner.$disconnect();
  });

  it('is open to Super admins only', async () => {
    const refused = await operations.write('post', '/support-sessions', { tenantId, direct: true });
    expect(refused.status).toBe(403);
  });

  it('starts at once with no reason, no approval and no expiry, and lets the banner be hidden', async () => {
    const { session, header } = await enterDirect({ showBanner: false });
    expect(session).toMatchObject({
      kind: 'ACT',
      status: 'ACTIVE',
      direct: true,
      showBanner: false,
      reason: '',
    });
    // Effectively open-ended, and a browser-session cookie (no Expires/Max-Age).
    expect(new Date(session.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      5 * 365 * 86_400_000,
    );
    expect(header).not.toMatch(/expires=/i);
    expect(header).not.toMatch(/max-age=/i);
  });

  it('gives owner-level access: actions the approved act-as list refuses are allowed', async () => {
    const { cookie } = await enterDirect();
    const response = await hotelPost(`/tenants/${tenantId}/staff-invitations`, cookie, {
      email: `direct-invitee-${randomUUID()}@example.test`,
      assignments: [],
    });
    // Not refused as a limited support session; the handler itself decides.
    expect(response.body.code).not.toBe('SUPPORT_ACCESS_LIMITED');
    expect(response.status).not.toBe(403);
  });

  it('is invisible to the hotel owner and recorded in the platform log', async () => {
    const { session, cookie } = await enterDirect();
    // An owner-only action (approving another admin's pending request) that writes a hotel audit row.
    const pending = await operations.write('post', '/support-sessions', {
      tenantId,
      kind: 'ACT',
      reason: 'Needs approval so the direct session can act as the owner',
    });
    expect(pending.status).toBe(201);
    const action = await hotelPost(
      `/tenants/${tenantId}/support-sessions/${pending.body.id}/approve`,
      cookie,
    );
    expect(action.status).toBeLessThan(300);

    // The owner's session list and notice never include it.
    const listed = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/support-sessions`)
      .set('Cookie', ownerCookie)
      .expect(200);
    expect(listed.body.sessions.map((entry: { id: string }) => entry.id)).not.toContain(session.id);
    // The owner cannot approve, deny or end it either.
    for (const verb of ['approve', 'deny', 'revoke'])
      expect(
        (
          await hotelPost(
            `/tenants/${tenantId}/support-sessions/${session.id}/${verb}`,
            ownerCookie,
          )
        ).status,
      ).toBe(404);

    // Hotel audit rows written during the session are hidden from the hotel by the database itself,
    // and visible to platform roles.
    const database = app.get(TenantDatabaseService);
    const hiddenForHotel = await database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM audit_logs
        WHERE tenant_id = ${tenantId}::uuid AND request_context #>> '{support,sessionId}' = ${session.id}`,
    );
    expect(hiddenForHotel[0].n).toBe(0);
    const stored = await owner.$queryRaw<Array<{ n: number; hidden: number }>>`
      SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE hidden)::int AS hidden FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND request_context #>> '{support,sessionId}' = ${session.id}`;
    expect(stored[0].n).toBeGreaterThan(0);
    expect(stored[0].hidden).toBe(stored[0].n);
    const forPlatform = await database.withPlatformAdminTransaction(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM audit_logs
        WHERE tenant_id = ${tenantId}::uuid AND request_context #>> '{support,sessionId}' = ${session.id}`,
    );
    expect(forPlatform[0].n).toBe(stored[0].n);

    // No copy was written to the hotel's own log under the platform account.
    const leaked = await owner.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM audit_logs
      WHERE tenant_id = ${tenantId}::uuid AND target_id = ${session.id} AND NOT hidden`;
    expect(leaked[0].n).toBe(0);

    const platform = await owner.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM platform_audit_log WHERE support_session_id = ${session.id}::uuid`;
    expect(platform.map((row) => row.action)).toContain('platform.support.direct_started');
    expect(platform.map((row) => row.action)).toContain('platform.support.request');
  });

  it('ends when the admin ends it, and the cookie stops working', async () => {
    const { session, cookie } = await enterDirect();
    const ended = await superAdmin.write('post', `/support-sessions/${session.id}/revoke`);
    expect(ended.status).toBe(201);
    const after = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/support-sessions`)
      .set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});
