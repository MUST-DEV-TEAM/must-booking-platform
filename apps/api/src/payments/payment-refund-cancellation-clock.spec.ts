import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const context = { tenantId: 't', propertyId: 'p' };
const money = { amount: '100.00', currency: 'EUR' };
const charge = {
  id: 'c1',
  provider: 'pokpay',
  externalPaymentId: 'order-1',
  amount: '100.00',
  currency: 'EUR',
  status: 'PAID',
};

function setup(options: { clockRefund?: boolean; refundOk?: boolean; clockThrows?: boolean } = {}) {
  const { clockRefund = true, refundOk = true, clockThrows = false } = options;
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([charge])
      .mockResolvedValue([{ amount: '0' }]),
    $executeRaw: vi.fn(),
  };
  const clockBooking = {
    postRefund: vi.fn(async () => {
      if (clockThrows) throw new Error('Clock down');
      return { ok: true, value: undefined };
    }),
  };
  const review = { recordInTransaction: vi.fn() };
  const service = new PaymentRefundService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    clockBooking as never,
    review as never,
  );
  vi.spyOn(service, 'refundCharge').mockResolvedValue(
    (refundOk
      ? {
          result: {
            ok: true,
            value: { id: 'order-1:refund:k1', status: 'REFUNDED', amount: money },
          },
          confirmation: null,
          clockRefund: clockRefund ? { amount: money, refundId: 'order-1:refund:k1' } : null,
        }
      : {
          result: { ok: false, error: { code: 'X', message: 'failed', retryable: false } },
          confirmation: null,
          clockRefund: null,
        }) as never,
  );
  return { service, tx, clockBooking, review };
}

const variants = {
  'automatic full refund': (s: PaymentRefundService, tx: unknown) =>
    s.refundPaidChargeForBooking(tx as never, context, 'b1', 'cancellation-refund:k1'),
  'partial refund of a multi-room order': (s: PaymentRefundService, tx: unknown) =>
    s.refundPaidChargeForBookingAmount(tx as never, context, 'b1', money, 'cancellation-refund:k1'),
};

describe.each(Object.entries(variants))('cancellation %s and Clock', (_name, run) => {
  it('posts the refund to Clock, with the same reference a staff refund uses', async () => {
    const { service, tx, clockBooking } = setup();
    const outcome = await run(service, tx);
    expect(outcome.result.ok).toBe(true);
    expect(clockBooking.postRefund).toHaveBeenCalledWith(
      tx,
      context,
      'b1',
      money,
      'must-refund:order-1:refund:k1',
    );
  });

  it('does not post again when the refund was already recorded', async () => {
    const { service, tx, clockBooking } = setup({ clockRefund: false });
    await run(service, tx);
    expect(clockBooking.postRefund).not.toHaveBeenCalled();
  });

  it('does not post when the refund failed', async () => {
    const { service, tx, clockBooking } = setup({ refundOk: false });
    const outcome = await run(service, tx);
    expect(outcome.result.ok).toBe(false);
    expect(clockBooking.postRefund).not.toHaveBeenCalled();
  });

  it('keeps the refund and asks a person to look when Clock cannot be reached', async () => {
    const { service, tx, review } = setup({ clockThrows: true });
    const outcome = await run(service, tx);
    expect(outcome.result.ok).toBe(true);
    expect(review.recordInTransaction).toHaveBeenCalledTimes(1);
  });
});
