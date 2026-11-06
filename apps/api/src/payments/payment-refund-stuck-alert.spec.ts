import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService, type StuckRefundOperation } from './payment-refund.service';

const operation: StuckRefundOperation = {
  tenantId: 't',
  propertyId: 'p',
  bookingId: 'b1',
  operationId: 'op-1',
  idempotencyKey: 'gateway-refund:manual-refund:k',
  stage: 'PREPARING',
  chargeExternalPaymentId: 'order-1',
  amount: '21560.00',
  currency: 'ALL',
  ageMinutes: 14,
};

function setup(firstTimeAlert: boolean) {
  const tx = {
    $queryRaw: vi.fn(async () => (firstTimeAlert ? [{ id: 'op-1' }] : [])),
    $executeRaw: vi.fn(),
  };
  const review = { recordInTransaction: vi.fn() };
  const inApp = { recordInTransaction: vi.fn() };
  const service = new PaymentRefundService(
    {
      withTenantTransaction: async (_c: unknown, op: (t: typeof tx) => Promise<unknown>) => op(tx),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    inApp as never,
    {} as never,
    review as never,
  );
  return { service, tx, review, inApp };
}

describe('alerting about a refund that stays stuck', () => {
  it('raises one review item and one staff notification, in plain words, the first time', async () => {
    const { service, review, inApp } = setup(true);
    await expect(service.raiseStuckRefundAlert(operation)).resolves.toBe(true);
    expect(review.recordInTransaction).toHaveBeenCalledTimes(1);
    const item = review.recordInTransaction.mock.calls[0]?.[1];
    expect(item).toMatchObject({
      tenantId: 't',
      propertyId: 'p',
      category: 'PAYMENT_BOOKING_MISMATCH',
      referenceType: 'booking',
      referenceId: 'b1',
    });
    expect(item.message).toContain('21560.00 ALL');
    expect(item.message).toContain('14 minutes');
    expect(inApp.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(inApp.recordInTransaction.mock.calls[0]?.[1]).toMatchObject({
      tenantId: 't',
      propertyId: 'p',
      type: 'BOOKING_NEEDS_ATTENTION',
      payload: { bookingId: 'b1', reason: 'refund_stuck' },
    });
  });

  it('raises nothing when this attempt was already alerted on an earlier run', async () => {
    const { service, review, inApp } = setup(false);
    await expect(service.raiseStuckRefundAlert(operation)).resolves.toBe(false);
    expect(review.recordInTransaction).not.toHaveBeenCalled();
    expect(inApp.recordInTransaction).not.toHaveBeenCalled();
  });
});
