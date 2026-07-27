import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';

const migrationDatabaseUrl =
  'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public';
const runtimeDatabaseUrl =
  'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public';
const migrationPrisma = new PrismaClient({
  datasources: { db: { url: migrationDatabaseUrl } },
});
const runtimePrisma = new PrismaClient({
  datasources: { db: { url: runtimeDatabaseUrl } },
});
const tenantDatabase = new TenantDatabaseService({
  datasources: { db: { url: runtimeDatabaseUrl } },
});
const tenantTables = [
  'organizations',
  'users',
  'properties',
  'tenant_memberships',
  'capabilities',
  'property_role_templates',
  'property_role_template_capabilities',
  'property_staff_assignments',
  'property_staff_capability_overrides',
  'audit_logs',
] as const;

async function asRuntimeRole<T>(
  context: { tenantId?: string; propertyId?: string },
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return runtimePrisma.$transaction(async (transaction) => {
    if (context.tenantId) {
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${context.tenantId}, true),
               set_config('app.property_id', ${context.propertyId ?? ''}, true)
      `;
    }

    return operation(transaction);
  });
}

describe('tenant row-level security', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const propertyA = randomUUID();
  const propertyA2 = randomUUID();
  const propertyB = randomUUID();
  const blockedPropertyId = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const capabilityA = randomUUID();
  const capabilityB = randomUUID();
  const roleTemplateA = randomUUID();
  const roleTemplateB = randomUUID();
  const signupUserId = randomUUID();

  beforeAll(async () => {
    await migrationPrisma.$executeRaw`
      INSERT INTO "organizations" ("id", "name")
      VALUES (${tenantA}::uuid, 'RLS tenant A'), (${tenantB}::uuid, 'RLS tenant B')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "users" ("id", "email")
      VALUES
        (${userA}::uuid, 'rls-tenant-a@example.test'),
        (${userB}::uuid, 'rls-tenant-b@example.test')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
      VALUES
        (${propertyA}::uuid, ${tenantA}::uuid, 'Tenant A property', 'tenant-a-rls'),
        (${propertyA2}::uuid, ${tenantA}::uuid, 'Tenant A second property', 'tenant-a-rls-2'),
        (${propertyB}::uuid, ${tenantB}::uuid, 'Tenant B property', 'tenant-b-rls')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role")
      VALUES
        (${tenantA}::uuid, ${userA}::uuid, 'OWNER'),
        (${tenantB}::uuid, ${userB}::uuid, 'OWNER')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "capabilities" ("id", "tenant_id", "key")
      VALUES
        (${capabilityA}::uuid, ${tenantA}::uuid, 'rls.a'),
        (${capabilityB}::uuid, ${tenantB}::uuid, 'rls.b')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_role_templates" ("id", "tenant_id", "property_id", "name", "kind")
      VALUES
        (${roleTemplateA}::uuid, ${tenantA}::uuid, ${propertyA}::uuid, 'RLS A', 'CUSTOM'),
        (${roleTemplateB}::uuid, ${tenantB}::uuid, ${propertyB}::uuid, 'RLS B', 'CUSTOM')
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
      VALUES
        (${tenantA}::uuid, ${propertyA}::uuid, ${roleTemplateA}::uuid, ${capabilityA}::uuid),
        (${tenantB}::uuid, ${propertyB}::uuid, ${roleTemplateB}::uuid, ${capabilityB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id")
      VALUES
        (${tenantA}::uuid, ${propertyA}::uuid, ${userA}::uuid, ${roleTemplateA}::uuid),
        (${tenantB}::uuid, ${propertyB}::uuid, ${userB}::uuid, ${roleTemplateB}::uuid)
    `;
  });

  afterAll(async () => {
    await migrationPrisma.$executeRaw`
      DELETE FROM "users" WHERE "id" = ${signupUserId}::uuid
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "property_staff_assignments" WHERE "property_id" IN (${propertyA}::uuid, ${propertyB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "property_role_template_capabilities" WHERE "property_id" IN (${propertyA}::uuid, ${propertyB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "property_role_templates" WHERE "id" IN (${roleTemplateA}::uuid, ${roleTemplateB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "capabilities" WHERE "id" IN (${capabilityA}::uuid, ${capabilityB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "tenant_memberships" WHERE "user_id" IN (${userA}::uuid, ${userB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "properties" WHERE "id" IN (${propertyA}::uuid, ${propertyB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "properties" WHERE "id" IN (${propertyA2}::uuid, ${blockedPropertyId}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "users" WHERE "id" IN (${userA}::uuid, ${userB}::uuid)
    `;
    await migrationPrisma.$executeRaw`
      DELETE FROM "organizations" WHERE "id" IN (${tenantA}::uuid, ${tenantB}::uuid)
    `;
    await migrationPrisma.$disconnect();
    await runtimePrisma.$disconnect();
    await tenantDatabase.$disconnect();
  });

  it('denies reads without context for every tenant table through the runtime role', async () => {
    const counts = await asRuntimeRole({}, async (transaction) =>
      Promise.all(
        tenantTables.map(async (table) => {
          const rows = await transaction.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT count(*)::bigint AS count FROM "${table}"`,
          );

          return [table, Number(rows[0].count)] as const;
        }),
      ),
    );

    expect(Object.fromEntries(counts)).toEqual(
      Object.fromEntries(tenantTables.map((table) => [table, 0])),
    );
  });

  it('isolates reads to the current tenant', async () => {
    const tenantAProperties = await asRuntimeRole(
      { tenantId: tenantA },
      (transaction) =>
        transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "properties" WHERE "id" IN (${propertyA}::uuid, ${propertyB}::uuid)
      `,
    );
    expect(tenantAProperties).toEqual([{ id: propertyA }]);
  });

  it('blocks cross-tenant and cross-property reads and writes through the runtime role', async () => {
    const tenantAPropertyOnly = await asRuntimeRole(
      { tenantId: tenantA, propertyId: propertyA },
      (transaction) =>
        transaction.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "properties" WHERE "id" IN (${propertyA}::uuid, ${propertyA2}::uuid, ${propertyB}::uuid)
        `,
    );
    expect(tenantAPropertyOnly).toEqual([{ id: propertyA }]);

    const crossTenantUpdate = await asRuntimeRole(
      { tenantId: tenantA, propertyId: propertyA },
      (transaction) =>
        transaction.$executeRaw`
          UPDATE "properties" SET "name" = 'Cross-tenant write' WHERE "id" = ${propertyB}::uuid
        `,
    );
    const crossPropertyUpdate = await asRuntimeRole(
      { tenantId: tenantA, propertyId: propertyA },
      (transaction) =>
        transaction.$executeRaw`
          UPDATE "properties" SET "name" = 'Cross-property write' WHERE "id" = ${propertyA2}::uuid
        `,
    );
    expect(crossTenantUpdate).toBe(0);
    expect(crossPropertyUpdate).toBe(0);

    await expect(
      asRuntimeRole(
        { tenantId: tenantA, propertyId: propertyA },
        (transaction) =>
          transaction.$executeRaw`
          INSERT INTO "properties" ("id", "tenant_id", "name", "slug")
          VALUES (${blockedPropertyId}::uuid, ${tenantB}::uuid, 'Blocked property', 'blocked-${blockedPropertyId}')
        `,
      ),
    ).rejects.toThrow();

    const names = await migrationPrisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT "id", "name" FROM "properties" WHERE "id" IN (${propertyA2}::uuid, ${propertyB}::uuid) ORDER BY "id"
    `;
    expect(names).toEqual(
      expect.arrayContaining([
        { id: propertyA2, name: 'Tenant A second property' },
        { id: propertyB, name: 'Tenant B property' },
      ]),
    );
  });

  it('allows the runtime role to create a user for signup', async () => {
    const insertedRows = await runtimePrisma.$executeRaw`
      INSERT INTO "users" ("id", "email")
      VALUES (${signupUserId}::uuid, 'rls-signup@example.test')
    `;

    expect(insertedRows).toBe(1);
  });

  it('sets tenant and property context transaction-locally through the database wrapper', async () => {
    const context = await tenantDatabase.withTenantTransaction(
      { tenantId: tenantA, propertyId: propertyA },
      (transaction) =>
        transaction.$queryRaw<Array<{ tenantId: string; propertyId: string }>>`
          SELECT
            current_setting('app.tenant_id') AS "tenantId",
            current_setting('app.property_id') AS "propertyId"
        `,
    );

    expect(context).toEqual([{ tenantId: tenantA, propertyId: propertyA }]);
  });
});
