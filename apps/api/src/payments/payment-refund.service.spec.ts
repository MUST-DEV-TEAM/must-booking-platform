import { describe, expect, it, vi } from 'vitest';

import { percentageRefundMinorUnits, PaymentRefundService } from './payment-refund.service';

describe('percentage refund calculation', () => {
  it('calculates against the original charge in minor units and rounds to cents', () => {
    expect(percentageRefundMinorUnits('100.00', 25)).toBe(2500n);
    expect(percentageRefundMinorUnits('99.99', 33.33)).toBe(3333n);
    expect(percentageRefundMinorUnits('180.00', 100)).toBe(18000n);
  });

  it('rejects percentages outside the supported range', () => {
    expect(percentageRefundMinorUnits('100.00', 0)).toBeNull();
    expect(percentageRefundMinorUnits('100.00', 100.01)).toBeNull();
  });
});

it('reserves a pending refund without sending a completed receipt or mirroring it into Clock', async () => {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ amount: '0.00' }])
      .mockResolvedValueOnce([{ id: 'pending-row' }]),
    $executeRaw: vi.fn(),
  };
  const audit = { recordInTransaction: vi.fn() },
    review = { recordInTransaction: vi.fn() },
    notify = { recordInTransaction: vi.fn() };
  const service = new PaymentRefundService(
    {} as never,
    audit as never,
    {
      forProvider: () => ({
        refund: async () => ({
          ok: true,
          value: {
            id: 'pending-refund',
            status: 'REFUND_PENDING',
            amount: { amount: '25.00', currency: 'EUR' },
          },
        }),
      }),
    } as never,
    {} as never,
    notify as never,
    {} as never,
    review as never,
  );
  vi.spyOn(
    service as unknown as { gatewayRefund: (...args: unknown[]) => Promise<unknown> },
    'gatewayRefund',
  ).mockResolvedValue({
    ok: true,
    value: {
      id: 'pending-refund',
      status: 'REFUND_PENDING',
      amount: { amount: '25.00', currency: 'EUR' },
    },
  });
  const result = await service.refundCharge(
    tx as never,
    { tenantId: 't', propertyId: 'p' },
    'b',
    { provider: 'pokpay', externalPaymentId: 'order', amount: '100.00', currency: 'EUR' },
    { amount: { amount: '25.00', currency: 'EUR' }, idempotencyKey: 'same-request' },
  );
  expect(result).toMatchObject({
    result: { ok: true, value: { status: 'REFUND_PENDING' } },
    confirmation: null,
    clockRefund: null,
  });
  expect(tx.$queryRaw.mock.calls[1]).toContain('REFUND_PENDING');
  expect(review.recordInTransaction).toHaveBeenCalledOnce();
  expect(notify.recordInTransaction).not.toHaveBeenCalled();
});
it('blocks ambiguous multi-charge refunds before calling a provider', async () => {
  const registry = { forProvider: vi.fn() };
  const service = new PaymentRefundService(
    {} as never,
    {} as never,
    registry as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  expect(
    await service.refundCharge(
      {} as never,
      { tenantId: 't', propertyId: 'p' },
      'b',
      {
        provider: 'pokpay',
        externalPaymentId: 'latest',
        amount: '250.00',
        currency: 'EUR',
        chargeCount: 2,
      },
      { amount: { amount: '500.00', currency: 'EUR' }, idempotencyKey: 'request' },
    ),
  ).toMatchObject({ result: { ok: false, error: { code: 'REFUND_ALLOCATION_REVIEW_REQUIRED' } } });
  expect(registry.forProvider).not.toHaveBeenCalled();
});
