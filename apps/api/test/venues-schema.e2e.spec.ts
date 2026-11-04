import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cleanupTenant } from './helpers/cleanup-tenant';

const admin = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
// The runtime role: subject to row-level security, unlike the migration owner above.
const app = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

describe('venue schema', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const venueA = randomUUID();
  const areaA = randomUUID();
  const tableA1 = randomUUID();
  const tableA2 = randomUUID();

  beforeAll(async () => {
    for (const [id, name] of [
      [tenantA, 'Venue schema A'],
      [tenantB, 'Venue schema B'],
    ]) {
      await admin.$executeRaw`INSERT INTO organizations (id, name) VALUES (${id}::uuid, ${name})`;
    }
    await admin.$executeRaw`
      INSERT INTO venues (id, tenant_id, name, slug)
      VALUES (${venueA}::uuid, ${tenantA}::uuid, 'Standalone grill', 'standalone-grill')`;
    await admin.$executeRaw`
      INSERT INTO venue_areas (id, tenant_id, venue_id, name, sort_order)
      VALUES (${areaA}::uuid, ${tenantA}::uuid, ${venueA}::uuid, 'Terrace', 0)`;
    await admin.$executeRaw`
      INSERT INTO venue_tables (id, tenant_id, venue_id, area_id, label, min_seats, max_seats, map_x, map_y, shape)
      VALUES (${tableA1}::uuid, ${tenantA}::uuid, ${venueA}::uuid, ${areaA}::uuid, 'T1', 2, 4, 10, 10, 'square'),
             (${tableA2}::uuid, ${tenantA}::uuid, ${venueA}::uuid, ${areaA}::uuid, 'T2', 2, 4, 120, 10, 'round')`;
  });

  afterAll(async () => {
    await cleanupTenant(admin, tenantA);
    await cleanupTenant(admin, tenantB);
    await admin.$disconnect();
    await app.$disconnect();
  });

  it('stores a venue that is not linked to any hotel property', async () => {
    const rows = await admin.$queryRaw<Array<{ propertyId: string | null; active: boolean }>>`
      SELECT property_id AS "propertyId", active FROM venues WHERE id = ${venueA}::uuid`;
    expect(rows).toEqual([{ propertyId: null, active: true }]);
  });

  it('rejects a table whose minimum seats exceed its maximum', async () => {
    await expect(
      admin.$executeRaw`
        INSERT INTO venue_tables (tenant_id, venue_id, area_id, label, min_seats, max_seats, map_x, map_y, shape)
        VALUES (${tenantA}::uuid, ${venueA}::uuid, ${areaA}::uuid, 'BAD', 4, 2, 0, 0, 'square')`,
    ).rejects.toThrow();
  });

  it('rejects a second table with the same label in the same area', async () => {
    await expect(
      admin.$executeRaw`
        INSERT INTO venue_tables (tenant_id, venue_id, area_id, label, min_seats, max_seats, map_x, map_y, shape)
        VALUES (${tenantA}::uuid, ${venueA}::uuid, ${areaA}::uuid, 'T1', 2, 4, 0, 0, 'square')`,
    ).rejects.toThrow();
  });

  it('stores a table combination once per unordered pair', async () => {
    const [low, high] = [tableA1, tableA2].sort();
    await admin.$executeRaw`
      INSERT INTO venue_table_combinations (tenant_id, venue_id, table_a_id, table_b_id)
      VALUES (${tenantA}::uuid, ${venueA}::uuid, ${low}::uuid, ${high}::uuid)`;
    await expect(
      admin.$executeRaw`
        INSERT INTO venue_table_combinations (tenant_id, venue_id, table_a_id, table_b_id)
        VALUES (${tenantA}::uuid, ${venueA}::uuid, ${high}::uuid, ${low}::uuid)`,
    ).rejects.toThrow();
  });

  it('adds the dining flag and venue limit to plans, off by default', async () => {
    const rows = await admin.$queryRaw<Array<{ diningEnabled: boolean; maxVenues: number }>>`
      SELECT dining_enabled AS "diningEnabled", max_venues AS "maxVenues"
      FROM plans WHERE id = '00000000-0000-0000-0000-000000000001'::uuid`;
    expect(rows).toEqual([{ diningEnabled: false, maxVenues: 0 }]);
  });

  it('shows a venue only to its own tenant through row-level security', async () => {
    const countFor = (tenantId: string) =>
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.property_id', '', true)`;
        const venues = await tx.$queryRaw<
          Array<{ n: number }>
        >`SELECT COUNT(*)::int AS n FROM venues`;
        const tables = await tx.$queryRaw<
          Array<{ n: number }>
        >`SELECT COUNT(*)::int AS n FROM venue_tables`;
        return { venues: venues[0]!.n, tables: tables[0]!.n };
      });
    expect(await countFor(tenantA)).toEqual({ venues: 1, tables: 2 });
    expect(await countFor(tenantB)).toEqual({ venues: 0, tables: 0 });
  });
});
