import { describe, expect, it } from 'vitest';
import {
  evaluatePricing,
  minor,
  decimal,
  roundMinor,
  pricingDay,
  type PricingFacts,
  type PricingPlan,
  type Adjustment,
  type Charge,
} from './pricing-evaluator';
export const plan: PricingPlan = {
  id: 'p',
  name: 'Flexible',
  currency: 'EUR',
  isActive: true,
  lifecycle: 'Active',
  version: 1,
  code: 'FLEX',
  description: '',
  pricingBasis: 'independent',
  basePlanId: null,
  adjustmentKind: 'percentage',
  adjustmentValue: '0',
  roomTypeIds: [],
  channels: ['website', 'staff'],
  mealPlan: 'room_only',
  isFallback: true,
  minStay: null,
  maxStay: null,
  minAdvance: null,
  publicationStartsOn: null,
  publicationEndsOn: null,
};
const input = {
  ratePlanId: 'p',
  roomTypeId: 't',
  startsOn: '2036-02-29',
  endsOn: '2036-03-02',
  adults: 2,
  children: 1,
  today: '2036-02-20',
};
export const facts = (): PricingFacts => ({
  plans: [{ ...plan }],
  base: [
    {
      id: 'b',
      ratePlanId: 'p',
      roomTypeId: 't',
      startsOn: null,
      endsOn: null,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      amount: '100.00',
      version: 1,
      createdAt: '2026-01-01',
    },
  ],
  daily: [],
  rules: [],
  charges: [],
  roomOverrides: [],
});
export const rule = (overrides: Partial<Adjustment> = {}): Adjustment => ({
  id: 'r',
  name: 'Season',
  lifecycle: 'Active',
  version: 1,
  mode: 'percentage',
  value: '10',
  currency: null,
  roomTypeIds: [],
  ratePlanIds: [],
  startsOn: '2036-02-29',
  endsOn: '2036-03-01',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  priority: 50,
  minStay: null,
  maxStay: null,
  minAdvance: null,
  maxAdvance: null,
  note: '',
  ...overrides,
});
export const charge = (overrides: Partial<Charge> = {}): Charge => ({
  id: 'vat',
  name: 'VAT example',
  lifecycle: 'Active',
  version: 1,
  basis: 'percentage_accommodation',
  value: '6',
  currency: null,
  display: 'included',
  confirmed: true,
  roomTypeIds: [],
  ratePlanIds: [],
  channels: ['website', 'staff'],
  startsOn: '2036-01-01',
  endsOn: null,
  note: '',
  ...overrides,
});
describe('pure local pricing', () => {
  it('keeps legacy base/date/room precedence and leap-night edges', () => {
    const f = facts();
    expect(evaluatePricing(f, input).total?.amount).toBe('200.00');
    f.base.push({
      ...f.base[0]!,
      id: 'dated',
      startsOn: '2036-02-29',
      endsOn: '2036-02-29',
      amount: '120.00',
    });
    f.daily.push({
      ratePlanId: 'p',
      roomTypeId: 't',
      date: '2036-02-29',
      amount: '130.00',
      version: 1,
    });
    expect(evaluatePricing(f, input).total?.amount).toBe('230.00');
    f.roomOverrides.push({ ratePlanId: 'p', roomId: 'room', amount: '140.00', version: 1 });
    expect(evaluatePricing(f, { ...input, roomId: 'room' }).total?.amount).toBe('280.00');
  });
  it('applies one highest rule, derived plan, fixed and non-compounding percent charges', () => {
    const f = facts();
    f.plans.push({
      ...plan,
      id: 'd',
      pricingBasis: 'derived',
      basePlanId: 'p',
      adjustmentValue: '-10',
    });
    f.rules = [rule(), rule({ id: 'lower', priority: 25, value: '90' })];
    f.charges = [
      charge(),
      charge({
        id: 'city',
        basis: 'per_adult_night',
        value: '2',
        currency: 'EUR',
        display: 'added',
      }),
      charge({ id: 'clean', basis: 'per_stay', value: '25', currency: 'EUR', display: 'added' }),
      charge({ id: 'service', basis: 'percentage_subtotal', value: '3', display: 'added' }),
    ];
    const result = evaluatePricing(f, { ...input, ratePlanId: 'd' });
    expect(result.total?.amount).toBe('249.81');
    expect(result.nightlyRates.map((n) => n.amount)).toEqual(['137.78', '112.03']);
    expect(result.nightlyRates[0]?.components.find((c) => c.id === 'city')).toMatchObject({
      amount: '4.00',
      display: 'added',
    });
  });
  it('does not change total when charge display switches included/added', () => {
    const f = facts();
    f.charges = [charge()];
    const a = evaluatePricing(f, input);
    f.charges[0]!.display = 'added';
    expect(evaluatePricing(f, input).total).toEqual(a.total);
  });
  it('rounds halves exactly and never through floating-point money', () => {
    expect(minor('9999999999.99')).toBe(999999999999n);
    expect(decimal(minor('-0.01'))).toBe('-0.01');
    expect(roundMinor(1005n, 10n)).toBe(101n);
    expect(roundMinor(-1005n, 10n)).toBe(-101n);
    const f = facts();
    f.base[0]!.amount = '1.00';
    f.rules = [rule({ value: '0.5' })];
    expect(evaluatePricing(f, input).total?.amount).toBe('2.02');
  });
  it('blocks ties including identical values and ignores drafts/archives', () => {
    const f = facts();
    f.rules = [rule(), rule({ id: 'tie' })];
    expect(evaluatePricing(f, input).errors[0]?.code).toBe('PRICING_PRIORITY_CONFLICT');
    f.rules[1]!.lifecycle = 'Draft';
    expect(evaluatePricing(f, input).valid).toBe(true);
    f.rules[0]!.lifecycle = 'Archived';
    expect(evaluatePricing(f, input).total?.amount).toBe('200.00');
  });
  it('matches weekday, scope, inclusive schedule and stay/advance edges', () => {
    const f = facts();
    f.rules = [rule({ weekdays: [5], minStay: 2, maxStay: 2, minAdvance: 9, maxAdvance: 9 })];
    expect(evaluatePricing(f, input).total?.amount).toBe('210.00');
    f.rules[0]!.minAdvance = 10;
    expect(evaluatePricing(f, input).total?.amount).toBe('200.00');
    f.rules[0]!.minAdvance = null;
    f.rules[0]!.roomTypeIds = ['other'];
    expect(evaluatePricing(f, input).total?.amount).toBe('200.00');
  });
  it('derives a per-person-night plan from adults plus children', () => {
    const f = facts();
    f.plans.push({
      ...plan,
      id: 'd',
      pricingBasis: 'derived',
      basePlanId: 'p',
      adjustmentKind: 'per_person_night',
      adjustmentValue: '18',
    });
    expect(evaluatePricing(f, { ...input, ratePlanId: 'd' }).total?.amount).toBe('308.00');
  });
  it('fails closed for missing nights, unavailable plans, negative totals and overflow', () => {
    const f = facts();
    f.base = [];
    expect(evaluatePricing(f, input).errors[0]?.code).toBe('PRICING_MISSING_BASE');
    f.base = facts().base;
    f.plans[0]!.lifecycle = 'Draft';
    expect(evaluatePricing(f, input).valid).toBe(false);
    f.plans[0]!.lifecycle = 'Active';
    f.rules = [rule({ mode: 'fixed', value: '-101', currency: 'EUR' })];
    expect(evaluatePricing(f, input).valid).toBe(false);
    f.rules = [];
    f.base[0]!.amount = '9999999999.99';
    expect(evaluatePricing(f, input).valid).toBe(false);
  });
  it('keeps input facts and returned snapshots independent', () => {
    const f = facts(),
      before = JSON.stringify(f),
      result = evaluatePricing(f, input);
    expect(JSON.stringify(f)).toBe(before);
    f.base[0]!.amount = '400';
    expect(result.total?.amount).toBe('200.00');
    expect(result.nightlyRates[0]?.components[0]?.amount).toBe('100.00');
  });
  it('does not invent tax applicability for unconfirmed, wrong-currency or scoped-out records', () => {
    const f = facts();
    f.charges = [
      charge({ confirmed: false }),
      charge({ id: 'usd', basis: 'per_stay', currency: 'USD', value: '100' }),
      charge({ id: 'other', roomTypeIds: ['other'] }),
    ];
    expect(evaluatePricing(f, input).total?.amount).toBe('200.00');
  });
  it('rejects cycles, different currencies, non-two-decimal currencies and publication/channel gaps', () => {
    const f = facts();
    f.plans[0]!.currency = 'JPY';
    expect(evaluatePricing(f, input).valid).toBe(false);
    f.plans[0]!.currency = 'EUR';
    f.plans[0]!.channels = ['website'];
    expect(evaluatePricing(f, input).valid).toBe(false);
    f.plans[0]!.channels = ['staff'];
    f.plans[0]!.publicationEndsOn = '2036-02-29';
    expect(evaluatePricing(f, input).valid).toBe(false);
    f.plans[0]!.pricingBasis = 'derived';
    f.plans[0]!.basePlanId = 'p';
    expect(evaluatePricing(f, input).valid).toBe(false);
  });
  it('uses calendar days across year and DST boundaries', () => {
    expect(pricingDay('2035-12-31', 1)).toBe('2036-01-01');
    expect(pricingDay('2026-10-25', 1)).toBe('2026-10-26');
  });
});
