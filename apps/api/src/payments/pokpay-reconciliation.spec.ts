import { describe, expect, it } from 'vitest';

import {
  compareWithProvider,
  type ProviderOrder,
  type RecordedOrder,
} from './pokpay-reconciliation';

const recorded = (extra: Partial<RecordedOrder> = {}): RecordedOrder => ({
  orderId: 'o1',
  chargeStatus: 'PAID',
  chargeAmount: '100.00',
  chargeCurrency: 'EUR',
  refundedAmount: '0',
  refundCurrencies: [],
  refundCount: 0,
  ...extra,
});
const provider = (extra: Partial<ProviderOrder> = {}): ProviderOrder => ({
  status: 'COMPLETED',
  amount: '100.00',
  currency: 'EUR',
  ...extra,
});

describe('comparing our records of a PokPay order with PokPay', () => {
  it('finds nothing when both sides agree', () => {
    expect(compareWithProvider(recorded(), provider())).toBeNull();
    // Still unpaid on both sides.
    expect(
      compareWithProvider(
        recorded({ chargeStatus: null, chargeAmount: null }),
        provider({ status: 'PENDING' }),
      ),
    ).toBeNull();
    // A manual payment is recorded with the status "succeeded".
    expect(compareWithProvider(recorded({ chargeStatus: 'succeeded' }), provider())).toBeNull();
  });

  it('finds a payment PokPay took that we never recorded, such as one made after the hold expired', () => {
    const found = compareWithProvider(
      recorded({ chargeStatus: null, chargeAmount: null, chargeCurrency: null }),
      provider({ amount: '250.00' }),
    );
    expect(found?.kind).toBe('PAID_AT_PROVIDER_ONLY');
    expect(found?.message).toContain('250.00 EUR');
  });

  it('finds a payment we recorded that PokPay does not show as taken', () => {
    expect(compareWithProvider(recorded(), provider({ status: 'CANCELLED' }))?.kind).toBe(
      'PAID_HERE_ONLY',
    );
    expect(compareWithProvider(recorded(), provider({ status: 'PENDING' }))?.message).toContain(
      'pending',
    );
  });

  it('finds a different amount or currency, and ignores a difference below one cent', () => {
    expect(compareWithProvider(recorded(), provider({ amount: '90.00' }))?.kind).toBe(
      'AMOUNT_DIFFERS',
    );
    expect(
      compareWithProvider(recorded(), provider({ currency: 'ALL', amount: '9800.00' }))?.kind,
    ).toBe('AMOUNT_DIFFERS');
    expect(compareWithProvider(recorded(), provider({ amount: '100.004' }))).toBeNull();
  });

  it('finds a refund made at PokPay that we did not record, or recorded only in part', () => {
    expect(compareWithProvider(recorded(), provider({ status: 'REFUNDED' }))?.kind).toBe(
      'REFUNDED_AT_PROVIDER_ONLY',
    );
    const partial = compareWithProvider(
      recorded({ refundedAmount: '40.00', refundCurrencies: ['EUR'], refundCount: 1 }),
      provider({ status: 'REFUNDED' }),
    );
    expect(partial?.kind).toBe('REFUNDED_AT_PROVIDER_ONLY');
    expect(partial?.message).toContain('40.00 EUR of 100.00 EUR');
  });

  it('accepts a full refund recorded in another currency without comparing amounts across currencies', () => {
    expect(
      compareWithProvider(
        recorded({ refundedAmount: '9800.00', refundCurrencies: ['ALL'], refundCount: 1 }),
        provider({ status: 'REFUNDED' }),
      ),
    ).toBeNull();
  });

  it('finds a full refund we recorded that PokPay does not show, but not a partial refund', () => {
    expect(
      compareWithProvider(
        recorded({ refundedAmount: '100.00', refundCurrencies: ['EUR'], refundCount: 1 }),
        provider(),
      )?.kind,
    ).toBe('REFUNDED_HERE_ONLY');
    expect(
      compareWithProvider(
        recorded({ refundedAmount: '30.00', refundCurrencies: ['EUR'], refundCount: 1 }),
        provider(),
      ),
    ).toBeNull();
  });
});
