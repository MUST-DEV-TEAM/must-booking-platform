import { describe, expect, it, vi } from 'vitest';

import { PaymentRefundService } from './payment-refund.service';

const context = { tenantId: 't', propertyId: 'p' };
const charge = {
  provider: 'pokpay',
  externalPaymentId: 'order-1',
  amount: '250.00',
  currency: 'EUR',
};
const command = { amount: { amount: '150.00', currency: 'EUR' }, idempotencyKey: 'k1' };

function setup(providerStatus: string | null, refundedSoFar: string) {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ amount: refundedSoFar }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const audit = { recordInTransaction: vi.fn() };
  const review = { recordInTransaction: vi.fn() };
  const refund = vi.fn();
  const provider = {
    refund,
    getPayment: async () =>
      providerStatus
        ? { id: 'order-1', status: providerStatus, amount: { amount: '250.00', currency: 'EUR' } }
        : null,
  };
  const service = new PaymentRefundService(
    {} as never,
    audit as never,
    { forProvider: () => provider } as never,
    {} as never,
    { recordInTransaction: vi.fn() } as never,
    {} as never,
    review as never,
  );
  return { service, tx, audit, review, refund };
}

describe('a refund the provider has already made', () => {
  it('brings the ledger in line, flags it, and sends nothing to the provider', async () => {
    const { service, tx, audit, review, refund } = setup('REFUNDED', '100.00');
    const outcome = await service.refundCharge(tx as never, context, 'b1', charge, command);
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { code: 'REFUND_ALREADY_DONE' },
    });
    expect((outcome.result as { error: { message: string } }).error.message).toContain(
      '150.00 EUR',
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(audit.recordInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'payment.refund_reconciled' }),
    );
    expect(review.recordInTransaction).toHaveBeenCalledTimes(1);
    expect(refund).not.toHaveBeenCalled();
  });

  it('records nothing when the ledger already agrees, and still sends nothing', async () => {
    const { service, tx, audit, refund } = setup('REFUNDED', '250.00');
    const outcome = await service.refundCharge(tx as never, context, 'b1', charge, command);
    expect(outcome.result).toMatchObject({ ok: false, error: { code: 'REFUND_ALREADY_DONE' } });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(audit.recordInTransaction).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });
});
