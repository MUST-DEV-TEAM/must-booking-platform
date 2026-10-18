import { Prisma } from '@prisma/client';
import type { TenantTransaction } from './tenant-database.service';
import type { BookingRestriction } from '../booking/booking-rules';

export type RestrictionRecord = BookingRestriction & {
  reference: string;
  internalReason: string;
  version: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};
export const restrictionColumns = Prisma.sql`r.id, r.reference, r.name, r.type, r.value, r.scope, r.target_ids AS "targetIds", r.starts_on::text AS "startsOn", r.ends_on::text AS "endsOn", r.weekdays, r.priority, r.lifecycle, r.internal_reason AS "internalReason", r.version, r.created_by_user_id AS "createdByUserId", r.updated_by_user_id AS "updatedByUserId", r.created_at AS "createdAt", r.updated_at AS "updatedAt"`;

export function restrictionRows(tx: TenantTransaction, tenantId: string, propertyId: string) {
  return tx.$queryRaw<RestrictionRecord[]>(
    Prisma.sql`SELECT ${restrictionColumns} FROM inventory_restrictions r WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid ORDER BY r.created_at DESC, r.id`,
  );
}
/** Scoped facts only. An enabled external PMS assignment suppresses local restrictions even when unhealthy. */
export function applicableRestrictions(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
  roomTypeId: string,
) {
  return tx.$queryRaw<Array<RestrictionRecord & { timezone: string | null }>>(Prisma.sql`
    SELECT ${restrictionColumns}, p.timezone
    FROM inventory_restrictions r
    JOIN properties p ON p.tenant_id = ${tenantId}::uuid AND p.id = ${propertyId}::uuid
    JOIN room_types rt ON rt.tenant_id = ${tenantId}::uuid AND rt.property_id = ${propertyId}::uuid AND rt.id = ${roomTypeId}::uuid
    WHERE r.tenant_id = ${tenantId}::uuid AND r.property_id = ${propertyId}::uuid AND r.lifecycle IN ('Active','Scheduled')
      AND (r.scope = 'property' OR (r.scope = 'room_type' AND rt.id = ANY(r.target_ids)) OR (r.scope = 'category' AND rt.category_id = ANY(r.target_ids)))
      AND NOT EXISTS (SELECT 1 FROM property_integration_connections pc JOIN integration_connections c ON c.tenant_id = pc.tenant_id AND c.id = pc.connection_id
        WHERE pc.tenant_id = ${tenantId}::uuid AND pc.property_id = ${propertyId}::uuid AND pc.enabled AND pc.kind = 'PMS' AND c.provider = 'CLOCK_PMS')
  `);
}
