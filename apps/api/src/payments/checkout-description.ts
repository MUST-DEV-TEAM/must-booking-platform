import type { TenantTransaction } from '../tenancy/tenant-database.service';

export interface CheckoutDescriptionParts {
  hotelName: string;
  reference: string | null;
  startsOn: string;
  endsOn: string;
}

/** What the guest sees on the payment page: the hotel, the booking reference and the stay dates. */
export function formatCheckoutDescription(parts: CheckoutDescriptionParts): string {
  const stay = `${parts.startsOn} to ${parts.endsOn}`;
  return [parts.hotelName, parts.reference ? `Booking ${parts.reference}` : null, stay]
    .filter(Boolean)
    .join(' - ');
}

/**
 * Reads the parts from the booking inside the caller's transaction. No matching booking returns
 * undefined, so the payment page keeps the provider's plain default text.
 */
export async function loadCheckoutDescription(
  tx: TenantTransaction,
  scope: { tenantId: string; propertyId: string },
  bookingId: string,
): Promise<string | undefined> {
  const rows = await tx.$queryRaw<
    Array<{ hotelName: string; reference: string | null; startsOn: string; endsOn: string }>
  >`SELECT p.name AS "hotelName", b.external_reference AS reference,
           b.starts_on::text AS "startsOn", b.ends_on::text AS "endsOn"
    FROM bookings b JOIN properties p ON p.tenant_id = b.tenant_id AND p.id = b.property_id
    WHERE b.tenant_id = ${scope.tenantId}::uuid AND b.property_id = ${scope.propertyId}::uuid
      AND b.id = ${bookingId}::uuid`;
  return rows[0] ? formatCheckoutDescription(rows[0]) : undefined;
}
