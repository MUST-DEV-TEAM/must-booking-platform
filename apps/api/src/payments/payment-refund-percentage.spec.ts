import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
};
const bookingId = '33333333-3333-4333-8333-333333333333';

// A 250.00 charge with `alreadyRefunded` already refunded; returns what the provider was asked to refund.
async function refundRequested(
  alreadyRefunded: string,
  request: { percentage?: number; amount?: { amount: string; currency: string } },
) {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ requestHash: 'request-hash' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'charge-row',
          provider: 'pokpay',
          externalPaymentId: 'order-1',
          amount: '250.00',
          currency: 'EUR',
          status: 'PAID',
        },
      ])
      // manualRefund reads the prior refunds, then refundCharge reads them again for the provider
      .mockResolvedValueOnce([{ amount: alreadyRefunded }])
      .mockResolvedValueOnce([{ amount: alreadyRefunded }])
      .mockResolvedValueOnce([{ id: 'refund-row' }])
      .mockResolvedValueOnce([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const refund = vi.fn().mockImplementation(async (_context, command) => ({
    ok: true,
    value: { id: 'refund-1', bookingId, amount: command.amount, status: 'REFUNDED' },
  }));
  const service = new PaymentRefundService(
    { withTenantTransaction: vi.fn(async (_context, execute) => execute(tx)) } as never,
    { recordInTransaction: vi.fn().mockResolvedValue(undefined) } as never,
    { forProvider: vi.fn().mockReturnValue({ refund }) } as never,
    { sendRefundConfirmationEmailSafely: vi.fn().mockResolvedValue(undefined) } as never,
    { recordInTransaction: vi.fn().mockResolvedValue(undefined) } as never,
    { postRefund: vi.fn().mockResolvedValue({ ok: true, value: undefined }) } as never,
    { recordInTransaction: vi.fn().mockResolvedValue(undefined) } as never,
  );

  const result = await service.manualRefund(context, {
    bookingId,
    idempotencyKey: 'key',
    actorUserId: '44444444-4444-4444-8444-444444444444',
    ...request,
  });
  return { result, requested: refund.mock.calls[0]?.[1]?.amount?.amount as string | undefined };
}

describe('manual percentage refunds apply to what is still refundable', () => {
  it('takes 50% of the 200.00 left after a 50.00 refund of 250.00, which is 100.00', async () => {
    const { result, requested } = await refundRequested('50.00', { percentage: 50 });

    expect(result).toMatchObject({ ok: true });
    expect(requested).toBe('100.00');
  });

  it('takes 50% of the whole charge when nothing has been refunded yet', async () => {
    const { requested } = await refundRequested('0.00', { percentage: 50 });

    expect(requested).toBe('125.00');
  });

  it('refunds exactly what is left at 100%', async () => {
    const { requested } = await refundRequested('50.00', { percentage: 100 });

    expect(requested).toBe('200.00');
  });

  it('leaves a fixed amount alone: it is taken as typed, up to what is left', async () => {
    const typed = await refundRequested('50.00', { amount: { amount: '30.00', currency: 'EUR' } });
    const tooMuch = await refundRequested('50.00', {
      amount: { amount: '999.00', currency: 'EUR' },
    });

    expect(typed.requested).toBe('30.00');
    expect(tooMuch.requested).toBe('200.00');
  });
});
