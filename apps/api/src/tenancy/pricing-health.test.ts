import { describe, it, expect } from 'vitest';
import { pricingHealth } from './pricing-health';
import type { PricingFacts, PricingPlan } from '../booking/pricing-evaluator';
const plan: PricingPlan = {
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
const types = [{ id: 't', name: 'King', status: 'PUBLISHED' }];
const facts = (): PricingFacts => ({
  plans: [{ ...plan }],
  base: [],
  daily: [],
  rules: [],
  charges: [],
  roomOverrides: [],
});
describe('Shared pricing health and accommodation readiness', () => {
  it('accepts daily-only prices and finds the exact first missing arrival beyond the configured horizon edge', () => {
    const f = facts();
    f.daily = [
      { ratePlanId: 'p', roomTypeId: 't', date: '2036-02-28', amount: '100.00', version: 1 },
      { ratePlanId: 'p', roomTypeId: 't', date: '2036-02-29', amount: '100.00', version: 1 },
    ];
    const covered = pricingHealth(f, types, '2036-02-28', 1);
    expect(covered.readiness.t).toBe(true);
    expect(covered.coverage?.pricedCells).toBe(2);
    expect(covered.issues).toEqual([]);
    const gap = pricingHealth(f, types, '2036-02-28', 2);
    expect(gap.readiness.t).toBe(false);
    expect(gap.coverage?.pricedCells).toBe(2);
    expect(gap.issues[0]?.message).toContain('2036-03-01');
  });
  it('reports unsupported horizons and absent active plans without inventing coverage', () => {
    const f = facts();
    f.plans = [];
    expect(pricingHealth(f, types, '2035-03-01', 30)).toMatchObject({
      readiness: { t: false },
      issues: [{ code: 'PRICING_NO_ACTIVE_PLAN' }],
    });
    expect(pricingHealth(f, types, '9999-12-29', 365).coverage).toBeNull();
  });
  it('does not count drafts, unpublished room types or unbounded dates as fully verified', () => {
    const f = facts();
    f.plans[0]!.lifecycle = 'Draft';
    f.base = [
      {
        id: 'b',
        ratePlanId: 'p',
        roomTypeId: 't',
        startsOn: null,
        endsOn: null,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        amount: '100.00',
        version: 1,
        createdAt: '',
      },
    ];
    const draft = pricingHealth(f, types, '2035-03-01', null);
    expect(draft.readiness.t).toBe(false);
    expect(draft.coverage).toMatchObject({
      horizonComplete: false,
      totalCells: 0,
      percentage: null,
    });
    f.plans[0]!.lifecycle = 'Active';
    expect(
      pricingHealth(f, [{ ...types[0]!, status: 'DRAFT' }], '2035-03-01', 30).coverage?.totalCells,
    ).toBe(0);
    expect(
      pricingHealth(f, [{ ...types[0]!, status: 'DRAFT' }], '2035-03-01', 30).readiness.t,
    ).toBe(true);
  });
});
