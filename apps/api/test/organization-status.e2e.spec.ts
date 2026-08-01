import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const database = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('organization status schema', () => {
  const organizationId = randomUUID();

  beforeAll(async () => {
    await database.$executeRaw`
      INSERT INTO "organizations" ("id", "name")
      VALUES (${organizationId}::uuid, 'Organization status test')
    `;
  });

  afterAll(async () => {
    await database.$executeRaw`
      DELETE FROM "organizations" WHERE "id" = ${organizationId}::uuid
    `;
    await database.$disconnect();
  });

  it('defaults organizations to ACTIVE and supports SUSPENDED as a concrete state', async () => {
    const rows = await database.$queryRaw<Array<{ status: string }>>`
      SELECT "status"::text AS "status"
      FROM "organizations"
      WHERE "id" = ${organizationId}::uuid
    `;
    expect(rows).toEqual([{ status: 'ACTIVE' }]);

    await database.$executeRaw`
      UPDATE "organizations"
      SET "status" = 'SUSPENDED'::"OrganizationStatus"
      WHERE "id" = ${organizationId}::uuid
    `;
    const suspended = await database.$queryRaw<Array<{ status: string }>>`
      SELECT "status"::text AS "status"
      FROM "organizations"
      WHERE "id" = ${organizationId}::uuid
    `;
    expect(suspended).toEqual([{ status: 'SUSPENDED' }]);
  });
});
