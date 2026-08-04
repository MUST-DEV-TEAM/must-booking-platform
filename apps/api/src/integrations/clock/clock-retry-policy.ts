import type { ClockClassifiedError } from './clock-error-classification';

export type ClockHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RetryContext {
  error: ClockClassifiedError;
  method: ClockHttpMethod;
  /**
   * True only for a request whose failure means "we don't know if Clock
   * actually created/changed something" — booking creation/update/cancel
   * timeouts. Per source brief section 18: never blind-retry this; look up
   * the operation record and search Clock by the MUST reference first
   * (Task 10's job). This flag exists so the retry policy can enforce that
   * rule structurally, not just by convention at each call site.
   */
  isUnconfirmedMutation?: boolean;
}

/**
 * Source brief section 11, verbatim: "Retry automatik vetëm për 429, network
 * interruption të sigurt, GET timeouts dhe provider temporary unavailable.
 * Mos bëni blind retry për booking creation timeout." (Automatic retry only
 * for: 429, safe network interruption, GET timeouts, and provider
 * temporarily unavailable. Never blind-retry a booking-creation timeout.)
 */
export function isRetryEligible(context: RetryContext): boolean {
  if (context.isUnconfirmedMutation) return false;

  const { category } = context.error;
  if (category === 'rate_limited') return true;
  if (category === 'provider_unavailable') return true;
  if (category === 'network') return true; // "safe network interruption"
  if (category === 'timeout') return context.method === 'GET';

  return false;
}

export interface RetryDelayOptions {
  attempt: number; // 1-indexed
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Exponential backoff with full jitter — the brief specifies *when* to retry, not the exact backoff shape. */
export function nextRetryDelayMs({
  attempt,
  baseDelayMs = 250,
  maxDelayMs = 8_000,
}: RetryDelayOptions): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(Math.random() * exponential);
}
