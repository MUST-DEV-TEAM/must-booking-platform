import { PrismaClient } from '@prisma/client';

const password = requiredEnvironment('APP_DATABASE_PASSWORD');
const databaseUrl = process.env.MIGRATION_DATABASE_URL?.trim() || '';

if (!databaseUrl) {
  throw new Error('MIGRATION_DATABASE_URL must be configured.');
}

// Migration 20260727180000 creates `must_booking_app` with a placeholder password,
// because a migration cannot read the deployment's secrets. Only the migration
// owner can change it afterwards, so this runs on that connection -- not the API's
// own non-superuser one -- after every `prisma migrate deploy`.
const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

async function main(): Promise<void> {
  try {
    await database.$executeRawUnsafe(`ALTER ROLE must_booking_app WITH PASSWORD '${password}'`);
    console.log('Set the must_booking_app runtime role password from APP_DATABASE_PASSWORD.');
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
  // ALTER ROLE accepts no bind parameters, so the value is inlined into the
  // statement. Reject anything that could terminate the literal instead of
  // relying on escaping to contain it.
  const isUnsafe = [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return character === "'" || character === '\\' || code < 0x20 || code === 0x7f;
  });
  if (isUnsafe) {
    throw new Error(`${name} must not contain quotes, backslashes or control characters.`);
  }
  return value;
}
