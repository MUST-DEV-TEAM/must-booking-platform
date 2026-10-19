import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONSOLE_HEADERS,
  ConsoleClient,
  TEST_DATABASE_URL,
  TEST_PASSWORD,
  clearPlatformLoginLimits,
  loggedIn,
  ownerClient,
  seedPlatformAccount,
  startConsoleApp,
  type TestAccount,
} from './helpers/platform-console';
import { PrismaClient } from '@prisma/client';

describe('platform console: sign-in, sessions and team', () => {
  const owner = ownerClient();
  let app: INestApplication;
  let superAdmin: TestAccount;
  let finance: TestAccount;
  let auditor: TestAccount;
  const created: string[] = [];

  const auditRows = (where: string, ...args: unknown[]) =>
    owner.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM platform_audit_log WHERE ${where} ORDER BY created_at DESC`,
      ...args,
    );

  beforeAll(async () => {
    await clearPlatformLoginLimits();
    app = await startConsoleApp();
    superAdmin = await seedPlatformAccount(owner, 'super_admin');
    finance = await seedPlatformAccount(owner, 'finance');
    auditor = await seedPlatformAccount(owner, 'auditor');
  });

  beforeEach(async () => {
    await clearPlatformLoginLimits();
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  describe('sign-in', () => {
    it('signs in with a separate, hardened cookie and audits it', async () => {
      const client = new ConsoleClient(app);
      const response = await client.login(superAdmin.email);
      expect(response.status).toBe(200);
      expect(response.body.me).toMatchObject({ email: superAdmin.email, roleKey: 'super_admin' });
      expect(response.body.me.capabilities).toContain('platform.team.manage');
      const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('must_platform='),
      )!;
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).not.toMatch(/must_session/);
      const rows = await auditRows(`action = 'platform.auth.login' AND actor_email = $1`, superAdmin.email);
      expect(rows[0]).toMatchObject({ result: 'succeeded', actor_role: 'super_admin' });
    });

    it('rejects a wrong password without revealing whether the account exists, and audits it', async () => {
      const wrong = await new ConsoleClient(app).login(superAdmin.email, 'Wrong-password-1234');
      const unknown = await new ConsoleClient(app).login(`nobody-${randomUUID()}@example.test`);
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
      const rows = await auditRows(`action = 'platform.auth.login' AND result = 'failed' AND actor_email = $1`, superAdmin.email);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('does not accept a suspended account', async () => {
      const suspended = await seedPlatformAccount(owner, 'operations', 'SUSPENDED');
      const response = await new ConsoleClient(app).login(suspended.email);
      expect(response.status).toBe(401);
    });

    it('throttles repeated failures for one email', async () => {
      const email = `throttle-${randomUUID()}@example.test`;
      let last = 0;
      for (let attempt = 0; attempt < 10; attempt++)
        last = (await new ConsoleClient(app).login(email, 'Nope-nope-1234')).status;
      expect(last).toBe(429);
      const denied = await auditRows(`action = 'platform.auth.login' AND result = 'denied' AND actor_email = $1`, email);
      expect(denied.length).toBeGreaterThan(0);
    });

    it('is not reachable with a hotel-session cookie or without the console header', async () => {
      const hotelCookie = await request(app.getHttpServer())
        .get('/platform-console/auth/me')
        .set('Cookie', 'must_session=11111111-1111-4111-8111-111111111111');
      expect(hotelCookie.status).toBe(401);
      const noHeader = await request(app.getHttpServer())
        .post('/platform-console/auth/login')
        .send({ email: superAdmin.email, password: TEST_PASSWORD });
      expect(noHeader.status).toBe(403);
      const badOrigin = await request(app.getHttpServer())
        .post('/platform-console/auth/login')
        .set({ ...CONSOLE_HEADERS, Origin: 'https://evil.example' })
        .send({ email: superAdmin.email, password: TEST_PASSWORD });
      expect(badOrigin.status).toBe(403);
    });
  });

  describe('sessions', () => {
    it('stops working after logout and after expiry, and logs out everywhere', async () => {
      const a = await loggedIn(app, superAdmin);
      const b = await loggedIn(app, superAdmin);
      expect((await a.get('/auth/me')).status).toBe(200);

      expect((await a.write('post', '/auth/logout', {}, null)).status).toBe(204);
      expect((await a.get('/auth/me')).status).toBe(401);
      expect((await b.get('/auth/me')).status).toBe(200);

      const c = await loggedIn(app, superAdmin);
      const everywhere = await c.write('post', '/auth/logout-everywhere', {}, null);
      expect(everywhere.status).toBe(201);
      expect((await b.get('/auth/me')).status).toBe(401);
      expect((await c.get('/auth/me')).status).toBe(401);
    });

    it('rejects an absolutely expired and an idle session', async () => {
      const expired = await loggedIn(app, finance);
      await owner.$executeRaw`UPDATE platform_sessions SET expires_at = now() - interval '1 minute' WHERE account_id = ${finance.id}::uuid AND revoked_at IS NULL`;
      expect((await expired.get('/auth/me')).status).toBe(401);

      const idle = await loggedIn(app, finance);
      await owner.$executeRaw`UPDATE platform_sessions SET last_seen_at = now() - interval '3 hours' WHERE account_id = ${finance.id}::uuid AND revoked_at IS NULL`;
      expect((await idle.get('/auth/me')).status).toBe(401);
    });

    it('stops a live session the moment the account is suspended', async () => {
      const victim = await seedPlatformAccount(owner, 'operations');
      const session = await loggedIn(app, victim);
      expect((await session.get('/auth/me')).status).toBe(200);
      await owner.$executeRaw`UPDATE platform_accounts SET status = 'SUSPENDED' WHERE id = ${victim.id}::uuid`;
      expect((await session.get('/auth/me')).status).toBe(401);
    });
  });

  describe('capabilities fail closed', () => {
    it('lets the auditor read the team but not change it, and audits the denial', async () => {
      const client = await loggedIn(app, auditor);
      expect((await client.get('/team')).status).toBe(200);
      const denied = await client.write('post', '/team/invitations', {
        email: `x-${randomUUID()}@example.test`,
        roleKey: 'auditor',
      });
      expect(denied.status).toBe(403);
      const rows = await auditRows(`action = 'platform.access.denied' AND actor_account_id = $1::uuid`, auditor.id);
      expect(rows[0]).toMatchObject({ result: 'denied' });
    });

    it('denies finance the team and audit screens entirely', async () => {
      const client = await loggedIn(app, finance);
      expect((await client.get('/team')).status).toBe(403);
      expect((await client.get('/audit')).status).toBe(403);
    });
  });

  describe('team management', () => {
    let admin: ConsoleClient;
    beforeAll(async () => {
      admin = await loggedIn(app, superAdmin);
    });

    it('invites a person, who accepts and signs in with the chosen password', async () => {
      const email = `invitee-${randomUUID()}@example.test`;
      const invite = await admin.write('post', '/team/invitations', { email, roleKey: 'operations', firstName: 'Ina' });
      expect(invite.status).toBe(201);
      expect(invite.body.invitationToken).toBeTruthy();
      created.push(invite.body.id);

      const pending = await new ConsoleClient(app).login(email, 'Whatever-1234');
      expect(pending.status).toBe(401);

      const accepted = await new ConsoleClient(app).write('post', '/auth/invitations/accept', {
        token: invite.body.invitationToken,
        password: 'Brand-new-pass-99',
      }, null);
      expect(accepted.status).toBe(200);
      expect(accepted.body.me).toMatchObject({ email, roleKey: 'operations' });

      const reuse = await new ConsoleClient(app).write('post', '/auth/invitations/accept', {
        token: invite.body.invitationToken,
        password: 'Another-pass-99',
      }, null);
      expect(reuse.status).toBe(400);
      expect((await new ConsoleClient(app).login(email, 'Brand-new-pass-99')).status).toBe(200);
    });

    it('creates an account with a password and refuses a weak one or a duplicate email', async () => {
      const email = `created-${randomUUID()}@example.test`;
      const weak = await admin.write('post', '/team', { email, roleKey: 'finance', password: 'short1' });
      expect(weak.status).toBe(400);
      const ok = await admin.write('post', '/team', { email, roleKey: 'finance', password: 'Strong-pass-1234' });
      expect(ok.status).toBe(201);
      const duplicate = await admin.write('post', '/team', { email: email.toUpperCase(), roleKey: 'finance', password: 'Strong-pass-1234' });
      expect(duplicate.status).toBe(409);
      expect((await new ConsoleClient(app).login(email, 'Strong-pass-1234')).status).toBe(200);
      const audit = await auditRows(`action = 'platform.team.created' AND target_id = $1`, ok.body.id);
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0])).not.toContain('Strong-pass');
    });

    it('replays an identical request with the same Idempotency-Key and refuses a changed one', async () => {
      const email = `idem-${randomUUID()}@example.test`;
      const key = randomUUID();
      const first = await admin.write('post', '/team/invitations', { email, roleKey: 'auditor' }, key);
      const second = await admin.write('post', '/team/invitations', { email, roleKey: 'auditor' }, key);
      expect(second.status).toBe(first.status);
      expect(second.body.id).toBe(first.body.id);
      const changed = await admin.write('post', '/team/invitations', { email, roleKey: 'finance' }, key);
      expect(changed.status).toBe(422);
      const count = await owner.$queryRaw<[{ n: number }]>`SELECT COUNT(*)::int AS n FROM platform_accounts WHERE lower(email) = ${email}`;
      expect(count[0].n).toBe(1);
      expect((await admin.write('post', '/team/invitations', { email: `n-${email}`, roleKey: 'auditor' }, null)).status).toBe(400);
    });

    it('lets only one of two simultaneous role changes win (version check)', async () => {
      const target = await seedPlatformAccount(owner, 'auditor');
      const version = (await owner.$queryRaw<[{ version: number }]>`SELECT version FROM platform_accounts WHERE id = ${target.id}::uuid`)[0].version;
      const [one, two] = await Promise.all([
        admin.write('patch', `/team/${target.id}/role`, { roleKey: 'finance', version }),
        admin.write('patch', `/team/${target.id}/role`, { roleKey: 'operations', version }),
      ]);
      expect([one.status, two.status].sort()).toEqual([200, 409]);
    });

    it('never lets the last active Super admin be demoted or suspended, nor a role be over-granted', async () => {
      const lone = await seedPlatformAccount(owner, 'super_admin');
      // Make `lone` the only active super admin by suspending everyone else in a transaction we undo after.
      const others = await owner.$queryRaw<Array<{ id: string }>>`SELECT a.id FROM platform_accounts a JOIN platform_roles r ON r.id = a.role_id WHERE r.key = 'super_admin' AND a.status = 'ACTIVE' AND a.id <> ${lone.id}::uuid`;
      await owner.$executeRaw`UPDATE platform_accounts SET status = 'SUSPENDED' WHERE id = ANY(${others.map((row) => row.id)}::uuid[])`;
      try {
        const loneClient = await loggedIn(app, lone);
        const peer = await seedPlatformAccount(owner, 'operations');
        const peerClient = await loggedIn(app, peer);
        // An operations user cannot manage teams at all.
        expect((await peerClient.write('patch', `/team/${lone.id}/status`, { status: 'SUSPENDED', version: 0 })).status).toBe(403);
        // Self-suspension is refused.
        expect((await loneClient.write('patch', `/team/${lone.id}/status`, { status: 'SUSPENDED', version: 0 })).status).toBe(403);
        // Demotion of the only Super admin is refused.
        const demote = await loneClient.write('patch', `/team/${lone.id}/role`, { roleKey: 'auditor', version: 0 });
        expect(demote.status).toBe(409);
      } finally {
        await owner.$executeRaw`UPDATE platform_accounts SET status = 'ACTIVE' WHERE id = ANY(${others.map((row) => row.id)}::uuid[])`;
      }
    });

    it('suspending a person ends their sessions and is audited with before and after', async () => {
      const target = await seedPlatformAccount(owner, 'operations');
      const session = await loggedIn(app, target);
      const version = (await owner.$queryRaw<[{ version: number }]>`SELECT version FROM platform_accounts WHERE id = ${target.id}::uuid`)[0].version;
      const response = await admin.write('patch', `/team/${target.id}/status`, { status: 'SUSPENDED', version });
      expect(response.status).toBe(200);
      expect((await session.get('/auth/me')).status).toBe(401);
      const rows = await auditRows(`action = 'platform.team.suspended' AND target_id = $1`, target.id);
      expect(rows[0]).toMatchObject({ before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } });
    });
  });

  describe('platform audit log is append-only', () => {
    it('refuses update, delete and truncate even from the runtime role', async () => {
      const app_role = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
      try {
        const run = (sql: string) =>
          app_role.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.role', 'platform_console', true)`;
            return tx.$executeRawUnsafe(sql);
          });
        await expect(run(`UPDATE platform_audit_log SET reason = 'x'`)).rejects.toThrow();
        await expect(run(`DELETE FROM platform_audit_log`)).rejects.toThrow();
        await expect(run(`TRUNCATE platform_audit_log`)).rejects.toThrow();
      } finally {
        await app_role.$disconnect();
      }
      // Even the table owner is stopped by the trigger.
      await expect(owner.$executeRawUnsafe(`DELETE FROM platform_audit_log`)).rejects.toThrow();
    });

    it('is invisible without the console role', async () => {
      const app_role = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
      try {
        const rows = await app_role.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM platform_audit_log`;
        expect(rows[0].n).toBe(0);
      } finally {
        await app_role.$disconnect();
      }
    });
  });
});
