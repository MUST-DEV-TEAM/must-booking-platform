import { randomUUID } from 'node:crypto';

import * as bcrypt from 'bcrypt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migratePlatformAdmins } from '../src/platform/console/migrate-platform-admins';
import {
  clearPlatformLoginLimits,
  ConsoleClient,
  ownerClient,
  startConsoleApp,
} from './helpers/platform-console';

describe('migrating is_platform_admin users into platform accounts', () => {
  const owner = ownerClient();
  const email = `legacy-admin-${randomUUID()}@example.test`;
  let userId: string;

  beforeAll(async () => {
    const hash = await bcrypt.hash('Legacy-admin-pass-1', 4);
    const rows = await owner.$queryRaw<Array<{ id: string }>>`
      INSERT INTO users (email, password_hash, email_verified_at, is_platform_admin)
      VALUES (${email}, ${hash}, now(), true) RETURNING id`;
    userId = rows[0]!.id;
  });

  afterAll(async () => {
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM platform_sessions WHERE account_id IN (SELECT id FROM platform_accounts WHERE migrated_from_user_id = ${userId}::uuid)`;
      await tx.$executeRaw`DELETE FROM platform_accounts WHERE migrated_from_user_id = ${userId}::uuid`;
      await tx.$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    });
    await owner.$disconnect();
  });

  it('is a dry run by default, applies idempotently, keeps the old user, and can be rolled back', async () => {
    const dry = await migratePlatformAdmins(owner, 'dry-run');
    expect(dry.candidates).toContainEqual({ email, action: 'create' });
    expect(
      await owner.$queryRaw`SELECT 1 FROM platform_accounts WHERE lower(email) = ${email}`,
    ).toHaveLength(0);

    const applied = await migratePlatformAdmins(owner, 'apply');
    expect(applied.candidates).toContainEqual({ email, action: 'create' });
    const again = await migratePlatformAdmins(owner, 'apply');
    expect(again.candidates).toContainEqual({ email, action: 'skip-existing' });
    const accounts = await owner.$queryRaw<Array<{ role: string; status: string }>>`
      SELECT r.key AS role, a.status FROM platform_accounts a JOIN platform_roles r ON r.id = a.role_id WHERE lower(a.email) = ${email}`;
    expect(accounts).toEqual([{ role: 'super_admin', status: 'ACTIVE' }]);

    // The old user and its flag are untouched, so the old routes keep working.
    const legacy = await owner.$queryRaw<
      Array<{ is_platform_admin: boolean }>
    >`SELECT is_platform_admin FROM users WHERE id = ${userId}::uuid`;
    expect(legacy[0].is_platform_admin).toBe(true);

    // The migrated account signs in to the new console with the same password.
    await clearPlatformLoginLimits();
    const app = await startConsoleApp();
    try {
      const client = new ConsoleClient(app);
      const login = await client.login(email, 'Legacy-admin-pass-1');
      expect(login.status).toBe(200);
      expect(login.body.me.roleKey).toBe('super_admin');

      // Rollback suspends the account and ends its sessions; the old flag is still there.
      const rollback = await migratePlatformAdmins(owner, 'rollback');
      expect(rollback.candidates).toContainEqual({ email, action: 'suspend' });
      expect((await client.get('/auth/me')).status).toBe(401);
      expect((await new ConsoleClient(app).login(email, 'Legacy-admin-pass-1')).status).toBe(401);
    } finally {
      await app.close();
    }
    const audit = await owner.$queryRaw<Array<{ action: string }>>`
      SELECT action FROM platform_audit_log WHERE action LIKE 'platform.account.migrat%' AND (actor_email = ${email} OR details->>'email' = ${email})`;
    expect(audit.map((row) => row.action).sort()).toEqual([
      'platform.account.migrated_from_user',
      'platform.account.migration_rolled_back',
    ]);
  });
});
