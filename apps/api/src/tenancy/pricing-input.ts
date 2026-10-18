import {
  minor,
  decimal,
  type PricingPlan,
  type Adjustment,
  pricingDay,
} from '../booking/pricing-evaluator';
import { validRuleDate } from '../booking/booking-rules';
import { pricingInvalid } from './pricing-writes.service';
export const pricingUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const pricingObject = (body: unknown) =>
  (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
export function pricingId(value: unknown): string {
  if (typeof value !== 'string' || !pricingUuid.test(value))
    pricingInvalid('Choose a valid scoped record.');
  return value.toLowerCase();
}
export function text(v: Record<string, unknown>, key: string, max = 4000, required = false) {
  const value = v[key] ?? '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    pricingInvalid(`Invalid ${key}.`);
  return value.trim();
}
export function ids(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) pricingInvalid('Choose at most 500 targets.');
  const result = value.map(pricingId).sort();
  if (new Set(result).size !== result.length) pricingInvalid('Choose unique targets.');
  return result;
}
export function date(value: unknown, required = false): string | null {
  if (value === null || value === undefined || value === '') {
    if (required) pricingInvalid('A start date is required.');
    return null;
  }
  if (
    typeof value !== 'string' ||
    !validRuleDate(value) ||
    value.startsWith('0000') ||
    value >= '9999-12-31'
  )
    pricingInvalid('Choose a valid property-local calendar date.');
  return value;
}
export function integer(value: unknown, min = 0, max = 3660): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    pricingInvalid(`Choose an integer from ${min} to ${max}.`);
  return value;
}
export function amount(value: unknown, negative = false): string {
  if (
    typeof value !== 'string' ||
    !(negative ? /^-?\d{1,10}(?:\.\d{1,2})?$/ : /^\d{1,10}(?:\.\d{1,2})?$/).test(value)
  )
    pricingInvalid('Enter a decimal string with at most two decimal places.');
  return decimal(minor(value));
}
export function currency(value: unknown, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !/[A-Z]{3}/.test(value.toUpperCase()) || value.length !== 3)
    pricingInvalid('Choose a three-letter currency.');
  const c = value.toUpperCase();
  try {
    if (
      new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions()
        .maximumFractionDigits !== 2
    )
      pricingInvalid('Only two-decimal local currencies are supported.');
  } catch {
    pricingInvalid('Unsupported currency precision.');
  }
  return c;
}
export function channels(value: unknown): string[] {
  const c = value ?? ['website', 'staff'];
  if (
    !Array.isArray(c) ||
    !c.length ||
    c.some((x) => !['website', 'staff'].includes(x)) ||
    new Set(c).size !== c.length
  )
    pricingInvalid('Choose Website and/or Staff.');
  return [...c].sort();
}
export function weekdays(value: unknown): number[] {
  const d = value ?? [1, 2, 3, 4, 5, 6, 7];
  if (
    !Array.isArray(d) ||
    !d.length ||
    d.some((x) => !Number.isInteger(x) || x < 1 || x > 7) ||
    new Set(d).size !== d.length
  )
    pricingInvalid('Choose unique ISO weekdays.');
  return [...d].sort();
}
export function pricingPlanInput(body: unknown) {
  const v = pricingObject(body),
    pricingBasis = v.pricingBasis ?? 'independent',
    adjustmentKind = v.adjustmentKind ?? 'percentage';
  if (
    !['independent', 'derived'].includes(String(pricingBasis)) ||
    !['percentage', 'per_person_night'].includes(String(adjustmentKind))
  )
    pricingInvalid('Choose a valid pricing basis.');
  const a = amount(v.adjustmentValue ?? '0', true);
  if (adjustmentKind === 'percentage' && (minor(a) < -10000n || minor(a) > 100000n))
    pricingInvalid('Percentage must be from -100 to 1000.');
  const start = date(v.publicationStartsOn),
    end = date(v.publicationEndsOn),
    minStay = integer(v.minStay, 1),
    maxStay = integer(v.maxStay, 1);
  if ((start && end && end < start) || (minStay && maxStay && maxStay < minStay))
    pricingInvalid('Invalid publication/stay range.');
  const mealPlan = v.mealPlan ?? 'room_only';
  if (!['room_only', 'breakfast', 'half_board', 'full_board'].includes(String(mealPlan)))
    pricingInvalid('Choose a meal plan.');
  return {
    name: text(v, 'name', 200, true),
    description: text(v, 'description', 2000),
    currency: currency(v.currency)!,
    pricingBasis: pricingBasis as PricingPlan['pricingBasis'],
    basePlanId: pricingBasis === 'derived' ? pricingId(v.basePlanId) : null,
    adjustmentKind: String(adjustmentKind),
    adjustmentValue: pricingBasis === 'derived' ? a : '0.00',
    roomTypeIds: ids(v.roomTypeIds),
    channels: channels(v.channels),
    mealPlan: String(mealPlan),
    minStay,
    maxStay,
    minAdvance: integer(v.minAdvance),
    publicationStartsOn: start,
    publicationEndsOn: end,
  };
}
export function adjustmentInput(body: unknown) {
  const v = pricingObject(body),
    mode = v.mode ?? 'percentage',
    value = amount(v.value, true),
    start = date(v.startsOn, true)!,
    end = date(v.endsOn),
    days = weekdays(v.weekdays),
    minStay = integer(v.minStay, 1),
    maxStay = integer(v.maxStay, 1),
    minAdvance = integer(v.minAdvance),
    maxAdvance = integer(v.maxAdvance),
    priority = integer(v.priority ?? 50, 1, 100)!;
  if (!['percentage', 'fixed'].includes(String(mode)))
    pricingInvalid('Choose percentage or fixed adjustment.');
  if (mode === 'percentage' && (minor(value) < -10000n || minor(value) > 100000n))
    pricingInvalid('Percentage must be from -100 to 1000.');
  if (
    (end && end < start) ||
    (minStay && maxStay && maxStay < minStay) ||
    (minAdvance !== null && maxAdvance !== null && maxAdvance < minAdvance)
  )
    pricingInvalid('Invalid condition/date range.');
  if (
    end &&
    !Array.from({ length: 7 }, (_, i) => pricingDay(start, i)).some(
      (d) => d <= end && days.includes(new Date(d + 'T00:00:00Z').getUTCDay() || 7),
    )
  )
    pricingInvalid('No dates match these weekdays.');
  return {
    name: text(v, 'name', 200, true),
    mode: String(mode),
    value,
    currency: currency(v.currency, mode === 'percentage'),
    startsOn: start,
    endsOn: end,
    weekdays: days,
    priority,
    roomTypeIds: ids(v.roomTypeIds),
    ratePlanIds: ids(v.ratePlanIds),
    minStay,
    maxStay,
    minAdvance,
    maxAdvance,
    note: text(v, 'note'),
  };
}
export function chargeInput(body: unknown) {
  const v = pricingObject(body),
    basis = v.basis ?? 'percentage_accommodation',
    display = v.display ?? 'included',
    start = date(v.startsOn, true)!,
    end = date(v.endsOn),
    value = amount(v.value);
  if (
    ![
      'percentage_accommodation',
      'percentage_subtotal',
      'per_adult_night',
      'per_person_night',
      'per_stay',
    ].includes(String(basis)) ||
    !['included', 'added'].includes(String(display))
  )
    pricingInvalid('Choose a valid charge basis/display.');
  if (String(basis).startsWith('percentage_') && minor(value) > 10000n)
    pricingInvalid('Charge percentage cannot exceed 100.');
  if (end && end < start) pricingInvalid('End date is before start.');
  if (v.confirmed !== undefined && typeof v.confirmed !== 'boolean')
    pricingInvalid('Confirm applicability with a checkbox.');
  return {
    name: text(v, 'name', 200, true),
    basis: String(basis),
    display: String(display),
    value,
    currency: currency(v.currency, String(basis).startsWith('percentage_')),
    confirmed: v.confirmed === true,
    startsOn: start,
    endsOn: end,
    roomTypeIds: ids(v.roomTypeIds),
    ratePlanIds: ids(v.ratePlanIds),
    channels: channels(v.channels),
    note: text(v, 'note'),
  };
}
export type PlanInput = ReturnType<typeof pricingPlanInput>;
export type AdjustmentInput = ReturnType<typeof adjustmentInput>;
export type ChargeInput = ReturnType<typeof chargeInput>;
export function adjustmentConflicts(
  candidate: Adjustment,
  others: Adjustment[],
  plans: PricingPlan[],
  typeIds: string[],
  today: string,
) {
  return others.flatMap((other) => {
    if (
      other.id === candidate.id ||
      other.lifecycle !== 'Active' ||
      other.priority !== candidate.priority
    )
      return [];
    const stay = Math.max(1, candidate.minStay ?? 1, other.minStay ?? 1);
    if (stay > Math.min(candidate.maxStay ?? 3660, other.maxStay ?? 3660)) return [];
    const lead = Math.max(0, candidate.minAdvance ?? 0, other.minAdvance ?? 0),
      maxLead = Math.min(candidate.maxAdvance ?? 3660000, other.maxAdvance ?? 3660000);
    const start = [candidate.startsOn, other.startsOn, today, pricingDay(today, lead)]
      .sort()
      .at(-1)!;
    const ends = [
        candidate.endsOn,
        other.endsOn,
        maxLead < 3660000 ? pricingDay(today, maxLead) : null,
      ]
        .filter((x): x is string => !!x)
        .sort(),
      end = ends[0];
    if (end && end < start) return [];
    const types = typeIds.filter(
      (id) =>
        (!candidate.roomTypeIds.length || candidate.roomTypeIds.includes(id)) &&
        (!other.roomTypeIds.length || other.roomTypeIds.includes(id)),
    );
    const shared = plans.some(
      (p) =>
        p.lifecycle !== 'Archived' &&
        (!p.roomTypeIds.length || types.some((t) => p.roomTypeIds.includes(t))) &&
        (!candidate.currency || candidate.currency === p.currency) &&
        (!other.currency || other.currency === p.currency) &&
        (!candidate.ratePlanIds.length ||
          candidate.ratePlanIds.includes(p.id) ||
          candidate.ratePlanIds.includes(p.basePlanId ?? '')) &&
        (!other.ratePlanIds.length ||
          other.ratePlanIds.includes(p.id) ||
          other.ratePlanIds.includes(p.basePlanId ?? '')),
    );
    if (!types.length || !shared) return [];
    for (let i = 0; i < 7; i++) {
      const date = pricingDay(start, i),
        d = new Date(date + 'T00:00:00Z').getUTCDay() || 7;
      if (end && date > end) break;
      if (candidate.weekdays.includes(d) && other.weekdays.includes(d))
        return [{ id: other.id, name: other.name, date }];
    }
    return [];
  });
}
