import { describe, expect, it, vi } from 'vitest';

import type { StuckRefundOperation } from './payment-refund.service';
import { PaymentRefundRecoveryService } from './payment-refund-recovery.service';

const row = (id: string, ageMinutes = 12): StuckRefundOperation => ({
  tenantId: 't',
  propertyId: 'p',
  bookingId: `b-${id}`,
  operationId: id,
  idempotencyKey: `gateway-refund:${id}`,
  stage: 'PREPARING',
  chargeExternalPaymentId: 'order',
  amount: '10.00',
  currency: 'ALL',
  ageMinutes,
});

function setup(
  rows: StuckRefundOperation[],
  outcomes: Record<string, 'RECOVERED' | 'NOTHING_TO_DO' | 'NEEDS_PERSON' | 'throws'>,
) {
  const database = { $queryRaw: vi.fn().mockResolvedValue(rows) };
  const refunds = {
    raiseStuckRefundAlert: vi.fn<(operation: StuckRefundOperation) => Promise<boolean>>(
      async () => true,
    ),
    recoverStuckRefund: vi.fn(async (operation: StuckRefundOperation) => {
      const outcome = outcomes[operation.operationId] ?? 'RECOVERED';
      if (outcome === 'throws') throw new Error('database busy');
      return outcome;
    }),
  };
  const service = new PaymentRefundRecoveryService(database as never, refunds as never);
  return { service, database, refunds };
}

describe('the refund recovery sweep', () => {
  it('can be created and run without a Redis connection', async () => {
    const { service } = setup([], {});
    await expect(service.run()).resolves.toMatchObject({ found: 0 });
  });

  it('asks only for attempts older than 5 minutes, at most 50 per run', async () => {
    const { service, database } = setup([], {});
    await service.run();
    const call = database.$queryRaw.mock.calls[0] ?? [];
    expect(call.slice(1)).toEqual([5, 50]);
  });

  it('recovers each stuck attempt and counts the outcomes', async () => {
    const { service, refunds } = setup([row('a'), row('b'), row('c')], {
      a: 'RECOVERED',
      b: 'NOTHING_TO_DO',
      c: 'NEEDS_PERSON',
    });
    await expect(service.run()).resolves.toEqual({
      found: 3,
      recovered: 1,
      nothingToDo: 1,
      needsPerson: 1,
      errors: 0,
    });
    expect(refunds.recoverStuckRefund).toHaveBeenCalledTimes(3);
  });

  it('keeps going and counts an error when one attempt throws', async () => {
    const { service, refunds } = setup([row('a'), row('b')], { a: 'throws', b: 'RECOVERED' });
    await expect(service.run()).resolves.toMatchObject({ recovered: 1, errors: 1, found: 2 });
    expect(refunds.recoverStuckRefund).toHaveBeenCalledTimes(2);
  });

  it('alerts for an attempt a person must handle once it is 10 minutes old, and not before', async () => {
    const { service, refunds } = setup([row('old', 12), row('young', 7), row('fixed', 30)], {
      old: 'NEEDS_PERSON',
      young: 'NEEDS_PERSON',
      fixed: 'RECOVERED',
    });
    await service.run();
    expect(refunds.raiseStuckRefundAlert).toHaveBeenCalledTimes(1);
    expect(refunds.raiseStuckRefundAlert.mock.calls[0]?.[0]).toMatchObject({ operationId: 'old' });
  });

  it('still counts the attempt and keeps going when raising the alert fails', async () => {
    const { service, refunds } = setup([row('a', 20), row('b', 20)], {
      a: 'NEEDS_PERSON',
      b: 'NEEDS_PERSON',
    });
    refunds.raiseStuckRefundAlert.mockRejectedValueOnce(new Error('database busy'));
    await expect(service.run()).resolves.toMatchObject({ needsPerson: 2, errors: 1 });
    expect(refunds.raiseStuckRefundAlert).toHaveBeenCalledTimes(2);
  });
});
