import { describe, expect, it } from 'vitest';

import { connectionMode, isStripeTestKey } from './connection-mode';

describe('Stripe key mode', () => {
  it('treats secret and restricted test keys as TEST', () => {
    expect(connectionMode('STRIPE', { secretKey: 'sk_test_abc' })).toBe('TEST');
    expect(connectionMode('STRIPE', { secretKey: ' rk_test_abc ' })).toBe('TEST');
  });

  it('treats live and unknown keys as LIVE, so play money is never assumed', () => {
    expect(connectionMode('STRIPE', { secretKey: 'sk_live_abc' })).toBe('LIVE');
    expect(connectionMode('STRIPE', { secretKey: 'rk_live_abc' })).toBe('LIVE');
    expect(connectionMode('STRIPE', {})).toBe('LIVE');
    expect(isStripeTestKey(undefined)).toBe(false);
    expect(isStripeTestKey('whsec_test_abc')).toBe(false);
  });
});
