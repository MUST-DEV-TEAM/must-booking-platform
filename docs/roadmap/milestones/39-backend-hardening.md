# Milestone 39: Backend hardening

Status: **Planned 2026-11-14. Owner decisions recorded the same day (section 2). Task 5 (reading) done 2026-11-14. Nothing else built. Ready to execute.**

Source: [backend review, 2026-11-13](../../audit/backend-review-2026-11-13.md) (tasks B1 to B13) and items 7, 8, 9 and 11 of the [database review](../../audit/database-review-2026-11-13.md), which [Milestone 38](38-database-hardening.md) handed to this plan. The task table is the spec; the reviews hold the evidence.

## 1. Goal and limits

Make the API safe to restart, honest about its own health, and quiet enough that a real problem is seen: sessions end when a password changes, a deploy does not cut work in half, the review queue holds only what a person can act on, and failures leave a reason. No change to what a booking, payment or refund does.

Out of scope here, planned elsewhere:

- The booking, payment and cancellation flow (tasks L1 to L18 of the [booking flow review](../../audit/booking-flow-review-2026-11-13.md)), including moving Clock and PokPay calls out of long transactions (L3). That needs its own plan.
- The database-level guard against double booking (database item 12): Milestone 25.
- The flaky web test `apps/web/app/dashboard/payments.test.tsx` ([open follow-up 2](../open-follow-ups.md)). It failed two pull requests on 2026-11-13 and passed on re-run. Frontend plan.
- Running the workers as a second container (B13). Recorded trigger: a fourth hotel, or the first native hotel.

Already done since the review (2026-11-13): the repeated warning about eight test bookings (part of B12) stopped with #475; the database contention behind some failed webhook jobs (B8) was reduced by Milestone 38 task 2.

## 2. Owner decisions (2026-11-14)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Empire's 13 website bookings paid by PokPay all ended cancelled, expired or availability-failed. Were they all tests? | Yes, all tests. No real guest was affected. |
| D2 | Should Luxury receive Clock webhooks? | Yes. The subscription is created in Luxury's Clock account (task 12). |
| D3 | Close the existing review items nobody can act on (742 at Empire, plus duplicates)? | Yes, after a count-only run is reviewed. Rows are marked resolved with a reason, not deleted. |
| D4 | Give the 837 old failed `folio_update` events a final state, and clear the 926 old dead-letter jobs and old failed-job lists in Redis? | Yes, after the counts are reviewed. Event rows are kept. |
| D5 | A Redis restart of a few seconds (task 9). | Yes, outside busy hours. Persistence is switched on first without a restart, so sessions survive it. |
| D6 | After a password reset by emailed link: sign the account out everywhere. After a password change while signed in: keep only the current session. | Yes. |

The decisions approve the approach. Each merge still deploys and needs the owner's go for that task, and steps that change live rows or Redis contents still wait for the owner's review of the counts.

## 3. Rules for whoever executes

- The [Milestone 38 rules](38-database-hardening.md#3-rules-for-whoever-executes) apply unchanged: one task, one branch, one pull request; CI green; every merge deploys and needs the owner's go; migrations additive and idempotent with the rollback in a comment; Empire and Luxury read-only, tests on Must Hotel; after each deploy the verify step is run on live (read-only) and the numbers go in the pull request.
- Before pushing API changes: `npx tsc --noEmit -p tsconfig.build.json` in `apps/api`, eslint on changed files, and every existing spec of a touched service. Vitest does not typecheck.
- A change to live rows or to Redis contents (tasks 6, 7, 8) ships in two releases, like Milestone 38 task 8: first count and log, the owner reviews, then act.
- Model tiers: Sonnet for routine tasks, Opus for the ones marked so, Fable for the reading and design tasks.

## 4. Tasks, in execution order

| # | Task | Closes | Needs | Risk | Runs |
| --- | --- | --- | --- | --- | --- |
| 1 | Stop the API cleanly on deploy | B2 | - | Low | Sonnet |
| 2 | A password reset or change ends the other sessions | B1 (MBA-102) | D6 | Low-medium | Opus |
| 3 | A readiness check that tests Postgres and Redis; the deploy gate uses it | B6 (MBA-301) | Task 1 merged (same files) | Low | Sonnet |
| 4 | Quieter logs | B12 | - | Low | Sonnet |
| 5 | Re-check the 15 money-flow findings from September | B10 | - | None (reading) | Fable |
| 6 | Review queue: only what a person can act on, never twice | B3, database 7 | D3 for step 3 | Medium | Opus |
| 7 | Failed webhook events keep a reason; temporary errors retry | B8, database 8 | D4 for step 3 | Low | Opus |
| 8 | Dead-letter queue: seen, alerted, bounded | B5 | D4 for step 3 | Low | Sonnet |
| 9 | Redis keeps its data through a crash | B7 | D5 | Low, short restart | Sonnet |
| 10 | Two security findings, before hotels sign up on their own | B9 (MBA-105, MBA-107) | - | Medium | Opus |
| 11 | Tests for the native booking path | B11 | Before Milestone 25 go-live | Low | Opus |
| 12 | Luxury: missing bookings and webhooks | B4, database 9 | D2; hotel staff | None in code | Owner, hotel staff |
| 13 | Database owner role without superuser rights: design | Database 11, Milestone 38 task 9 | - | Design, no code | Fable |

Tasks 1 to 5 are independent of the owner decisions and can start at once; 1 goes first because it makes every later deploy safer. Tasks 6 to 8 share the count-then-act pattern. Task 10 is gated by self-serve sign-up, task 11 by Milestone 25.

### Task 1. Stop the API cleanly on deploy

- **Where:** `apps/api/src/main.ts` (no `enableShutdownHooks()` today), `infrastructure/containers/compose.homelab.yaml` (api service).
- **Change:** call `app.enableShutdownHooks()`. Add `init: true` and `stop_grace_period: 30s` to the api service. Check each BullMQ worker's `onModuleDestroy` awaits `worker.close()` (which waits for the active job) and that the one-second Clock sync timer is cleared and its running tick awaited.
- **Do not change:** job retry rules or the recovery sweeps; they stay as the second line.
- **Verify:** on the local stack, `docker stop` of the api returns in under 10 seconds with exit code 0 while a job is running, the log shows the workers closing, and no queue has a job left in `active`. After the deploy: the next deploy's log shows the same.
- **Rollback:** revert.

### Task 2. A password reset or change ends the other sessions

- **Where:** `AuthService.resetPassword` (`apps/api/src/auth/auth.service.ts`), the password-change path, and the session store in Redis.
- **Change:** keep a per-user set of session ids in Redis (added at sign-in, removed at sign-out and expiry). On reset by emailed link: delete every session of the user and their other unused reset tokens. On change while signed in: delete every session except the current one. Record `auth.sessions_revoked` with the count in the audit log.
- **Sessions that exist at deploy time** are not in any set. Either backfill the sets once from the existing session keys at startup, or accept that they are covered from their next sign-in; state which in the pull request. Do not sign everyone out.
- **Tests:** sign in twice, reset the password, the old cookie gets 401; change the password, the other session gets 401 and the current one still works; a second reset token for the same user no longer works.
- **Rollback:** revert; the sets expire with the sessions.

### Task 3. A readiness check that tests Postgres and Redis

- **Where:** `apps/api/src/health/health.controller.ts`, `infrastructure/containers/deploy-release.sh` (`healthy()` greps `"status":"ok"`), the compose file, `.github/workflows/uptime.yml`.
- **Change:** add `GET /health/ready`: `SELECT 1` through the application pool and a Redis `PING`, each with a 2 second timeout; 200 when both answer, 503 naming the part that failed (no details beyond the name). `GET /health` stays as the cheap liveness answer. Point the deploy gate at the readiness path, add a compose `healthcheck` for the api, and make the uptime workflow call readiness.
- **Verify:** on the local stack stop Redis: readiness answers 503 and the deploy script refuses. On live: both paths answer 200.
- **Rollback:** point the gate back at `/health`.

### Task 4. Quieter logs

- **Change:** log Clock GET requests at debug level (errors and non-2xx stay at their level); do not log the health-check requests. Keep one summary line a minute per hotel with the number of Clock calls, so the volume is still visible.
- **Verify:** on live, log lines per hour fall by more than 90% with the same activity; a failed Clock call is still logged.

### Task 5. Re-check the 15 money-flow findings from September

- **Scope:** MBA-001 to 009, 011 and 013 to 017 in `docs/audit/FINDINGS.md` (checkout rollback, late PokPay capture, multi-room checkout, hydration overwrites, event ordering, connection identity, refund allocation, payment timeouts, email recovery).
- **Method:** one bounded pass per finding: read the cited code as it is today, mark it fixed or open with file and line, update its status in `FINDINGS.md`. No code changes. Where a finding matches a task of the booking flow review (L1 to L18), link the two instead of describing it twice.
- **Result:** a short list of what is still open, handed to the booking-flow plan.
- **Done 2026-11-14** (code reading only; each finding carries a "Re-check" line in `FINDINGS.md`):

  | Result | Findings |
  | --- | --- |
  | Fixed | MBA-006 (cancellation terms frozen at booking), MBA-007 (unknown Clock status goes to review) |
  | Mostly fixed or mitigated | MBA-009, MBA-013, MBA-015, MBA-016 (refunds), MBA-017 |
  | Open, for the booking-flow plan | MBA-002 (same as L1), MBA-003 (near L16), MBA-004, MBA-008, MBA-014, and the L3 part of MBA-016 |
  | Open, only matters for Stripe (Milestone 37) | MBA-001, MBA-011 |
  | Open, only matters for native hotels (Milestone 25) | MBA-005 |

  Parts marked "not re-checked" in `FINDINGS.md` still need a look when their plan is written.

### Task 6. Review queue: only what a person can act on, never twice

- **Found on live:** 743 open "booking total has no valid currency" items at Empire, of which 742 are cancelled bookings; 743 items for 734 bookings; 30 "payment but no deposit folio" items on a hotel with 7 paid bookings. `manual_review_items` has no rule against a second open item for the same thing.
- **Step 1, code (no live rows touched):**
  - Do not raise an item for an imported booking that is cancelled or has a zero total.
  - Add a nullable `dedupe_key` column, filled as `<category>:<kind>:<reference_type>:<reference_id>` by `ManualReviewService` for every new item, and make raising an item with the key of an open item update that item (count and last-seen time) instead of inserting. The `FINANCIAL_SYNC_BLOCKED` note added in #475 does its own look-up first; move it onto the key.
  - Close an item automatically when the condition that raised it is checked again and has cleared.
- **Step 2, count only:** a script or nightly log line that reports, per hotel, how many open items step 3 would close and why (cancelled booking, zero total, duplicate of an older open item). The owner reviews the numbers.
- **Step 3, with the owner's go (D3):** mark those rows `RESOLVED` with a resolution note in `context`, Must Hotel first, then Empire and Luxury. Then add the partial unique index `(tenant_id, property_id, dedupe_key) WHERE status = 'OPEN' AND dedupe_key IS NOT NULL` in a migration that first verifies no duplicates remain and otherwise stops without changing anything.
- **Verify:** open items at Empire and Luxury are ones a person can act on; running the same check twice adds no row; the count before and after goes in the pull request.
- **Rollback:** step 3 is a status change with the previous status kept in `context`; the nightly backup is the second line.

### Task 7. Failed webhook events keep a reason; temporary errors retry

- **Step 1, code:** add `provider_events.last_error` (short text, no payload, no guest data) written on every failed attempt. Treat pool and transaction-start timeouts ("Unable to start a transaction in the given time", connection errors) as retryable, with the existing backoff, instead of final.
- **Step 2, count only:** report per hotel the `FAILED` events by type and age, and for each `booking_*` event whether the booking in MUST already matches Clock's state (the booking sync should have caught it).
- **Step 3, with the owner's go (D4):** give failures older than 14 days whose booking is consistent a final state. Check first whether an existing status (`IGNORED`) says the right thing; add a new enum value only if not. Rows are kept: they are the duplicate guard.
- **Tests:** a test that injects the transaction-start error sees the job retried and the reason saved.
- **Verify:** `FAILED` count is zero or every row has a reason.

### Task 8. Dead-letter queue: seen, alerted, bounded

- **Step 1, code:** show the `clock.dead-letter` count and the oldest entry's age in the platform console. Raise one alert (the existing platform alert email) when the count grows, not one per job. Set `removeOnFail` with an age limit (30 days) on `clock.webhooks` and `clock.reconciliation`, so failed lists stop growing for ever.
- **Step 2, count only:** log the dead-letter jobs by name and month.
- **Step 3, with the owner's go (D4):** remove dead-letter jobs older than 30 days and trim the old failed lists. This is a live Redis change. Webhook events also have database rows, so nothing is lost that task 7 does not account for.
- **Verify:** a forced failure on the local stack raises the alert once; after step 3 the console shows the real, small number.

### Task 9. Redis keeps its data through a crash

- **Change:** in `compose.homelab.yaml`, give the `redis` service `command: redis-server --appendonly yes --appendfsync everysec`.
- **Order on deploy, so nothing is lost:** before the merge, the owner (or Claude with the owner's go) runs `redis-cli CONFIG SET appendonly yes` on live. Redis then writes its append-only file while running. The merge recreates the container, which starts from that file with every session, token and queued job intact. Merge outside busy hours.
- **Verify:** `redis-cli CONFIG GET appendonly` returns `yes`; a session opened before the restart still works after it; queues are not empty-by-accident (compare job counts before and after).
- **Rollback:** remove the command and redeploy; Redis falls back to snapshots.

### Task 10. Two security findings, before hotels sign up on their own

- **Clock host (MBA-105):** `parseClockCredentials` (`apps/api/src/integrations/clock/clock-credentials.ts`) accepts any host an admin types, and the server then sends requests there. Restrict it to Clock's real API domains. Take the allowed pattern from `docs/integrations/clock`; if the docs do not state it, record it as unverified and ask, do not guess. Check the saved connections on live against the pattern first (read-only), so no working hotel is refused.
- **Invitation activation (MBA-107):** first a test that shows whether the new-account path of `StaffInviteService.activate` accepts a different email than the invited one. If it does, bind the new account to the invited address and refuse a mismatch.
- **Gate:** not urgent while only platform staff set up hotels; must be merged before self-serve sign-up or PMS connection by hotels opens.

### Task 11. Tests for the native booking path

- **Change:** concurrency tests for `local-pms.provider.ts` against a real database: two guests booking the last room (exactly one succeeds), booking during a block, a cancellation releasing the room, a multi-room booking where one room is gone. Pair with the database guard of Milestone 25.
- **Gate:** before the first native (non-Clock) hotel goes live.

### Task 12. Luxury: missing bookings and webhooks

- **Hotel staff:** confirm the missing room-type mappings in Settings; 11 bookings then import. The 18 bookings whose total has no valid currency need a look in Clock by the hotel.
- **Owner (D2):** if yes, the webhook subscription is created in Luxury's Clock account, following the [Clock runbook](../../integrations/clock/runbook.md). This is a change in a real hotel's Clock account and is done by the owner or with their explicit go.
- **Verify (read-only):** Luxury has rows in `provider_events` and a recent `last_webhook_received_at`; the count of Clock bookings missing from MUST is zero or each has a reason.

### Task 13. Database owner role without superuser rights: design

- **What:** the design that Milestone 38 task 9 left for the security review. One superuser role owns every table and all 31 `SECURITY DEFINER` functions today. Target: a superuser for maintenance only, an owner role for migrations that is not a superuser, the application role as now; each cross-hotel function gets its access by an explicit policy or a dedicated role with `BYPASSRLS` and nothing else.
- **Deliverable:** an ADR with the role layout, the list of the 31 functions and what each needs, and a migration path tested on a restored copy, including how backups (`pg_dump` needs to read every table) and `prisma migrate deploy` keep working. No code in this milestone.

## 5. Done when

- A password reset signs an intruder out.
- A deploy lets running work finish, and refuses to go live when the database or Redis is unreachable.
- A crash of Redis loses at most one second of sessions, links and queued jobs.
- The review queue of each real hotel is short enough to clear in a day, and no item appears twice.
- Every failed webhook event and dead-letter job is either retried, closed with a reason, or raises one alert.
- The September money-flow findings are each marked fixed or open, and the open ones are in the booking-flow plan.
- The two security findings and the native-path tests are done before their gates open.
