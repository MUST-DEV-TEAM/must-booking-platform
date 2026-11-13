# Backend review, 2026-11-13

Step 2 of the layered review (database, backend, frontend). Step 1 is the [database review](database-review-2026-11-13.md). This file is the task list for the models that execute the work.

**How it was checked.** The API code (`apps/api`, about 90,000 lines) was mapped and the risky parts were read: startup, configuration, authentication, the Clock client and workers, the sync loop, refunds and invitations. On the live server the API log since the last restart (9 hours), the job queues, the Redis settings and the container settings were inspected read-only. Live data was read as counts and patterns only. Nothing was changed. The test suite was not run.

**What the live system does today.** In 9 hours the API served about 1,000 real requests and made 48,516 calls to Clock (all answered 200). It logged no errors, no 5xx responses and never restarted.

## Ranked tasks

| # | Task | Priority | Risk of the fix | Who runs it |
| --- | --- | --- | --- | --- |
| B1 | A password reset leaves old sessions signed in | Now | Low-medium | Opus |
| B2 | The API is killed, not stopped, on every deploy | Now | Low | Sonnet |
| B3 | Review queue: stop the noise and the duplicates | Soon | Medium (live rows need owner go) | Opus |
| B4 | Luxury: 29 Clock bookings are missing from MUST, and no webhooks | Soon | None (staff action and a question) | Owner, hotel staff |
| B5 | Dead-letter queue holds 926 jobs that nobody sees | Soon | Low | Sonnet |
| B6 | Health check says "ok" without checking anything | Soon | Low | Sonnet |
| B7 | Redis can lose up to an hour of sessions, links and queued jobs | Soon | Low (short restart) | Sonnet |
| B8 | Failed webhook events keep no reason | Soon | Low | Opus |
| B9 | Two older security findings are still open | Before self-serve sign-up | Medium | Opus |
| B10 | Re-check the 15 money-flow findings from September | Soon | None (reading only) | Fable or Opus |
| B11 | Unit tests for the native booking path before the first native hotel | Before Milestone 25 go-live | Low | Opus |
| B12 | Log noise | Later | Low | Sonnet |
| B13 | One process does everything | No action now | - | - |

## Task details

### B1. A password reset leaves old sessions signed in

- **Found:** `AuthService.resetPassword` (`apps/api/src/auth/auth.service.ts:307`) consumes the token, saves the new password and writes an audit row. It does not end the user's existing sessions. Someone who already got into an account stays in after the owner resets the password. This was finding MBA-102 in September and is still open.
- **Change:** keep a per-user list of session ids in Redis; on password reset and password change delete every session except the current one, and delete the user's other unused reset tokens.
- **Verify:** a test that signs in, resets the password, then calls the API with the old cookie and gets 401.

### B2. The API is killed, not stopped, on every deploy

- **Found:** `main.ts` never calls `enableShutdownHooks()`, the container runs Node as process 1 with no init process, and the compose file sets no stop grace period. Nest therefore never runs its 60 shutdown handlers (worker close, Redis quit), and Docker kills the API after 10 seconds. Jobs in flight (a Clock booking write, a refund, an email) are cut mid-way and rely on later recovery. There were five deploys on the evening of 2026-11-12.
- **Change:** call `app.enableShutdownHooks()`; add `init: true` and `stop_grace_period: 30s` to the api service; make sure each worker's close waits for its active job.
- **Verify:** on the local stack `docker stop` returns in under 10 seconds with exit code 0 and the log shows the workers closing; no job is left in a queue's `active` list.

### B3. Review queue: stop the noise and the duplicates

- **Found on live:**
  - Empire has 743 open "Clock booking total has no valid currency" items. 742 of those bookings are cancelled, 740 have a zero total and 739 are in the past. Staff can do nothing with them.
  - Items are duplicated: 743 items for 734 bookings; 30 open "successful payment but no deposit folio" items on a hotel with 7 paid bookings in total.
  - Staff have resolved one item per hotel, ever. The system closed 72. The queue is not being used.
- **Change:** do not raise a review item for a cancelled or zero-total imported booking. Give each kind of item a stable key and a unique rule for open items, so a repeat updates the existing item. Close an item automatically when its condition clears. Closing the 742 existing Empire rows changes live data and needs the owner's go.
- **Verify:** open items on Empire and Luxury drop to the ones a person can act on; running the same check twice does not add a row.

### B4. Luxury: 29 Clock bookings are missing from MUST, and no webhooks

- **Found:** 18 Luxury bookings were not imported because their total has no valid currency, and 11 because their room type has no confirmed mapping. They exist in Clock but not in MUST's reservation list or reports. Luxury has also never received a Clock webhook, so it is kept current by polling only.
- **Action:** hotel staff confirm the missing room-type mappings in Settings. The owner decides whether Luxury should have webhooks; if yes, the subscription is created in Luxury's Clock account.
- **Question:** all 13 website bookings at Empire paid by PokPay ended cancelled (7), expired (4) or availability-failed (2, both on 2026-11-12); none is confirmed. If these were all tests, nothing is wrong. If any was a real guest, the paid website flow at Empire needs a look first.

### B5. Dead-letter queue holds 926 jobs that nobody sees

- **Found:** `clock.dead-letter` has 926 waiting jobs (902 `hydrate-event`), the oldest from 2026-09-11, the newest about a week old. Nothing reads the queue and nothing alerts on it. The failed lists of `clock.webhooks` (883) and `clock.reconciliation` (22, all from September) are kept forever.
- **Change:** alert when the dead-letter count grows; show the count in the platform console; set an age limit on failed jobs. Deleting the old entries is a live Redis change and needs the owner's go.
- **Verify:** a forced failure on the local stack raises the alert once.

### B6. Health check says "ok" without checking anything

- **Found:** `GET /health` returns `{status:'ok'}` without touching Postgres or Redis (`apps/api/src/health/health.controller.ts`). The deploy gate and the ops check both use it, and the api container has no health check of its own. A deploy can pass while the database is unreachable. This was finding MBA-301 and is still open.
- **Change:** add a readiness check that runs `SELECT 1` and a Redis `PING` with a short timeout; point the deploy gate and a compose `healthcheck` at it; keep the cheap check for liveness.
- **Verify:** stop Redis on the local stack; readiness answers 503 and the deploy script refuses.

### B7. Redis can lose up to an hour of sessions, links and queued jobs

- **Found:** Redis runs with `appendonly no` and snapshots every 5 to 60 minutes. It holds staff sessions, password-reset and invitation tokens, WordPress pairing codes and every queued job. A crash or a hard server restart loses whatever came after the last snapshot: staff are signed out, fresh invitation links stop working, queued emails and webhook jobs vanish (webhook events and emails also have database rows and recovery sweeps; tokens do not).
- **Change:** `appendonly yes` with `appendfsync everysec` in the compose command. Redis must restart, so it needs the owner's go.
- **Verify:** `redis-cli CONFIG GET appendonly` returns `yes`; a session survives `docker restart` of Redis.

### B8. Failed webhook events keep no reason

- **Found:** an Empire `booking_canceled` event was marked `FAILED` on its first attempt on 2026-11-12. The booking itself is correctly cancelled, so no harm was done. `provider_events` has no column for the failure reason, so the cause cannot be read back. An older failed job in the same queue shows "Unable to start a transaction in the given time", a temporary database error that should be retried, not treated as final.
- **Change:** store the last error on the event row; treat pool and transaction-start timeouts as retryable. The [database review](database-review-2026-11-13.md) task 2 removes most of the contention behind such timeouts.
- **Verify:** a test that injects that error sees the job retried and the reason saved.

### B9. Two older security findings are still open

- **Clock host (MBA-105):** `parseClockCredentials` (`apps/api/src/integrations/clock/clock-credentials.ts`) only trims the host a hotel admin types in. The server then sends requests to that host. Restrict it to Clock's real domains; take the pattern from `docs/integrations/clock`, do not guess it.
- **Invitation activation (MBA-107):** the new-account path of `StaffInviteService.activate` (`apps/api/src/tenancy/staff-invite.service.ts:356`) takes the email from the request and does not compare it with the invited address. This appears still open; confirm with a test, then bind the account to the invited email.
- **Why not "now":** only platform staff set up hotels today. Both must be closed before hotels can sign up and connect a PMS on their own.

### B10. Re-check the 15 money-flow findings from September

- **Found:** the September audit left 43 records in `docs/audit/FINDINGS.md`. Nine were re-checked today against current code and live data:
  - Fixed or no longer occurring: MBA-100 (suspension is enforced in the guards), MBA-019 (the reservations list is paged), MBA-012 (a pending refund is saved as pending), MBA-010 (no reconciliation failure since 2026-09-30), MBA-101 (login limits exist).
  - Still open: MBA-102 (task B1), MBA-105 and MBA-107 (task B9), MBA-301 (task B6).
- **Not re-checked:** MBA-001 to 009, 011 and 013 to 017 (checkout rollback, late PokPay capture, multi-room checkout, hydration overwrites, event ordering, connection identity, refund allocation, payment timeouts, email recovery).
- **Change:** one bounded pass per finding: read the cited code, mark it fixed or open with the file and line, update the status in `FINDINGS.md`. No code changes in this task.

### B11. Unit tests for the native booking path before the first native hotel

- **Found:** `local-pms.provider.ts` (2,257 lines) is the booking engine for hotels without Clock. It has never run on live (the native inventory tables are empty). `apps/api/src/tenancy` is 38,610 lines with 10 unit test files; it is covered mostly by the 124 end-to-end files.
- **Change:** before Milestone 25 goes live, add concurrency tests for the native path: two guests booking the last room, booking during a block, cancel releasing inventory. Pair it with database task 12 (the database-level guard).

### B12. Log noise

- **Found:** 96% of log lines are one info line per Clock GET (48,516 in 9 hours) and two lines per health check. One warning about 8 test bookings was written 4,077 times; the open branch `fix/clock-financial-sync-backoff` already addresses that one.
- **Change:** log Clock GETs at debug level and drop the health-check lines.

### B13. One process does everything (no action now)

The same Node process serves HTTP, runs the workers of 19 queues and runs the one-second sync timer, on one CPU core. That is fine at 1,000 requests per 9 hours. When a fourth hotel or the native PMS arrives, run the workers as a second container from the same image, so a slow sync cannot slow a guest's booking.

## Verified healthy

- No errors, no 5xx and no restarts in the inspected window. Sentry is configured on live.
- The Clock rate limiter keeps capacity for guest requests apart from background sync (4 requests a second per hotel, under Clock's 5).
- Every outbound HTTP call has a timeout.
- The database pool is set explicitly (10 connections, 20 s wait).
- All working queues are empty; nothing is stuck waiting.
- Empire's webhooks arrive and are processed.
- Hotel suspension, login limits, paged reservation lists and pending refunds are handled (see B10).

## Not checked

- The test suite was not run.
- Booking, checkout and refund code was not read line by line; task B10 covers it.
- The WordPress plugin and the Next.js proxy belong to the frontend step.
- Stripe: no Stripe keys are set on live, so that path is not in use.
