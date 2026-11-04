import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { TenantTransaction } from './tenant-database.service';

export const RESTAURANT_ENTITLEMENT = { diningEnabled: true, maxVenues: null } as const;

export type VenuePlan = { diningEnabled: boolean; maxVenues: number | null; activeVenues: number };

/** Restaurants are currently available to every plan, without a plan-specific venue limit. */
export async function loadVenuePlan(tx: TenantTransaction, tenantId: string): Promise<VenuePlan> {
  const rows = await tx.$queryRaw<VenuePlan[]>`
    SELECT true AS "diningEnabled", NULL::integer AS "maxVenues",
           (SELECT COUNT(*)::integer FROM "venues" v WHERE v."tenant_id" = o."id" AND v."active") AS "activeVenues"
    FROM "organizations" o
    JOIN "plans" p ON p."id" = o."plan_id"
    WHERE o."id" = ${tenantId}::uuid
  `;
  if (!rows[0]) throw new NotFoundException('Tenant plan was not found.');
  return { ...rows[0], ...RESTAURANT_ENTITLEMENT };
}

export function requireDining(plan: VenuePlan): void {
  if (!plan.diningEnabled)
    throw new ForbiddenException({
      message: 'Dining is not enabled for this plan.',
      code: 'DINING_NOT_ENABLED',
    });
}
