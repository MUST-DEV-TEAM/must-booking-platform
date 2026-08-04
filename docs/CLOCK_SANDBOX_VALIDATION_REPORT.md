# Clock PMS+ Sandbox Validation Report

Milestone 11, Task 16 — the milestone's actual "done" gate (source brief section 36's Definition of Done checklist, assessed item by item against what Tasks 1-15 actually built and verified). Sandbox: HOTEL DEMO account (`support@must.al`), `sky-eu1.clock-software.com`, API user `must_16307`.

**Overall: this milestone meets its own explicitly-scoped "basic" Definition of Done (docs/roadmap/milestones/11-clock-pms-adapter-basic.md's Goal statement), not the source brief's full production-grade checklist.** Two items below are not done at all (metrics, alerts) and one core flow (a real Clock-*confirmed* booking) was never achieved in this specific sandbox account for reasons outside this codebase's control — see "Real booking-creation success: not achieved, and why" below.

## Checklist (source brief section 36)

| Item | Status | Evidence |
| --- | --- | --- |
| Sandbox | ✅ Done | Real credentials, real account, used across Tasks 6-16, never mocked. |
| Encrypted credentials | ✅ Done | AES-256-GCM, `CredentialCipherService` (Task 1), unit-tested round-trip + tamper detection. |
| Endpoint matrix | ✅ Done | `CLOCK_ENDPOINT_MATRIX.md`, every row carries a verification status, no `ASSUMPTION`-only row presented as ready (Task 14). |
| Catalog / mapping | ✅ Done | Real room types/rooms synced, staged `PROPOSED`, confirmed into real local rows (Task 7, `clock-catalog-sync.e2e.spec.ts`). |
| Availability | ✅ Done (contract); ⚠️ no live data observed | Real `/rates_availability` request contract confirmed (400→200 transition reproduced); this account has no rate/availability configured for any room type, so only empty results were ever observed, never a populated success body (Task 8). |
| Idempotent booking creation | ⚠️ Partial | The idempotency mechanism itself is real and verified (a replayed create returns the cached result, no second row, `attempts` increments — Task 10). A genuinely *successful* (Clock-confirmed) booking creation was never achieved — see below. |
| Timeout reconciliation | ⚠️ Code done, not independently re-verified | The section-18 lookup-before-retry logic exists and is exercised as dead code paths by the type system/build, but forcing a real Clock network timeout on demand wasn't done in this milestone (Task 10). |
| Updates | ⚠️ Code done, not verified against a live booking | Dates-only update, `lock_version` re-fetch pattern, stale-object 500 reclassification are all implemented per Clock's documented contract, but never run against an actual Clock-confirmed booking (none exists in this account) — see below. |
| Cancellation | ⚠️ Partial | Verified for real against a *local-only* booking (no `externalBookingId` — Clock is never called, since there's nothing there to cancel): `clock-sandbox-validation.e2e.spec.ts`. The "cancel a real Clock booking" path (`GET` current `lock_version` then `PUT status=canceled`) is implemented per the documented contract but never exercised against a live booking. |
| Webhooks | ✅ Code + full flow done; ⚠️ no live AWS traffic | Real AWS SNS signature verification (real RSA key pair, real crypto, not mocked), real HTTP routing, real RLS lookup, real dedup, real BullMQ enqueue — all proven end to end. No live Clock Message Channels subscription exists for this account, so genuinely AWS-signed traffic was never captured (Task 11). |
| Rate limiter | ✅ Done | Real Redis-backed, distributed, tested against a real local Redis (Task 5). |
| Queues | ✅ Infrastructure done; ⚠️ skeleton only | 6 real BullMQ queues + dead-letter, real Redis, real workers — processors are explicitly skeleton-only (log receipt), no queue has real business logic wired to it yet (Task 9). |
| Manual review | ✅ Schema + 2/7 triggers done | Table covers all 7 brief categories; `UNKNOWN_RESULT` and `SCHEMA_MISMATCH` have real producing code; the other 5 are schema-ready only, pending out-of-scope features (Task 12). |
| Audit | ✅ Done | Every connection lifecycle action and every Clock booking operation writes to `AuditLogService`, verified for real (Task 13). |
| Metrics | ❌ Not done | No metrics/observability code exists anywhere in the Clock integration — no counters, no histograms, no export of any kind. Source brief section 28's full list (API request/duration/error/rate-limit/WAF-suspicion/webhook-delay/queue-depth/booking-creation-duration/unknown-result/reconciliation-mismatch metrics) is entirely unbuilt. |
| Alerts | ❌ Not done | No alerting code or configuration exists. Source brief section 28's alert list (401/403, 429, queue backlog, pending-booking timeout, missing webhooks, schema-validation failures, financial-sync failures) is entirely unbuilt. |
| E2E tests | ✅ Done | Real-sandbox e2e coverage across connect/test/sync/confirm/availability/booking-create/cancel/webhooks/manual-review/audit — see the file list below. |

## Real booking-creation success: not achieved, and why

Every booking-creation attempt against this sandbox account — across Tasks 10 and 16, several distinct attempts, including a full sweep of every room type in the catalog against a 2-month date window — has returned the same real, correctly-classified 400 rejection:

> "The selected period, room type/room, adults and children are not available for the selected rate. The User doesn't have the following right: 'Booking: Rate Availability Control Override'."

Two independent, Clock-account-side facts cause this, confirmed by direct investigation (not assumed):

1. **No room type in this account has any rate/availability configured** for any date range tried — `GET /rates_availability` returns an empty result for every room type across a 2-month window (Task 8's discovery probe, re-confirmed in Task 16).
2. **The sandbox API user (`must_16307`) lacks the "Booking: Rate Availability Control Override" right**, which Clock's own error message names explicitly — this right would let a booking be created despite no configured availability.

Neither is fixable from application code. Unblocking a real, Clock-*confirmed* booking (and, downstream of that, a real update and a real Clock-side cancellation) requires **one of**:

- Configuring real rate/availability data for at least one room type in the Clock sandbox account's own dashboard, or
- Granting the `must_16307` API user the "Booking: Rate Availability Control Override" right (via Clock support or the account's own user-rights admin screen, if accessible).

Both require access to the Clock sandbox account's own admin dashboard, which is outside this session's reach. **This is a real, outstanding verification gap** — the booking create/update/cancel *code paths* are built and match Clock's documented contract exactly (confirmed via Clock's own public Postman API docs), and the *rejection* path is proven for real, but a genuine success has never been observed.

## Real sandbox e2e test files (this milestone)

| File | Covers |
| --- | --- |
| `clock-pms.provider.sandbox.spec.ts` | Digest auth, `testConnection` success + failure (Task 6) |
| `clock-catalog-sync.e2e.spec.ts` | Sync, propose, confirm real room types/rooms (Task 7) |
| `clock-availability.e2e.spec.ts` | Real `/rates_availability` request/response contract (Task 8) |
| `clock-booking.e2e.spec.ts` | Real booking-create rejection, idempotent replay, audit trail (Tasks 10, 13) |
| `clock-webhook.e2e.spec.ts` | Real AWS SNS signature verification, dedup, enqueue, 400/404 handling (Task 11) |
| `manual-review.e2e.spec.ts` | Platform-admin manual-review list/resolve, RLS tenant isolation (Task 12) |
| `clock-sandbox-validation.e2e.spec.ts` | This report's chained end-to-end flow: connect → test → sync → confirm → availability → attempt create → cancel (Task 16) |

All are gated behind `describe.skipIf(!hasSandboxCredentials)` — they run for real when `CLOCK_SANDBOX_*` env vars are present (local dev only; deliberately absent in CI so no PR run makes third-party sandbox calls) and skip cleanly otherwise.

## Recommendation

This milestone is safe to mark **Done** against its own explicitly-scoped "basic" goal (connect, sync catalog, check availability, attempt booking create/cancel through `ClockPmsProvider`, sandbox-validated) — every code path that can be verified without Clock-account-admin access has been. Metrics and alerts should be scoped as their own follow-up (they're substantial enough to be their own milestone task, not a footnote here). A genuine Clock-confirmed booking create/update/cancel cycle should be re-run as the very first thing once either sandbox availability data or the override right is obtained — at that point, re-running `clock-sandbox-validation.e2e.spec.ts` is the fastest way to find out whether anything in the untested success path needs fixing.
