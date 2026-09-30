import { describe, expect, it, vi } from 'vitest';

import { PokPayPaymentProvider } from './pokpay-payment.provider';

const context = { tenantId: 'tenant-1', propertyId: 'property-1' };

// Live PokPay staging 2026-09-30: a 250 EUR order reports refundableAmount in Lek
// (22750 before any refund), and refundAmount is read in Lek.
function providerWith(orders: Array<Record<string, unknown>>) {
  const provider = new PokPayPaymentProvider({} as never);
  vi.spyOn(provider as never, 'configuration' as never).mockResolvedValue({
    ok: true,
    value: { merchantId: 'merchant-1' },
  } as never);
  const sent: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const reads = [...orders];
  vi.spyOn(provider as never, 'authenticatedRequest' as never).mockImplementation((async (
    _configuration: unknown,
    request: { method: string; path: string; body?: Record<string, unknown> },
  ) => {
    sent.push(request);
    if (request.method === 'POST')
      return { ok: true, value: { data: { sdkOrder: { id: 'order-1', transactionId: 'tx-1' } } } };
    return { ok: true, value: { data: { sdkOrder: reads.shift() } } };
  }) as never);
  return { provider, sent };
}

const order = (over: Record<string, unknown>) => ({
  id: 'order-1',
  amount: 250,
  finalAmount: 250,
  currencyCode: 'EUR',
  ...over,
});

describe('PokPayPaymentProvider.refund currency handling', () => {
  it('converts a EUR refund into the Lek PokPay expects and verifies the order afterwards', async () => {
    const { provider, sent } = providerWith([
      order({ refundableAmount: 22750 }),
      order({ refundableAmount: 13650 }),
    ]);

    const result = await provider.refund(context, {
      idempotencyKey: 'k',
      paymentId: 'order-1',
      amount: { amount: '100.00', currency: 'EUR' },
      alreadyRefunded: { amount: '0.00', currency: 'EUR' },
    });

    expect(result.ok).toBe(true);
    expect(sent.find((call) => call.method === 'POST')?.body?.refundAmount).toBe(9100);
  });

  it('keeps the same rate for a second partial refund using the recorded prior refunds', async () => {
    const { provider, sent } = providerWith([
      order({ refundableAmount: 13650 }),
      order({ refundableAmount: 9100 }),
    ]);

    const result = await provider.refund(context, {
      idempotencyKey: 'k',
      paymentId: 'order-1',
      amount: { amount: '50.00', currency: 'EUR' },
      alreadyRefunded: { amount: '100.00', currency: 'EUR' },
    });

    expect(result.ok).toBe(true);
    expect(sent.find((call) => call.method === 'POST')?.body?.refundAmount).toBe(4550);
  });

  it('sends an ALL order refund one-to-one', async () => {
    const { provider, sent } = providerWith([
      order({ amount: 5000, finalAmount: 5000, currencyCode: 'ALL', refundableAmount: 5000 }),
      order({ currencyCode: 'ALL', refundableAmount: 3800 }),
    ]);

    const result = await provider.refund(context, {
      idempotencyKey: 'k',
      paymentId: 'order-1',
      amount: { amount: '1200.00', currency: 'ALL' },
      alreadyRefunded: { amount: '0.00', currency: 'ALL' },
    });

    expect(result.ok).toBe(true);
    expect(sent.find((call) => call.method === 'POST')?.body?.refundAmount).toBe(1200);
  });

  it('refuses a refund in a different currency than the order was paid in', async () => {
    const { provider, sent } = providerWith([order({ refundableAmount: 22750 })]);

    const result = await provider.refund(context, {
      idempotencyKey: 'k',
      paymentId: 'order-1',
      amount: { amount: '100.00', currency: 'USD' },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'POKPAY_REFUND_CURRENCY_MISMATCH' } });
    expect(sent.some((call) => call.method === 'POST')).toBe(false);
  });

  it('refuses to exceed what is still refundable', async () => {
    const { provider, sent } = providerWith([order({ refundableAmount: 13650 })]);

    const result = await provider.refund(context, {
      idempotencyKey: 'k',
      paymentId: 'order-1',
      amount: { amount: '200.00', currency: 'EUR' },
      alreadyRefunded: { amount: '100.00', currency: 'EUR' },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_REFUND_AMOUNT' } });
    expect(sent.some((call) => call.method === 'POST')).toBe(false);
  });

  it('reports failure instead of success when PokPay moved a different amount than asked', async () => {
    const { provider } = providerWith([
      order({ refundableAmount: 22750 }),
      order({ refundableAmount: 22650 }),
    ]);

    const result = await provider.refund(context, {
      idempotencyKey: 'k',
      paymentId: 'order-1',
      amount: { amount: '100.00', currency: 'EUR' },
      alreadyRefunded: { amount: '0.00', currency: 'EUR' },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'POKPAY_REFUND_AMOUNT_MISMATCH' } });
  });
});
