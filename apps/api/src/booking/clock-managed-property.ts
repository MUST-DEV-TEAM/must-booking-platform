import type { TenantTransaction } from '../tenancy/tenant-database.service';

/**
 * A property whose reservations live in Clock PMS. Clock exposes no capacity on a room
 * type (only on rates: max_adults/max_children, enforced by Clock when it prices a stay),
 * so the local `room_types.max_occupancy` blocks guests there only once the hotel has
 * confirmed it (see `enforcedRoomCapacity`).
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

/**
 * The guest limit a room type enforces (task 40-4c): its capacity, except on a Clock hotel where the
 * capacity is enforced only once the hotel confirmed it. An unconfirmed Clock room type refuses no one,
 * so nothing changes for a hotel until it has checked its numbers; Clock's rate limits still apply.
 */
export function enforcedRoomCapacity(
  clockManaged: boolean,
  roomType: { maxOccupancy: number; capacityConfirmedAt?: Date | string | null },
): number | undefined {
  if (!clockManaged) return roomType.maxOccupancy;
  return roomType.capacityConfirmedAt ? roomType.maxOccupancy : undefined;
}
