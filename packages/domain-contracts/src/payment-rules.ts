/**
 * The rules for the hotel's Payment methods page (order and default of the checkout methods, what the hotel accepts
 * in person, how long a payment link stays valid), written once. The form shows these messages as the owner types and
 * the API refuses the same values (settings redesign plan, S7).
 */

/** The checkout methods a hotel can order today. A new payment provider is added here once its integration exists. */
export const CHECKOUT_METHODS = [
  { key: 'stripe', label: 'Stripe', kind: 'provider' },
  { key: 'pokpay', label: 'PokPay', kind: 'provider' },
  { key: 'pay_at_hotel', label: 'Pay at the hotel', kind: 'hotel' },
] as const;
export type CheckoutMethodKey = (typeof CHECKOUT_METHODS)[number]['key'];
export const CHECKOUT_METHOD_KEYS: readonly string[] = CHECKOUT_METHODS.map((m) => m.key);

/**
 * What a hotel can take in person at the reception, most common in Europe first: cash, the two main card networks,
 * American Express, UnionPay (visitors from China) and the two phone wallets at a contactless terminal. Online
 * providers and bank transfer are not listed.
 */
export const ACCEPTED_AT_HOTEL = [
  { value: 'cash', label: 'Cash' },
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
  { value: 'amex', label: 'American Express' },
  { value: 'unionpay', label: 'UnionPay' },
  { value: 'apple_pay', label: 'Apple Pay' },
  { value: 'google_pay', label: 'Google Pay' },
] as const;

export const LINK_EXPIRY_ACTIONS = ['notify_staff', 'cancel_release'] as const;

export const PAYMENT_LINK_VALID_DAYS = { min: 1, max: 14, default: 7 } as const;
export const SECOND_REMINDER_DAYS = { min: 2, max: 13 } as const;

/** A checkout order: known methods only, none twice. Empty means "the standard order". */
export function checkPaymentOrder(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Choose the order of the payment methods.';
  return value.every((v) => typeof v === 'string' && CHECKOUT_METHOD_KEYS.includes(v)) &&
    new Set(value).size === value.length
    ? null
    : 'Choose payment methods from the list, each once.';
}

export function checkAcceptedAtHotel(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Choose what you accept at the hotel.';
  const allowed: readonly string[] = ACCEPTED_AT_HOTEL.map((a) => a.value);
  return value.every((v) => typeof v === 'string' && allowed.includes(v)) &&
    new Set(value).size === value.length
    ? null
    : 'Choose from the list, each once.';
}

export type PaymentValues = {
  /** Which methods are switched on (`paymentGateways` in the API). */
  enabled?: { stripe?: boolean; pokpay?: boolean; payAtHotel?: boolean };
  paymentDefaultMethod?: string | null;
  acceptedAtHotel?: readonly string[] | null;
  paymentLinkValidDays?: number | null;
  paymentSecondReminderDays?: number | null;
  /** The first reminder, set in Emails (days after the link was sent). */
  firstReminderDays?: number | null;
};

const isOn = (values: PaymentValues, key: string) =>
  key === 'stripe'
    ? values.enabled?.stripe === true
    : key === 'pokpay'
      ? values.enabled?.pokpay === true
      : key === 'pay_at_hotel'
        ? values.enabled?.payAtHotel === true
        : false;

/** Cross-field rules; returns messages by field. */
export function checkPaymentSettings(values: PaymentValues): Record<string, string> {
  const out: Record<string, string> = {};
  const { enabled } = values;
  if (enabled && !(enabled.stripe || enabled.pokpay || enabled.payAtHotel))
    out.methods = 'Keep at least one payment method on so guests can complete an online booking.';
  if (values.paymentDefaultMethod && enabled && !isOn(values, values.paymentDefaultMethod))
    out.paymentDefaultMethod = 'The default method must be switched on.';
  if (enabled?.payAtHotel && (values.acceptedAtHotel?.length ?? 1) < 1)
    out.acceptedAtHotel = 'Choose at least one way guests can pay at the hotel.';
  const validity = values.paymentLinkValidDays ?? PAYMENT_LINK_VALID_DAYS.default;
  const first = values.firstReminderDays ?? null;
  if (first !== null && validity <= first)
    out.paymentLinkValidDays = `A payment link must stay valid longer than the first reminder (day ${first}).`;
  const second = values.paymentSecondReminderDays;
  if (second !== null && second !== undefined) {
    if (second >= validity)
      out.paymentSecondReminderDays = 'The second reminder must come before the link expires.';
    else if (first !== null && second <= first)
      out.paymentSecondReminderDays = `The second reminder must come after the first (day ${first}).`;
  }
  return out;
}
