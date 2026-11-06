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
  ageMinutes: 12,
};

type Options = {
  providerStatus?: string | 'throws' | null;
  /** What the ledger already holds as REFUND rows, in the charge's currency. */
  refundedSoFar?: string;
  charges?: Array<Record<string, unknown>>;
  clockPost?: 'ok' | 'throws';
  latestRefundId?: string | null;
};

function setup(options: Options = {}) {
  const {
    providerStatus = 'REFUNDED',
    refundedSoFar = '0.00',
    clockPost = 'ok',
    latestRefundId = 'order-1:refund:earlier',
  } = options;
  const charges = options.charges ?? [
    {
      id: 'c1',
      provider: 'pokpay',
      externalPaymentId: 'order-1',
      amount: '21560.00',
      currency: 'ALL',
      status: 'PAID',
    },
  ];
  const statements: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      statements.push(strings.join('?'));
      return 1;
    }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      statements.push(sql);
      if (sql.includes("kind = 'CHARGE'")) return charges;
      if (sql.includes('SUM(amount)')) return [{ amount: refundedSoFar }];
      if (sql.includes('ORDER BY created_at DESC LIMIT 1'))
        return latestRefundId ? [{ id: latestRefundId }] : [];
      return [];
    }),
  };
  const withTenantTransaction = vi.fn(
    async (_ctx: unknown, op: (t: typeof tx) => Promise<unknown>, _opts?: unknown) => op(tx),
  );
  const provider = {
    refund: vi.fn(),
    getPayment: vi.fn(async () => {
      if (providerStatus === 'throws') throw new Error('PokPay down');
      return providerStatus
        ? { id: 'order-1', status: providerStatus, amount: { amount: '21560.00', currency: 'ALL' } }
        : null;
    }),
  };
  const audit = { recordInTransaction: vi.fn() };
  const review = { recordInTransaction: vi.fn() };
  const clockBooking = {
    postRefund: vi.fn(async () => {
      if (clockPost === 'throws') throw new Error('Clock unreachable');
      return { ok: true, value: undefined };
    }),
  };
  const service = new PaymentRefundService(
    { withTenantTransaction } as never,
    audit as never,
    { forProvider: () => provider } as never,
    {} as never,
    { recordInTransaction: vi.fn() } as never,
    clockBooking as never,
    review as never,
  );
  return { service, tx, provider, audit, review, clockBooking, statements, withTenantTransaction };
}

const operationWasClosed = (tx: { $executeRaw: ReturnType<typeof vi.fn> }) =>
  tx.$executeRaw.mock.calls.some(([strings]) =>
    (strings as TemplateStringsArray).join('?').includes('UPDATE integration_operations'),
  );
const refundRowWasInserted = (tx: { $executeRaw: ReturnType<typeof vi.fn> }) =>
  tx.$executeRaw.mock.calls.some(([strings]) =>
    (strings as TemplateStringsArray).join('?').includes('INSERT INTO payments'),
  );

describe('recovering a refund the provider paid but the system never recorded', () => {
  it('records the REFUND row, tells Clock, and closes the attempt when the provider shows it refunded', async () => {
    const { service, tx, clockBooking, provider } = setup();
    await expect(service.recoverStuckRefund(operation)).resolves.toBe('RECOVERED');
    expect(refundRowWasInserted(tx)).toBe(true);
    expect(clockBooking.postRefund).toHaveBeenCalledWith(
      tx,
      { tenantId: 't', propertyId: 'p' },
      'b1',
      { amount: '21560.00', currency: 'ALL' },
      'must-refund:order-1:refund:reconciled',
    );
    expect(operationWasClosed(tx)).toBe(true);
    expect(provider.refund).not.toHaveBeenCalled();
  });

  it('takes the per-booking refund lock before it reads anything', async () => {
    const { service, statements } = setup();
    await service.recoverStuckRefund(operation);
    expect(statements[0]).toContain('pg_advisory_xact_lock');
  });

  it('only closes the attempt when the ledger already holds the full refund, with no new row and no Clock post', async () => {
    const { service, tx, clockBooking } = setup({ refundedSoFar: '21560.00' });
    await expect(service.recoverStuckRefund(operation)).resolves.toBe('NOTHING_TO_DO');
    expect(refundRowWasInserted(tx)).toBe(false);
    expect(clockBooking.postRefund).not.toHaveBeenCalled();
    expect(operationWasClosed(tx)).toBe(true);
  });

  it('changes nothing and asks for a person when the provider does not show a full refund', async () => {
    const { service, tx, clockBooking } = setup({ providerStatus: 'PARTIALLY_REFUNDED' });
    await expect(service.recoverStuckRefund(operation)).resolves.toBe('NEEDS_PERSON');
    expect(refundRowWasInserted(tx)).toBe(false);
    expect(operationWasClosed(tx)).toBe(false);
    expect(clockBooking.postRefund).not.toHaveBeenCalled();
  });

  it('changes nothing and asks for a person when the provider cannot be read', async () => {
    const { service, tx } = setup({ providerStatus: 'throws' });
    await expect(service.recoverStuckRefund(operation)).resolves.toBe('NEEDS_PERSON');
    expect(refundRowWasInserted(tx)).toBe(false);
    expect(operationWasClosed(tx)).toBe(false);
  });

  it('asks for a person when there is no single charge to match', async () => {
    const none = setup({ charges: [] });
    await expect(none.service.recoverStuckRefund(operation)).resolves.toBe('NEEDS_PERSON');
    const charge = {
      id: 'c',
      provider: 'pokpay',
      externalPaymentId: 'order-1',
      amount: '10.00',
      currency: 'ALL',
      status: 'PAID',
    };
    const several = setup({ charges: [charge, { ...charge, id: 'c2', externalPaymentId: 'o2' }] });
    await expect(several.service.recoverStuckRefund(operation)).resolves.toBe('NEEDS_PERSON');
  });

  it('keeps the ledger row and still closes the attempt when Clock cannot be told', async () => {
    const { service, tx, review } = setup({ clockPost: 'throws' });
    await expect(service.recoverStuckRefund(operation)).resolves.toBe('RECOVERED');
    expect(refundRowWasInserted(tx)).toBe(true);
    expect(operationWasClosed(tx)).toBe(true);
    expect(review.recordInTransaction).toHaveBeenCalled();
  });

  it('waits up to 15 seconds for a connection and allows time for the provider and Clock', async () => {
    const { service, withTenantTransaction } = setup();
    await service.recoverStuckRefund(operation);
    expect(withTenantTransaction.mock.calls[0]?.[2]).toMatchObject({
      maxWaitMs: 15_000,
      timeoutMs: 90_000,
    });
  });
});
