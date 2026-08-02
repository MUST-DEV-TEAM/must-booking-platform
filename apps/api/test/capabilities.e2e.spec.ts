import { randomUUID } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';

import { CapabilitiesGuard } from '../src/tenancy/capabilities.guard';
import { PropertyRoleTemplatesService } from '../src/tenancy/property-role-templates.service';
import { TenantDatabaseService } from '../src/tenancy/tenant-database.service';

const migrationPrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://must_booking:must_booking_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const database = new TenantDatabaseService({
  datasources: {
    db: {
      url: 'postgresql://must_booking_app:must_booking_app_dev@localhost:5432/must_booking?schema=public',
    },
  },
});
const templates = new PropertyRoleTemplatesService(database);
const guard = new CapabilitiesGuard(
  { getAllAndOverride: () => 'settings.manage' } as never,
  database,
);

describe('property staff capabilities', () => {
  const tenantId = randomUUID();
  const propertyId = randomUUID();
  const userId = randomUUID();
  const context = { userId, tenantId, propertyId };
  const executionContext = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ tenantContext: context }) }),
  } as never;

  afterAll(async () => {
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_capability_overrides" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_staff_assignments" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_template_capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "tenant_memberships" WHERE "tenant_id" = ${tenantId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "properties" WHERE "id" = ${propertyId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${userId}::uuid`;
    await migrationPrisma.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${tenantId}::uuid`;
    await database.$disconnect();
    await migrationPrisma.$disconnect();
  });

  it('seeds templates and lets an override grant a Front Desk staff capability', async () => {
    await migrationPrisma.$executeRaw`INSERT INTO "organizations" ("id", "name") VALUES (${tenantId}::uuid, 'Capabilities')`;
    await migrationPrisma.$executeRaw`INSERT INTO "properties" ("id", "tenant_id", "name", "slug") VALUES (${propertyId}::uuid, ${tenantId}::uuid, 'Property', 'capabilities')`;
    await migrationPrisma.$executeRaw`INSERT INTO "users" ("id", "email") VALUES (${userId}::uuid, ${`staff-${userId}@example.test`})`;
    await migrationPrisma.$executeRaw`INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role") VALUES (${tenantId}::uuid, ${userId}::uuid, 'STAFF')`;
    await templates.ensureBuiltInTemplates(tenantId, propertyId);
    const seededCapabilities = await migrationPrisma.$queryRaw<
      Array<{ name: string; capabilities: string[] }>
    >`
      SELECT prt."name", array_agg(c."key" ORDER BY c."key") AS "capabilities"
      FROM "property_role_templates" prt
      JOIN "property_role_template_capabilities" rtc
        ON rtc."tenant_id" = prt."tenant_id"
        AND rtc."property_id" = prt."property_id"
        AND rtc."role_template_id" = prt."id"
      JOIN "capabilities" c ON c."tenant_id" = rtc."tenant_id" AND c."id" = rtc."capability_id"
      WHERE prt."tenant_id" = ${tenantId}::uuid AND prt."property_id" = ${propertyId}::uuid
      GROUP BY prt."name"
      ORDER BY prt."name"
    `;
    expect(seededCapabilities).toEqual([
      { name: 'Front Desk', capabilities: ['guests.manage'] },
      {
        name: 'Property Manager',
        capabilities: [
          'bookings.manage',
          'guests.manage',
          'payments.refund',
          'reports.view',
          'settings.manage',
          'staff.invite',
          'staff.manage_permissions',
        ],
      },
    ]);
    const template = await migrationPrisma.$queryRaw<
      Array<{ id: string }>
    >`SELECT "id" FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "name" = 'Front Desk'`;
    expect(template).toHaveLength(1);
    await migrationPrisma.$executeRaw`INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id") VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${userId}::uuid, ${template[0].id}::uuid)`;
    await expect(guard.canActivate(executionContext)).rejects.toBeInstanceOf(ForbiddenException);
    await templates.setCapabilityOverride(tenantId, propertyId, userId, 'settings.manage', true);
    await expect(guard.canActivate(executionContext)).resolves.toBe(true);
  });
});
