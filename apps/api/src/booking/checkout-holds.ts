import type { TenantDatabaseService } from '../tenancy/tenant-database.service';

export type CheckoutHolds = Map<string, Map<string, number>>;

/** Unpaid local holds have no Clock reservation yet. Linked/confirmed bookings must not be deducted twice.
 * Keep a pending hold until the expiry worker verifies payment and releases it, even after its deadline.
 */
export async function pendingCheckoutHolds(
  database: TenantDatabaseService,
  tenantId: string,
  propertyId: string,
  roomTypeIds: string[],
  startsOn: string,
  endsOn: string,
  roomId?: string,
): Promise<CheckoutHolds> {
  const result: CheckoutHolds = new Map();
  if (!roomTypeIds.length) return result;
  const rows = await database.withTenantTransaction(
    { tenantId, propertyId },
    (tx) =>
      tx.$queryRaw<Array<{ roomTypeId: string; date: string; held: number }>>`
      SELECT b.room_type_id AS "roomTypeId", n.day::date::text AS date, count(*)::int AS held
      FROM bookings b
      CROSS JOIN LATERAL generate_series(
        greatest(b.starts_on,${startsOn}::date),
        least(b.ends_on,${endsOn}::date)-1,interval '1 day'
      ) n(day)
      WHERE b.tenant_id=${tenantId}::uuid AND b.property_id=${propertyId}::uuid
        AND b.room_type_id=ANY(${roomTypeIds}::uuid[]) AND b.status='PAYMENT_PENDING'
        AND b.external_booking_id IS NULL AND b.starts_on<${endsOn}::date AND b.ends_on>${startsOn}::date
        AND (${roomId ?? null}::uuid IS NULL OR b.room_id=${roomId ?? null}::uuid)
      GROUP BY b.room_type_id,n.day`,
  );
  for (const row of rows) {
    if (!row.roomTypeId || !row.date || !(row.held > 0)) continue;
    const days = result.get(row.roomTypeId) ?? new Map<string, number>();
    days.set(row.date, row.held);
    result.set(row.roomTypeId, days);
  }
  return result;
}

export async function pendingCheckoutRooms(
  database: TenantDatabaseService,
  tenantId: string,
  propertyId: string,
  startsOn: string,
  endsOn: string,
): Promise<Set<string>> {
  const rows = await database.withTenantTransaction(
    { tenantId, propertyId },
    (tx) =>
      tx.$queryRaw<Array<{ roomId: string }>>`SELECT DISTINCT room_id AS "roomId" FROM bookings
      WHERE tenant_id=${tenantId}::uuid AND property_id=${propertyId}::uuid
        AND status='PAYMENT_PENDING' AND external_booking_id IS NULL AND room_id IS NOT NULL
        AND starts_on<${endsOn}::date AND ends_on>${startsOn}::date`,
  );
  return new Set(rows.map((row) => row.roomId));
}
