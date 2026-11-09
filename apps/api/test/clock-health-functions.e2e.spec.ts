import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Behavioural proof for the Clock health checks (stale webhook, stuck booking): under the platform role
// row-level security hides connections and bookings, so the checks read them through two narrow
// SECURITY DEFINER functions. Mocked unit tests cannot show this, which is how the alerts stayed blind.
const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const runtimePrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public',
    },
  },
});

async function asRuntimeRole<T>(
  context: { tenantId?: string; propertyId?: string; role?: string },
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return runtimePrisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      SELECT set_config('app.tenant_id', ${context.tenantId ?? ''}, true),
             set_config('app.property_id', ${context.propertyId ?? ''}, true),
             set_config('app.role', ${context.role ?? ''}, true)
    `;
    return operation(transaction);
  });
}

describe('Clock health check functions', () => {
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const connectionId = randomUUID();

  beforeAll(async () => {
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Clock health test')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Clock health', ${`clock-health-${propertyId}`})
    `;
    await asRuntimeRole({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "integration_connections" ("id", "tenant_id", "kind", "provider", "name", "encrypted_credentials", "status")
        VALUES (${connectionId}::uuid, ${tenantId}::uuid, 'PMS', 'CLOCK_PMS', 'Clock health test', 'not-real', 'CONNECTED')
      `;
      await tx.$executeRaw`
        INSERT INTO "property_integration_connections" ("tenant_id", "property_id", "connection_id", "kind", "enabled")
        VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${connectionId}::uuid, 'PMS', true)
      `;
    });
  });

  afterAll(async () => {
    await asRuntimeRole({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRaw`DELETE FROM "property_integration_connections" WHERE "tenant_id" = ${tenantId}::uuid`;
      await tx.$executeRaw`DELETE FROM "integration_connections" WHERE "tenant_id" = ${tenantId}::uuid`;
    });
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    await migrationPrisma.$disconnect();
    await runtimePrisma.$disconnect();
  });

  it('shows why a plain query is blind: the platform role cannot read connections', async () => {
    const rows = await asRuntimeRole(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "integration_connections" WHERE "id" = ${connectionId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });

  it('lists the connected Clock connection to the platform role without credentials', async () => {
    const rows = await asRuntimeRole(
      { role: 'platform_admin' },
      (tx) => tx.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM clock_connection_health()`,
    );
    const mine = rows.find((row) => row.id === connectionId);
    expect(mine).toBeDefined();
    expect(mine?.tenantId).toBe(tenantId);
    expect(mine?.lastWebhookReceivedAt).toBeNull();
    expect(mine?.createdAt).toBeInstanceOf(Date);
    expect(Object.keys(mine ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'lastWebhookReceivedAt',
      'tenantId',
    ]);
  });

  it('refuses to run for any role other than platform_admin', async () => {
    await expect(
      asRuntimeRole(
        { tenantId, propertyId },
        (tx) => tx.$queryRaw`SELECT * FROM clock_connection_health()`,
      ),
    ).rejects.toThrow(/requires the platform admin role/);
    await expect(
      asRuntimeRole(
        { tenantId, propertyId },
        (tx) =>
          tx.$queryRaw`SELECT * FROM stuck_in_flight_bookings(ARRAY['PMS_CREATION_PENDING']::"BookingStatus"[], now())`,
      ),
    ).rejects.toThrow(/requires the platform admin role/);
  });

  it('runs the stuck-booking function for the platform role', async () => {
    const rows = await asRuntimeRole(
      { role: 'platform_admin' },
      (tx) =>
        tx.$queryRaw<
          unknown[]
        >`SELECT * FROM stuck_in_flight_bookings(ARRAY['PMS_CREATION_PENDING']::"BookingStatus"[], '1970-01-01'::timestamptz)`,
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(0);
  });
});
