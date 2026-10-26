import { PrismaClient } from '@prisma/client';

import { migratePlatformAdmins } from '../src/platform/console/migrate-platform-admins';

// Usage (from apps/api):
//   pnpm migrate:platform-admins            # dry run: prints what would happen
//   pnpm migrate:platform-admins --apply    # creates Super admin platform accounts
//   pnpm migrate:platform-admins --rollback # suspends the migrated accounts
// Uses MIGRATION_DATABASE_URL (the owner), never the runtime role. The old users and their
// is_platform_admin flag are not touched.
const url = process.env.MIGRATION_DATABASE_URL?.trim();
if (!url) throw new Error('MIGRATION_DATABASE_URL must be configured.');

const mode = process.argv.includes('--rollback')
  ? 'rollback'
  : process.argv.includes('--apply')
    ? 'apply'
    : 'dry-run';

const client = new PrismaClient({ datasources: { db: { url } } });

migratePlatformAdmins(client, mode)
  .then((report) => {
    console.log(`Platform admin migration (${report.mode})`);
    for (const row of report.candidates) console.log(`  ${row.action.padEnd(14)} ${row.email}`);
    if (report.candidates.length === 0) console.log('  no users are flagged is_platform_admin');
    if (mode === 'dry-run') console.log('Nothing was changed. Re-run with --apply to migrate.');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.$disconnect());
