import { BadRequestException } from '@nestjs/common';

import type { TenantTransaction } from '../tenancy/tenant-database.service';

/** The address a guest comes back to after paying: the hotel's own website only, never any other origin. */
export async function validatedGuestReturnUrl(
  tx: TenantTransaction,
  context: { tenantId: string; propertyId: string },
  returnUrl?: string,
): Promise<string | null> {
  if (!returnUrl) return null;
  let candidate: URL;
  try {
    candidate = new URL(returnUrl);
  } catch {
    throw new BadRequestException('returnUrl must be a valid URL.');
  }
  if (
    !['http:', 'https:'].includes(candidate.protocol) ||
    candidate.username ||
    candidate.password ||
    candidate.hash
  )
    throw new BadRequestException(
      'returnUrl must be an http(s) URL without credentials or a fragment.',
    );
  const properties = await tx.$queryRaw<Array<{ publicWebsiteOrigin: string | null }>>`
    SELECT public_website_origin AS "publicWebsiteOrigin"
    FROM properties
    WHERE id = ${context.propertyId}::uuid AND tenant_id = ${context.tenantId}::uuid
  `;
  if (!properties[0]?.publicWebsiteOrigin || candidate.origin !== properties[0].publicWebsiteOrigin)
    throw new BadRequestException('returnUrl must use the property public website origin.');
  return candidate.toString();
}

/** Where the payment page sends the guest afterwards: the hotel's website when it gave one, else MUST's own page. */
export function checkoutReturnUrl(
  bookingId: string,
  outcome: 'success' | 'cancel',
  returnUrl: string | null | undefined,
  scope: { tenantId: string; propertyId: string },
): string {
  if (!returnUrl) {
    const result = new URL(`/bookings/${bookingId}/payment/${outcome}`, process.env.WEB_APP_URL!);
    result.searchParams.set('tenantId', scope.tenantId);
    result.searchParams.set('propertyId', scope.propertyId);
    return result.toString();
  }
  const candidate = new URL(returnUrl);
  candidate.searchParams.set('booking_id', bookingId);
  candidate.searchParams.set('outcome', outcome);
  return candidate.toString();
}
