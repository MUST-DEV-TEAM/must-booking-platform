import { PrismaClient } from '@prisma/client';

/**
 * Specs sign up fresh hotels, which start on the Free plan, and then write to them. Production Free
 * is read-only with one seat, so the test database restores the earlier writable, three-seat Free.
 * The read-only guard has its own spec that creates a read-only plan. Unit runs without a database
 * skip this silently.
 */
export default async function setup(): Promise<void> {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
      },
    },
  });
  try {
    await prisma.$executeRaw`
      UPDATE "plans" SET "read_only" = false, "max_staff_seats" = 3
      WHERE "id" = '00000000-0000-0000-0000-000000000001'
    `;
  } catch {
    // No database in this run.
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}
