import { describe, expect, it } from 'vitest';

import {
  acceptedAtHotelLabels,
  acceptedAtHotelSentence,
  orderPaymentMethods,
} from './payment-method-order';

const all = ['stripe', 'pokpay', 'pay_at_hotel'] as const;

describe('orderPaymentMethods (G-51)', () => {
  it('keeps the standard order when the hotel set none', () => {
    expect(orderPaymentMethods(all, [], null)).toEqual({
      methods: ['stripe', 'pokpay', 'pay_at_hotel'],
      defaultMethod: 'stripe',
    });
  });

  it("follows the hotel's order and pre-selects its default", () => {
    expect(orderPaymentMethods(all, ['pay_at_hotel', 'stripe', 'pokpay'], 'stripe')).toEqual({
      methods: ['pay_at_hotel', 'stripe', 'pokpay'],
      defaultMethod: 'stripe',
    });
  });

  it('drops a method that is not offered and falls back when the default is not offered', () => {
    expect(orderPaymentMethods(['pay_at_hotel'], ['pokpay', 'pay_at_hotel'], 'pokpay')).toEqual({
      methods: ['pay_at_hotel'],
      defaultMethod: 'pay_at_hotel',
    });
  });

  it('puts a method missing from the saved order after the ones the hotel placed', () => {
    expect(orderPaymentMethods(all, ['pay_at_hotel'], null).methods).toEqual([
      'pay_at_hotel',
      'stripe',
      'pokpay',
    ]);
  });

  it('has no default when nothing is offered', () => {
    expect(orderPaymentMethods([], ['stripe'], 'stripe')).toEqual({
      methods: [],
      defaultMethod: null,
    });
  });
});

describe('what the reception accepts (S7b-3)', () => {
  it('names the saved ways to pay in the catalogue order and drops unknown ones', () => {
    expect(acceptedAtHotelLabels(['visa', 'cash', 'bitcoin']).map((entry) => entry.label)).toEqual([
      'Cash',
      'Visa',
    ]);
    expect(acceptedAtHotelLabels(null)).toEqual([]);
  });

  it('writes one sentence, or nothing when empty', () => {
    expect(acceptedAtHotelSentence([])).toBeNull();
    expect(acceptedAtHotelSentence(['Cash'])).toBe('At the hotel we accept Cash.');
    expect(acceptedAtHotelSentence(['Cash', 'Visa', 'Mastercard'])).toBe(
      'At the hotel we accept Cash, Visa and Mastercard.',
    );
  });
});
