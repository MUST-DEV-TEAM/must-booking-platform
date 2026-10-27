/**
 * Currency codes are checked against the real ISO 4217 list (the one the runtime ships), not just "three
 * letters", so a typo such as `EUO` or a made-up code is refused at the edge instead of being stored.
 */
const KNOWN = new Set(Intl.supportedValuesOf('currency'));

/** The upper-case ISO 4217 code, or null when the value is missing or not a real currency. */
export function isoCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && KNOWN.has(code) ? code : null;
}
