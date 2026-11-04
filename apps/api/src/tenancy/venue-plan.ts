import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { TenantTransaction } from './tenant-database.service';

export type VenuePlan = { diningEnabled: boolean; maxVenues: number; activeVenues: number };

/** The dining switch and venue limit of the plan a workspace is on, with its active venue count. */
export async function loadVenuePlan(tx: TenantTransaction, tenantId: string): Promise<VenuePlan> {
  const rows = await tx.$queryRaw<VenuePlan[]>`
    SELECT p."dining_enabled" AS "diningEnabled", p."max_venues" AS "maxVenues",
           (SELECT COUNT(*)::integer FROM "venues" v WHERE v."tenant_id" = o."id" AND v."active") AS "activeVenues"
    FROM "organizations" o
    JOIN "plans" p ON p."id" = o."plan_id"
    WHERE o."id" = ${tenantId}::uuid
  `;
  if (!rows[0]) throw new NotFoundException('Tenant plan was not found.');
  return rows[0];
}

export function requireDining(plan: VenuePlan): void {
  if (!plan.diningEnabled)
    throw new ForbiddenException({
      message: 'Dining is not enabled for this plan.',
      code: 'DINING_NOT_ENABLED',
    });
}
