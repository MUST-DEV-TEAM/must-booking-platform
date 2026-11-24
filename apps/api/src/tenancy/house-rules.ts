import { policyPreviewLines } from '@must/domain-contracts';

import type { TenantTransaction } from './tenant-database.service';

/**
 * The hotel's check-in and check-out times and house rules as plain sentences for a guest (G-55). Built by
 * the same function the Settings "Policies" preview uses, so what the hotel previewed is what guests read.
 * Empty when the hotel filled in nothing.
 */
export async function houseRuleLines(
  tx: TenantTransaction,
  scope: { tenantId: string; propertyId: string },
  language: 'en' | 'sq' = 'en',
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<Record<string, unknown>>>`
    SELECT check_in_time AS "checkInTime", check_out_time AS "checkOutTime",
      COALESCE(default_currency, 'EUR') AS "currency",
      check_in_until AS "checkInUntil", check_out_from AS "checkOutFrom",
      late_arrival_instructions AS "lateArrivalInstructions",
      early_check_in_policy AS "earlyCheckInPolicy", early_check_in_until AS "earlyCheckInUntil", early_check_in_note AS "earlyCheckInNote",
      late_check_out_policy AS "lateCheckOutPolicy", late_check_out_until AS "lateCheckOutUntil", late_check_out_note AS "lateCheckOutNote",
      cots_policy AS "cotsPolicy", cots_fee::text AS "cotsFee", cots_max::text AS "cotsMax",
      extra_beds_policy AS "extraBedsPolicy", extra_beds_fee::text AS "extraBedsFee", extra_beds_max::text AS "extraBedsMax",
      children_policy AS "childrenPolicy", children_policy_note AS "childrenPolicyNote",
      pets_policy AS "petsPolicy", pets_policy_note AS "petsPolicyNote", pets_fee_type AS "petsFeeType",
      pets_fee::text AS "petsFee", pets_max::text AS "petsMax",
      smoking_policy AS "smokingPolicy", parties_policy AS "partiesPolicy",
      quiet_hours_from AS "quietHoursFrom", quiet_hours_to AS "quietHoursTo",
      id_at_arrival AS "idAtArrival", id_documents AS "idDocuments",
      damage_deposit_amount::text AS "damageDepositAmount", damage_deposit_method AS "damageDepositMethod",
      damage_deposit_refund_days::text AS "damageDepositRefundDays", other_house_rules AS "otherHouseRules"
    FROM properties
    WHERE tenant_id = ${scope.tenantId}::uuid AND id = ${scope.propertyId}::uuid`;
  const row = rows[0];
  if (!row) return [];
  return policyPreviewLines(
    row,
    {
      checkInTime: row.checkInTime as string | null,
      checkOutTime: row.checkOutTime as string | null,
    },
    String(row.currency ?? 'EUR'),
    language,
  );
}
