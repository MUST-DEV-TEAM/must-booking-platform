import { countryCode, type CreateBookingCommand } from '@must/domain-contracts';

import type { TenantTransaction } from '../tenancy/tenant-database.service';

export type GuestInsertInput = {
  email: string;
  phone: string | null;
  suspectedDuplicateOfGuestId: string | null;
};

export type GuestMatchingOptions = {
  insertGuest: (input: GuestInsertInput) => Promise<string | null>;
  onEmailMatch?: (guestId: string) => Promise<void>;
};

/**
 * Apply ADR-0030 point 1 to MUST's local guest table. Email remains the
 * attachment key; an exact phone match to another guest is advisory only.
 * Provider-specific guest-field updates/inserts stay in the caller.
 */
export async function resolveGuestWithPhoneSignal(
  tx: TenantTransaction,
  tenantId: string,
  guest: CreateBookingCommand['guest'],
  options: GuestMatchingOptions,
): Promise<string | null> {
  const country = countryCode(guest.countryCode);
  const captureCountry = async (id: string) => {
    if (country !== undefined)
      await tx.$executeRaw`UPDATE guests SET country_code=${country},capture_version=capture_version+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid`;
    return id;
  };
  const email = guest.email.trim().toLowerCase();
  const existingByEmail = await tx.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE guest_chain AS (
      SELECT id, merged_into_guest_id
      FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
      UNION ALL
      SELECT merged.id, merged.merged_into_guest_id
      FROM guests merged
      JOIN guest_chain chain
        ON merged.tenant_id = ${tenantId}::uuid AND merged.id = chain.merged_into_guest_id
    )
    SELECT id FROM guest_chain WHERE merged_into_guest_id IS NULL LIMIT 1
  `;
  const phone = guest.phone?.trim() || null;
  const existingByPhone = phone
    ? await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM guests
        WHERE tenant_id = ${tenantId}::uuid
          AND merged_into_guest_id IS NULL
          AND phone IS NOT NULL
          AND btrim(phone) = ${phone}
        ORDER BY (id = ${existingByEmail[0]?.id ?? null}::uuid) DESC, id
        LIMIT 1
      `
    : [];
  const phoneCandidateId = existingByPhone[0]?.id ?? null;

  const flagSuspectedDuplicate = async (guestId: string): Promise<void> => {
    if (!phoneCandidateId || phoneCandidateId === guestId) return;
    await tx.$executeRaw`
      UPDATE guests
      SET suspected_duplicate_of_guest_id = ${phoneCandidateId}::uuid,
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid AND id = ${guestId}::uuid
    `;
  };

  if (existingByEmail[0]) {
    await flagSuspectedDuplicate(existingByEmail[0].id);
    await options.onEmailMatch?.(existingByEmail[0].id);
    return captureCountry(existingByEmail[0].id);
  }

  const inserted = await options.insertGuest({
    email,
    phone,
    suspectedDuplicateOfGuestId: phoneCandidateId,
  });
  if (inserted) return captureCountry(inserted);

  const matched = await tx.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE guest_chain AS (
      SELECT id, merged_into_guest_id
      FROM guests
      WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
      UNION ALL
      SELECT merged.id, merged.merged_into_guest_id
      FROM guests merged
      JOIN guest_chain chain
        ON merged.tenant_id = ${tenantId}::uuid AND merged.id = chain.merged_into_guest_id
    )
    SELECT id FROM guest_chain WHERE merged_into_guest_id IS NULL LIMIT 1
  `;
  if (!matched[0]) return null;
  await flagSuspectedDuplicate(matched[0].id);
  return captureCountry(matched[0].id);
}
