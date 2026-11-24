import { describe, expect, it } from 'vitest';
import { requestCheckoutMinutes } from './payment-collection.service';

const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 12, minutes, 0));
const now = at(0).getTime();

describe('requestCheckoutMinutes', () => {
  it('opens a Stripe page for its 31-minute minimum even in the last half hour', () => {
    expect(requestCheckoutMinutes('stripe', at(10), now)).toBe(31);
    expect(requestCheckoutMinutes('stripe', at(120), now)).toBe(31);
  });
  it('keeps a PokPay page inside the deadline', () => {
    expect(requestCheckoutMinutes('pokpay', at(10), now)).toBe(9);
    expect(requestCheckoutMinutes('pokpay', at(120), now)).toBe(31);
  });
  it('refuses only when the deadline is about to pass', () => {
    expect(requestCheckoutMinutes('stripe', at(1), now)).toBeNull();
    expect(requestCheckoutMinutes('pokpay', at(-5), now)).toBeNull();
    expect(requestCheckoutMinutes('pokpay', at(2), now)).toBe(1);
  });
});
