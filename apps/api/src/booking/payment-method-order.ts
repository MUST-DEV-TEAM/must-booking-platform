import { ACCEPTED_AT_HOTEL } from '@must/domain-contracts';

export type PaymentMethodKey = 'stripe' | 'pokpay' | 'pay_at_hotel';

/**
 * The methods a guest is offered, in the hotel's own order, and the one to pre-select (G-51, S7b-2).
 * `available` is the standard order (Stripe, PokPay, pay at the hotel) after the availability rule; `order` is the
 * hotel's saved order (empty means the standard one). A method missing from the saved order, for example one that
 * was switched on later, follows the ones the hotel placed. The default is the hotel's choice when it is offered,
 * otherwise the first method offered.
 */
export function orderPaymentMethods(
  available: readonly PaymentMethodKey[],
  order: readonly string[] | null | undefined,
  preferredDefault: string | null | undefined,
): { methods: PaymentMethodKey[]; defaultMethod: PaymentMethodKey | null } {
  const rank = (method: PaymentMethodKey) => {
    const index = (order ?? []).indexOf(method);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const methods = available
    .map((method, position) => ({ method, position }))
    .sort((a, b) => rank(a.method) - rank(b.method) || a.position - b.position)
    .map((entry) => entry.method);
  const defaultMethod = methods.find((method) => method === preferredDefault) ?? methods[0] ?? null;
  return { methods, defaultMethod };
}

/** The reception's accepted ways to pay as `{ value, label }`, in the catalogue's order, unknown values dropped. */
export function acceptedAtHotelLabels(
  saved: readonly string[] | null | undefined,
): Array<{ value: string; label: string }> {
  return ACCEPTED_AT_HOTEL.filter((entry) => (saved ?? []).includes(entry.value)).map((entry) => ({
    value: entry.value,
    label: entry.label,
  }));
}

/** One sentence for the confirmation email, or null when the hotel listed nothing. */
export function acceptedAtHotelSentence(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  const list =
    labels.length === 1
      ? labels[0]!
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `At the hotel we accept ${list}.`;
}
