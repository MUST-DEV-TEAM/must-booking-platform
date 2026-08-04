# Clock PMS+ Error Catalogue

Milestone 11 deliverable (source brief section 37/Appendix B, section 11). The brief's exact 14 categories, as actually classified by `clock-error-classification.ts`, and the retry rule from `clock-retry-policy.ts` (see `CLOCK_ARCHITECTURE.md` for why the retry *policy* isn't currently wired into an actual retry *loop*).

## The 14 categories

| Category | HTTP trigger | Retryable by policy | Real example observed |
| --- | --- | --- | --- |
| `authentication` | 401 | No | `HTTP Digest: Access denied.` (plain text, not JSON) — wrong API key |
| `authorization` | 403 | No | `{"error":"The User doesn't have the following right: '...'"}` |
| `validation` | 400 | No | `/rates_availability` missing required params; booking-create "not available for the selected rate" |
| `not_found` | 404 | No | Not yet observed against a real Clock response |
| `conflict` | Special-cased 500 (see below) | Yes (via `RetryContext`, not auto-executed) | `{"error":"Attempted to update a stale object: Booking"}` |
| `rate_limited` | 429 | Yes | Not yet observed against real Clock (MUST's own 4 req/s limiter engages first) |
| `timeout` | Client-side (no response) | Yes, but **GET only** | `HeadersTimeoutError` (undici), observed during Task 10 sandbox probing |
| `network` | Client-side (connection failure) | Yes ("safe network interruption") | Not yet observed against real Clock |
| `provider_unavailable` | 502/503/504 | Yes | Not yet observed against real Clock |
| `waf_blocked` | — | No | **No detection code exists.** See "Not built" below. |
| `unknown_result` | — (not an HTTP status) | N/A | Booking-creation timeout where the reference-lookup reconciliation also fails — routes to `manual_review_items` (`UNKNOWN_RESULT`), see `CLOCK_BOOKING_STATE_MACHINE.md` |
| `schema_mismatch` | 2xx with unexpected body shape | No | A booking-create 2xx response failing `isClockBookingResource` — routes to `manual_review_items` (`SCHEMA_MISMATCH`) |
| `configuration` | — (not an HTTP status) | No | No active Clock connection; unmapped room type; zero/multiple rate plans; missing credential fields |
| `permanent` | 5xx not otherwise classified | No | Not yet observed against real Clock |

## The stale-object 500: a real special case

Clock's optimistic-concurrency conflict is a plain **HTTP 500**, not the 409 a REST API would typically use, with a fixed message body: `{"error":"Attempted to update a stale object: Booking"}`. If this weren't special-cased, the generic classifier (`status >= 500` → `permanent`, not retryable) would misclassify a completely ordinary, expected, retryable concurrency conflict as an unrecoverable server error. `ClockBookingService.fetch` checks for this exact message substring on any 500 before falling through to the generic classifier — see `clock-booking.service.ts`'s `STALE_OBJECT_MESSAGE` constant.

## `waf_blocked`: not built

Source brief section 12 requires: "Clock mund të bllokojë IP-në për sjellje të dyshimtë... Një seri 403 duhet të hapë circuit breaker dhe alert operacional" (Clock may block the IP for suspicious behavior; a series of 403s should open a circuit breaker and raise an operational alert). What exists: the generic `ClockCircuitBreakerService` (Task 5) trips on any 5 consecutive failures of *any* kind, including 403s — so a 403 storm does eventually stop hammering Clock. What's missing: a dedicated detector that specifically recognizes a 403 pattern as WAF suspicion (as opposed to, say, a real authorization misconfiguration), and any alerting hook. `waf_blocked` is a defined category in the type system (`ClockErrorCategory`) but nothing in the classifier ever produces it — every 403 currently classifies as `authorization`, not `waf_blocked`. Real follow-up work, tracked here rather than left silently unbuilt.

## Retry eligibility (policy, not auto-executed)

Per source brief section 11, verbatim: retry automatically only for 429, "safe network interruption," GET timeouts, and provider-temporarily-unavailable; never blind-retry a booking-creation timeout. `isRetryEligible` (`clock-retry-policy.ts`) implements exactly this and is unit-tested (17 cases). `nextRetryDelayMs` implements exponential backoff with full jitter (250ms base, 8s cap) — the brief specifies *when* to retry, not the exact backoff shape, so this is a documented reasonable default. **Neither function is called by any real Clock service in this milestone** — see `CLOCK_ARCHITECTURE.md`'s "Retry: policy vs. execution" section. `Result.error.retryable` is surfaced to callers as information, not acted on automatically.

## Rate limiting (MUST-side, not Clock's error responses)

Clock documents 5 req/s per API user; `ClockRateLimiterService` enforces 4 req/s (a safety margin) via a real Redis Lua `INCR`+`EXPIRE` script, distributed across API instances (unlike the in-memory circuit breaker). A request MUST itself throttles never reaches Clock at all — it fails locally with `clock_rate_limited` before any HTTP call is attempted, distinct from Clock ever actually returning a real 429 (which has not been observed in this sandbox).
