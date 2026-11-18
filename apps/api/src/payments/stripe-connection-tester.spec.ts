import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

import { StripeConnectionTester } from './stripe-connection-tester';

const tester = new StripeConnectionTester({ register: vi.fn() } as never);

describe('StripeConnectionTester publishable key', () => {
  it('refuses a publishable key that is not pk_test_ or pk_live_', async () => {
    await expect(
      tester.test({ secretKey: 'rk_test_a', publishableKey: 'sk_test_oops' }),
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining('pk_test_') });
  });

  it('refuses a publishable key of the other mode than the secret key', async () => {
    await expect(
      tester.test({ secretKey: 'rk_test_a', publishableKey: 'pk_live_a' }),
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining('both be test') });
  });

  it('accepts a matching pair once Stripe accepts the secret key', async () => {
    const balance = Object.getPrototypeOf(new Stripe('sk_test_x').balance) as {
      retrieve: () => Promise<Stripe.Balance>;
    };
    vi.spyOn(balance, 'retrieve').mockResolvedValue({} as Stripe.Balance);
    await expect(
      tester.test({ secretKey: 'rk_test_a', publishableKey: 'pk_test_a' }),
    ).resolves.toEqual({ ok: true, message: 'Connected to Stripe successfully.' });
  });
});
