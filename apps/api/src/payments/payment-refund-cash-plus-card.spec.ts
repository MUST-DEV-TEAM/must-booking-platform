import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const bookingId = '33333333-3333-4333-8333-333333333333';
const actorUserId = '44444444-4444-4444-8444-444444444444';
const card = {
  id: 'c1',
  provider: 'pokpay',
  externalPaymentId: 'order-1',
  amount: '140.00',
  currency: 'EUR',
  status: 'PAID',
};
const cash = { provider: 'manual', currency: 'EUR' };

/** Runs `cancellationRefund` for 240.00 against a booking whose charges and earlier refunds are given. */
async function run(options: {
  charges: Array<{ provider: string; currency: string }>;
  onlineCharge?: typeof card | null;
  prior?: unknown;
  onlineRefunded?: string;
  amount?: string;
}) {
  const queries = [
    options.charges,
    options.onlineCharge === null ? [] : [options.onlineCharge ?? card],
    options.prior === undefined ? [] : [{ result: options.prior }],
    [{ amount: options.onlineRefunded ?? '0.00' }],
  ];
  const tx = { $queryRaw: vi.fn() };
  for (const rows of queries) tx.$queryRaw.mockResolvedValueOnce(rows);
  const service = new PaymentRefundService(
    { withTenantTransaction: vi.fn(async (_context, execute) => execute(tx)) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const manualRefund = vi.spyOn(service, 'manualRefund').mockResolvedValue({
    ok: true,
    value: { id: 'r', bookingId, amount: { amount: '0', currency: 'EUR' }, status: 'REFUNDED' },
  } as never);
  const answer = await service.cancellationRefund(context, {
    bookingId,
    idempotencyKey: 'key:refund',
    amount: { amount: options.amount ?? '240.00', currency: 'EUR' },
    actorUserId,
    note: 'Cancellation',
  });
  return { answer, manualRefund };
}

describe('a cancellation refund for a booking paid by card and in person (D5)', () => {
  it('refunds the card part online and names the in-person part to return by hand', async () => {
    const { answer, manualRefund } = await run({ charges: [card, cash] });

    expect(manualRefund).toHaveBeenCalledTimes(1);
    expect(manualRefund.mock.calls[0]![1]).toMatchObject({
      amount: { amount: '140.00', currency: 'EUR' },
      onlineChargeOnly: true,
    });
    expect(answer.returnByHand).toEqual({ amount: '100.00', currency: 'EUR' });
  });

  it('refunds only what the card still has when part of it was refunded earlier', async () => {
    const { answer, manualRefund } = await run({ charges: [card, cash], onlineRefunded: '40.00' });

    expect(manualRefund.mock.calls[0]![1]).toMatchObject({
      amount: { amount: '100.00', currency: 'EUR' },
    });
    expect(answer.returnByHand).toEqual({ amount: '140.00', currency: 'EUR' });
  });

  it('sends nothing to the gateway when the card is already fully refunded', async () => {
    const { answer, manualRefund } = await run({ charges: [card, cash], onlineRefunded: '140.00' });

    expect(manualRefund).not.toHaveBeenCalled();
    expect(answer).toEqual({ refund: null, returnByHand: { amount: '240.00', currency: 'EUR' } });
  });

  it('repeats the amount of the first attempt, so the gateway is never asked for a different sum', async () => {
    const prior = { ok: true, value: { amount: { amount: '140.00', currency: 'EUR' } } };
    const { answer, manualRefund } = await run({
      charges: [card, cash],
      prior,
      onlineRefunded: '140.00',
    });

    expect(manualRefund.mock.calls[0]![1]).toMatchObject({
      amount: { amount: '140.00', currency: 'EUR' },
      onlineChargeOnly: true,
    });
    expect(answer.returnByHand).toEqual({ amount: '100.00', currency: 'EUR' });
  });

  it('leaves a booking paid one way exactly as before: the whole amount, no return by hand', async () => {
    const { answer, manualRefund } = await run({ charges: [card], amount: '140.00' });

    expect(manualRefund.mock.calls[0]![1]).not.toHaveProperty('onlineChargeOnly');
    expect(manualRefund.mock.calls[0]![1]).toMatchObject({
      amount: { amount: '140.00', currency: 'EUR' },
    });
    expect(answer.returnByHand).toBeNull();
  });
});
