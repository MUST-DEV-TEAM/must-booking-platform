import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { TenantDatabaseService } from './tenant-database.service';

export interface PlanUsage {
  plan: {
    name: string;
    maxProperties: number;
    maxStaffSeats: number;
    pmsEnabled: boolean;
    maxPmsConnectionsPerProperty: number;
  };
  usage: { properties: number; staffSeats: number };
}

@Injectable()
export class PlanUsageService {
  constructor(@Inject(TenantDatabaseService) private readonly database: TenantDatabaseService) {}

  async get(tenantId: string): Promise<PlanUsage> {
    const rows = await this.database.withTenantTransaction(
      { tenantId },
      (tx) =>
        tx.$queryRaw<
          Array<{
            name: string;
            maxProperties: number;
            maxStaffSeats: number;
            pmsEnabled: boolean;
            maxPmsConnectionsPerProperty: number;
            properties: number;
            staffSeats: number;
          }>
        >`
          SELECT
            p."name",
            p."max_properties" AS "maxProperties",
            p."max_staff_seats" AS "maxStaffSeats",
            p."pms_enabled" AS "pmsEnabled",
            p."max_pms_connections_per_property" AS "maxPmsConnectionsPerProperty",
            (SELECT COUNT(*)::integer FROM "properties" WHERE "tenant_id" = o."id") AS "properties",
            (SELECT COUNT(*)::integer FROM "tenant_memberships" WHERE "tenant_id" = o."id") AS "staffSeats"
          FROM "organizations" o
          JOIN "plans" p ON p."id" = o."plan_id"
          WHERE o."id" = ${tenantId}::uuid
        `,
    );
    if (!rows[0]) throw new NotFoundException('Tenant plan was not found.');

    const { properties, staffSeats, ...plan } = rows[0];
    return { plan, usage: { properties, staffSeats } };
  }
}
