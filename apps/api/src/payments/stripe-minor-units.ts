// Stripe counts money in the smallest unit of each currency, and that unit is not always 1/100.
// A yen has no sub-unit (so 5000 yen is sent as 5000), a Kuwaiti dinar has three decimals (so 1.500 dinar is
// sent as 1500). Our own ledger writes every amount with two decimals ("5000.00"), so these helpers convert
// at the Stripe boundary only. Lists are from Stripe's documentation ("Zero-decimal currencies" and
// "Three-decimal currencies"). Icelandic krona and Ugandan shilling are zero-decimal but Stripe still wants
// them in two-decimal form, so they count as two decimals here.
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function stripeDecimals(currency: string): 0 | 2 | 3 {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/** "400.00" EUR -> 40000, "5000.00" JPY -> 5000, "1.500" KWD -> 1500. Rounds half up past the currency's decimals. */
export function toStripeMinorUnits(amount: string, currency: string): bigint {
  const decimals = stripeDecimals(currency);
  const [whole = '0', fraction = ''] = amount.split('.');
  const padded = fraction.padEnd(decimals + 1, '0');
  const kept = BigInt(`${whole || '0'}${padded.slice(0, decimals)}`);
  return Number(padded[decimals] ?? '0') >= 5 ? kept + 1n : kept;
}

/** A Stripe amount in the smallest unit -> our two-decimal string: 5000 JPY -> "5000.00", 1500 KWD -> "1.50". */
export function fromStripeMinorUnits(minor: number, currency: string): string {
  const decimals = stripeDecimals(currency);
  const value = BigInt(Math.round(minor));
  const cents = decimals <= 2 ? value * 10n ** BigInt(2 - decimals) : (value + 5n) / 10n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
