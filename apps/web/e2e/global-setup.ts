import { PrismaClient } from '@prisma/client';

/**
 * Browser specs sign up fresh hotels (Free plan) and then edit them. Production Free is read-only
 * with one seat, so the test database restores the earlier writable, three-seat Free.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
  if (!url) return;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$executeRaw`
      UPDATE "plans" SET "read_only" = false, "max_staff_seats" = 3
      WHERE "id" = '00000000-0000-0000-0000-000000000001'
    `;
  } finally {
    await prisma.$disconnect();
  }
}
