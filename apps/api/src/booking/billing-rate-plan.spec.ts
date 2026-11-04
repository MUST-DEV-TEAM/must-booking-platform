import { describe, expect, it, vi } from 'vitest';
import { resolveBillingRatePlan } from './billing-rate-plan';

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const planId = '33333333-3333-4333-8333-333333333333';
const allPlanId = '44444444-4444-4444-8444-444444444444';

function tx(rows: Array<unknown[]>) {
  const queryRaw = vi.fn();
  for (const r of rows) queryRaw.mockResolvedValueOnce(r);
  return { $queryRaw: queryRaw, $executeRaw: vi.fn().mockResolvedValue(1) } as never;
}

describe('resolveBillingRatePlan', () => {
  it('keeps the chosen plan when the currency matches', async () => {
    const result = await resolveBillingRatePlan(
      tx([[{ id: planId, currency: 'EUR', isClockPlan: true }]]),
      scope,
      planId,
      'EUR',
    );
    expect(result).toEqual({ ok: true, ratePlanId: planId });
  });

  it('books a Clock rate in the currency Clock quoted', async () => {
    const result = await resolveBillingRatePlan(
      tx([[{ id: planId, currency: 'EUR', isClockPlan: true }], [{ id: allPlanId }]]),
      scope,
      planId,
      'ALL',
    );
    expect(result).toEqual({ ok: true, ratePlanId: allPlanId });
  });

  it("creates the currency plan when it doesn't exist yet", async () => {
    const client = tx([[{ id: planId, currency: 'EUR', isClockPlan: true }], []]);
    const result = await resolveBillingRatePlan(client, scope, planId, 'ALL');
    expect(result.ok).toBe(true);
    expect((client as unknown as { $executeRaw: unknown }).$executeRaw).toHaveBeenCalledOnce();
  });

  it("still rejects a mismatch on the hotel's own (non-Clock) plan", async () => {
    const result = await resolveBillingRatePlan(
      tx([[{ id: planId, currency: 'EUR', isClockPlan: false }]]),
      scope,
      planId,
      'ALL',
    );
    expect(result).toEqual({ ok: false, reason: 'CURRENCY_MISMATCH' });
  });

  it('reports a missing or inactive plan', async () => {
    const result = await resolveBillingRatePlan(tx([[]]), scope, planId, 'EUR');
    expect(result).toEqual({ ok: false, reason: 'RATE_PLAN_NOT_FOUND' });
  });
});
