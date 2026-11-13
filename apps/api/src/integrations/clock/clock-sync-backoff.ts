/**
 * Retry schedule for a Clock sync job that keeps failing with an error retrying cannot fix (a bill whose
 * currencies disagree). Standard capped backoff: wait longer after each failure, never give up, so a fixed
 * booking recovers on the next try. Other kinds of failure (Clock down, rate limited) keep the 1 minute retry.
 */
export const FINANCIAL_BACKOFF_SECONDS = [60, 300, 1800, 21_600] as const;

/** Raise one review note for the booking when this many failures in a row have happened. */
export const FINANCIAL_ALERT_AFTER_FAILURES = 3;

/** Seconds to wait before the next try, given how many consecutive failures happened before this one. */
export function financialRetryDelaySeconds(failuresBefore: number): number {
  const count = Number.isFinite(failuresBefore) ? Math.trunc(failuresBefore) : 0;
  const index = Math.min(Math.max(0, count), FINANCIAL_BACKOFF_SECONDS.length - 1);
  return FINANCIAL_BACKOFF_SECONDS[index]!;
}

/** True only on the failure that reaches the threshold, so a streak raises exactly one note. */
export function shouldAlertFinancialBlocked(failuresIncludingThis: number): boolean {
  return failuresIncludingThis === FINANCIAL_ALERT_AFTER_FAILURES;
}
