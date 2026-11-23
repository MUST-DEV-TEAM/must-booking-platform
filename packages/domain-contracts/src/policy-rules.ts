/**
 * The rules for the hotel's Policies page (check-in times, cots and extra beds, pets, house rules, damage
 * deposit), written once. The form shows these messages as the owner types and the API refuses the same values
 * (settings redesign plan, S5). Whole-number limits (cots per room and so on) live in `BOOKING_LIMIT_RANGES`.
 */
export const POLICY_CHOICES = {
  cotsPolicy: ['not_available', 'free', 'paid'],
  extraBedsPolicy: ['not_available', 'free', 'paid'],
  petsFeeType: ['free', 'per_night', 'per_stay'],
  smokingPolicy: ['not_allowed', 'designated_areas', 'allowed'],
  partiesPolicy: ['not_allowed', 'on_request', 'allowed'],
  idAtArrival: ['not_required', 'main_guest', 'all_adults'],
  damageDepositMethod: ['cash', 'card'],
} as const;
export type PolicyChoiceKey = keyof typeof POLICY_CHOICES;

/** Documents a hotel can accept at arrival. */
export const ID_DOCUMENT_CHOICES = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID card' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'residence_permit', label: 'Residence permit' },
] as const;

export const OTHER_HOUSE_RULES_MAX = 1000;
export const LATE_ARRIVAL_MAX = 500;
export const MONEY_MAX = 99999.99;

/** Normalises a typed amount to "12.50", or null when empty. Returns NaN for anything that is not an amount. */
export function normaliseMoney(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(',', '.');
  if (text === '') return null;
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(text)) return 'invalid';
  return Number(text).toFixed(2);
}

/** A price: more than 0, at most 99999.99, up to two decimals. Empty is fine; the cross-field rules decide. */
export function checkMoneyAmount(value: unknown): string | null {
  const money = normaliseMoney(value);
  if (money === null) return null;
  return money !== 'invalid' && Number(money) > 0 && Number(money) <= MONEY_MAX
    ? null
    : 'Enter an amount above 0 with up to two decimals, for example 15.00.';
}

export function checkPolicyChoice(key: PolicyChoiceKey, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return (POLICY_CHOICES[key] as readonly unknown[]).includes(value)
    ? null
    : 'Choose one of the options.';
}

export function checkIdDocuments(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Choose the documents you accept.';
  const allowed: readonly string[] = ID_DOCUMENT_CHOICES.map((d) => d.value);
  return value.every((v) => typeof v === 'string' && allowed.includes(v)) &&
    new Set(value).size === value.length
    ? null
    : 'Choose documents from the list.';
}

export type PolicyValues = {
  checkInTime?: string | null;
  checkInUntil?: string | null;
  checkOutTime?: string | null;
  checkOutFrom?: string | null;
  cotsPolicy?: string | null;
  cotsFee?: unknown;
  cotsMax?: number | null;
  extraBedsPolicy?: string | null;
  extraBedsFee?: unknown;
  extraBedsMax?: number | null;
  petsPolicy?: string | null;
  petsFeeType?: string | null;
  petsFee?: unknown;
  petsMax?: number | null;
  idAtArrival?: string | null;
  idDocuments?: readonly string[] | null;
  damageDepositAmount?: unknown;
  damageDepositMethod?: string | null;
  damageDepositRefundDays?: number | null;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const set = (v: unknown) => v !== null && v !== undefined && v !== '';

/** Cross-field rules; returns messages by field. */
export function checkPolicies(values: PolicyValues): Record<string, string> {
  const out: Record<string, string> = {};
  const {
    checkInTime: from,
    checkInUntil: until,
    checkOutTime: by,
    checkOutFrom: outFrom,
  } = values;
  if (set(until) && TIME.test(String(until))) {
    if (!set(from)) out.checkInUntil = 'Enter the check-in from time first.';
    else if (String(until) <= String(from))
      out.checkInUntil = 'Check-in until must be later than check-in from.';
  }
  if (set(outFrom) && TIME.test(String(outFrom))) {
    if (!set(by)) out.checkOutFrom = 'Enter the check-out by time first.';
    else if (String(outFrom) >= String(by))
      out.checkOutFrom = 'Check-out from must be earlier than check-out by.';
  }
  for (const [name, policy, fee, max] of [
    ['cots', values.cotsPolicy, values.cotsFee, values.cotsMax],
    ['extraBeds', values.extraBedsPolicy, values.extraBedsFee, values.extraBedsMax],
  ] as const) {
    if (policy !== 'free' && policy !== 'paid') continue;
    if (policy === 'paid' && !set(normaliseMoney(fee)))
      out[`${name}Fee`] = 'Enter the price per night.';
    if (!set(max) || Number(max) < 1) out[`${name}Max`] = 'Enter how many per room, from 1 to 3.';
  }
  if (
    values.petsPolicy !== 'not_allowed' &&
    (values.petsFeeType === 'per_night' || values.petsFeeType === 'per_stay') &&
    !set(normaliseMoney(values.petsFee))
  )
    out.petsFee = 'Enter the pet fee.';
  if (
    values.idAtArrival &&
    values.idAtArrival !== 'not_required' &&
    (values.idDocuments?.length ?? 0) < 1
  )
    out.idDocuments = 'Choose at least one accepted document.';
  if (set(normaliseMoney(values.damageDepositAmount))) {
    if (!set(values.damageDepositMethod))
      out.damageDepositMethod = 'Choose how the deposit is taken.';
    if (!set(values.damageDepositRefundDays))
      out.damageDepositRefundDays = 'Enter how many days until it is refunded, from 1 to 30.';
  }
  return out;
}

/**
 * Values a hotel set earlier that no longer apply (a price on a cot that is now free, a fee for pets when pets
 * are not allowed). The API clears them when it saves, so nothing stale is shown to guests later.
 */
export function staleDependents(values: PolicyValues): Record<string, null | never[]> {
  const out: Record<string, null | never[]> = {};
  const clear = (key: string, current: unknown) => {
    if (Array.isArray(current) ? current.length : set(current))
      out[key] = Array.isArray(current) ? [] : null;
  };
  if (values.cotsPolicy !== 'paid') clear('cotsFee', values.cotsFee);
  if (values.cotsPolicy !== 'free' && values.cotsPolicy !== 'paid')
    clear('cotsMax', values.cotsMax);
  if (values.extraBedsPolicy !== 'paid') clear('extraBedsFee', values.extraBedsFee);
  if (values.extraBedsPolicy !== 'free' && values.extraBedsPolicy !== 'paid')
    clear('extraBedsMax', values.extraBedsMax);
  if (values.petsPolicy === 'not_allowed') {
    clear('petsFeeType', values.petsFeeType);
    clear('petsMax', values.petsMax);
  }
  if (
    values.petsPolicy === 'not_allowed' ||
    (values.petsFeeType !== 'per_night' && values.petsFeeType !== 'per_stay')
  )
    clear('petsFee', values.petsFee);
  if (!values.idAtArrival || values.idAtArrival === 'not_required')
    clear('idDocuments', values.idDocuments);
  if (!set(normaliseMoney(values.damageDepositAmount))) {
    clear('damageDepositMethod', values.damageDepositMethod);
    clear('damageDepositRefundDays', values.damageDepositRefundDays);
  }
  return out;
}
