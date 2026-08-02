import { Inject, Injectable } from '@nestjs/common';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';

const builtInCapabilities = [
  ['staff.invite', 'Invite property staff'],
  ['staff.manage_permissions', 'Manage property-staff permissions'],
  ['settings.manage', 'Manage property settings'],
  ['reports.view', 'View property reports'],
  ['guests.manage', 'Manage guests'],
  ['bookings.manage', 'Manage bookings'],
  ['payments.refund', 'Refund payments'],
] as const;

@Injectable()
export class PropertyRoleTemplatesService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async listTemplates(tenantId: string, propertyId: string) {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          name: string;
          kind: 'BUILT_IN' | 'CUSTOM';
          capabilityKey: string | null;
          capabilityDescription: string | null;
        }>
      >`
        SELECT prt."id", prt."name", prt."kind"::text AS "kind",
          c."key" AS "capabilityKey", c."description" AS "capabilityDescription"
        FROM "property_role_templates" prt
        LEFT JOIN "property_role_template_capabilities" rtc
          ON rtc."tenant_id" = prt."tenant_id"
          AND rtc."property_id" = prt."property_id"
          AND rtc."role_template_id" = prt."id"
        LEFT JOIN "capabilities" c
          ON c."tenant_id" = rtc."tenant_id" AND c."id" = rtc."capability_id"
        WHERE prt."tenant_id" = ${tenantId}::uuid AND prt."property_id" = ${propertyId}::uuid
        ORDER BY prt."kind", prt."name", c."key"
      `;
      const templates = new Map<
        string,
        {
          id: string;
          name: string;
          kind: 'BUILT_IN' | 'CUSTOM';
          capabilities: Array<{ key: string; description: string | null }>;
        }
      >();
      for (const row of rows) {
        let template = templates.get(row.id);
        if (!template) {
          template = { id: row.id, name: row.name, kind: row.kind, capabilities: [] };
          templates.set(row.id, template);
        }
        if (row.capabilityKey)
          template.capabilities.push({
            key: row.capabilityKey,
            description: row.capabilityDescription,
          });
      }
      return [...templates.values()];
    });
  }

  async missingCapabilityKeys(
    tenantId: string,
    propertyId: string,
    capabilityKeys: string[],
  ): Promise<string[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const existing = new Set<string>();
      for (const key of capabilityKeys) {
        const rows = await tx.$queryRaw<Array<{ key: string }>>`
          SELECT "key" FROM "capabilities"
          WHERE "tenant_id" = ${tenantId}::uuid AND "key" = ${key}
        `;
        if (rows[0]) existing.add(rows[0].key);
      }
      return capabilityKeys.filter((key) => !existing.has(key));
    });
  }

  async ensureBuiltInTemplates(tenantId: string, propertyId: string): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      this.ensureBuiltInTemplatesInTransaction(tx, tenantId, propertyId),
    );
  }

  async ensureBuiltInTemplatesInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    propertyId: string,
  ): Promise<void> {
    for (const [key, description] of builtInCapabilities) {
      await tx.$executeRaw`
          INSERT INTO "capabilities" ("tenant_id", "key", "description") VALUES (${tenantId}::uuid, ${key}, ${description})
          ON CONFLICT ("tenant_id", "key") DO NOTHING
        `;
    }
    for (const name of ['Property Manager', 'Front Desk']) {
      await tx.$executeRaw`
          INSERT INTO "property_role_templates" ("tenant_id", "property_id", "name", "kind") VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${name}, 'BUILT_IN')
          ON CONFLICT ("tenant_id", "property_id", "name") DO NOTHING
        `;
    }
    const templates = await tx.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT "id", "name" FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "kind" = 'BUILT_IN'
      `;
    const capabilities = await tx.$queryRaw<Array<{ id: string; key: string }>>`
        SELECT "id", "key" FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid
      `;
    for (const template of templates) {
      const allowed =
        template.name === 'Property Manager'
          ? capabilities
          : capabilities.filter((capability) => capability.key === 'guests.manage');
      for (const capability of allowed) {
        await tx.$executeRaw`
            INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id") VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${template.id}::uuid, ${capability.id}::uuid)
            ON CONFLICT ("tenant_id", "property_id", "role_template_id", "capability_id") DO NOTHING
          `;
      }
    }
  }

  async createCustomTemplate(
    tenantId: string,
    propertyId: string,
    name: string,
    capabilityKeys: string[],
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "property_role_templates" ("tenant_id", "property_id", "name", "kind") VALUES (${tenantId}::uuid, ${propertyId}::uuid, ${name}, 'CUSTOM')
      `;
      const template = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "property_role_templates" WHERE "tenant_id" = ${tenantId}::uuid AND "property_id" = ${propertyId}::uuid AND "name" = ${name}
      `;
      for (const key of capabilityKeys) {
        await tx.$executeRaw`
          INSERT INTO "property_role_template_capabilities" ("tenant_id", "property_id", "role_template_id", "capability_id")
          SELECT ${tenantId}::uuid, ${propertyId}::uuid, ${template[0].id}::uuid, "id" FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid AND "key" = ${key}
        `;
      }
    });
  }

  async setCapabilityOverride(
    tenantId: string,
    propertyId: string,
    userId: string,
    capabilityKey: string,
    granted: boolean,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
        SELECT ${tenantId}::uuid, ${propertyId}::uuid, ${userId}::uuid, "id", ${granted}
        FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid AND "key" = ${capabilityKey}
        ON CONFLICT ("tenant_id", "property_id", "user_id", "capability_id") DO UPDATE SET "granted" = EXCLUDED."granted", "updated_at" = CURRENT_TIMESTAMP
      `;
    });
  }
}
