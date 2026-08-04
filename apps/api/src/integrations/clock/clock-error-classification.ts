import type { ResultError } from '@must/domain-contracts';

// The brief's exact 14 categories (source brief section 11) — do not add or
// rename without updating docs/CLOCK_ENDPOINT_MATRIX.md and the retry policy.
export type ClockErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'provider_unavailable'
  | 'waf_blocked'
  | 'unknown_result'
  | 'schema_mismatch'
  | 'configuration'
  | 'permanent';

export interface ClockClassifiedError extends ResultError {
  category: ClockErrorCategory;
}

/**
 * Maps an HTTP response (or a client-side failure like a timeout/network
 * error) into one of the brief's 14 categories. Status-to-category mappings
 * marked CONFIRMED_IN_SANDBOX were actually observed against the real Clock
 * sandbox (docs/CLOCK_ENDPOINT_MATRIX.md); everything else is a reasonable,
 * standard-HTTP-semantics ASSUMPTION until an example is actually seen.
 */
export function classifyClockHttpResponse(status: number, body: unknown): ClockClassifiedError {
  const message = extractMessage(body);

  // CONFIRMED_IN_SANDBOX: a 401 with no/invalid Digest credentials.
  if (status === 401)
    return build('authentication', message ?? 'Clock rejected the credentials.', false);

  // CONFIRMED_IN_SANDBOX: 403 with {"error":"The User doesn't have <right>"}
  // once Digest auth itself succeeded — an authenticated-but-forbidden case.
  if (status === 403)
    return build('authorization', message ?? 'The Clock API user lacks this right.', false);

  // CONFIRMED_IN_SANDBOX: 400 with a Contract validation error body on
  // /rates_availability when required params are missing.
  if (status === 400)
    return build('validation', message ?? 'Clock rejected the request as invalid.', false);

  if (status === 404)
    return build('not_found', message ?? 'The requested Clock resource was not found.', false);
  if (status === 409)
    return build('conflict', message ?? 'Clock reported a conflicting state.', false);
  if (status === 429)
    return build('rate_limited', message ?? 'Clock rate-limited this request.', true);
  if (status === 502 || status === 503 || status === 504)
    return build('provider_unavailable', message ?? 'Clock is temporarily unavailable.', true);
  if (status >= 500)
    return build('permanent', message ?? 'Clock returned an unexpected server error.', false);

  return build(
    'unknown_result',
    message ?? `Clock returned an unrecognized status (${status}).`,
    false,
  );
}

export function classifyClockClientFailure(
  kind: 'timeout' | 'network',
  message: string,
): ClockClassifiedError {
  // Both are generally retryable classes of failure at the classification
  // level; the finer-grained rule (a timeout is only retried for GET,
  // per section 11) lives in isRetryEligible, not here.
  return build(kind, message, true);
}

export function classifySchemaMismatch(message: string): ClockClassifiedError {
  return build('schema_mismatch', message, false);
}

export function classifyConfigurationError(message: string): ClockClassifiedError {
  return build('configuration', message, false);
}

function build(
  category: ClockErrorCategory,
  message: string,
  retryable: boolean,
): ClockClassifiedError {
  return { category, code: `clock_${category}`, message, retryable };
}

function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 500);
  return undefined;
}
