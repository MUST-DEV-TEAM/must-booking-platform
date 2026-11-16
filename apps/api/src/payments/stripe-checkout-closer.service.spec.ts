import { describe, expect, it, vi } from 'vitest';

import { StripeCheckoutCloserService } from './stripe-checkout-closer.service';

const item = (id: string) => ({
  tenantId: '11111111-1111-4111-8111-111111111111',
  propertyId: '22222222-2222-4222-8222-222222222222',
  bookingId: '33333333-3333-4333-8333-333333333333',
  externalPaymentId: id,
});

function build(
  ended: ReturnType<typeof item>[],
  expire: (context: unknown, id: string) => Promise<unknown>,
) {
  const executeRaw = vi.fn(async () => 1);
  const database = {
    $queryRaw: vi.fn(async () => ended),
    withTenantTransaction: vi.fn(async (_context: unknown, run: (tx: unknown) => unknown) =>
      run({ $executeRaw: executeRaw }),
    ),
  };
  const stripe = { expireCheckout: vi.fn(expire) };
  const service = new StripeCheckoutCloserService(database as never, stripe as never);
  return { service, stripe, database, executeRaw };
}

describe('StripeCheckoutCloserService', () => {
  it('closes the Stripe page of each ended booking and marks it closed', async () => {
    const { service, stripe, executeRaw } = build(
      [item('cs_test_1'), item('cs_test_2')],
      async () => ({
        ok: true,
        value: { closed: true },
      }),
    );
    await expect(service.closeEndedCheckouts()).resolves.toEqual({ closed: 2, retry: 0 });
    expect(stripe.expireCheckout).toHaveBeenCalledTimes(2);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it('leaves a session unmarked when Stripe could not be reached, so the next sweep tries again', async () => {
    const { service, executeRaw } = build([item('cs_test_1')], async () => ({
      ok: true,
      value: { closed: false },
    }));
    await expect(service.closeEndedCheckouts()).resolves.toEqual({ closed: 0, retry: 1 });
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('one failing session does not stop the others', async () => {
    let calls = 0;
    const { service } = build([item('cs_test_1'), item('cs_test_2')], async () => {
      calls += 1;
      if (calls === 1) throw new Error('network down');
      return { ok: true, value: { closed: true } };
    });
    await expect(service.closeEndedCheckouts()).resolves.toEqual({ closed: 1, retry: 1 });
  });

  it('stops asking for a hotel that no longer has a Stripe connection', async () => {
    const { service, executeRaw } = build([item('cs_test_1')], async () => ({
      ok: false,
      error: { code: 'STRIPE_NOT_CONFIGURED', message: 'x', retryable: false },
    }));
    await expect(service.closeEndedCheckouts()).resolves.toEqual({ closed: 1, retry: 0 });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});
