import { Inject, Injectable } from '@nestjs/common';
import { TenantDatabaseService } from './tenant-database.service';

@Injectable()
export class CapabilitiesService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}
  async effective(context: { tenantId: string; propertyId?: string; userId: string }) {
    return this.database.withTenantTransaction(context, async (tx) => {
      const member = await tx.$queryRaw<
        Array<{ role: 'OWNER' | 'ADMIN' | 'STAFF' }>
      >`SELECT "role" FROM "tenant_memberships" WHERE "tenant_id"=${context.tenantId}::uuid AND "user_id"=${context.userId}::uuid`;
      if (member[0]?.role === 'OWNER' || member[0]?.role === 'ADMIN') {
        const all = await tx.$queryRaw<
          Array<{ key: string }>
        >`SELECT "key" FROM "capabilities" WHERE "tenant_id"=${context.tenantId}::uuid`;
        return all.map((x) => x.key);
      }
      if (!context.propertyId) return [];
      const rows = await tx.$queryRaw<Array<{ key: string }>>`
        SELECT c."key" FROM "capabilities" c
        JOIN "property_staff_assignments" psa ON psa."tenant_id"=c."tenant_id" AND psa."property_id"=${context.propertyId}::uuid AND psa."user_id"=${context.userId}::uuid
        LEFT JOIN "property_role_template_capabilities" rtc ON rtc."tenant_id"=psa."tenant_id" AND rtc."property_id"=psa."property_id" AND rtc."role_template_id"=psa."role_template_id" AND rtc."capability_id"=c."id"
        LEFT JOIN "property_staff_capability_overrides" o ON o."tenant_id"=c."tenant_id" AND o."property_id"=psa."property_id" AND o."user_id"=psa."user_id" AND o."capability_id"=c."id"
        WHERE c."tenant_id"=${context.tenantId}::uuid AND COALESCE(o."granted", rtc."capability_id" IS NOT NULL)
      `;
      return rows.map((x) => x.key);
    });
  }
}
