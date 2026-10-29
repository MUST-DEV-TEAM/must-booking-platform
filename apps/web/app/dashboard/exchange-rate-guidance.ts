/**
 * Guidance shown next to a hotel exchange rate. A rate is "hotel-currency units per one unit of the display
 * currency" (1 EUR = 100 ALL), the reverse of how many people think about it ("100 ALL = ? EUR"), so the screen
 * shows the market reference, a worked example and a warning when the typed rate is far from the market.
 */

/** Above this distance from the market the screen asks for a second, deliberate click. */
export const SOFT_DEVIATION = 0.1;
/** Above this the server also refuses unless the save is explicitly confirmed. */
export const HARD_DEVIATION = 0.5;
/** A rate nobody has looked at for this long is flagged as possibly out of date. */
export const STALE_DAYS = 60;

function positive(value: string): number | null {
  const number = Number(value.trim().replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** How far the typed rate is from the market reference, as a fraction (0.1 = 10%); null when unknown. */
export function deviationFromMarket(value: string, reference: number | undefined): number | null {
  const rate = positive(value);
  return rate === null || !reference || reference <= 0 ? null : Math.abs(rate / reference - 1);
}

/** "100 ALL ≈ 0.5 EUR" for the typed rate, so the direction can be checked at a glance. */
export function worked(value: string, base: string, currency: string): string | null {
  const rate = positive(value);
  if (rate === null) return null;
  const amount = 100 / rate;
  const text = amount.toLocaleString('en', { maximumFractionDigits: amount < 1 ? 4 : 2 });
  return `100 ${base} ≈ ${text} ${currency}`;
}

export function daysSince(iso: string, now: number = Date.now()): number {
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / 86_400_000)) : 0;
}
