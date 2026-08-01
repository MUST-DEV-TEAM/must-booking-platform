# Operations

This runbook covers installation, configuration, verification, deployment, diagnostics, incidents, and recovery for the `0.4.92` release-candidate working tree based on commit `b0380ad`. It does not authorize provider or production operations.

## Evidence and compatibility baseline

- Current evidence: working tree based on commit `b0380ad`, release metadata `0.4.92`, inspected 2026-07-17.
- Plugin metadata declares WordPress 5.0+, PHP 7.4+, and tested through WordPress 6.0.
- Payment, email, and portal paths use PHP 7.4-compatible string checks. Run the production PHP lint/deployment check before release.
- The WordPress tested-up-to value is metadata, not proof of compatibility with current WordPress, Elementor, theme, PHP, database, browser, or provider versions.
- Production configuration, database shape, credentials, callbacks, cron execution, backups, and provider state were not inspected in this consolidation.

## Installation

### Prerequisites

- A recoverable WordPress installation with database/file backup access.
- PHP 7.4 or later; run source lint and the booking/payment smoke tests on the exact deployment runtime.
- HTTPS for any provider callback environment.
- Working WordPress permalinks and WP-Cron, or an external scheduler that calls `wp-cron.php`.
- Provider accounts/rights only when that integration is intentionally configured.

### Procedure

1. Back up the WordPress database and existing plugin directory.
2. Install the canonical release ZIP or place the directory at `wp-content/plugins/must-hotel-booking`.
3. Verify `must-hotel-booking.php`, the version constant, `readme.txt` stable tag, and package name agree.
4. Activate the plugin from WordPress admin.
5. Open plugin Settings and inspect managed pages, database diagnostics, cron, email, payments, provider readiness, and updater state.
6. Save permalinks if `/staff`, `/staff-login`, or managed public routes return 404.

Activation performs table installation, current payment-policy migration/repair, default inventory backfill, managed-page installation, staff capability synchronization, cron scheduling, portal rewrite registration, and rewrite flushing. It does not constitute production acceptance.

## Upgrade and database behavior

The plugin stores its database version in `must_hotel_booking_db_version`. On `plugins_loaded`, an older stored version runs the full idempotent installer. Payment/refund, public-access, Clock-fulfillment lease, confirmation-integrity, and payment-attempt/paid-observation schema repair also run at the current version so partially upgraded installations receive additive columns, indexes, ownership/allocation/evidence tables, and grant/context tables.

- The base installer defines 32 `dbDelta()` tables, and the additive public-access repair creates/reconciles two grant/context tables; no plugin table uses foreign keys.
- Public access adds `must_public_booking_access` and `must_public_booking_access_contexts`; tokens/selectors are stored only as hashes.
- Clock fulfillment adds `provider_fulfilment_key`, `provider_fulfilment_owner`, claim/lease timestamps, and an expiry index to `must_reservations` without renaming or dropping legacy data.
- Confirmation integrity adds finite flow/source/claim/timestamp columns to `must_reservations`, plus `must_payment_verification_groups` and `must_payment_verifications`. Unique ownership, payment, claim and group/reservation indexes prevent reassignment. Confirmed legacy rows remain untouched; a pending legacy row is classified only by an exact trusted gateway-attempt, Clock-import, staff-offline or authorized recovery path.
- Payment-attempt integrity additively extends `must_payments` with attempt reference/status, provider/site/Clock identities, exact reservation/allocation hashes, minor-unit total/currency, checkout mode, expiry and booking snapshot. Legacy rows retain `attempt_status=legacy`; they are readable but are not silently treated as reusable proof.
- `must_paid_provider_observations` and `must_paid_provider_observation_allocations` store idempotent provider-paid/manual-review evidence separately from the payment ledger and immutable successful verification claims. The provider/mode/account/reference ownership key prevents callback duplicates without conflating environments; no observation emits success hooks.
- There is no ordered numbered migration ledger; the plugin release version is also the migration version.
- Historical schema code is not obsolete merely because current installations may already contain its changes.
- Deactivation unschedules plugin cron hooks and flushes rewrites; it does not delete operational data.
- A file rollback is not a schema rollback. Do not downgrade plugin files without evaluating existing columns, options, metadata, and provider state.

For every upgrade:

1. Capture database and plugin-file backups and verify restore access.
2. Record current plugin/database versions and scheduled hooks.
3. Deploy the reviewed package.
4. Load WordPress once so upgrade hooks can run.
5. Inspect database errors, managed pages, cron schedules, provider job backlog, and diagnostics.
6. Run a non-write booking/render smoke in the intended environment.
7. Perform provider tests only under a separately approved acceptance plan.

## Initial configuration

Configure, in order:

1. Hotel identity, currency, timezone, stay/booking rules, and cancellation window.
2. Accommodations, physical rooms/inventory, restrictions, rate plans, taxes/fees, and coupons.
3. Managed page assignments and permalink behavior.
4. Email sender, layout, templates, and an independently verified delivery path.
5. Provider mode (`local` or `clock`) and any explicit fallback policy.
6. Environment-specific Stripe/PokPay credentials and enabled methods.
7. Clock account/subscription/property/endpoints, mappings, inbound authentication, sync schedules, and accounting mode when Clock is selected; then explicitly approve the displayed current Clock payment target for the saved site environment.
8. Staff roles/users, portal module visibility, and capabilities.
9. Support diagnostics only if its token-protected public endpoint is operationally required.

Fresh-install payment policy prefers online payment; PokPay is the default when available. `pay_at_hotel` is disabled unless explicitly enabled. Do not enable a method merely because fields are populated; validate the intended environment through an approved administrative process.

For Clock, use the documented regional URL shape `https://{region}.clock-software.com/{api_type}/{subscription_id}/{account_id}` or a deliberately configured HTTPS proxy base. PMS and Base API access are validated independently. Confirm the API user has the required account rights, keep traffic at or below five calls per second, and never treat a network/5xx result after a write as permission to replay it. Inbound PUSH must have either the exact SNS `TopicArn` pinned or complete Basic credentials; an SNS signature alone is not sufficient source binding.

## Managed pages and routes

| Route | Requirement | Purpose |
|---|---|---|
| `/booking` | Required | Search dates, party, room count/category |
| `/booking-accommodation` | Required | Accommodation/room selection |
| `/checkout` | Required | Guest details and stay review |
| `/booking-confirmation` | Required | Payment, provider return, result, cancellation review |
| `/rooms` | Optional assignment | Room catalogue/Elementor host |
| `/staff` | Required when portal enabled | Staff application shell |
| `/staff-login` | Required when portal enabled | Staff authentication |

The plugin tracks managed page IDs and can repair missing assignments from Settings. `must_hotel_booking_managed_pages_suspended` suppresses automatic management. Current source exposes no separate legacy factory-reset flow described by old manuals; do not rely on that historical behavior.

For missing routes:

1. Inspect Settings -> Managed Pages and confirm assigned pages are published.
2. Confirm the portal feature/module settings and staff-login page.
3. Save WordPress permalinks to flush rewrite rules.
4. Verify no theme/Elementor template redirects the managed pages.
5. Do not create duplicate pages until assignments and rewrite state are understood.

## Background jobs

| Hook | Default/current role |
|---|---|
| `must_hotel_booking_cleanup_expired_locks` | Every five minutes; expired locks and pending-payment cleanup callbacks share this schedule. |
| `must_hotel_booking_process_provider_sync_jobs` | Every five minutes; bounded queue drain with single follow-up events. |
| `must_hotel_booking_clock_full_catalog_sync` | Daily, default local time 03:00. |
| `must_hotel_booking_clock_availability_rate_sync` | Enabled by default, normally every 15 minutes. |
| `must_hotel_booking_clock_reservation_fallback_sync` | Enabled by default, normally every five minutes with small batches. |

Saved installations can retain different schedule values. `ClockReservationAutoSyncScheduler` remains in source but is not registered/scheduled directly on current `main`; treat it as an investigation candidate, not a second active schedule.

If `DISABLE_WP_CRON` is true, the hosting platform must call `wp-cron.php`. Before repairing a backlog, inspect:

- next-run timestamps and overdue diagnostics;
- WordPress/site timezone;
- provider job pending/retryable/exhausted counts;
- locks and last sanitized error;
- provider rate limiting and credentials;
- whether a previous write may have succeeded externally.

Manual run/repair controls can make external requests. Do not use them against a connected environment merely to clear a warning.

## Diagnostics and observability

Settings -> Diagnostics & Maintenance reports managed pages, lock cleanup, payment/email/provider/updater state, abuse protection, slow booking requests, and a table-health sample.

Important limitation: diagnostics checks 24 tables while installation currently produces 34 plugin tables, including the two public-access grant/context tables. It is not a complete schema audit.

| Evidence | Location/owner | Notes |
|---|---|---|
| Activity events | `must_activity_log` | Booking/admin/email lifecycle summaries; no general retention policy found. |
| Provider requests | `mhb_provider_request_logs` | Sanitized direction, operation, correlation/idempotency data, timing, result. |
| Provider work | Provider sync job table/repository | Pending, retryable, exhausted and completed work. |
| Clock accounting | Clock folio accounting table/repository | Operation and provider item/folio correlation. |
| Slow public requests | Bounded WordPress option | Threshold around 1.5 seconds, bounded to 40 recent rows. |
| Support health | `GET /wp-json/must-support/v1/health` | Disabled by default; token-protected and operationally sensitive. |
| PHP/WordPress errors | Hosting/PHP/WordPress logs | Location is environment-specific; avoid logging secrets or full personal data. |

Never paste raw diagnostics, provider bodies, backups, or logs into Markdown/issues without sanitizing credentials, tokens, URLs containing secrets, personal data, and provider identifiers that do not need disclosure.

## Safe local verification

There is no Composer/npm/PHPUnit project runner. Tests are standalone PHP scripts, and some assert source markers rather than behavior.

```powershell
php -l path\to\changed-file.php
node --check path\to\changed-file.js
php tests\FocusedTestName.php
git diff --check
git status --short
```

For a documentation-only change, validate Markdown links, diff scope, secrets, version claims, and `git diff --check`; PHP/runtime tests are not required unless the documentation claim needs them.

Classify test evidence correctly:

- A standalone fake/mocked behavioral test can prove only its modeled boundary.
- A source-text assertion proves ordering/markers in source, not callback concurrency, database transactions, or provider outcomes.
- The E2E harness is the broadest repository lifecycle workflow, but its write mode is destructive/external and requires explicit authorization.

### Clock exact-room read acceptance

Deployment of exact physical-room availability requires a separately approved, read-only check in a named non-production Clock environment. Confirm all of the following without creating reservations, holds, payments, callbacks, sync jobs, or accounting writes:

1. One `rates_availability` read for a known parent type/rate returns complete occupied-date rows with Boolean `free` evidence.
2. One matching `room_statuses` read uses check-in through checkout-minus-one-day and returns the documented room-type groups and physical-room Boolean `available` rows.
3. A known available and a known unavailable physical room are classified correctly without substitution.
4. The configured account has endpoint rights, request latency is acceptable, and logs contain only sanitized operation/error summaries rather than full response bodies, guest data, housekeeping notes, credentials, or unnecessary private identifiers.

Until that account-specific check passes, local fake-fixture tests establish only the modeled contract; they do not certify production Clock rights, response shape, data agreement, or performance. Any transport, HTTP, parse, mapping, or missing-row uncertainty must remain provider-unconfirmed and fail closed at selected-stay/write boundaries.

## Tool safety matrix

| Tool | Safety boundary |
|---|---|
| `tools/lifecycle-sync-smoke-test.php` | Isolated fake-based local smoke. |
| `tools/clock-accounting-readiness.php` | Local configuration inspection; no Clock write expected. |
| `tools/clock-accounting-environment-report.php` | Reads local config/data and prints identifiers; output is sensitive. |
| `tools/provider-preflight-report.php` | Despite a read-only label, performs external Clock GET/Stripe balance and possible PokPay order fetch; approval required. |
| `tools/clock-e2e-backup.php` | Writes ignored local backups containing settings/table data; protect and remove under an approved process. |
| `tools/clock-e2e-settings.php` | Mutates plugin settings. |
| `tools/clock-e2e-cleanup.php` | Mutates reservation/payment state. |
| `tests/E2E/production-lifecycle-harness.php` | Default readiness mode is non-write; `--allow-external-writes` creates provider/local records and requires non-production isolation and backups. |
| `tools/release-plugin.ps1` | Pulls, edits versions/changelog, stages all changes, commits, pushes, tags, and publishes; release-only. |

Read a tool before running it. A filename or `read_only` flag is not proof of no network or no mutation.

## Deployment and release

### Pre-deployment

1. Use a reviewed clean release branch/worktree.
2. Confirm only intended files changed; preserve unrelated work.
3. Align plugin header, version constant, `readme.txt` stable tag, changelog, tag, and ZIP name.
4. Lint changed PHP/JS and run focused standalone tests.
5. Review database/option compatibility and backup/rollback plan.
6. Validate the package manifest excludes development, secret, backup, worktree, and temporary artifacts.
7. Record which provider/runtime acceptance remains unverified.

The GitHub release workflow validates version metadata and ZIP content/structure and publishes an asset. It does not run PHP lint, JavaScript checks, or the standalone test suite.

`tools/release-plugin.ps1` uses broad staging (`git add -A`) and performs remote release actions. Never run it from a dirty or unreviewed worktree.

### Post-deployment

1. Confirm plugin version and activation without fatal errors.
2. Confirm database upgrade evidence and no new database errors.
3. Verify managed pages, portal login/routes, and permalinks.
4. Inspect cron schedules and provider job backlog.
5. Render public search/selection/checkout/confirmation in non-write states.
6. Verify email/provider callbacks only through the approved acceptance procedure.
7. Monitor sanitized logs for new failures, retries, duplicates, or performance regressions.

## Read-only production investigation

SSH or database access must be explicitly authorized and read-only by default.

- Identify environment, host, release, and incident window before connecting.
- Avoid commands that invoke WordPress hooks, cron, reconciliation, or provider calls.
- Prefer file/version checks, log reads, option/table counts, and narrowly scoped SELECTs.
- Mask secrets, personal data, tokens, provider URLs/IDs, and payment details in captured evidence.
- Do not edit plugin files, options, cron, rows, permissions, or caches during diagnosis.
- Stop if a command may bootstrap write-capable WordPress code or contact a provider.

## Incident playbooks

### Provider payment captured, local booking still pending

1. Freeze automatic/manual retries for the affected correlation set.
2. Preserve gateway object/event evidence, pending payment/reservation rows, provider logs, and Clock IDs if any.
3. Verify reservation allocation, amount, currency, environment/account, and transaction identity.
4. Inspect the immutable pending-attempt fields/payment allocation, paid-provider observation and allocation (if present), payment verification group/allocation, durable `online_payment_verification`, confirmation flow/claim/source, provider sync state, fulfillment key/owner/lease, and per-room fulfillment outcome.
5. Determine whether Clock wrote a booking before any new create attempt. An expired lease or `manual_review` is a stop condition, not retry permission.
6. Reconcile through an approved manual/recovery plan. An administrative recovery must remain explicit, capability-authorized and activity-logged; do not mark paid, reclassify a known online flow, or create another booking by inference.

### Duplicate or partial Clock fulfillment

Stop retries. Preserve every local/external ID and all rooms in the group. Reread Clock without mutation, correlate provider logs, identify orphan/duplicate records, and escalate for a compensating/manual plan.

### Cron or provider-job backlog

Inspect WP-Cron, next runs, locks, due/retryable/exhausted jobs, rate limits, and the last provider error. Determine whether queued writes are safe to replay before repair. Do not run the queue merely to reduce the count.

### Confirmation data exposure or forged state change

Treat as a security incident. Restrict/disable the affected public surface at the hosting/application boundary if authorized, preserve sanitized request/log evidence, identify exposed/changed reservations, and plan a code fix and notification response. Do not destroy evidence.

### Missing tables or pages after update

Preserve a backup, confirm the deployed version, load WordPress once for upgrade hooks, inspect database errors/diagnostics, repair managed assignments/permalinks, and reactivate only when safe. Never drop/recreate tables to clear diagnostics.

## Reset, rollback, and recovery

Current source exposes one destructive administrator action: Reset Demo / Test Hotel Data. It requires `manage_options`, a nonce, exact reset target, phrase `RESET DEMO DATA`, acknowledgement, and current password. It deletes operational/provider data and logs while preserving settings, credentials, managed pages, staff users, and WordPress content.

This action is not a normal recovery tool and must never be used on production data without a separately approved destructive-data plan and verified backup.

Rollback principles:

- Restore files and database as a coordinated recovery unit when schema/data changed.
- Pause provider jobs before rolling back code that interprets their payload/state.
- Preserve captured-payment, refund, Clock booking, and accounting evidence.
- Do not delete unknown rows or reset provider state to make the UI look healthy.
- After restore, verify routes, schedules, schema, provider ownership, and no duplicate callbacks/jobs.

## Operational stop conditions

Stop and escalate when:

- the target environment or provider account is uncertain;
- backups/restore cannot be proven;
- a command can write to a provider or production database without explicit approval;
- payment or provider write success is ambiguous;
- a retry could duplicate a booking, refund, or accounting entry;
- migrations would remove/rename data or lack an idempotent plan;
- sensitive output cannot be captured safely;
- production callback, cron, log retention, provider rights, or current API contract is required but unverified.
