import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

const freePlanId = '00000000-0000-0000-0000-000000000001';
const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('plan catalog', () => {
  const organizationId = randomUUID();

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${organizationId}::uuid`;
    await migrationPrisma.$disconnect();
  });

  it('seeds the illustrative Free plan and defaults new organizations to it', async () => {
    const plans = await migrationPrisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        maxProperties: number;
        maxStaffSeats: number;
        pmsEnabled: boolean;
        maxPmsConnectionsPerProperty: number;
      }>
    >`
      SELECT
        "id",
        "name",
        "max_properties" AS "maxProperties",
        "max_staff_seats" AS "maxStaffSeats",
        "pms_enabled" AS "pmsEnabled",
        "max_pms_connections_per_property" AS "maxPmsConnectionsPerProperty"
      FROM "plans"
      WHERE "id" = ${freePlanId}::uuid
    `;

    expect(plans).toEqual([
      {
        id: freePlanId,
        name: 'Free',
        maxProperties: 1,
        maxStaffSeats: 3,
        pmsEnabled: false,
        maxPmsConnectionsPerProperty: 0,
      },
    ]);

    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name")
      VALUES (${organizationId}::uuid, 'Default plan organization')
    `;

    const organizations = await migrationPrisma.$queryRaw<Array<{ planId: string }>>`
      SELECT "plan_id" AS "planId"
      FROM "organizations"
      WHERE "id" = ${organizationId}::uuid
    `;
    expect(organizations).toEqual([{ planId: freePlanId }]);
  });
});
