import { formatMoney, type ApproximateMoney } from '../../lib/money';

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );

/**
 * An amount in its own currency. When another currency is worth showing, an approximate amount follows in
 * brackets, marked as approximate. It is for reading only: different currencies are never added together.
 */
export function Money({
  amount,
  currency,
  approximate,
  negative = false,
}: {
  amount: string | number;
  currency: string;
  approximate?: ApproximateMoney | null;
  /** Shows a minus sign, for example for a refund. */
  negative?: boolean;
}) {
  const note = approximate
    ? approximate.basis === 'payment-day'
      ? approximate.date
        ? `Approximate, at the exchange rate of ${dayLabel(approximate.date)}, the day it was recorded.`
        : 'Approximate, at the exchange rate of the day it was recorded.'
      : approximate.date
        ? `Estimate at the exchange rate of ${dayLabel(approximate.date)}. The real value depends on the rate when it is paid.`
        : 'Estimate at the latest exchange rate. The real value depends on the rate when it is paid.'
    : undefined;
  return (
    <span>
      {negative ? '−' : ''}
      {formatMoney(amount, currency)}
      {approximate ? (
        <span className="ml-1 text-muted-foreground" title={note}>
          {`(≈ ${negative ? '−' : ''}${formatMoney(approximate.amount, approximate.currency)}${
            approximate.basis === 'estimate' ? ', estimate' : ''
          })`}
        </span>
      ) : null}
    </span>
  );
}
