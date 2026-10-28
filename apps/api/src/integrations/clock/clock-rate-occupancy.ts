type RateCaps = { maxAdults: number | null; maxChildren: number | null };

/**
 * Clock has no capacity on a room type; a rate's `rate_restriction` is the only place it
 * says how many guests fit. The most any website rate allows is the best display value for
 * "up to N guests". Unknown (no rates, or any rate with no adult cap) returns null so the
 * stored value is left alone rather than guessed.
 */
export function occupancyFromRates(rates: RateCaps[]): number | null {
  if (rates.length === 0) return null;
  let best = 0;
  for (const rate of rates) {
    if (rate.maxAdults === null || !Number.isInteger(rate.maxAdults) || rate.maxAdults < 1)
      return null;
    best = Math.max(best, rate.maxAdults + Math.max(0, rate.maxChildren ?? 0));
  }
  return best;
}
