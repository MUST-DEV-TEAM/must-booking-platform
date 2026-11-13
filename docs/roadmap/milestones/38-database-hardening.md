# Milestone 38: Database hardening

Status: **In progress.** Live 2026-11-13: task 1 repository part (#472; host install and destination are Denis's, issue #370), task 3 (#470, #474), task 4 (#471), task 5 (#473). Task 2 (#475 precondition, #476). Tasks 6 and 7 wait for seven days of query statistics (from 2026-11-13). Tasks 8 and 9 not started.

Source: [database review, 2026-11-13](../../audit/database-review-2026-11-13.md). Each task below names the review item it closes. The task table is the spec; the review holds the evidence.

## 1. Goal and limits

Make the database safe to lose a server, cheap to run as hotels are added, and observable, using standard PostgreSQL practice. No change to booking, payment or Clock behaviour.

Out of scope here, planned elsewhere:

- Review items 7, 8 and 9 (review queue, failed webhook events, Luxury webhooks) belong to the backend plan.
- Review item 12 (database guard against double booking) belongs to Milestone 25, before the first non-Clock hotel goes live.
- Splitting the long transactions around Clock and PokPay is task L3 of the [booking flow review](../../audit/booking-flow-review-2026-11-13.md). Task 6 below depends on it for its final values.

## 2. Owner decisions (2026-11-13)

| # | Question | Decision |
| --- | --- | --- |
| D1 | Where do off-site backups go? | The Google Drive copy is a stopgap (about 92 MB free), not the professional backup. The repository side is made ready now (task 1). Choosing and provisioning the professional destination stays with Denis on GitHub issue #370. Recommended there: an S3-compatible bucket used only for backups, on a different provider than the server, with versioning and a retention lock so a backup cannot be changed or deleted early, plus the hosting provider's server snapshots as a second layer. |
| D2 | A restart of Postgres lasting a few seconds, once, outside busy hours (task 5). | Yes. |
| D3 | How long to keep data (task 8). | As recommended: raw webhook payloads 90 days; idempotency receipts 30 days; email previews as today (they already expire); audit log: no deletion now, revisit at 2 years. |
| D4 | The copy of each hotel's Clock guest list. | Keep it. The hotel keeps a record of everyone who booked and stayed. The copy is the guest directory staff see, and most of its rows are past guests entered without an email (5,458 of 13,760 at Empire, 11,051 of 14,016 at Luxury), which is why they are not linked to a booking. Nothing is deleted from guest records in this milestone. |

Standard practice for D4 asks four things of the hotel, none built here: a stated period after the last stay (set with the hotel's accountant), deletion on a guest's request except what the law requires to be kept, no marketing without consent, and limited access with encrypted backups (already the case).

## 3. Rules for whoever executes

- One task, one branch from `main`, one pull request. CI green before merge. Merging to `main` deploys to production, so every merge needs the owner's go for that task.
- Migrations: additive, idempotent, safe to re-run, with the rollback SQL in a comment. Prisma runs a migration inside a transaction, so no `CONCURRENTLY`; every table touched here is small enough for a plain statement.
- Empire Beach Resort and Luxury Premium Finese are read-only for verification. Anything that needs test data uses Must Hotel Testing.
- Run the full test suite in the isolated Docker replica, not against the development database.
- Precondition for task 2: branch `fix/clock-financial-sync-backoff` has one unpushed commit and uncommitted work in the same file. Finish and merge it first, or build task 2 on top of it. Do not discard it.
- After each deploy, run the task's verify step on live (read-only) and write the measured numbers into the pull request.

## 4. Tasks, in execution order

| # | Task | Closes review item | Needs | Risk |
| --- | --- | --- | --- | --- |
| 1 | Backups: make the repository ready for a professional destination; trash fix; automatic restore test | 1 | Destination itself: Denis, issue #370 | Low |
| 2 | Clock sync loop: stop the once-a-second job seeding | 2 | Precondition above | Medium |
| 3 | Audit log: stop writing a row per unchanged import batch | 6 | - | Low |
| 4 | Remove duplicate indexes; close two open function grants | 13, part of 11 | - | Low |
| 5 | Turn on query statistics and slow-query logging | 3 | Approved (D2); merge outside busy hours | Low, short restart |
| 6 | Timeouts for the application role | 4 | Task 5 plus 7 days of data | Medium-low |
| 7 | Indexes for the background sweeps | 5 | Task 5 plus 7 days of data | Low |
| 8 | Retention job | 10 | Periods decided (D3) | Medium (deletes data) |
| 9 | Database owner role without superuser rights: design only | 11 | Security review | Design, no code |

Tasks 1 to 4 are independent and can go in any order. Tasks 6 and 7 wait a week after task 5 so the choices rest on measured queries.

### Task 1. Backups: ready for a professional destination, trash fix, automatic restore test

- **Split of work:** everything in the repository is done in this task, so that switching the destination is one configuration line. Creating the storage, its key and the server configuration is Denis's part, tracked in GitHub issue #370. The script already works with any rclone remote; nothing in it is tied to Google Drive.
- **Change:**
  0. Add an example for an S3-compatible remote with the existing crypt layer to `infrastructure/backup/README.md` and to the backup env example: bucket versioning on, a retention lock of at least 30 days, a key that can write and list but not delete versions.
  1. In `infrastructure/backup/backup-postgres.sh`, make the prune skip the Drive trash: add `--drive-use-trash=false` to the `rclone delete` line (harmless on other remotes).
  2. Add `infrastructure/backup/restore-test.sh`: take the newest remote dump, restore it into a throwaway database (`must_booking_restore_test`) in the Postgres container, compare row counts of `bookings`, `payments`, `guests` and `_prisma_migrations` with the live database within a tolerance for the hours since the dump, drop the throwaway database, exit non-zero on any failure. Add a weekly systemd timer and service next to the existing backup units, with the same `OnFailure` alert.
  3. Document in `infrastructure/backup/README.md`: the new remote, the restore test, and the one-time host steps.
  4. Correct row 5b of `docs/roadmap/open-follow-ups.md` (off-site backups do run; the open item was space).
- **Host steps (Denis, issue #370; typed on the server, never from CI):** create the bucket and a key limited to it; add the rclone remote with the existing crypt layer on top; change `BACKUP_REMOTE` in `/etc/must-booking/backup.env`; install the restore-test timer; run one backup and one restore test by hand.
- **Verify now (repository part):** `restore-test.sh` exits 0 against the current remote on the isolated stack; a deliberately corrupted copy makes it exit non-zero.
- **Verify after the switch (Denis):** the journal shows "uploaded" to the new remote; the weekly restore test passes; a forced failure sends the alert.
- **Rollback:** set `BACKUP_REMOTE` back; the old dumps stay where they are for 30 days.

### Task 2. Clock sync loop: stop the once-a-second job seeding

Done 2026-11-13 (#475, #476). Item 2 is a trigger on `bookings` (`bookings_clock_seed_financial_job`) rather than code in each of the eight paths that confirm or import a Clock booking; it skips the insert when the session has no hotel set, and the once-a-minute seed covers that case. Item 4 shipped with task 3 (#470). First live reading (5 minutes, settled): scans on `clock_sync_jobs` about 1,540 a minute from about 22,700 (target under 1,000: not met; the bills lane re-ticks at once while it has due work); a new test booking's bill was queued at once and read after 40 seconds; WAL about 370 MB a day, not yet halved: compare over 24 hours. The once-a-minute bill seed over `bookings` (about 46 ms a call) is now the top statement: look at it in task 7.

- **Where:** `apps/api/src/integrations/clock/clock-background-sync.service.ts`, `tick()` and `ensure()`.
- **Change:**
  1. Call `ensure(scope)` from `tick()` at most once every 60 seconds per hotel (an in-memory timestamp per `tenantId:propertyId` is enough; `ensure` is idempotent, so a second API instance is safe). The explicit callers (`status()`, the manual "sync now" paths) keep calling it directly.
  2. Seed a `financial:<bookingId>` job at the moment a booking is confirmed or imported, so a new booking does not wait up to a minute for its first bill check.
  3. Add an index that serves `claim()`: `clock_sync_jobs (tenant_id, property_id, connection_id, next_run_at)`. Confirm with `EXPLAIN` that an idle claim reads no more than a handful of rows.
  4. In the catalog sync, update a `clock_catalog_mappings` row only when a value differs (`WHERE ... IS DISTINCT FROM ...`), so an unchanged catalog writes nothing.
- **Do not change:** the one-second tick itself, the two lanes, the lease logic, the Clock rate limiter.
- **Tests:** unit test that 120 ticks with nothing due call `ensure` twice per hotel; existing sync tests stay green.
- **Verify on live (read-only), one hour after deploy:** `idx_scan` on `clock_sync_jobs` grows by under 1,000 a minute (about 15,000 before); `n_tup_upd` on `clock_catalog_mappings` stops growing while the catalog is unchanged; `pg_stat_wal.wal_bytes` per day is under half of the earlier 400 MB; every job's `last_success_at` is as fresh as before; a new test booking on Must Hotel gets its financial reading within a minute.
- **Rollback:** revert the pull request; the index can stay.

### Task 3. Audit log: stop writing a row per unchanged import batch

Done 2026-11-13 (#470, #474). The background sync runs small guest imports every few minutes; a summary row is written only when a run of several batches ends. First live reading: about 12 rows an hour, against about 70 before.

- **Where:** `apps/api/src/integrations/clock/clock-guest-import.service.ts:158` (`clock.guest_import_batch`), and the writer of `clock_catalog.synced`.
- **Change:** write the audit row only when the batch created or changed at least one record; otherwise nothing. Keep one summary row per full import run. Do not delete existing rows: the audit log is append-only by ADR-0037.
- **Verify:** `audit_logs` rows per day fall from about 1,800 to a few hundred with the same sync activity; a real change in Clock still produces a row.

### Task 4. Remove duplicate indexes; close two open function grants

- **Change, one migration plus the matching `schema.prisma` edits:**
  1. Drop the two indexes identical to a primary key: `inventory_units_tenant_id_property_id_room_type_id_stays_on_idx`, `room_availability_tenant_id_property_id_room_id_stays_on_idx`.
  2. Drop `bookings_tenant_property_room_stay_idx` (never used; the full index on the same columns serves the same lookups).
  3. Drop the 29 plain indexes that are a left prefix of a unique index on the same table (the review counted 29 on 2026-11-13; regenerate the list from `pg_index` on a current copy before writing the migration, and keep any index whose longer twin is partial or an expression index).
  4. `REVOKE EXECUTE ON FUNCTION auth_assert_platform_user_is_exclusive(), auth_assert_tenant_membership_is_exclusive() FROM PUBLIC` (trigger functions do not need it).
- **Done 2026-11-13 (#471):** 15 prefix indexes, not 29: the review's count included prefixes of non-unique indexes, which stay. `prisma migrate diff` was not empty before this task (custom index names and raw-SQL foreign keys Prisma does not model); the task added no drift. Index size on live 49 MB to 46 MB.
- **Leave alone:** the 27 "never used" indexes that are not duplicates. Look at them again after 30 more days of statistics.
- **Verify:** `prisma migrate diff` between schema and database is empty; the duplicate-index query returns no rows; full suite green.
- **Rollback:** the `CREATE INDEX` statements, kept in the migration as a comment.

### Task 5. Turn on query statistics and slow-query logging

Done 2026-11-13 (#473). The extension's views are revoked from `PUBLIC` and from the app role, which the schema's default privileges would otherwise have granted.

- **Change:**
  1. In `infrastructure/containers/compose.homelab.yaml`, give the `postgres` service a command: `postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=top -c log_min_duration_statement=500 -c log_lock_waits=on -c track_io_timing=on`.
  2. Migration: `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;`. Do not grant it to the application role.
  3. Add a short "how to read the slow queries" section to the operations doc, with the two queries to run (top by total time, top by mean time).
- **Effect on deploy:** compose recreates the Postgres container, so the merge itself causes the restart (seconds). Merge outside busy hours with the owner's go; check the API reconnects and `/health` answers.
- **Verify:** `SHOW shared_preload_libraries` lists the extension; `SELECT count(*) FROM pg_stat_statements` is above zero after an hour; a 600 ms test query appears in the Postgres log.
- **Rollback:** remove the command line and redeploy; the extension can stay.

### Task 6. Timeouts for the application role

- **Change, one migration:** `ALTER ROLE must_booking_app SET statement_timeout = '60s'; ... SET lock_timeout = '15s'; ... SET idle_in_transaction_session_timeout = '120s';`
- **Why these values and not lower:** cancellation, payment confirmation and refunds today keep a transaction open while waiting for Clock and PokPay (30, 45 and 90 second limits in code). A lower idle-in-transaction limit would cut a refund in the middle. When task L3 of the booking flow review has moved those calls out of the transactions, lower the three values to 30 s, 10 s and 30 s in a follow-up migration.
- **Before merging:** from task 5's data, confirm no legitimate statement runs longer than 30 seconds (reports, exports, imports). If one does, fix or exempt it first (`SET LOCAL statement_timeout` inside that one transaction).
- **Verify:** `SELECT rolconfig FROM pg_roles WHERE rolname = 'must_booking_app'`; on Must Hotel run a CSV export, a guest import, a cancellation with refund and a payment; a test transaction left idle is ended by the server after 120 seconds.
- **Rollback:** `ALTER ROLE must_booking_app RESET ALL;`

### Task 7. Indexes for the background sweeps

- **Method:** for each table below, take the sweep's exact statement from `pg_stat_statements`, write one partial index that matches its `WHERE`, and confirm with `EXPLAIN (ANALYZE, BUFFERS)` on a restored copy.
- **Tables (full scans counted in the review):** `venue_deposit_operations`, `payment_provider_sessions`, `email_transport_attempts`, `integration_operations`, `venue_reservations`, `manual_review_items`, `provider_events`, and `bookings` (the cause of its 15,462 full scans is still unknown; find it here).
- **Expected shape, to be confirmed against the real statements:** for example `provider_events (created_at) WHERE status IN ('RECEIVED','QUEUED')` for the recovery sweep. Drop `venue_deposit_operations_pending_idx` if the real query cannot use it.
- **Verify:** a day after deploy, `seq_scan` on each table has stopped growing at the earlier rate.

### Task 8. Retention job

- **Change:** one scheduled job, built like the existing `notification-retention.service.ts`, with one rule per table, deleting in batches of 1,000 inside the tenant scope:
  - `provider_events`: after 90 days, for rows in `HYDRATED` or `IGNORED`, replace `raw_payload` with `'{}'`. **Keep the row**: its `(connection_id, event_id)` pair is what stops a re-delivered event from being processed twice.
  - Idempotency receipt tables (`*_operations` that only hold a request hash and a response): delete after 30 days. Exclude `integration_operations`, which is money evidence.
  - `clock_guest_profiles` and `guests`: no deletion (decision D4).
  - `audit_logs`: no deletion in this milestone.
- **Check, no change:** when a guest is deleted in Clock, does the next import remove that profile from `clock_guest_profiles`? Read `clock-guest-import.service.ts` and test on Must Hotel. If the copy keeps the person, record it as a follow-up, because a deletion request handled in Clock would then leave the guest in MUST.
- **Safety:** first release runs in dry-run mode and only logs the counts per table and hotel; the owner reviews the numbers; the second release deletes. First real run on Must Hotel only. The nightly backup is the rollback.
- **Docs:** record the periods in a short ADR, since they are a cross-cutting, hard-to-reverse choice.
- **Verify:** dry-run counts match a manual count; after the real run, `pg_total_relation_size('provider_events')` falls and a re-delivered old webhook is still recognised as a duplicate.

### Task 9. Database owner role without superuser rights (design only)

Today one superuser role owns every table and all 31 `SECURITY DEFINER` functions. The standard layout is three roles: a superuser used only for maintenance, an owner role for migrations that is not a superuser, and the application role as it is now. The definer functions that must read across hotels then need either explicit policies or a dedicated role with `BYPASSRLS` and nothing else.

This changes how every cross-hotel function gets its access, so it is a design task for the security review, written as an ADR with a tested migration path. No code in this milestone beyond the two grants closed in task 4.

## 5. Done when

- A backup taken today can be restored by a script, and that script runs every week without a person.
- The idle database does under a tenth of today's work (task 2's numbers).
- A slow query can be named within a minute, and a stuck one is ended by the server.
- No table grows without a written limit, except the audit log, whose limit is a recorded decision.
- The review's "Not checked" items for the database are either closed or have an owner.
