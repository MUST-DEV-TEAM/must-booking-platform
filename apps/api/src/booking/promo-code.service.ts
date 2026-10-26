import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Money, NightlyRate } from '@must/domain-contracts';

import { TenantDatabaseService, type TenantTransaction } from '../tenancy/tenant-database.service';

export type PromoSummary = {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: string;
  /** What is taken off the price. */
  discount: Money;
  /** The price before the code. */
  originalTotal: Money;
};

export type PromoResult =
  { applies: true; promo: PromoSummary; total: Money } | { applies: false; reason: string };

type PromoRow = {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: string;
  currency: string | null;
  bookFrom: Date | null;
  bookUntil: Date | null;
  stayFrom: Date | null;
  stayUntil: Date | null;
  minNights: number | null;
  roomTypeIds: string[] | null;
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
};

/** One message for every reason a code does not apply, so nobody can probe which codes exist. */
export const PROMO_NOT_VALID = 'This code is not valid for this stay.';

const CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/;

export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  if (!CODE_PATTERN.test(code)) throw new BadRequestException(PROMO_NOT_VALID);
  return code;
}

export const toMinor = (amount: string): bigint => {
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole! + (fraction + '00').slice(0, 2));
};
export const fromMinor = (value: bigint): string =>
  `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
const day = (value: Date | string): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

function nightsBetween(startsOn: string, endsOn: string): number {
  return Math.round((Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000);
}

/** The discount in minor units, never more than the price. */
export function discountMinor(row: Pick<PromoRow, 'kind' | 'value'>, total: bigint): bigint {
  const value = toMinor(row.value);
  const raw = row.kind === 'PERCENT' ? (total * value + 5_000n) / 10_000n : value;
  return raw > total ? total : raw;
}

/**
 * Takes the discount off each night in proportion to its price, so the nights still add up to the
 * discounted total. Any rounding left over goes to the last night.
 */
export function discountNights(
  nights: NightlyRate[],
  total: bigint,
  discount: bigint,
): NightlyRate[] {
  if (nights.length === 0 || total === 0n) return nights;
  let left = discount;
  return nights.map((night, index) => {
    const price = toMinor(night.amount);
    const share = index === nights.length - 1 ? left : (price * discount) / total;
    left -= share;
    return { ...night, amount: fromMinor(price - share > 0n ? price - share : 0n) };
  });
}

@Injectable()
export class PromoCodeService {
  constructor(@Inject(TenantDatabaseService) private readonly db: TenantDatabaseService) {}

  /**
   * Whether the hotel's own code applies to this stay, and the discounted price. A code that is not
   * the hotel's own returns not-applies, so a Clock bonus code can be tried next.
   */
  async evaluate(
    tenantId: string,
    propertyId: string,
    input: {
      code: string;
      roomTypeId: string;
      startsOn: string;
      endsOn: string;
      total: Money;
      today?: string;
    },
  ): Promise<PromoResult> {
    const rows = await this.db.withTenantTransaction(
      { tenantId, propertyId },
      (tx) =>
        tx.$queryRaw<PromoRow[]>`
        SELECT id, code, kind, value::text AS value, currency, book_from AS "bookFrom",
               book_until AS "bookUntil", stay_from AS "stayFrom", stay_until AS "stayUntil",
               min_nights AS "minNights", room_type_ids::text[] AS "roomTypeIds",
               max_redemptions AS "maxRedemptions", (SELECT COUNT(*)::int FROM bookings b WHERE b.tenant_id = p.tenant_id AND b.property_id = p.property_id AND b.promo_code = p.code AND b.status::text NOT IN ('AVAILABILITY_FAILED', 'PAYMENT_FAILED', 'PMS_REJECTED', 'CANCELLED', 'EXPIRED')) AS redemptions, active
        FROM promo_codes p
        WHERE tenant_id = ${tenantId}::uuid AND property_id = ${propertyId}::uuid
          AND code = ${input.code}
      `,
    );
    const row = rows[0];
    if (!row) return { applies: false, reason: PROMO_NOT_VALID };
    return this.check(row, input);
  }

  /** Pure rules: every reason returns the same message. */
  check(
    row: PromoRow,
    input: { roomTypeId: string; startsOn: string; endsOn: string; total: Money; today?: string },
  ): PromoResult {
    const today = input.today ?? new Date().toISOString().slice(0, 10);
    const stayStart = input.startsOn;
    const stayEnd = input.endsOn;
    const invalid =
      !row.active ||
      (row.bookFrom && today < day(row.bookFrom)) ||
      (row.bookUntil && today > day(row.bookUntil)) ||
      (row.stayFrom && stayStart < day(row.stayFrom)) ||
      (row.stayUntil && stayEnd > day(row.stayUntil)) ||
      (row.minNights && nightsBetween(input.startsOn, input.endsOn) < row.minNights) ||
      (row.roomTypeIds &&
        row.roomTypeIds.length > 0 &&
        !row.roomTypeIds.includes(input.roomTypeId)) ||
      (row.maxRedemptions !== null && row.redemptions >= row.maxRedemptions) ||
      (row.kind === 'FIXED' && row.currency !== input.total.currency);
    if (invalid) return { applies: false, reason: PROMO_NOT_VALID };

    const total = toMinor(input.total.amount);
    const discount = discountMinor(row, total);
    if (discount <= 0n) return { applies: false, reason: PROMO_NOT_VALID };
    const currency = input.total.currency;
    return {
      applies: true,
      promo: {
        code: row.code,
        kind: row.kind,
        value: row.value,
        discount: { amount: fromMinor(discount), currency },
        originalTotal: input.total,
      },
      total: { amount: fromMinor(total - discount), currency },
    };
  }

  /**
   * Whether one more booking may use the code. A use is a booking that carries the code and has not
   * failed, been rejected, expired or been cancelled, so a use comes back by itself when a booking
   * falls through. The check runs under a lock per code, so two bookings cannot both take the last use.
   */
  async reserveUse(
    tx: TenantTransaction,
    scope: { tenantId: string; propertyId: string },
    code: string,
  ): Promise<boolean> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`promo:${scope.tenantId}:${scope.propertyId}:${code}`}, 0))
    `;
    const rows = await tx.$queryRaw<Array<{ ok: boolean }>>`
      SELECT (p.active AND (p.max_redemptions IS NULL OR (SELECT COUNT(*)::int FROM bookings b WHERE b.tenant_id = p.tenant_id AND b.property_id = p.property_id AND b.promo_code = p.code AND b.status::text NOT IN ('AVAILABILITY_FAILED', 'PAYMENT_FAILED', 'PMS_REJECTED', 'CANCELLED', 'EXPIRED')) < p.max_redemptions)) AS ok
      FROM promo_codes p
      WHERE p.tenant_id = ${scope.tenantId}::uuid AND p.property_id = ${scope.propertyId}::uuid
        AND p.code = ${code}
    `;
    return rows[0]?.ok === true;
  }
}
