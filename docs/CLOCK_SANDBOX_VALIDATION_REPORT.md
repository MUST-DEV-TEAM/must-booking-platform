# Clock PMS+ Sandbox Validation Report

Milestone 11, Task 16 — the milestone's actual "done" gate (source brief section 36's Definition of Done checklist, assessed item by item against what Tasks 1-15 actually built and verified). Sandbox: HOTEL DEMO account (`support@must.al`), `sky-eu1.clock-software.com`, API user `must_16307`.

**Update (2026-08-05): the real booking-creation gap below is resolved.** What looked like an account-side limitation (no rate/availability data, missing "Rate Availability Control Override" right) traced to a real code bug, found and fixed the same day — see "Real booking-creation success: now achieved" below. The rest of this report's "basic" Definition of Done assessment stands; only the booking-creation/update/cancellation rows change from "rejection proven" to "real success proven."

## Checklist (source brief section 36)

| Item | Status | Evidence |
| --- | --- | --- |
| Sandbox | ✅ Done | Real credentials, real account, used across Tasks 6-16, never mocked. |
| Encrypted credentials | ✅ Done | AES-256-GCM, `CredentialCipherService` (Task 1), unit-tested round-trip + tamper detection. |
| Endpoint matrix | ✅ Done | `CLOCK_ENDPOINT_MATRIX.md`, every row carries a verification status, no `ASSUMPTION`-only row presented as ready (Task 14). |
| Catalog / mapping | ✅ Done | Real room types/rooms synced, staged `PROPOSED`, confirmed into real local rows (Task 7, `clock-catalog-sync.e2e.spec.ts`). |
| Availability | ✅ Done | Real `/rates_availability` request contract confirmed; DBL room type has real rate/price data in this account and returns a genuine, populated `free: true` success body (2026-08-05, Task 8 + post-close-out fix). |
| Idempotent booking creation | ✅ Done | The idempotency mechanism is real and verified (a replayed create returns the cached result, no second row, `attempts` increments). A genuinely *successful* Clock-confirmed booking creation is now proven for real (2026-08-05) — see below. |
| Timeout reconciliation | ⚠️ Code done, not independently re-verified | The section-18 lookup-before-retry logic exists and is exercised as dead code paths by the type system/build, but forcing a real Clock network timeout on demand wasn't done in this milestone (Task 10). |
| Updates | ⚠️ Code done, not verified against a live booking | Dates-only update, `lock_version` re-fetch pattern, stale-object 500 reclassification are all implemented per Clock's documented contract; a real Clock-confirmed booking now exists and can be used to verify this — not yet re-run as of 2026-08-05. |
| Cancellation | ✅ Done | Verified for real against a genuine Clock-confirmed booking (`GET` current `lock_version` then `PUT status=canceled`) — `clock-booking.e2e.spec.ts` and `clock-sandbox-validation.e2e.spec.ts`, both updated 2026-08-05. |
| Webhooks | ✅ Code + full flow done; ⚠️ no live AWS traffic | Real AWS SNS signature verification (real RSA key pair, real crypto, not mocked), real HTTP routing, real RLS lookup, real dedup, real BullMQ enqueue — all proven end to end. No live Clock Message Channels subscription exists for this account, so genuinely AWS-signed traffic was never captured (Task 11). |
| Rate limiter | ✅ Done | Real Redis-backed, distributed, tested against a real local Redis (Task 5). |
| Queues | ✅ Infrastructure done; ⚠️ skeleton only | 6 real BullMQ queues + dead-letter, real Redis, real workers — processors are explicitly skeleton-only (log receipt), no queue has real business logic wired to it yet (Task 9). |
| Manual review | ✅ Schema + 2/7 triggers done | Table covers all 7 brief categories; `UNKNOWN_RESULT` and `SCHEMA_MISMATCH` have real producing code; the other 5 are schema-ready only, pending out-of-scope features (Task 12). |
| Audit | ✅ Done | Every connection lifecycle action and every Clock booking operation writes to `AuditLogService`, verified for real (Task 13). |
| Metrics | ❌ Not done | No metrics/observability code exists anywhere in the Clock integration — no counters, no histograms, no export of any kind. Source brief section 28's full list (API request/duration/error/rate-limit/WAF-suspicion/webhook-delay/queue-depth/booking-creation-duration/unknown-result/reconciliation-mismatch metrics) is entirely unbuilt. |
| Alerts | ❌ Not done | No alerting code or configuration exists. Source brief section 28's alert list (401/403, 429, queue backlog, pending-booking timeout, missing webhooks, schema-validation failures, financial-sync failures) is entirely unbuilt. |
| E2E tests | ✅ Done | Real-sandbox e2e coverage across connect/test/sync/confirm/availability/booking-create/cancel/webhooks/manual-review/audit — see the file list below. |

## Real booking-creation success: now achieved

**Root cause (found 2026-08-05):** Clock's data model has two distinct levels — a **Rate Plan** (`/rate_plans`, e.g. id `69242`, a parent grouping with no room-type/price data of its own) and a **Rate** (`/rates/`, e.g. id `784160` for room type DBL), where, per Clock's own public API docs ("Data Mapping and Room Type / Rate Structure"): *"1 RoomType has 0..n Rates; 1 Rate belongs to 1 Room Type."* `ClockAvailabilityService` and `ClockBookingService` both fetched `/rate_plans` and used that id directly as the `rates`/`rate_id` parameter for `/rates_availability` and `POST /bookings/`. Since `69242` is not a valid `rates_availability`/booking `rate_id` for any room type, Clock silently matched nothing — returning an empty array from `/rates_availability` and, on booking create, the misleading rejection:

> "The selected period, room type/room, adults and children are not available for the selected rate. The User doesn't have the following right: 'Booking: Rate Availability Control Override'."

This looked exactly like an account-side rights/configuration gap (and was reported to Clock support as such) until testing with the correct child `rates/` id for DBL (`784160`) immediately succeeded — confirming Clock support's own pushback ("why do you need this right instead of creating bookings for available rates?") was correct: the request itself was wrong, not the account.

**Fix:** `ClockAvailabilityService.ratesForRoomType` and `ClockBookingService.rateIdForRoomType` now call `GET /rates/` and filter by `bookable_type === 'Pms::RoomType'` and `bookable_id === <external room type id>`, using the matching child rate's own `id`.

**Proven for real (2026-08-05):** `clock-sandbox-validation.e2e.spec.ts` now runs the full chain — connect → test → sync → confirm → real availability (`isAvailable: true`) → real booking create (`status: CONFIRMED`, real numeric `externalBookingId`) → real Clock-side cancel (`GET` lock_version, `PUT status=canceled`) — genuinely end to end, no rejection anywhere. `clock-booking.e2e.spec.ts` independently proves the same create/idempotent-replay/cancel cycle through `ClockBookingService` directly.

No override right was ever needed, and none was requested from Clock.

## Real sandbox e2e test files (this milestone)

| File | Covers |
| --- | --- |
| `clock-pms.provider.sandbox.spec.ts` | Digest auth, `testConnection` success + failure (Task 6) |
| `clock-catalog-sync.e2e.spec.ts` | Sync, propose, confirm real room types/rooms (Task 7) |
| `clock-availability.e2e.spec.ts` | Real `/rates_availability` request/response contract, genuine success (Task 8, fixed 2026-08-05) |
| `clock-booking.e2e.spec.ts` | Real booking-create success, idempotent replay, real Clock-side cancel, audit trail (Tasks 10, 13, fixed 2026-08-05) |
| `clock-webhook.e2e.spec.ts` | Real AWS SNS signature verification, dedup, enqueue, 400/404 handling (Task 11) |
| `manual-review.e2e.spec.ts` | Platform-admin manual-review list/resolve, RLS tenant isolation (Task 12) |
| `clock-sandbox-validation.e2e.spec.ts` | This report's chained end-to-end flow: connect → test → sync → confirm → availability → create → cancel, genuinely successful (Task 16, fixed 2026-08-05) |

All are gated behind `describe.skipIf(!hasSandboxCredentials)` — they run for real when `CLOCK_SANDBOX_*` env vars are present (local dev only; deliberately absent in CI so no PR run makes third-party sandbox calls) and skip cleanly otherwise.

## Recommendation

This milestone meets its own explicitly-scoped "basic" Definition of Done, and as of 2026-08-05 the one flow originally flagged as unverifiable (a genuine Clock-confirmed booking) is now proven for real. Remaining gaps are unchanged and explicitly out of this milestone's scope: metrics and alerts (entirely unbuilt), the timeout-reconciliation and update paths (code done, not independently re-verified against a live booking), and BullMQ workers (skeleton only — no queue has real business logic wired to it). These are reasonable candidates for Milestone 12 or a dedicated follow-up.
