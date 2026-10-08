import type { TenantTransaction } from '../tenancy/tenant-database.service';

export type StaffRecipient = { staffUserId: string; email: string };

/**
 * Who receives staff booking emails for a property: its assigned staff, or the
 * organization's owners and admins when nobody is assigned. Without the fallback a
 * property with no staff assignments (the default since signup stopped creating
 * placeholder staff accounts) gets no staff booking or cancellation emails at all.
 */
export function staffRecipients(
  tx: TenantTransaction,
  context: { tenantId: string; propertyId: string },
): Promise<StaffRecipient[]> {
  return tx.$queryRaw<StaffRecipient[]>`
    WITH assigned AS (
      SELECT psa.user_id AS "staffUserId", u.email
      FROM property_staff_assignments psa
      JOIN users u ON u.id = psa.user_id
      WHERE psa.tenant_id = ${context.tenantId}::uuid
        AND psa.property_id = ${context.propertyId}::uuid
    )
    SELECT "staffUserId", email FROM assigned
    UNION ALL
    SELECT tm.user_id AS "staffUserId", u.email
    FROM tenant_memberships tm
    JOIN users u ON u.id = tm.user_id
    WHERE tm.tenant_id = ${context.tenantId}::uuid
      AND tm.role IN ('OWNER', 'ADMIN')
      AND NOT EXISTS (SELECT 1 FROM assigned)
  `;
}
