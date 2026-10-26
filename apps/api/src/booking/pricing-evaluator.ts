import { validRuleDate } from './booking-rules';
export type PricingPlan = {
  id: string;
  name: string;
  currency: string;
  isActive: boolean;
  lifecycle: string;
  version: number;
  code: string;
  description: string;
  pricingBasis: string;
  basePlanId: string | null;
  adjustmentKind: string;
  adjustmentValue: string;
  roomTypeIds: string[];
  channels: string[];
  mealPlan: string;
  isFallback: boolean;
  minStay: number | null;
  maxStay: number | null;
  minAdvance: number | null;
  publicationStartsOn: string | null;
  publicationEndsOn: string | null;
};
export type BasePrice = {
  id: string;
  ratePlanId: string;
  roomTypeId: string;
  startsOn: string | null;
  endsOn: string | null;
  weekdays: number[];
  amount: string;
  version: number;
  createdAt: string;
};
export type DailyPrice = {
  ratePlanId: string;
  roomTypeId: string;
  date: string;
  amount: string;
  version: number;
};
export type Adjustment = {
  id: string;
  name: string;
  lifecycle: string;
  version: number;
  mode: string;
  value: string;
  currency: string | null;
  roomTypeIds: string[];
  ratePlanIds: string[];
  startsOn: string;
  endsOn: string | null;
  weekdays: number[];
  priority: number;
  minStay: number | null;
  maxStay: number | null;
  minAdvance: number | null;
  maxAdvance: number | null;
  note: string;
};
export type Charge = {
  category?: import('@must/domain-contracts').ChargeCategory | null;
  id: string;
  name: string;
  lifecycle: string;
  version: number;
  basis: string;
  value: string;
  currency: string | null;
  display: string;
  confirmed: boolean;
  roomTypeIds: string[];
  ratePlanIds: string[];
  channels: string[];
  startsOn: string;
  endsOn: string | null;
  note: string;
};
export type PricingFacts = {
  plans: PricingPlan[];
  base: BasePrice[];
  daily: DailyPrice[];
  rules: Adjustment[];
  charges: Charge[];
  roomOverrides: { ratePlanId: string; roomId: string; amount: string; version: number }[];
};
export type PricingRequest = {
  ratePlanId: string;
  roomTypeId: string;
  roomId?: string;
  startsOn: string;
  endsOn: string;
  adults?: number;
  children?: number;
  channel?: 'website' | 'staff';
  today: string;
};
export const pricingDay = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
export const pricingNights = (start: string, end: string) =>
  (Date.parse(end) - Date.parse(start)) / 86400000;
export function minor(value: string): bigint {
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid decimal money.');
  const negative = value.startsWith('-'),
    parts = value.replace('-', '').split('.');
  const n = BigInt(parts[0]!) * 100n + BigInt((parts[1] ?? '').padEnd(2, '0'));
  return negative ? -n : n;
}
export function decimal(n: bigint): string {
  const sign = n < 0n ? '-' : '';
  const a = n < 0n ? -n : n;
  return `${sign}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}
export function roundMinor(n: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Invalid denominator.');
  return n < 0n ? -roundMinor(-n, denominator) : (n + denominator / 2n) / denominator;
}
const moneyLimit = 999999999999n;
const inScope = (ids: string[], id: string) => !ids.length || ids.includes(id);
const scheduled = (r: { startsOn: string; endsOn: string | null }, date: string) =>
  date >= r.startsOn && (!r.endsOn || date <= r.endsOn);
export function adjustmentMatches(
  r: Adjustment,
  input: PricingRequest,
  rootPlanId: string,
  date: string,
): boolean {
  const nights = pricingNights(input.startsOn, input.endsOn),
    advance = pricingNights(input.today, input.startsOn);
  return (
    r.lifecycle === 'Active' &&
    inScope(r.roomTypeIds, input.roomTypeId) &&
    (!r.ratePlanIds.length ||
      r.ratePlanIds.includes(input.ratePlanId) ||
      r.ratePlanIds.includes(rootPlanId)) &&
    scheduled(r, date) &&
    r.weekdays.includes(new Date(date + 'T00:00:00Z').getUTCDay() || 7) &&
    (r.minStay === null || nights >= r.minStay) &&
    (r.maxStay === null || nights <= r.maxStay) &&
    (r.minAdvance === null || advance >= r.minAdvance) &&
    (r.maxAdvance === null || advance <= r.maxAdvance)
  );
}
export type PricingComponent = {
  kind: 'base' | 'rule' | 'plan' | 'charge';
  id: string;
  version: number;
  name: string;
  amount: string;
  display?: string;
  category?: import('@must/domain-contracts').ChargeCategory | null;
};
export type PricingNight = { date: string; amount: string; components: PricingComponent[] };
export type PricingResult = {
  valid: boolean;
  errors: { code: string; message: string; date?: string }[];
  total: { amount: string; currency: string } | null;
  nightlyRates: PricingNight[];
};
/** Resolve base precedence once for the evaluator and base-change comparison. */
export function resolveBasePrice(
  facts: PricingFacts,
  ratePlanId: string,
  roomTypeId: string,
  date: string,
  roomId?: string,
) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const override = roomId
    ? facts.roomOverrides.find((o) => o.ratePlanId === ratePlanId && o.roomId === roomId)
    : undefined;
  const daily = facts.daily.find(
    (d) => d.ratePlanId === ratePlanId && d.roomTypeId === roomTypeId && d.date === date,
  );
  const base = facts.base
    .filter(
      (b) =>
        b.ratePlanId === ratePlanId &&
        b.roomTypeId === roomTypeId &&
        b.weekdays.includes(weekday) &&
        (!b.startsOn || (date >= b.startsOn && date <= b.endsOn!)),
    )
    .sort(
      (a, b) =>
        Number(!a.startsOn) - Number(!b.startsOn) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    )[0];
  const chosen = override ?? daily ?? base;
  return { override, daily, base, chosen };
}
/** Single decimal-safe local evaluator. It has no IO and never mutates a booking or issued quote. */
export function evaluatePricing(facts: PricingFacts, input: PricingRequest): PricingResult {
  const errors: PricingResult['errors'] = [],
    nightlyRates: PricingNight[] = [];
  const fail = (code: string, message: string, date?: string) =>
    errors.push({ code, message, ...(date ? { date } : {}) });
  if (
    !validRuleDate(input.startsOn) ||
    !validRuleDate(input.endsOn) ||
    input.endsOn <= input.startsOn ||
    pricingNights(input.startsOn, input.endsOn) > 3660
  )
    return {
      valid: false,
      errors: [{ code: 'PRICING_INVALID', message: 'Choose a valid stay of at most 3660 nights.' }],
      total: null,
      nightlyRates: [],
    };
  const plan = facts.plans.find((p) => p.id === input.ratePlanId),
    root =
      plan?.pricingBasis === 'derived' ? facts.plans.find((p) => p.id === plan.basePlanId) : plan;
  if (!plan || !root || root.pricingBasis !== 'independent' || root.currency !== plan.currency)
    return {
      valid: false,
      errors: [
        {
          code: 'PRICING_PLAN_INVALID',
          message: 'An independent plan in the same currency is required.',
        },
      ],
      total: null,
      nightlyRates: [],
    };
  const currency = plan.currency,
    adults = input.adults ?? 1,
    children = input.children ?? 0,
    nights = pricingNights(input.startsOn, input.endsOn),
    advance = pricingNights(input.today, input.startsOn),
    channel = input.channel ?? 'staff';
  if (
    !Number.isInteger(adults) ||
    adults < 1 ||
    !Number.isInteger(children) ||
    children < 0 ||
    adults + children > 1000
  )
    fail('PRICING_OCCUPANCY', 'Choose valid adult and child counts.');
  try {
    if (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits !== 2
    )
      fail(
        'PRICING_CURRENCY_UNSUPPORTED',
        'This local pricing model requires a two-decimal currency.',
      );
  } catch {
    fail('PRICING_CURRENCY_UNSUPPORTED', 'Invalid currency.');
  }
  for (const p of [...new Map([root, plan].map((p) => [p.id, p])).values()]) {
    if (
      !p.isActive ||
      p.lifecycle !== 'Active' ||
      !p.channels.includes(channel) ||
      !inScope(p.roomTypeIds, input.roomTypeId) ||
      (p.minStay !== null && nights < p.minStay) ||
      (p.maxStay !== null && nights > p.maxStay) ||
      (p.minAdvance !== null && advance < p.minAdvance)
    )
      fail('PRICING_PLAN_UNAVAILABLE', `Plan ${p.name} is unavailable for this stay/channel.`);
  }
  let total = 0n;
  const once = new Set<string>();
  try {
    for (let i = 0; i < nights; i++) {
      const date = pricingDay(input.startsOn, i),
        components: PricingComponent[] = [];
      if (
        [root, plan].some(
          (p) =>
            (p.publicationStartsOn && date < p.publicationStartsOn) ||
            (p.publicationEndsOn && date > p.publicationEndsOn),
        )
      )
        fail('PRICING_PLAN_UNAVAILABLE', 'Plan is outside its publication dates.', date);
      const { override, daily, base, chosen } = resolveBasePrice(
        facts,
        root.id,
        input.roomTypeId,
        date,
        input.roomId,
      );
      if (!chosen) {
        fail('PRICING_MISSING_BASE', 'No usable price for this night.', date);
        continue;
      }
      let accommodation = minor(chosen.amount);
      components.push({
        kind: 'base',
        id: override
          ? `room:${input.roomId}`
          : daily
            ? `daily:${root.id}:${input.roomTypeId}:${date}`
            : base!.id,
        version: chosen.version,
        name: override
          ? 'Room override'
          : daily
            ? 'Manual daily price'
            : base?.startsOn
              ? 'Dated absolute price'
              : 'Base price',
        amount: decimal(accommodation),
      });
      const matching = facts.rules.filter(
        (r) =>
          adjustmentMatches(r, input, root.id, date) && (!r.currency || r.currency === currency),
      );
      const priority = Math.max(...matching.map((r) => r.priority)),
        winners = matching.filter((r) => r.priority === priority);
      if (winners.length > 1) {
        fail('PRICING_PRIORITY_CONFLICT', 'Equal-priority adjustments overlap.', date);
        continue;
      }
      const rule = winners[0];
      if (rule) {
        const before = accommodation;
        accommodation =
          rule.mode === 'percentage'
            ? roundMinor(accommodation * (10000n + minor(rule.value)), 10000n)
            : accommodation + minor(rule.value);
        components.push({
          kind: 'rule',
          id: rule.id,
          version: rule.version,
          name: rule.name,
          amount: decimal(accommodation - before),
        });
      }
      if (plan.pricingBasis === 'derived') {
        const before = accommodation;
        accommodation =
          plan.adjustmentKind === 'percentage'
            ? roundMinor(accommodation * (10000n + minor(plan.adjustmentValue)), 10000n)
            : accommodation + minor(plan.adjustmentValue) * BigInt(adults + children);
        components.push({
          kind: 'plan',
          id: plan.id,
          version: plan.version,
          name: plan.name,
          amount: decimal(accommodation - before),
        });
      }
      if (accommodation < 0n || accommodation > moneyLimit) {
        fail('PRICING_AMOUNT_INVALID', 'Adjusted price is negative or too large.', date);
        continue;
      }
      const charges = facts.charges.filter(
        (c) =>
          c.lifecycle === 'Active' &&
          c.confirmed &&
          inScope(c.roomTypeIds, input.roomTypeId) &&
          inScope(c.ratePlanIds, plan.id) &&
          c.channels.includes(channel) &&
          scheduled(c, date) &&
          (!c.currency || c.currency === currency),
      );
      let fixed = 0n;
      for (const c of charges.filter((c) => !c.basis.startsWith('percentage_'))) {
        let amount = minor(c.value);
        if (c.basis === 'per_adult_night') amount *= BigInt(adults);
        else if (c.basis === 'per_person_night') amount *= BigInt(adults + children);
        else if (c.basis === 'per_stay') {
          if (once.has(c.id)) continue;
          once.add(c.id);
        }
        fixed += amount;
        components.push({
          kind: 'charge',
          category: c.category ?? null,
          id: c.id,
          version: c.version,
          name: c.name,
          amount: decimal(amount),
          display: c.display,
        });
      }
      let percentages = 0n;
      for (const c of charges.filter((c) => c.basis.startsWith('percentage_'))) {
        const amount = roundMinor(
          (accommodation + (c.basis === 'percentage_subtotal' ? fixed : 0n)) * minor(c.value),
          10000n,
        );
        percentages += amount;
        components.push({
          kind: 'charge',
          category: c.category ?? null,
          id: c.id,
          version: c.version,
          name: c.name,
          amount: decimal(amount),
          display: c.display,
        });
      }
      const amount = accommodation + fixed + percentages;
      if (amount < 0n || amount > moneyLimit) {
        fail('PRICING_AMOUNT_INVALID', 'Total is negative or too large.', date);
        continue;
      }
      total += amount;
      nightlyRates.push({ date, amount: decimal(amount), components });
    }
  } catch {
    fail('PRICING_AMOUNT_INVALID', 'Invalid saved decimal amount.');
  }
  if (total > moneyLimit)
    fail('PRICING_AMOUNT_INVALID', 'Stay total exceeds the supported amount.');
  return {
    valid: !errors.length,
    errors,
    total: errors.length ? null : { amount: decimal(total), currency },
    nightlyRates: errors.length ? [] : nightlyRates,
  };
}
