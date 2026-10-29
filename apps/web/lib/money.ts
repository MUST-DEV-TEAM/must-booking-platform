/** Money in its own currency, for example "ALL 12,000" or "€98.00". */
export function formatMoney(amount: string | number, currency: string): string {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
      // Intl accepts decimal strings exactly; TypeScript's format signature still only lists number/bigint.
      amount as number,
    );
  } catch {
    // An unknown currency code must never break a screen.
    return `${currency} ${Number.isFinite(value) ? value.toFixed(2) : String(amount)}`;
  }
}

/**
 * An approximate amount in another currency, shown beside the real one and never added to anything.
 * `payment-day` uses the rate stored when the payment was recorded; `estimate` uses today's rate.
 */
export type ApproximateMoney = {
  amount: string;
  currency: string;
  basis: 'payment-day' | 'estimate';
  /** The day of the rate, when known. */
  date?: string | null;
};

/** Rounds to cents the way a money amount is shown, so the bracket matches what a person would write down. */
export function convertAmount(amount: string | number, rate: number): string {
  return (Math.round(Number(amount) * rate * 100) / 100).toFixed(2);
}

/**
 * How many units of `to` one unit of `from` buys, from rates quoted against a common base
 * (`rates[X]` is how many units of X one unit of the base buys; the base itself is 1).
 */
export function crossRate(
  rates: Record<string, number>,
  base: string,
  from: string,
  to: string,
): number | null {
  const of = (code: string) => (code === base ? 1 : rates[code]);
  const fromRate = of(from.toUpperCase());
  const toRate = of(to.toUpperCase());
  if (!fromRate || !toRate || !(fromRate > 0) || !(toRate > 0)) return null;
  return toRate / fromRate;
}
