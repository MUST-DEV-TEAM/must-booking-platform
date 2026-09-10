import type { CreateBookingCommand } from '@must/domain-contracts';

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
  const email = guest.email.trim().toLowerCase();
  const existingByEmail = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM guests WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
  `;
  const phone = guest.phone?.trim() || null;
  const existingByPhone = phone
    ? await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM guests
        WHERE tenant_id = ${tenantId}::uuid
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
    return existingByEmail[0].id;
  }

  const inserted = await options.insertGuest({
    email,
    phone,
    suspectedDuplicateOfGuestId: phoneCandidateId,
  });
  if (inserted) return inserted;

  const matched = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM guests WHERE tenant_id = ${tenantId}::uuid AND lower(email) = ${email}
  `;
  if (!matched[0]) return null;
  await flagSuspectedDuplicate(matched[0].id);
  return matched[0].id;
}
