/** What we recorded for one PokPay order. */
export type RecordedOrder = {
  orderId: string;
  /** Status of our charge row; null when we recorded no charge for this order. */
  chargeStatus: string | null;
  chargeAmount: string | null;
  chargeCurrency: string | null;
  /** Everything we recorded as refunded for this order, and in which currencies. */
  refundedAmount: string;
  refundCurrencies: string[];
  refundCount: number;
};

/** What PokPay itself says about the same order. */
export type ProviderOrder = { status: string; amount: string; currency: string };

export type ReconciliationKind =
  | 'PAID_AT_PROVIDER_ONLY'
  | 'PAID_HERE_ONLY'
  | 'AMOUNT_DIFFERS'
  | 'REFUNDED_AT_PROVIDER_ONLY'
  | 'REFUNDED_HERE_ONLY';

export type Difference = { kind: ReconciliationKind; message: string };

/** Statuses our own charge rows use for a payment that really happened. */
const PAID_HERE = new Set(['PAID', 'succeeded']);
/** PokPay says the money was taken: completed, or later refunded. */
const PAID_THERE = new Set(['COMPLETED', 'REFUNDED']);
/** Amounts are compared to the cent. */
const CENT = 0.01;

const money = (amount: string, currency: string) => `${Number(amount).toFixed(2)} ${currency}`;

/**
 * Compares our records of one PokPay order with PokPay's own, in plain words. Returns nothing when they agree.
 * It never decides which side is right and never changes money: a difference is only reported for a person to
 * look at. Amounts in different currencies are never compared with each other.
 */
export function compareWithProvider(
  recorded: RecordedOrder,
  provider: ProviderOrder,
): Difference | null {
  const paidHere = recorded.chargeStatus !== null && PAID_HERE.has(recorded.chargeStatus);
  const paidThere = PAID_THERE.has(provider.status);

  if (!paidHere && paidThere)
    return {
      kind: 'PAID_AT_PROVIDER_ONLY',
      message: `PokPay shows a completed payment of ${money(provider.amount, provider.currency)} for this booking, but we have no payment recorded for it.`,
    };
  if (paidHere && !paidThere)
    return {
      kind: 'PAID_HERE_ONLY',
      message: `We recorded a payment for this booking, but PokPay shows the order as ${provider.status.toLowerCase()}.`,
    };
  if (!paidHere) return null;

  const ours = recorded.chargeAmount!;
  const sameCurrency =
    (recorded.chargeCurrency ?? '').toUpperCase() === provider.currency.toUpperCase();
  if (!sameCurrency || Math.abs(Number(ours) - Number(provider.amount)) > CENT)
    return {
      kind: 'AMOUNT_DIFFERS',
      message: `We recorded a payment of ${money(ours, recorded.chargeCurrency ?? '')} but PokPay shows ${money(provider.amount, provider.currency)} for the same order.`,
    };

  // Refunds can be recorded in another currency than the charge (lek at the order's rate), so amounts are only
  // compared when every refund is in the charge's own currency.
  const refundsInChargeCurrency = recorded.refundCurrencies.every(
    (code) => code.toUpperCase() === (recorded.chargeCurrency ?? '').toUpperCase(),
  );
  const refundedHere = Number(recorded.refundedAmount);
  const fullyRefundedHere = refundsInChargeCurrency && refundedHere >= Number(ours) - CENT;

  if (provider.status === 'REFUNDED') {
    if (recorded.refundCount === 0)
      return {
        kind: 'REFUNDED_AT_PROVIDER_ONLY',
        message: `PokPay shows this order as refunded, but we have no refund recorded for it.`,
      };
    if (refundsInChargeCurrency && refundedHere < Number(ours) - CENT)
      return {
        kind: 'REFUNDED_AT_PROVIDER_ONLY',
        message: `PokPay shows this order as refunded in full, but we recorded only ${money(recorded.refundedAmount, recorded.chargeCurrency ?? '')} of ${money(ours, recorded.chargeCurrency ?? '')}.`,
      };
    return null;
  }
  if (provider.status === 'COMPLETED' && fullyRefundedHere && recorded.refundCount > 0)
    return {
      kind: 'REFUNDED_HERE_ONLY',
      message: `We recorded this payment as fully refunded, but PokPay still shows the order as completed, not refunded.`,
    };
  return null;
}
