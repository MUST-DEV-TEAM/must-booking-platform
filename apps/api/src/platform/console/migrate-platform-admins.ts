import type { PrismaClient } from '@prisma/client';

export interface MigrationReport {
  mode: 'dry-run' | 'apply' | 'rollback';
  candidates: Array<{
    email: string;
    action: 'create' | 'skip-existing' | 'suspend' | 'skip-missing';
  }>;
}

type MigrationClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw' | '$transaction'>;

/**
 * Moves hotel-database users flagged `is_platform_admin` into separate platform accounts as Super
 * admins (same email and password hash). Explicit and reversible:
 *   - it never deletes or changes the old user or its flag, so the old routes keep working;
 *   - re-running it is safe (existing accounts are skipped);
 *   - `rollback` suspends the migrated accounts and ends their sessions.
 * It must run with the migration (owner) connection, because platform tables are closed to the
 * runtime role outside an authenticated console request.
 */
export async function migratePlatformAdmins(
  client: MigrationClient,
  mode: MigrationReport['mode'],
): Promise<MigrationReport> {
  const report: MigrationReport = { mode, candidates: [] };
  const flagged = await client.$queryRaw<
    Array<{
      id: string;
      email: string;
      passwordHash: string | null;
      firstName: string | null;
      lastName: string | null;
    }>
  >`
    SELECT "id", "email", "password_hash" AS "passwordHash", "first_name" AS "firstName", "last_name" AS "lastName"
    FROM "users" WHERE "is_platform_admin" = true ORDER BY "created_at"
  `;

  if (mode === 'rollback') {
    for (const user of flagged) {
      const migrated = await client.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "platform_accounts" WHERE "migrated_from_user_id" = ${user.id}::uuid
      `;
      if (!migrated[0]) {
        report.candidates.push({ email: user.email, action: 'skip-missing' });
        continue;
      }
      report.candidates.push({ email: user.email, action: 'suspend' });
      await client.$transaction([
        client.$executeRaw`
          UPDATE "platform_accounts" SET "status" = 'SUSPENDED', "version" = "version" + 1, "updated_at" = now()
          WHERE "id" = ${migrated[0].id}::uuid
        `,
        client.$executeRaw`
          UPDATE "platform_sessions" SET "revoked_at" = now(), "revoke_reason" = 'migration_rollback'
          WHERE "account_id" = ${migrated[0].id}::uuid AND "revoked_at" IS NULL
        `,
        client.$executeRaw`
          INSERT INTO "platform_audit_log" ("action", "target_type", "target_id", "result", "actor_role", "details")
          VALUES ('platform.account.migration_rolled_back', 'platform_account', ${migrated[0].id}, 'succeeded', 'migration', ${JSON.stringify({ email: user.email })}::jsonb)
        `,
      ]);
    }
    return report;
  }

  for (const user of flagged) {
    const existing = await client.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "platform_accounts" WHERE lower("email") = lower(${user.email})
    `;
    if (existing[0]) {
      report.candidates.push({ email: user.email, action: 'skip-existing' });
      continue;
    }
    report.candidates.push({ email: user.email, action: 'create' });
    if (mode === 'dry-run') continue;
    await client.$transaction([
      client.$executeRaw`
        INSERT INTO "platform_accounts" ("email", "first_name", "last_name", "password_hash", "role_id", "status", "migrated_from_user_id")
        SELECT ${user.email.toLowerCase()}, ${user.firstName}, ${user.lastName}, ${user.passwordHash}, r."id", 'ACTIVE', ${user.id}::uuid
        FROM "platform_roles" r WHERE r."key" = 'super_admin'
      `,
      client.$executeRaw`
        INSERT INTO "platform_audit_log" ("action", "target_type", "target_id", "result", "actor_role", "actor_email", "details")
        VALUES ('platform.account.migrated_from_user', 'user', ${user.id}, 'succeeded', 'migration', ${user.email},
          ${JSON.stringify({ role: 'super_admin', note: 'Old is_platform_admin flag and routes left in place.' })}::jsonb)
      `,
    ]);
  }
  return report;
}
