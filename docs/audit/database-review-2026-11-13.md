# Database review, 2026-11-13

Step 1 of the layered review (database, then backend, then frontend). This file is the task list for the models that execute the work: each task says what to change, why, the risk and how to verify it.

**How it was checked.** The Prisma schema and all 200 SQL migrations were read. The live database on `booking.must.al` was inspected read-only (catalog, statistics, row counts and patterns). No data was changed and no guest details were read or copied. Empire Beach Resort and Luxury Premium Finese are read-only; tests go to Must Hotel Testing.

**Size today.** PostgreSQL 17.11, 130 MB, 116 tables, 3 hotels, 24,953 bookings (about 1,300 new per month in season), 9,883 guests. One server: 1 vCPU, 956 MB RAM, 25 GB disk (66% used).

## Ranked tasks

| # | Task | Priority | Risk of the fix | Who runs it |
| --- | --- | --- | --- | --- |
| 1 | Off-site backup storage is almost full | Now | Low | Owner decision, then Sonnet |
| 2 | Clock sync loop queries the database about 260 times a second | Now | Medium | Opus |
| 3 | Turn on slow-query visibility | Soon | Low (short restart) | Sonnet |
| 4 | Add database timeouts for the application role | Soon | Medium-low | Opus decides, Sonnet applies |
| 5 | Background sweeps scan whole tables | Soon, after 3 | Low | Opus designs, Sonnet writes migrations |
| 6 | 81% of the audit log is one machine event | Soon | Low | Opus |
| 7 | Review queue on the real hotels is too long to use | Backend review | Needs owner go for live rows | Fable, then Opus |
| 8 | Failed webhook events are never closed | Backend review | Low | Fable, then Opus |
| 9 | Luxury has never received a Clock webhook | Backend review | None (a question) | Owner answer |
| 10 | No retention rules for growing tables | Later | Medium (deletes data) | Opus, owner picks periods |
| 11 | Database owner role is a superuser | Later | Medium | Fable reviews, Opus builds |
| 12 | Database-level guard against double booking before the first native hotel | Before Milestone 25 go-live | Medium | Fable designs, Opus builds |
| 13 | Remove duplicate and redundant indexes | Later | Low | Sonnet |
| 14 | Server size and pending reboot | No action (owner already decided) | - | - |
| 15 | Foreign keys without an index | No action now | - | - |

## Task details

### 1. Off-site backup storage is almost full

- **Found:** the Google Drive that receives the encrypted nightly backups has 92.5 MB free of 15 GB (181.5 MB of it is trash, which still counts). Each backup is about 16 MB and a deploy day makes several. After roughly five more uploads the off-site copy stops. Local copies stay on the same disk as the database for 7 days, so a disk failure would then lose everything.
- **Change:** free space or move the backups to storage with room (a paid Drive plan, or an S3-style bucket such as Backblaze B2 or Cloudflare R2, which costs cents at this size). Make the prune step skip the Drive trash (`--drive-use-trash=false`) or empty the trash on a schedule. Run a restore test; the last one was 2026-10-09.
- **Verify:** `rclone about` shows free space above 1 GB; the next nightly log line says "uploaded"; a restore into a throwaway database succeeds.
- **Correction to an older note:** row 5b in `docs/roadmap/open-follow-ups.md` says off-site backups are not running. They are running (nightly and before each deploy, encrypted, size-checked, readable by `pg_restore`). The open problem is space.

### 2. Clock sync loop queries the database about 260 times a second

- **Found:** `ClockBackgroundSyncService.tick()` runs every second. For every Clock hotel it calls `ensure()`, which runs about 18 `INSERT ... ON CONFLICT DO NOTHING` statements plus one insert that reads that hotel's confirmed bookings, and then claims jobs. Measured on live: 407 million index scans on `clock_sync_jobs` (1,367 rows) in 18 days, 991,816 row updates, and 4.5 GB of write-ahead log in 11 days for a 130 MB database. `clock_catalog_mappings` (258 rows) was rewritten 257,729 times. Postgres sits at about 5% of the only CPU core with no visitors.
- **Why it matters:** the cost grows with every hotel added. At 20 hotels this loop alone would use most of the server.
- **Change:** run `ensure()` at most once a minute per hotel (or when a booking is confirmed), not every tick. Keep the one-second claim, and give it a partial index on due jobs so an idle claim is one cheap lookup. Skip the write when a catalog mapping or snapshot has not changed.
- **Risk:** medium. This is the live Clock sync, and branch `fix/clock-financial-sync-backoff` has unmerged work in the same file; build on top of it.
- **Verify:** on the test hotel, `idx_scan` on `clock_sync_jobs` rises by under 1,000 a minute (today about 15,000); `pg_stat_wal.wal_bytes` per day drops by more than half; every job's `last_success_at` stays as fresh as before.

### 3. Turn on slow-query visibility

- **Found:** `pg_stat_statements` is not loaded and `log_min_duration_statement` is off. The statistics show a problem but not the query: `bookings` has been read in full 15,462 times (381 million rows), and 119 sorts spilled to disk (940 MB).
- **Change:** in the Postgres container command set `shared_preload_libraries=pg_stat_statements`, `log_min_duration_statement=500`, `log_lock_waits=on`, `track_io_timing=on`; create the extension in a migration.
- **Risk:** low, but Postgres must restart (a few seconds of downtime), so it needs the owner's go.
- **Verify:** `SELECT * FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20` returns rows after a day.

### 4. Add database timeouts for the application role

- **Found:** no statement, lock or idle-in-transaction timeout is set on the server, on the roles, or in the API code. A stuck request can hold locks on a booking or payment row with no limit. Four deadlocks are on record.
- **Change:** `ALTER ROLE must_booking_app SET statement_timeout`, `lock_timeout` and `idle_in_transaction_session_timeout`. Start from 30 s, 10 s and 60 s, then check the longest legitimate queries (reports, exports, imports) with the data from task 3 before fixing the values.
- **Risk:** medium-low. A value set too low breaks a long report.
- **Verify:** `SELECT rolconfig FROM pg_roles WHERE rolname='must_booking_app'`; full test suite; an export and a guest import on the test hotel.

### 5. Background sweeps scan whole tables

- **Found:** the indexes start with `tenant_id`, but the background sweeps look across all hotels by status or time, so they read the whole table. Full scans so far: `venue_deposit_operations` 171,479 (its `(state, created_at)` index has never been used), `payment_provider_sessions` 71,475, `email_transport_attempts` 43,606, `integration_operations` 32,324, `venue_reservations` 12,211, `manual_review_items` 7,008, `provider_events` 3,123.
- **Why it matters:** each scan takes milliseconds today. The cost grows with rows times hotels.
- **Change:** one partial index per sweep, matching its exact `WHERE` (for example `provider_events (created_at) WHERE status IN ('RECEIVED','QUEUED')`). Take the exact queries from task 3; do not guess.
- **Verify:** `seq_scan` on each table stops rising; `EXPLAIN` of each sweep shows an index scan.

### 6. 81% of the audit log is one machine event

- **Found:** 25,117 of 31,012 `audit_logs` rows are `clock.guest_import_batch`, about 1,500 a day. `clock_catalog.synced` adds 3,758. Human actions (252 bookings created, 128 logins) are buried, and the table grows about 55,000 rows a month.
- **Change:** write one row per import run that changed something, or move sync runs to their own log. The audit log is append-only by ADR-0037, so existing rows stay unless the owner sets a retention period (task 10).
- **Verify:** rows per day in `audit_logs` drop below 300 with the same sync activity.

### 7. Review queue on the real hotels is too long to use

- **Found:** Empire has 743 open items saying a Clock booking total has no valid currency (created 2026-10-27 to 2026-11-12) and 53 open payment mismatches. Luxury has 31 open items. Nobody can work through 743 items, so the real problems are hidden.
- **Change (backend review decides):** stop raising a review item for a case staff cannot act on, or group it into one notice per hotel. Closing existing rows on Empire and Luxury changes live data and needs the owner's go.
- **Verify:** open items per real hotel drop to a number staff can clear in a day.

### 8. Failed webhook events are never closed

- **Found:** 837 Empire `folio_update` events are still `FAILED` (last one 2026-10-16, up to 13 attempts each). One Empire `booking_canceled` event failed on 2026-11-12.
- **Change (backend review):** confirm that booking is cancelled in MUST (the two-minute booking sync should have caught it). Give old failures a final state so the count means something.
- **Verify:** `FAILED` count is zero or every row has a reason.

### 9. Luxury has never received a Clock webhook

- **Found:** Luxury has no rows in `provider_events` and no `last_webhook_received_at`. It is kept current by polling only.
- **Question for the owner:** is this intended? If not, set up the webhook subscription in Luxury's Clock account.

### 10. No retention rules for growing tables

- **Found:** `provider_events` keeps every raw payload (18 MB, about 7,000 new rows a month for 3 hotels). `clock_guest_profiles` holds a full copy of each hotel's Clock guest list (28,269 rows with names, emails and phones). `audit_logs`, the email tables and the idempotency receipts also grow without limit.
- **Change:** the owner picks periods (a common choice: raw webhook payloads 90 days, receipts 30 days, audit 2 years). Then one scheduled cleanup per table. Decide whether the full guest copy is needed or only the guests who have a booking.
- **Risk:** medium, because it deletes data. Needs a written rollback (the nightly backup) and a first run on the test hotel.

### 11. Database owner role is a superuser

- **Found:** the API correctly connects as `must_booking_app` (not a superuser, row-level security applies). The role that owns all 116 tables and 88 functions, `must_booking`, is a superuser that bypasses row-level security. All 31 `SECURITY DEFINER` functions therefore run with full rights; a mistake in one would cross hotel boundaries. Two of them (`auth_assert_platform_user_is_exclusive`, `auth_assert_tenant_membership_is_exclusive`) can be executed by `PUBLIC`.
- **Change:** move ownership to a role that is not a superuser, keep the superuser for maintenance only, and revoke `PUBLIC` execute on the two functions.
- **Risk:** medium. Do it with the security review, not alone.

### 12. Database-level guard against double booking before the first native hotel

- **Found:** `inventory_units` and `room_availability` have 0 rows on live, so the native (non-Clock) booking path has never run in production. It protects rooms with row locks in application code. There is no database constraint behind it.
- **Change:** before the first native hotel goes live, add an exclusion constraint (`btree_gist`) so two active bookings can never overlap on one room. Limit it to MUST-origin bookings: imported Clock history has 280 overlapping confirmed pairs (77 Empire, 202 Luxury, 1 test; none in the future), which would block a plain constraint.
- **Verify:** a test that inserts two overlapping bookings for one room fails at the database.

### 13. Remove duplicate and redundant indexes

- **Found:** 2 exact duplicates (`inventory_units` and `room_availability` each have an index identical to their primary key), 2 indexes on `bookings` for the same room-and-dates lookup (one never used, 2.7 MB), 29 indexes that are a prefix of another, 27 never used. Indexes are 48 MB of the 130 MB.
- **Change:** drop the exact duplicates and the prefix-redundant ones in one additive-safe migration. Look at "never used" again after 30 more days, since some serve rare screens.
- **Verify:** `prisma migrate diff` is clean; test suite passes.

### 14 and 15. Recorded, no action

- The server has 1 vCPU and 956 MB RAM with 462 MB of swap in use, and a reboot is pending for system updates. The owner decided on 2026-11-06 to leave the server size alone; task 2 lowers the load.
- 49 foreign keys have no supporting index. They only cost time when a parent row is deleted, which is rare here. The largest is `bookings.rate_plan_id`.

## Verified healthy

- Every table has a primary key. 171 foreign keys and 234 check constraints, all valid. No broken indexes. 200 migrations applied, none failed.
- Row-level security is on and forced for 113 of 116 tables; the other three are global by design (`plans`, `exchange_rates`, `_prisma_migrations`). No protected table lacks a policy.
- Every `SECURITY DEFINER` function pins its `search_path`.
- Money is `NUMERIC` everywhere; no float columns; all timestamps carry a time zone.
- Data checks across all three hotels: 0 bookings with bad dates, negative totals or missing currency; 0 duplicate guest emails inside a hotel; 0 payments in another currency without an exchange rate; no room is double-booked in the future; no booking is stuck on a real hotel.
- Backups run nightly and before each deploy, are encrypted, size-checked and kept 30 days off-site and 7 days locally.
- The database answers from memory (cache hit rate 100%).

## Not checked

- Which exact queries cause the full scans of `bookings` (needs task 3).
- Whether every row-level security policy is correct for every role (belongs to the security review).
- Restore of a current backup (last test 2026-10-09).
