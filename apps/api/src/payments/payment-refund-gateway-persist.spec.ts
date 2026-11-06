import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const reportOperationalFailure = vi.hoisted(() => vi.fn());
vi.mock('../observability/error-tracking', () => ({ reportOperationalFailure }));

const context = { tenantId: 't', propertyId: 'p' };
const charge = { provider: 'pokpay', externalPaymentId: 'order-1' };
const command = {
  amount: { amount: '21560.00', currency: 'ALL' },
  idempotencyKey: 'k1',
  alreadyRefunded: { amount: '0.00', currency: 'ALL' },
};
const refundResult = {
  ok: true as const,
  value: { id: 'order-1:refund:k1', status: 'REFUNDED', amount: command.amount, bookingId: 'b' },
};
const poolTimeout = Object.assign(
  new Error('Transaction API error: Unable to start a transaction in the given time.'),
  { code: 'P2028' },
);

/** First call prepares the attempt; every later call is the "save the provider's answer" write. */
function setup(writeOutcomes: Array<'ok' | 'fail'>) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const outcomes = [...writeOutcomes];
  const withTenantTransaction = vi.fn(
    async (_ctx: unknown, op: (t: typeof tx) => Promise<unknown>, _options?: unknown) => {
      if (withTenantTransaction.mock.calls.length === 1) return op(tx);
      if (outcomes.shift() === 'fail') throw poolTimeout;
      return op(tx);
    },
  );
  const provider = { refund: vi.fn().mockResolvedValue(refundResult) };
  const service = new PaymentRefundService(
    { withTenantTransaction } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const run = () =>
    (
      service as unknown as {
        gatewayRefund: (...args: unknown[]) => Promise<unknown>;
      }
    ).gatewayRefund(context, 'b', charge, command, provider);
  return { run, withTenantTransaction, provider, tx };
}

beforeEach(() => {
  vi.useFakeTimers();
  reportOperationalFailure.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('saving the provider answer after a refund was sent', () => {
  it('retries the write after a pool timeout and records the answer', async () => {
    const { run, withTenantTransaction } = setup(['fail', 'ok']);
    const pending = run();
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(refundResult);
    expect(withTenantTransaction).toHaveBeenCalledTimes(3);
    expect(reportOperationalFailure).not.toHaveBeenCalled();
  });

  it('waits up to 15 seconds for a free connection on both transactions', async () => {
    const { run, withTenantTransaction } = setup(['ok']);
    const pending = run();
    await vi.runAllTimersAsync();
    await pending;
    for (const call of withTenantTransaction.mock.calls)
      expect(call[2]).toMatchObject({ maxWaitMs: 15_000 });
  });

  it('still returns the refund and reports it when all 5 writes fail, never sending a second refund', async () => {
    const { run, provider } = setup(['fail', 'fail', 'fail', 'fail', 'fail']);
    const pending = run();
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual(refundResult);
    expect(provider.refund).toHaveBeenCalledTimes(1);
    expect(reportOperationalFailure).toHaveBeenCalledTimes(1);
  });
});
