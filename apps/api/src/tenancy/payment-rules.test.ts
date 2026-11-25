import { BadRequestException } from '@nestjs/common';
import {
  checkAcceptedAtHotel,
  checkPaymentOrder,
  checkPaymentSettings,
} from '@must/domain-contracts';
import { describe, expect, it } from 'vitest';

import { hotelInput, paymentChangeProblem } from './hotel-settings';

const on = { stripe: true, pokpay: false, payAtHotel: true };

describe('checkPaymentOrder and checkAcceptedAtHotel', () => {
  it('accepts known methods once each, and an empty list', () => {
    expect(checkPaymentOrder([])).toBeNull();
    expect(checkPaymentOrder(['pokpay', 'stripe', 'pay_at_hotel'])).toBeNull();
    expect(checkPaymentOrder(['stripe', 'stripe'])).not.toBeNull();
    expect(checkPaymentOrder(['bitcoin'])).not.toBeNull();
    expect(checkPaymentOrder('stripe')).not.toBeNull();
    expect(checkAcceptedAtHotel(['cash', 'visa'])).toBeNull();
    expect(checkAcceptedAtHotel(['unionpay', 'apple_pay', 'google_pay', 'amex'])).toBeNull();
    // Not offered any more, and the two phone wallets are separate choices.
    expect(checkAcceptedAtHotel(['maestro'])).not.toBeNull();
    expect(checkAcceptedAtHotel(['diners'])).not.toBeNull();
    expect(checkAcceptedAtHotel(['mobile_wallet'])).not.toBeNull();
    expect(checkAcceptedAtHotel(['cheque'])).not.toBeNull();
    // Online providers and bank transfer are not something a reception takes.
    expect(checkAcceptedAtHotel(['pokpay'])).not.toBeNull();
    expect(checkAcceptedAtHotel(['bank_transfer'])).not.toBeNull();
  });
});

describe('checkPaymentSettings', () => {
  it('needs at least one method on', () => {
    expect(
      checkPaymentSettings({ enabled: { stripe: false, pokpay: false, payAtHotel: false } })
        .methods,
    ).toBeDefined();
    expect(checkPaymentSettings({ enabled: on }).methods).toBeUndefined();
  });
  it('needs the default method to be switched on', () => {
    expect(
      checkPaymentSettings({ enabled: on, paymentDefaultMethod: 'pokpay' }).paymentDefaultMethod,
    ).toBeDefined();
    expect(checkPaymentSettings({ enabled: on, paymentDefaultMethod: 'stripe' })).toEqual({});
  });
  it('needs something accepted at the hotel when pay at the hotel is on', () => {
    expect(
      checkPaymentSettings({ enabled: on, acceptedAtHotel: [] }).acceptedAtHotel,
    ).toBeDefined();
    expect(checkPaymentSettings({ enabled: on, acceptedAtHotel: ['cash'] })).toEqual({});
    expect(
      checkPaymentSettings({
        enabled: { stripe: true, pokpay: false, payAtHotel: false },
        acceptedAtHotel: [],
      }),
    ).toEqual({});
  });
  it('keeps the link valid longer than the first reminder, and the second reminder in between', () => {
    expect(
      checkPaymentSettings({ paymentLinkValidDays: 3, firstReminderDays: 3 }).paymentLinkValidDays,
    ).toMatch(/first reminder/);
    expect(checkPaymentSettings({ paymentLinkValidDays: 7, firstReminderDays: 3 })).toEqual({});
    expect(
      checkPaymentSettings({
        paymentLinkValidDays: 7,
        firstReminderDays: 3,
        paymentSecondReminderDays: 7,
      }).paymentSecondReminderDays,
    ).toMatch(/before the link expires/);
    expect(
      checkPaymentSettings({
        paymentLinkValidDays: 7,
        firstReminderDays: 3,
        paymentSecondReminderDays: 3,
      }).paymentSecondReminderDays,
    ).toMatch(/after the first/);
    expect(
      checkPaymentSettings({
        paymentLinkValidDays: 7,
        firstReminderDays: 3,
        paymentSecondReminderDays: 5,
      }),
    ).toEqual({});
  });
});

describe('paymentChangeProblem', () => {
  const base = { paymentGateways: on, acceptedAtHotel: [] as string[], paymentLinkValidDays: 7 };
  it('does not block an unrelated save for a hotel that never set the new fields', () => {
    expect(paymentChangeProblem(base, ['onlinePaymentHoldMinutes'], 3)).toBeNull();
    expect(paymentChangeProblem(base, ['name'], 3)).toBeNull();
  });
  it('runs a rule when the field, or the switch it depends on, is part of the change', () => {
    expect(paymentChangeProblem(base, ['paymentGateways'], 3)).toMatch(/at the hotel/);
    expect(paymentChangeProblem(base, ['acceptedAtHotel'], 3)).toMatch(/at the hotel/);
    expect(
      paymentChangeProblem({ ...base, paymentLinkValidDays: 3 }, ['paymentLinkValidDays'], 3),
    ).toMatch(/first reminder/);
    expect(
      paymentChangeProblem(
        { ...base, paymentGateways: { stripe: false, pokpay: false, payAtHotel: false } },
        ['paymentGateways'],
        3,
      ),
    ).toMatch(/at least one/);
  });
});

describe('hotelInput for payment settings', () => {
  it('keeps the checkout order the owner chose and sorts what is accepted', () => {
    expect(
      hotelInput({
        paymentMethodOrder: ['pokpay', 'pay_at_hotel', 'stripe'],
        acceptedAtHotel: ['visa', 'cash'],
      }),
    ).toEqual({
      paymentMethodOrder: ['pokpay', 'pay_at_hotel', 'stripe'],
      acceptedAtHotel: ['cash', 'visa'],
    });
  });
  it('refuses a bad order, default, expiry action or day count', () => {
    expect(() => hotelInput({ paymentMethodOrder: ['stripe', 'stripe'] })).toThrow(
      BadRequestException,
    );
    expect(() => hotelInput({ paymentDefaultMethod: 'bitcoin' })).toThrow(BadRequestException);
    expect(() => hotelInput({ paymentLinkExpiryAction: 'shrug' })).toThrow(BadRequestException);
    expect(() => hotelInput({ paymentLinkExpiryAction: null })).toThrow(BadRequestException);
    expect(() => hotelInput({ paymentLinkValidDays: 15 })).toThrow(BadRequestException);
    expect(() => hotelInput({ paymentLinkValidDays: 0 })).toThrow(BadRequestException);
    expect(() => hotelInput({ paymentSecondReminderDays: 1 })).toThrow(BadRequestException);
    expect(hotelInput({ paymentSecondReminderDays: null, paymentDefaultMethod: null })).toEqual({
      paymentSecondReminderDays: null,
      paymentDefaultMethod: null,
    });
  });
});
