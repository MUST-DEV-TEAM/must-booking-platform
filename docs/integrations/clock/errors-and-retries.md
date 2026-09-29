# Clock errors, limits and retries

Status: **IMPLEMENTED classification; retry behavior varies by caller**. Code inspected 2026-09-19.

Source: [clock-error-classification.ts](../../../apps/api/src/integrations/clock/clock-error-classification.ts), [retry policy](../../../apps/api/src/integrations/clock/clock-retry-policy.ts), and each service's fetch wrapper.

| Category | Current trigger / handling |
| --- | --- |
| authentication | 401; non-retryable classification |
| authorization | 403; no dedicated WAF distinction |
| validation | 400 |
| not_found | 404 |
| conflict | Generic 409 is non-retryable; booking wrapper specially recognizes Clock's stale-object 500 |
| rate_limited | 429 or local Redis limiter refusal |
| timeout | Client timeout; classification alone is not permission to replay a mutation |
| network | Client network failure; same mutation caution |
| provider_unavailable | 502/503/504 or open circuit |
| permanent | Other 5xx |
| unknown_result | Unrecognized response or ambiguous operation handling |
| schema_mismatch | Explicit resource validation failure |
| configuration | Missing connection/credentials/mapping/rates or unavailable quote configuration |
| waf_blocked | Defined vocabulary; no dedicated producing detector found |

`ClockRateLimiterService` implements the brief's four requests/second per API user via Redis Lua. The allowance is distributed; the circuit breaker is not. `ClockCircuitBreakerService` is process-local, opens after five failures and allows a half-open attempt after 30 seconds; these thresholds are implementation assumptions, not verified vendor requirements. An operational reporting hook exists on open.

`isRetryEligible` denies unconfirmed mutations and permits rate-limited, network, provider-unavailable failures and GET timeouts. It does **not** grant conflict retries. `nextRetryDelayMs` implements jittered backoff. Neither helper is imported by a runtime Clock caller, so their unit tests do not establish a uniform executed retry policy.

Actual callers differ:

- Availability/catalog/booking wrappers commonly return a classified result after one attempted request.
- Booking create reconciles timeout/network ambiguity by reference lookup before marking unknown.
- Deposit/refund helpers have their own bounded retry and reference-lookup logic.
- Booking/financial consistency reads can wait in a loop for the local limiter before making a GET; this is not a general HTTP retry loop.
- BullMQ retries failed jobs according to queue options, then copies exhausted jobs to dead-letter.

Do not state "there are no retries" or "all safe failures automatically retry." Read the exact caller and the [lifecycle](booking-lifecycle.md) before changing recovery. Full WAF-specific detection and metrics remain absent. Historical vendor examples and verification dates are in the [endpoint matrix](endpoint-matrix.md), not implied by this classification table.
