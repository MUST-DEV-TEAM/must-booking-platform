import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const email = requiredEnvironment('PLATFORM_ADMIN_EMAIL').toLowerCase();
const password = requiredEnvironment('PLATFORM_ADMIN_PASSWORD');
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || '';

if (!databaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL must be configured.');
}

const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main(): Promise<void> {
  try {
    const passwordHash = await bcrypt.hash(password, 12);

    await database.$transaction(async (tx) => {
      const existing = await tx.$queryRaw<Array<{ id: string; isPlatformAdmin: boolean }>>`
        SELECT "id", "is_platform_admin" AS "isPlatformAdmin"
        FROM "users"
        WHERE lower("email") = ${email}
        FOR UPDATE
      `;

      if (existing[0]) {
        const memberships = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::integer AS "count"
          FROM "tenant_memberships"
          WHERE "user_id" = ${existing[0].id}::uuid
        `;
        if ((memberships[0]?.count ?? 0) > 0) {
          throw new Error('A platform-admin account cannot also have tenant memberships.');
        }

        await tx.$executeRaw`
          UPDATE "users"
          SET "password_hash" = ${passwordHash},
              "is_platform_admin" = true,
              "email_verified_at" = COALESCE("email_verified_at", CURRENT_TIMESTAMP),
              "updated_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${existing[0].id}::uuid
        `;
        return;
      }

      await tx.$executeRaw`
        INSERT INTO "users" (
          "id", "email", "password_hash", "email_verified_at", "is_platform_admin"
        )
        VALUES (gen_random_uuid(), ${email}, ${passwordHash}, CURRENT_TIMESTAMP, true)
      `;
    });

    console.log(`Seeded platform admin account: ${email}`);
  } finally {
    await database.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}
