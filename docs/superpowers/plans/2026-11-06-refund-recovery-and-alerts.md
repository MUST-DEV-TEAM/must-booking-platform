# Refund Recovery and Stuck-Money Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A refund the payment provider has paid must always end up in our ledger and in Clock, without staff, and a refund that cannot be finished must alert a person within minutes.

**Architecture:** Add a background sweeper that finds refund attempts stuck in `PREPARING`/`UNCERTAIN`, asks PokPay what happened, and finishes the job through the existing `syncRefundAlreadyDone` and `postRefund` paths (both already idempotent). Anything it cannot finish raises a manual-review item, a staff notification and an error-tracking event. Separately, remove the likely root cause of the timeout: an unset database connection pool.

**Tech Stack:** NestJS, Prisma 6 (raw SQL, RLS), BullMQ, PostgreSQL, existing `ManualReviewService`, `NotificationsService`, `AuditLogService`.

**Spec:** Incident of 2026-11-06, booking `EBR-261104-2216-U7BQ` (Empire Beach Resort). PokPay refunded 21,560 ALL; `gatewayRefund`'s second write failed with Prisma `P2028` ("Unable to start a transaction in the given time"); the refund stayed `PREPARING`, no `REFUND` payment row, no Clock negative payment, no alert. Fixed by hand the same day. Industry practice applied: outbox/saga recovery, stuck-operation alerting, daily three-way reconciliation, adequate capacity.

## Global Constraints

- Idempotency (AGENTS.md): every step safe to repeat; never send a second refund to the provider from the sweeper. The sweeper only **reads** the provider (`getPayment`) and records what the provider already did.
- Money is `NUMERIC`/minor units, never floats. Reuse `minorUnits`/`money` helpers in `payment-refund.service.ts`.
- Tenancy: every query carries `tenant_id` and `property_id`; RLS stays on; app role is non-owner.
- Migrations additive and idempotent; a rollback line is written in each migration header.
- No live calls to PokPay, Clock, Stripe or Resend in tests (mock the provider). No production deploy, data change or env change without the owner's explicit go-ahead for that action.
- Clock refund mirror reuses `ClockBookingService.postRefund` with reference `must-refund:<refund payment external id>`; do not invent endpoints.
- Docs: update the one canonical payments doc the router in `docs/README.md` names; no status files.

## Review Focus

- Provider says fully refunded but ledger already has the refund row (sweeper must do nothing, close the operation).
- Provider says **partially** refunded or status unknown (sweeper must not guess an amount; alert only).
- Provider unreachable / credentials broken (leave the operation open, count as unreadable, alert only after the age threshold).
- Sweeper runs twice at once or overlaps a staff retry (advisory lock + idempotent insert; no duplicate `REFUND` row, no duplicate Clock payment).
- Refund recorded but Clock post fails (ledger stays correct, manual-review item raised, operation still closed).

---

### Task 1: Stop starving the database pool

Root-cause hypothesis (unverified until measured): production `DATABASE_URL` has no `connection_limit`, so Prisma uses its default of `cpus*2+1` = 3 on the 1-vCPU host. `manualRefund` holds one connection for up to 90 s while `gatewayRefund` opens two more transactions; background Clock sync competes, so the second start waits past Prisma's default `maxWait` of 2000 ms.

**Files:**
- Modify: `apps/api/src/tenancy/tenant-database.service.ts:19-44` (add `maxWaitMs` option)
- Modify: `apps/api/src/payments/payment-refund.service.ts` (the two `withTenantTransaction` calls in `gatewayRefund`, and the retry wrapper below)
- Modify: `infrastructure/containers/compose.homelab.yaml` or its `.env.example` (document `connection_limit` and `pool_timeout`)
- Test: `apps/api/src/tenancy/tenant-database.service.spec.ts`, `apps/api/src/payments/payment-refund.service.spec.ts`

**Interfaces:**
- Produces: `withTenantTransaction(context, op, options?: { timeoutMs?: number; maxWaitMs?: number; isolationLevel? })` passing `maxWait: options.maxWaitMs` to `$transaction`.
- Produces: `private async persistGatewayResult(context, key, hash, result): Promise<void>` in `PaymentRefundService`, retrying the `UPDATE integration_operations` up to 5 times with 500 ms backoff and `maxWaitMs: 15_000`, because this write is the one that must not be lost after money has moved.

- [ ] **Step 1: Write failing tests.** `withTenantTransaction passes maxWait to $transaction when maxWaitMs is set`; `gatewayRefund retries the result write after a P2028 and records REFUNDED when the second attempt succeeds`; `gatewayRefund keeps the operation UNCERTAIN (not PREPARING) and raises a review item when all 5 writes fail`.
- [ ] **Step 2: Run** `pnpm --filter api test -- tenant-database payment-refund` and confirm they fail.
- [ ] **Step 3: Implement** the option and `persistGatewayResult`; use `maxWaitMs: 15_000` on both `gatewayRefund` transactions.
- [ ] **Step 4: Run the same command**; all pass.
- [ ] **Step 5: Document the env change only** (no production edit): in the containers README, state that `DATABASE_URL` must carry `connection_limit=10&pool_timeout=20` and that `max_connections` on the database is 100.
- [ ] **Step 6: Pool note for the server upgrade.** The container docs must say that `connection_limit` is sized to the host (about 10 on today's 1 vCPU / 1 GB host; raise it to roughly 3 to 4 times the vCPU count, never above half of the database's `max_connections`, when the server is upgraded). Recovery and alert tasks do not depend on the host and need no change after an upgrade.
- [ ] **Step 7: Commit** `fix(payments): do not lose a paid refund when the pool is busy`.

### Task 2: Find stuck refund attempts

**Files:**
- Create: `apps/api/prisma/migrations/<timestamp>_stuck_refund_operations_function/migration.sql` (header comment: rollback is `DROP FUNCTION payment_stuck_refund_operations(integer);`)
- Test: `apps/api/test/payment-stuck-refund-operations.e2e.spec.ts`

**Interfaces:**
- Produces: SQL function `payment_stuck_refund_operations(min_age_minutes integer)` (SECURITY DEFINER, same pattern as `payment_pokpay_reconciliation_candidates`) returning `tenant_id uuid, property_id uuid, booking_id uuid, idempotency_key text, stage text, charge_external_payment_id text, amount text, currency text, age_minutes integer` for `integration_operations` rows with `result->>'kind' = 'gateway_refund'`, `result->>'stage' IS DISTINCT FROM 'RETURNED'`, older than `min_age_minutes`, and with no matching `REFUND`/`REFUNDED` payment.

- [ ] **Step 1: Write the failing e2e test** `returns a PREPARING refund older than 5 minutes, and not a RETURNED one, and not one younger than 5 minutes, and not another tenant's` (seed four rows across two tenants).
- [ ] **Step 2: Run** `pnpm --filter api test:e2e -- payment-stuck-refund-operations`; expect FAIL (function missing).
- [ ] **Step 3: Write the migration** (`CREATE OR REPLACE FUNCTION`, idempotent; grant execute to the app role exactly as the PokPay function does).
- [ ] **Step 4: Run again**; expect PASS.
- [ ] **Step 5: Commit** `feat(payments): list refund attempts stuck after the provider call`.

### Task 3: Recover a stuck refund from the provider

**Files:**
- Modify: `apps/api/src/payments/payment-refund.service.ts` (add the public method; reuse private `syncRefundAlreadyDone`, `syncManualRefundToClock`)
- Create: `apps/api/src/payments/payment-refund-recovery.service.ts`
- Modify: `apps/api/src/payments/payments.module.ts` (register provider)
- Test: `apps/api/src/payments/payment-refund-recovery.spec.ts`

**Interfaces:**
- Consumes: `payment_stuck_refund_operations(min_age_minutes)` from Task 2; `PaymentProviderRegistry.forProvider(...).getPayment(context, paymentId)`.
- Produces: `PaymentRefundService.recoverStuckRefund(operation: StuckRefundOperation): Promise<'RECOVERED' | 'NOTHING_TO_DO' | 'NEEDS_PERSON'>`, where `StuckRefundOperation` is the row shape above. Behaviour: take the existing per-booking advisory lock; if the provider shows the payment fully refunded, record the missing `REFUND` row via the same code path as `syncRefundAlreadyDone` (id `<charge id>:refund:reconciled`), post to Clock with reference `must-refund:<that id>`, set the operation to `SUCCEEDED`/`RETURNED`, return `RECOVERED`; if the ledger already has it, only close the operation (`NOTHING_TO_DO`); if the provider shows partial/unknown/unreadable, change nothing and return `NEEDS_PERSON`.
- Produces: `PaymentRefundRecoveryService` (BullMQ repeatable job, every 5 minutes, `concurrency: 1`, modelled on `PokPayReconciliationService`) calling `recoverStuckRefund` for each stuck row older than 5 minutes, with a 150 ms pause between rows and a cap of 50 rows per run.

- [ ] **Step 1: Write failing tests** (provider and Clock mocked): `records the REFUND row and posts to Clock when PokPay shows the order refunded`; `closes the operation without a second REFUND row when the ledger already has it`; `never calls provider.refund`; `leaves a partially refunded order untouched and returns NEEDS_PERSON`; `leaves the operation open when the provider throws`; `two concurrent runs create exactly one REFUND row and one Clock post`; `Clock failure keeps the ledger row and raises a manual-review item`.
- [ ] **Step 2: Run** `pnpm --filter api test -- payment-refund-recovery`; expect FAIL.
- [ ] **Step 3: Implement** `recoverStuckRefund` and the sweeper.
- [ ] **Step 4: Run again**; expect PASS, then run the whole `pnpm --filter api test` because shared payments code changed.
- [ ] **Step 5: Commit** `feat(payments): finish a paid refund the system failed to record`.

### Task 4: Alert a person when money is stuck

**Files:**
- Modify: `apps/api/src/payments/payment-refund-recovery.service.ts`
- Test: `apps/api/src/payments/payment-refund-recovery.spec.ts`

**Interfaces:**
- Consumes: `recoverStuckRefund` result from Task 3; `ManualReviewService.recordInTransaction`, `NotificationsService.recordInTransaction` (type `BOOKING_NEEDS_ATTENTION`, reason `refund_stuck`), `reportOperationalFailure`.
- Produces: for a row whose result is `NEEDS_PERSON` and whose `age_minutes >= 10`, exactly one manual-review item (category `PAYMENT_BOOKING_MISMATCH`, message in plain words naming the booking, amount and age), one staff notification, and one `reportOperationalFailure` event; repeated runs must not create duplicates (key on the operation id).

- [ ] **Step 1: Write failing tests** `raises one review item, one notification and one error event for a refund stuck 10 minutes`; `does not raise a second set on the next run`; `raises nothing for a refund stuck only 6 minutes`.
- [ ] **Step 2: Run** `pnpm --filter api test -- payment-refund-recovery`; expect FAIL.
- [ ] **Step 3: Implement** the alerting branch.
- [ ] **Step 4: Run again**; expect PASS.
- [ ] **Step 5: Commit** `feat(payments): alert staff when a refund stays stuck`.

### Task 5: Daily three-way check includes Clock

The nightly PokPay check (`pokpay-reconciliation.service.ts`) already compares PokPay with our ledger and raises review items. It does not look at Clock.

**Files:**
- Modify: `apps/api/src/payments/pokpay-reconciliation.service.ts` or create `apps/api/src/integrations/clock/clock-refund-mirror-check.service.ts` (prefer the new file; Clock vendor calls stay in the Clock adapter)
- Test: `apps/api/src/integrations/clock/clock-refund-mirror-check.spec.ts`

**Interfaces:**
- Produces: `ClockRefundMirrorCheckService.run(): Promise<{ checked: number; missingInClock: number }>`, nightly, for each `REFUND`/`REFUNDED` payment of the last 45 days on a Clock-connected property: read the deposit folio's credit items (read-only) and, if none has reference `must-refund:<refund external id>` and none is negative with the same amount, raise one manual-review item "Refund recorded here but not in Clock — post the negative payment and do the Deposit Adjustment". Never writes to Clock.

- [ ] **Step 1: Write failing tests** with a mocked Clock client: `raises one review item when the folio has no matching negative item`; `raises nothing when the reference matches`; `raises nothing and counts unreadable when Clock errors`.
- [ ] **Step 2: Run** `pnpm --filter api test -- clock-refund-mirror-check`; expect FAIL.
- [ ] **Step 3: Implement** and register the BullMQ job at 03:45 UTC (after the PokPay check).
- [ ] **Step 4: Run again**; expect PASS.
- [ ] **Step 5: Commit** `feat(clock): nightly check that refunds reached Clock`.

### Task 6: Release rehearsal and docs

**Files:**
- Modify: the canonical payments doc named by `docs/README.md` (a short "Refund recovery" section: what the sweeper does, thresholds 5 and 10 minutes, where alerts appear, the manual-record procedure used on 2026-11-06)
- Test: `apps/api/test/refund-fault-injection.e2e.spec.ts`

- [ ] **Step 1: Write the failing fault-injection e2e** `cancel with refund: provider refund succeeds, the result write fails 5 times; after one sweeper run the booking has one REFUND row and one Clock post`.
- [ ] **Step 2: Run** `pnpm --filter api test:e2e -- refund-fault-injection`; expect FAIL before Tasks 1 to 3 are merged and PASS after.
- [ ] **Step 3: Update the doc** in short factual sentences.
- [ ] **Step 4: Run** `pnpm -w lint`, `pnpm --filter api test`, `pnpm -w build`; all green.
- [ ] **Step 5: Commit** `docs(payments): describe refund recovery`.

---

## Owner decisions (not code, not mine to do)

1. **Server size.** The host has 1 vCPU and about 1 GB RAM. Recommend at least 2 vCPU and 4 GB, plus memory and database-connection monitoring with an alert. Needs hosting access.
2. **Production changes.** Setting `connection_limit` on the live `DATABASE_URL`, running the new migration and deploying all need an explicit go-ahead for each action.
3. **Clock rights.** Ask Empire's Clock admin to give the staff role the right to do Deposit Adjustments, and give the hotel a one-page checklist for after a card refund.

## Self-review

- Coverage: items 1 (recover), 2 (alert), 3 (three-way check, Task 5), 4 (capacity, Task 1 plus owner decision 1), 5 (no half-done money state, Tasks 1 and 3), 6 (rehearsal and Clock rights, Task 6 plus owner decision 3).
- Order: 1 and 2 as agreed first are Tasks 3 and 4, but Task 1 comes first because it removes the likely cause and Task 2 is their dependency.
- Assumption flagged: the pool-size cause is inferred from the missing `connection_limit` and Prisma's documented default; Task 1 Step 5 should be followed by measuring pool use before and after.
