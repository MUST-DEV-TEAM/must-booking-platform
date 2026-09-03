# Clock certification gaps — tonight's plan (2026-09-03)

Ahead of the Clock PMS+ certification call, this closes the three concrete gaps identified against Clock's own stated production-activation requirements (connection, mapping, booking create/update/cancel, **financial flow**, rate limiting, **reconciliation**, and **alerts** — the three bolded ones are the real gaps; everything else is already live-proven, see `docs/CLOCK_SANDBOX_VALIDATION_REPORT.md` and today's `docs/CLOCK_RUNBOOK.md`/`CLOCK_WEBHOOK_FLOW.md`). Feeds directly into Milestone 12 Task 16/17's still-open items (`docs/roadmap/completed/12-integration-and-initial-release.md`).

**Split for tonight, in parallel:**
- **Codex → Task A (Reconciliation scheduling)** — smallest, almost pure wiring of an already-built, already-tested service onto an already-defined queue.
- **Claude → Task B (Missing-webhook / sync-failure alerting)**
- **Claude → Task C (Folio/financial visibility)** — largest and most sensitive, kept deliberately narrow (see its own scope note).

**Real merge-conflict risk, expected and fine**: all three add a new branch to `ClockWorkerService.process()`'s dispatch and touch `apps/api/src/app.module.ts`'s provider list. Whoever's PR lands second just resolves a small, mechanical conflict there — not a reason to serialize the work. If two new Prisma migrations land the same night, whoever merges second bumps their migration's timestamp to sort after the other's (`ls apps/api/prisma/migrations` to check what's ahead of you before naming yours).

---

## Task A — Automatic reconciliation (Codex)

**Problem**: `ClockBookingConsistencyService` (`apps/api/src/integrations/clock/clock-booking-consistency.service.ts`) is real, tested, and already compares local bookings against Clock for a given date range — but nothing calls it automatically. It only runs when something manually invokes `.check()`. Clock's "reconciliation" requirement means this needs to run on its own.

**What already exists, reuse it, don't rebuild it**:
- `ClockBookingConsistencyService.check(tenantId, propertyId, range)` — the actual comparison logic, unchanged.
- The `clock.reconciliation` queue already exists in `CLOCK_QUEUE_NAMES` (`apps/api/src/integrations/clock/clock-queue-names.ts`) with priority 4 — it's just never been used.
- `ClockQueueService` (`clock-queue.service.ts`) for enqueueing.
- `ClockWorkerService`'s `process()` dispatch pattern (`clock-worker.service.ts`) — follow the exact same style as the `clock.webhooks`/`hydrate-event` branch added earlier tonight (`processHydrateEvent`) for a new `processReconcile` branch.

**Scope**:
1. A way to enqueue a *repeating* job onto `clock.reconciliation` — BullMQ supports this natively via a job's `repeat: { pattern: '<cron>' }` option on `Queue.add()`. Once a day is a reasonable starting cadence (this is a background health check, not latency-sensitive). Register the repeatable job on module init (same `onModuleInit` pattern `ClockWorkerService` already uses), not on every request.
2. For each tenant/property with an active, enabled Clock connection (`IntegrationConnectionsService` already has the query pattern for this — see `activePmsConnectionCredentials` and how `ClockBookingConsistencyService.checkInternal` calls it), enqueue (or directly run) a `.check()` over a recent rolling window (e.g. last 31 days, matching the method's own existing 31-day limit — see `assertDateRange`).
3. `ClockWorkerService.process()`: a new branch for `clock.reconciliation`/`reconcile-property` (or similar job name) that calls `.check()` and does nothing extra — the method already writes an audit log and already calls `reportOperationalFailure` when it finds mismatches (see `checkInternal`'s existing `if (result.findings.length > 0) reportOperationalFailure(...)`). Don't duplicate that alerting here.

**Non-goals for tonight**: extending the checker to catalog/rate drift (bookings only, matching its current real scope); a configurable cadence/admin UI for the schedule.

**Acceptance criteria**: a real, scheduled run happens without any manual trigger (provable via BullMQ's repeatable-job registration being visible in Redis, or a real test forcing the cron to fire), and when a genuine local/Clock mismatch exists, it's found and alerted exactly the way an on-demand check already proves today (real e2e, not just code review — same bar as everything else in this integration).

---

## Task B — Missing-webhook / sync-failure alerting (Claude)

**Problem**: Clock explicitly lists "alerts" as a production-activation requirement. Two sub-cases:

1. **Sync/job failures** — largely **already covered**, just needs confirming and documenting: `ClockWorkerService.onModuleInit()`'s `worker.on('failed', ...)` handler already calls `reportOperationalFailure` (Sentry-backed, see `apps/api/src/observability/error-tracking.ts`) once a job exhausts its retries, for every queue including `clock.webhooks`. Verify this is real (it already looks real from tonight's code, but hasn't been independently proven with a forced failure) rather than building something new.
2. **Missing webhooks** — genuinely not built. Nothing today notices if Clock stops sending messages for a connection that should be receiving them (e.g. the subscription silently breaks, gets unsubscribed, or the endpoint starts failing without anyone noticing).

**Scope**:
1. A new nullable column on `integration_connections` — `last_webhook_received_at timestamptz` — following the exact pattern the table already has for `last_tested_at`/`last_test_result` (same table, same style, don't invent a new convention).
2. `ClockWebhookService.handle()` (`clock-webhook.service.ts`) updates this column whenever a real `Notification` is processed (not on `SubscriptionConfirmation`, not on a rejected/400 request) — one `UPDATE` alongside the existing `provider_events` insert, same transaction.
3. A scheduled check (reuse the same repeatable-BullMQ-job pattern Task A introduces — coordinate naming/timing so this doesn't fight Task A's cron registration in `onModuleInit`, ideally both live in the same small scheduler service rather than two separate ad hoc ones) that flags any enabled Clock connection whose `last_webhook_received_at` is null or older than a threshold (suggest 48 hours — Clock's own traffic is guest/staff-activity-driven, not constant, so don't make this too sensitive) and calls `reportOperationalFailure`.

**Non-goals for tonight**: the full brief's metrics list (request/duration/queue-depth counters etc.) — that's a much bigger, separate "observability" effort, not an "alert," and isn't part of tonight's scope.

**Acceptance criteria**: real e2e forcing both cases — a job that exhausts retries produces a real alert (if not already proven, prove it for real, don't just read the code and assume); a connection with a stale/absent `last_webhook_received_at` past the threshold produces a real alert when the check runs.

---

## Task C — Folio/financial visibility (Claude, deliberately narrow scope)

**Problem**: "Financial flow" is Clock's own named requirement, and it's the one genuinely unbuilt gap with real data behind it already — `folio_update` and `folio_close` events have been arriving live all evening (real captured shape: `{"folio_id": <id>}`, same bare-ID pattern as booking events — see `docs/CLOCK_WEBHOOK_FLOW.md`) and are currently just acknowledged, never fetched or applied.

**Why this stays narrow tonight, on purpose**: a folio is Clock's bill for a booking — real money, real charges, real payments. This project's own conventions (`AGENTS.md`) treat guest-payment/billing code paths as the single highest-care area in the whole codebase. Building real payment reconciliation (matching Clock folio charges against MUST's own `Payment` rows, deciding what happens on a mismatch, deciding whether MUST ever writes back to a folio) is a genuinely separate, bigger, higher-stakes design question that deserves its own dedicated pass — not something to improvise at the tail end of a long day before a certification call. Tonight's goal is only: **make folio state visible**, so Clock sees real coverage of the flow, without MUST's own financial records being touched at all.

**Scope**:
1. Before writing any code: confirm the real `GET /folios/{folio_id}` response shape against the sandbox (same "verify against real, not a doc guess" discipline as everything else today — a diagnostic script like today's `fetch-clock-booking-detail.js`, not committed, same throwaway-script convention). Real folio ids already captured tonight to test against: `76089568`, `76090570`.
2. Two new nullable columns on `bookings` (or, if the real shape suggests it's cleaner, a small new `clock_folio_id`/`clock_folio_balance`/`clock_folio_status` — decide once the real shape is known) — visibility only, no FK to `payments`, no write path back to Clock.
3. `ClockWorkerService` gets a new branch (alongside the `booking_*` types) for `folio_update`/`folio_close` that fetches the folio and updates those columns on whichever local booking it belongs to (folio → booking linkage: check the real response for a `booking_id`, matching pattern to how the booking hydration service already resolves things).
4. Surface it somewhere real — even just visible in an existing admin/API response is enough for tonight; a dashboard UI change is not required.

**Explicit non-goals for tonight**: writing to `payments`/`payment_provider_sessions`; any reconciliation between Clock folio charges and MUST payments; any code path that could plausibly touch platform billing; a UI beyond making the data queryable.

**Acceptance criteria**: real e2e proving a `folio_update`/`folio_close` event correctly updates the linked booking's folio-visibility fields, using the real captured payload shape (not a guessed one) — same rigor as tonight's booking hydration tests.

---

## After these three: the "what to send Clock" document

Separate, sequenced after Tasks A-C land (or in parallel with them, since it's pure writing, not code) — a real, honest summary of MUST's Clock integration to send ahead of the certification call, per Clock's own stated requirement ("integration data and workflows are required so we can prepare validation test cases prior to our meeting"). Draws from `CLOCK_ARCHITECTURE.md`, `CLOCK_WEBHOOK_FLOW.md`, `CLOCK_DATA_MAPPING.md`, `CLOCK_ERROR_CATALOGUE.md`, `CLOCK_RUNBOOK.md`, and tonight's three closed gaps — written to be read by Clock's integration team, not as internal engineering documentation.
