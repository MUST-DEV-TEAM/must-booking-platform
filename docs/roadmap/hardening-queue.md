# Hardening execution queue (Milestones 38 to 41)

Written 2026-11-15. This file turns the tasks of [Milestone 39](milestones/39-backend-hardening.md) and [Milestone 40](milestones/40-booking-flow-hardening.md) into slices small enough for one agent, one branch and one pull request, and puts them in one order. The milestone files stay the spec: each slice names its task there, and the task holds the change, the limits and the verify step. Nothing here changes a decision or a task.

Not sliced here:

- [Milestone 38](milestones/38-database-hardening.md) is already running. Its open tasks (6, 7, 8 second release, 9) follow its own file.
- Milestone 41 (frontend) is planned in pull request #483 and not merged. It gets its slices when it is.

## 1. How one slice runs

One agent at a time. The steps are the same for every slice.

1. **Brief.** The orchestrator (Fable) gives the implementing agent the brief in section 2 with the slice id. For a slice marked **Brief: Fable**, it first reads the code and adds the exact change (functions, the cases to handle, the tests to write) to the brief. The implementing agent does not design.
2. **Implement.** A Sonnet agent, on a fresh branch from `origin/main`, changes only the files of the slice, adds the slice's test and opens a pull request.
3. **Check.** The orchestrator runs `npx tsc --noEmit -p tsconfig.build.json` in `apps/api`, eslint on the changed files and every spec of each touched service. The full suite runs in CI, not locally.
4. **Review.** For a slice marked **Review: Fable**, the orchestrator reads the diff against the task. The answer is approve or a short fix list; at most two rounds, then the slice is re-planned. A slice marked **Review: routine** is merged on green CI and the checks of step 3.
5. **Merge.** Every merge deploys to production. The owner gave a standing go on 2026-11-15 for slices that are green and reviewed; steps that change live rows or Redis contents, design approvals and anything on a real hotel still wait for the owner. Merge one slice at a time and let its deploy finish before the next merge: the pipeline deploys only the newest commit, so two quick merges share one deploy. After the deploy the task's verify step is run on live, read-only, and the result goes in the pull request.

Review is required for anything that touches money, refunds, payments, Clock writes, migrations, authentication or the deploy path. Everything else is routine.

Model tier: the milestone files assign some tasks to Opus. The owner asked on 2026-11-15 for Sonnet agents under a Fable brief and review. That is the default here. Slices marked **Opus advised** are the ones where a wrong build costs most; the owner decides per slice.

## 2. Brief for the implementing agent

Send this text with the slice id filled in. Add the exact change below it for a slice marked Brief: Fable.

> Repo: `c:\Users\devim\Desktop\Must-Booking`. Read `AGENTS.md` first.
> Do slice **<id>** of `docs/roadmap/hardening-queue.md`. Its task in the milestone file is the spec: follow its change, its limits ("do not change") and its verify step.
> Work in the main checkout (one agent at a time, so no second worktree and no second `node_modules`): `git fetch origin`, check `git status` is clean, then create the branch the slice names from `origin/main`. Use the Edit tool, not scripts, so line endings stay LF. Change only what the slice needs. Add the test the slice names.
> Before you finish: in `apps/api`, run `npx tsc --noEmit -p tsconfig.build.json`, eslint on the files you changed, and the specs of every service you touched. Do not run the full suite.
> Commit with pathspecs (the git index is shared), push, open a pull request. Do not merge. Do not touch a live host, a real hotel's data, Clock or PokPay.
> Report only: the pull request link, the files changed, the test results, and anything in the task you could not do or had to decide.

## 3. Queue

The order is by risk removed per unit of work, then by dependency. A slice can start when the slices in its Needs column are merged.

### Group A. Safer deploys (Milestone 39)

| Slice | What | Milestone task | Branch | Likely files | Test | Needs | Brief | Review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 39-1 | Stop the API cleanly on deploy **Merged 2026-11-15, #487.** | M39 task 1 | `fix/m39-clean-shutdown` | `apps/api/src/main.ts`, worker `onModuleDestroy` methods, `infrastructure/containers/compose.homelab.yaml` | A spec that a worker's `onModuleDestroy` awaits `close()`; `docker stop` on the local stack | - | Fable (list the workers and timers first) | Fable |
| 39-3 | Readiness check for Postgres and Redis; the deploy gate uses it **Merged 2026-11-15, #490.** | M39 task 3 | `feat/m39-readiness-check` | `apps/api/src/health/health.controller.ts`, `infrastructure/containers/deploy-release.sh`, the compose file, `.github/workflows/uptime.yml` | Controller spec: 200 when both answer, 503 naming the failed part; the deploy script test | 39-1 | Standard | Fable |
| 39-9 | Redis keeps its data through a crash **Live `CONFIG SET` done 2026-11-15; merged 2026-11-16, #496.** | M39 task 9 | `ops/m39-redis-appendonly` | `infrastructure/containers/compose.homelab.yaml` | None in code; the live order in the task | Owner's go for the live `CONFIG SET` | Standard | Fable |
| 39-4 | Quieter logs **Merged 2026-11-15, #488.** | M39 task 4 | `chore/m39-quieter-logs` | `apps/api/src/integrations/clock/clock-http-client.ts`, the request logger | Spec: a GET logs at debug, a failed call still logs at its level | - | Standard | Routine |

### Group B. Money or a promise goes wrong today (Milestone 40)

| Slice | What | Milestone task | Branch | Likely files | Test | Needs | Brief | Review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40-1a | A partial refund PokPay made is saved as refunded **Merged 2026-11-15, #489.** | M40 task 1, first sentence of the change | `fix/m40-partial-refund-status` | `apps/api/src/payments/pokpay-payment.provider.ts` (lines 222 and 419 decide by `isRefunded`) | Provider spec: refundable amount fell by the amount sent, status `REFUNDED`; unchanged amount stays pending | - | Fable | Fable |
| 40-1b | Previews count a pending refund as already refunded **Deferred: after #489 a PokPay refund is saved as refunded once proven, so pending rows are rare (one test booking; Stripe later).** | M40 task 1 | `fix/m40-preview-counts-pending-refunds` | The cancellation and refund preview code in `apps/api/src/payments` and `apps/api/src/booking` | Spec: a second partial refund preview after a pending first one | 40-1a | Fable | Fable |
| 40-1c | Staff action and sweeper settle a refund that really is pending **Deferred with 40-1b.** | M40 task 1 | `feat/m40-resolve-pending-refund` | `apps/api/src/payments/payment-refund.service.ts`, `payment-refund.controller.ts`, `payment-refund-recovery.service.ts`, the dashboard refund row | Spec: re-read PokPay, settle as refunded or failed, never send a second refund | 40-1a | Fable | Fable |
| 40-2a | A cancellation reports its refund's real outcome **Merged 2026-11-16, #505.** | M40 task 2 | `fix/m40-cancellation-refund-outcome` | `apps/api/src/booking/local-pms.provider.ts`, `apps/api/src/payments/hotel-cancellation-refund.service.ts`, `apps/api/src/mail/booking-cancellation-notification.service.ts` | Specs for refunded, pending and not made; the email promises a refund only in the first two | 40-1a | Fable | Fable |
| 40-2b | Cash plus card: refund the card part, show staff the cash amount **Merged 2026-11-16, #506.** | M40 task 2, D5 | `fix/m40-cash-plus-card-cancellation` | Same services as 40-2a, the dashboard cancellation result | Spec: mixed payment, card part refunded, cash amount in the answer | 40-2a | Fable | Fable |
| 40-3a | A paid order is always recorded, whatever the booking's state **Merged 2026-11-16, #492.** | M40 task 3, step 1 | `fix/m40-record-late-payment` | `apps/api/src/payments/pokpay-payment.service.ts` (lines 105 to 125) | Spec: paid order on an expired, a cancelled and a confirmed booking is recorded and the webhook gets 200 | - | Fable | Fable, Opus advised |
| 40-3b | Then confirm if the room is free at the same price, otherwise refund; tell guest and staff **Split 2026-11-17. Part 1 merged 2026-11-17 (#534, deployed; migration `20261117160000_booking_flows` applied on live): the ADR-0043 saved flow (`booking_flows`, step history, worker) refunds every late payment automatically (expired or cancelled booking, or a second payment on a confirmed one); a booking with earlier refunds or any other state goes to a person. Part 2: the owner chose option A on 2026-11-17 (keep ADR-0019: a late payment is refunded, not re-confirmed): the PokPay page now closes when the room hold ends (`expiresAfterMinutes` = minutes left on the hold), see its pull request. Also found by the live check: the 40-3a late-payment insert put a note on a charge row, which the database refuses (`payments_note_refund_only`), so every late payment since 2026-11-16 answered 500 and was lost; fixed in #536. Live check after #536 on Must Hotel (order of MH-261113-0935-Q9T7, 490.00 EUR): recorded and refunded automatically in 0.17 s, flow DONE with three history rows, staff notice and guest refund email DELIVERED.** | M40 task 3, steps 2 and 3 | `feat/m40-late-payment-confirm-or-refund` | `pokpay-payment.service.ts`, a new worker step, `apps/api/src/mail/payment-notification.service.ts` | Specs for both outcomes and for a refund that cannot be made (one review item) | 40-3a | Fable | Fable, Opus advised |
| 40-3c | Read PokPay's documentation for an order lifetime or cancel call | M40 task 3, step 4 | `docs/m40-pokpay-order-lifetime` | `docs/integrations/pokpay` | None (reading) | - | Done by Fable | - |
| 40-4 | Guest numbers are checked, also for Clock hotels and multi-room **Re-planned 2026-11-16 as 4a to 4d in the task (capacity on the room type, confirmed by the hotel, then enforced).** | M40 task 4 | `fix/m40-occupancy-checks` | `apps/api/src/booking/quote.service.ts` (about lines 605 and 628), `apps/api/src/booking/multi-room-booking.service.ts` | Specs: 9 adults in a room for 2 refused; a family of 4 in two rooms accepted | The read-only live check in the task, done by Fable first | Fable | Fable |

### Group C. Sessions, review queue, failures with a reason

| Slice | What | Milestone task | Branch | Likely files | Test | Needs | Brief | Review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 39-2 | A password reset or change ends the other sessions **Merged 2026-11-16, #493.** | M39 task 2 | `fix/m39-revoke-sessions-on-password-change` | `apps/api/src/auth/auth.service.ts`, the session store | The three tests in the task | - | Fable (decide backfill or next sign-in, state it) | Fable |
| 39-6a | No review item for a cancelled or zero-total import; auto-close when the condition clears **Merged 2026-11-16, #498.** | M39 task 6, step 1, first and third points | `fix/m39-review-items-actionable-only` | `apps/api/src/integrations/manual-review.service.ts`, the callers that raise the currency item | Specs for each rule | - | Fable | Fable |
| 39-6b | `dedupe_key` column; raising an open item's key updates it **Merged 2026-11-16, #501 (key also carries `operationKey`).** | M39 task 6, step 1, second point | `feat/m39-review-item-dedupe-key` | `apps/api/prisma/schema.prisma`, a migration, `manual-review.service.ts`, the `FINANCIAL_SYNC_BLOCKED` note from #475 | Spec: same key twice, one row with a count of 2 | 39-6a | Fable | Fable |
| 39-7a | Failed webhook events keep a reason; pool and transaction-start timeouts retry **Merged 2026-11-16, #495.** | M39 task 7, step 1 | `fix/m39-webhook-failure-reason` | `apps/api/prisma/schema.prisma`, a migration, the Clock webhook worker, `clock-provider-event-status.ts` | The injected transaction-start error test in the task | - | Fable | Fable |
| 39-8a | Dead-letter count and age in the console, one alert, `removeOnFail` age limit **Merged 2026-11-16, #507.** | M39 task 8, step 1 | `feat/m39-dead-letter-visible` | The Clock queue setup, `apps/api/src/platform/console`, the platform alert email | Spec: a forced failure raises one alert | - | Standard | Routine |
| 40-5a | Hydration raises the booking version only on a real change **Merged 2026-11-16, #494.** | M40 task 5 | `fix/m40-version-only-on-change` | `apps/api/src/integrations/clock/clock-booking-hydration.service.ts` | Spec: an echo webhook with the same data leaves the version; a date change raises it | - | Fable | Fable |
| 40-5b | Approval compares dates, total and payments **Merged 2026-11-16 (the approval part; the guest email is 40-5c).** | M40 task 5 | `fix/m40-approve-cancellation-requests` | `apps/api/src/booking/local-pms.provider.ts` (lines 1285 to 1300), the request approval service, a mail template | Spec: approve a request whose version moved but whose data did not | 40-5a | Fable | Fable |
| 40-5c | The guest gets a "request received" email when a cancellation request is made | **Merged 2026-11-16 (starts off for existing hotels, gap G-25).** M40 task 5 | `feat/m40-request-received-email` | `apps/api/src/mail/email-templates.ts`, the template catalog, `notification-recipients.ts`, `booking-requests.service.ts` (`guestRequest`) | Spec: a guest request queues one email; switched off, none | 40-5b | Standard | Routine |
| 40-8 | One receipt per payment **Closed 2026-11-15, no change needed: see the task.** | M40 task 8 | `fix/m40-one-receipt-per-payment` | `apps/api/src/mail/payment-notification.service.ts` | Spec: two triggers for one payment, one email queued | - | Standard | Routine |
| 40-7a | "Booking created" notice on confirmation, none for an unpaid attempt or its expiry **Merged 2026-11-16 (single-room and Clock paths; multi-room orders never had the notice).** | M40 task 7, D4 | `fix/m40-notify-on-confirmation` | `apps/api/src/tenancy/notifications.service.ts`, the booking create and confirm paths | Spec: an expired unpaid attempt sends staff nothing | - | Standard | Routine |
| 40-7b | Deposit Adjustment item only when the deposit folio is closed or converted **Merged 2026-11-17 (#517). The item is raised only when the original deposit folio has a close date; the change is in `clock-booking.service.ts` (`postRefund`), not the files listed here. See gap G-26.** | M40 task 7 | `fix/m40-deposit-adjustment-item-when-needed` | `apps/api/src/payments/payment-refund.service.ts`, `manual-review.service.ts` | Spec: refund with an open folio at 0.00 raises no item | 39-6b | Fable | Fable |

### Group D. Count, the owner reviews, then act

Each pair is two releases. The second changes live rows or Redis contents and waits for the owner's review of the first one's numbers (decisions D3 and D4 of Milestone 39).

| Slice | What | Milestone task | Branch | Needs | Review |
| --- | --- | --- | --- | --- | --- |
| 39-6c | Count per hotel what the clean-up would close, and why **Merged 2026-11-16, #502; the owner approved the numbers.** | M39 task 6, step 2 | `chore/m39-review-queue-count` | 39-6b | Routine |
| 39-6d | Resolve those rows (Must Hotel first), then the partial unique index **Merged 2026-11-16, #503; rows resolved live (Must Hotel 6, Empire 773, Luxury 0; Empire 23 and Luxury 32 stay open); the unique index is live.** | M39 task 6, step 3 | `fix/m39-review-queue-cleanup` | 39-6c reviewed by the owner | Fable |
| 39-7b | Count failed events by type and age, and whether the booking already matches Clock | M39 task 7, step 2 | `chore/m39-failed-events-count` | 39-7a | Routine |
| 39-7c | Give old, consistent failures a final state | M39 task 7, step 3 | `fix/m39-failed-events-final-state` | 39-7b reviewed by the owner | Fable |
| 39-8b | Log dead-letter jobs by name and month | M39 task 8, step 2 | `chore/m39-dead-letter-count` | 39-8a | Routine |
| 39-8c | Remove dead-letter jobs older than 30 days, trim old failed lists | M39 task 8, step 3 | `ops/m39-dead-letter-cleanup` | 39-8b reviewed by the owner | Fable |

### Group E. Design first, sliced after approval

These are not sliced yet, because the slices depend on a design or a reading that does not exist.

| Item | What | Who | Then |
| --- | --- | --- | --- |
| M40 task 9 | ADR: cancellation, payment confirmation and refunds as saved steps | Fable | The owner approves; task 10 is sliced from the ADR (three pull requests at least: cancellation, payment confirmation, refunds). Opus advised for task 10: it is the High-risk item of the plan. |
| M40 tasks 11 and 14 | Multi-room safety; booking history | - | Sliced after task 10 |
| M40 task 13 | Read Clock's documentation for a tentative reservation | Fable | Build only if supported |
| M40 task 17 | Read PokPay's documentation for the fee per order | Fable | Sliced after the reading; needs 40-1 and 40-2 |
| M39 task 13 | ADR: database owner role without superuser rights | Fable | No code in Milestone 39 |

### Group F. Gated or small

| Slice | What | Milestone task | Gate | Review |
| --- | --- | --- | --- | --- |
| 39-10a | Restrict the Clock host to Clock's API domains | M39 task 10 | Before self-serve sign-up; the read-only check of saved connections first | Fable |
| 39-10b | Invitation activation: test first, bind to the invited address if needed | M39 task 10 | Before self-serve sign-up | Fable |
| 39-11 | Concurrency tests for the native booking path | M39 task 11 | Before the first native hotel (Milestone 25) | Fable |
| 40-12 | Reception list of cancelled bookings Clock still shows a balance for **40-12a (re-check the bill when a booking is cancelled, plus a one-time catch-up) in PR #526 (merged); 40-12b (CSV export of the open Clock bills, a button on Needs attention) in PR #527.** The existing Needs attention note already covers the list; the gap was that cancelled bookings were never re-checked. | M40 task 12 | - | Routine |
| 40-15 | Flag "expected" bookings after 2 days; store Clock's check-in time **40-15a merged 2026-11-17 (#530: stores Clock's check-in time from `status_changed_at`). 40-15b built (a daily check raises one review note and one bell notice for a confirmed booking still expected 2 to 60 days after arrival; counts on live: Empire 6, Luxury 3, Must Hotel 28). Empire has 170 older bookings still expected that need a one-time clean-up decision from the owner.** | M40 task 15 | - | Routine |
| 40-16a to 40-16d | Guest-facing wording: PokPay description; return page and status label; one subject format; 409 or 422 for a refused booking **16a merged 2026-11-17 (#521), 16b merged (#522), 16c merged (#523); 16d open.** | M40 task 16 | One pull request each | Routine, except 16d (Fable) |
| 40-16e | Why the first financial refresh fails; Luxury's 3 differing totals (reading, read-only) | M40 task 16 | - | Done by Fable |

Waiting on people, no slice: M39 task 12 (Luxury mappings and webhooks: hotel staff and the owner), M40 task 6 (sending domain: Denis Zoi, GitHub issue #482).

### Found while executing

- **CI (2026-11-16):** Clock staging is red on every PR (Clock demo account 16307, expired trial) and is a required check, so merges need `--admin` and the automatic deploy is skipped; deploy by hand with the deploy workflow's `workflow_dispatch`. A stuck queued dispatch is displaced by dispatching again. #499 (Clock refusal is one notice, not a breaker storm) is also merged.
- **CI:** the Clock staging job allows one run at a time and GitHub keeps only one waiting run per group, so with three or more pull requests open at once the waiting ones are cancelled and show as failed. Re-run them one at a time, or keep at most two pull requests in CI.
- **CI:** `apps/web/app/dashboard/reports.test.tsx` failed 4 runs on 2026-11-15 ("The requested date field did not open its calendar"). #491 makes the helper click again; not reproduced locally, so if it returns, log the trigger's `aria-expanded` at the failure.
- **Deploys:** the pipeline deploys only the newest commit of `main`; a failed CI run on `main` skips the deploy until it is re-run.
- **Off-site backup:** fails at every deploy since 2026-11-13 (noted on issue #370). The local pre-deploy dump still works.

## Progress (2026-11-16, evening)

Of the 40 slices in groups A to D and F: **20 done** (A 4 of 4, B 4 of 9, C 10 of 11, D 2 of 6, F 0 of 10; one of them, 40-8, was closed because no change was needed), **2 deferred** (40-1b, 40-1c) and **18 open**. Open: 40-3b, 40-3c, 40-4 (Group B); 40-7b (C); 39-7b, 39-7c, 39-8b, 39-8c (D, each waits for an owner review of counts before the change); the ten gated or small slices of group F. Not yet sliced: the five design items of group E, Milestone 38's open tasks and Milestone 41. Gaps found along the way are in [the gaps log](../audit/hardening-gaps-log.md).

## 4. Keeping this file true

When a slice merges, its row gets the pull request number and the date, and the milestone file's status line is updated in the same pull request. "Likely files" are a starting point checked against the code on 2026-11-15, not a limit: the agent reports any other file it had to change.
