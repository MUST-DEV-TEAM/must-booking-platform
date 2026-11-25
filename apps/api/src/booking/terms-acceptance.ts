import type { TenantTransaction } from '../tenancy/tenant-database.service';

type Scope = { tenantId: string; propertyId: string };

export type TermsAcceptance =
  | { ok: true; record: { termsVersionId: string | null; privacyVersionId: string | null } | null }
  | { ok: false; code: 'TERMS_NOT_ACCEPTED'; message: string };

/** The number of the hotel's current terms or privacy link, made on first use for links saved before versions existed. */
async function currentVersionId(
  tx: TenantTransaction,
  scope: Scope,
  kind: 'TERMS' | 'PRIVACY',
  url: string | null,
): Promise<string | null> {
  if (!url) return null;
  const latest = await tx.$queryRaw<Array<{ id: string; url: string }>>`
    SELECT id::text, url FROM property_legal_versions
    WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid AND kind = ${kind}
    ORDER BY version DESC LIMIT 1`;
  if (latest[0] && latest[0].url === url) return latest[0].id;
  const created = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO property_legal_versions (tenant_id, property_id, kind, version, url)
    VALUES (${scope.tenantId}::uuid, ${scope.propertyId}::uuid, ${kind},
      COALESCE((SELECT max(version) FROM property_legal_versions
        WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid AND kind = ${kind}), 0) + 1,
      ${url})
    RETURNING id::text`;
  return created[0]!.id;
}

/**
 * What a guest booking must record about the hotel's terms and privacy links (G-56). When the hotel requires
 * acceptance and has a link, a booking without it is refused; when the guest did accept, the exact versions are
 * returned to be stored on the booking. Nothing is required of a hotel that did not switch the requirement on,
 * so websites that never send the answer keep working.
 */
export async function checkTermsAcceptance(
  tx: TenantTransaction,
  scope: Scope,
  accepted: boolean,
): Promise<TermsAcceptance> {
  const rows = await tx.$queryRaw<
    Array<{ termsUrl: string | null; privacyUrl: string | null; required: boolean }>
  >`
    SELECT terms_url AS "termsUrl", privacy_url AS "privacyUrl", require_terms_acceptance AS required
    FROM properties WHERE tenant_id = ${scope.tenantId}::uuid AND id = ${scope.propertyId}::uuid`;
  const row = rows[0];
  const hasLinks = Boolean(row?.termsUrl || row?.privacyUrl);
  if (!row || !hasLinks) return { ok: true, record: null };
  if (!accepted) {
    if (row.required)
      return {
        ok: false,
        code: 'TERMS_NOT_ACCEPTED',
        message: 'Please accept the hotel’s terms and privacy policy to book.',
      };
    return { ok: true, record: null };
  }
  return {
    ok: true,
    record: {
      termsVersionId: await currentVersionId(tx, scope, 'TERMS', row.termsUrl),
      privacyVersionId: await currentVersionId(tx, scope, 'PRIVACY', row.privacyUrl),
    },
  };
}

/** Stores the accepted versions on the booking rows just created. */
export async function recordTermsAcceptance(
  tx: TenantTransaction,
  scope: Scope,
  bookingIds: readonly string[],
  record: { termsVersionId: string | null; privacyVersionId: string | null } | null,
): Promise<void> {
  if (!record || bookingIds.length === 0) return;
  await tx.$executeRaw`
    UPDATE bookings SET terms_accepted_at = now(), terms_version_id = ${record.termsVersionId}::uuid,
      privacy_version_id = ${record.privacyVersionId}::uuid
    WHERE tenant_id = ${scope.tenantId}::uuid AND property_id = ${scope.propertyId}::uuid
      AND id = ANY(${[...bookingIds]}::uuid[])`;
}
