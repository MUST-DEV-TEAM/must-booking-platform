import type { TenantTransaction } from '../tenancy/tenant-database.service';

/**
 * A property whose reservations live in Clock PMS. Clock exposes no capacity on a room
 * type (only on rates: max_adults/max_children, enforced by Clock when it prices a stay),
 * so the local `room_types.max_occupancy` is a placeholder there and must not block guests.
 */
export async function isClockManagedProperty(
  tx: TenantTransaction,
  tenantId: string,
  propertyId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ managed: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM property_integration_connections pic
      JOIN integration_connections ic ON ic.tenant_id=pic.tenant_id AND ic.id=pic.connection_id
      WHERE pic.tenant_id=${tenantId}::uuid AND pic.property_id=${propertyId}::uuid
        AND pic.enabled AND pic.kind='PMS' AND ic.provider='CLOCK_PMS'
    ) AS managed`;
  return rows[0]?.managed === true;
}
