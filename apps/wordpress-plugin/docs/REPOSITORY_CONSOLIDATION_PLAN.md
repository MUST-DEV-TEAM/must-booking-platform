# Repository Consolidation Plan

> Temporary master plan. This file records repository-wide evidence and future cleanup phases. It is not current-behavior documentation; use the canonical documents linked from [INDEX.md](INDEX.md) for normal tasks.

## 1. Executive assessment

### Overall health

The plugin has a substantial operational surface and useful domain separation, but repository hygiene and production-integrity confidence are uneven.

- The current release-candidate working tree is based on `b0380ad`; plugin header, version constant, and `readme.txt` stable tag agree on `0.4.92`.
- Bootstrap, managed pages, local/Clock provider adapters, repositories, payment gateways, staff portal, admin surfaces, and WP-Cron workers are all present.
- Documentation had become materially stale and duplicated. Before this consolidation, the active worktree held 45 tracked Markdown files, two ignored temporary Markdown files, long manuals based on `0.3.45`, a 317-line task diary, and multiple dated Clock research/acceptance reports.
- The current automated tests are standalone PHP scripts. Many are valuable static or mocked checks, but several high-risk payment-first tests assert source markers rather than exercising database concurrency or failure recovery.
- The original audit found confirmed production-integrity risks. The risk register below now marks implemented remediations while retaining unresolved operational and acceptance risks.

### Main sources of bloat

1. Duplicate short knowledge-base documents and long `0.3.45` manuals describing the same surfaces.
2. Task logs, acceptance snapshots, and research reports that repeat Git history.
3. Ignored release ZIPs, test logs, vendor research caches, browser artifacts, local backups, and nested worktrees under the plugin directory.
4. Compatibility layers, provider fallbacks, schedulers, and portal templates whose current use is uncertain.

### Main maintainability risks

1. Eager function-file loading in `includes/config.php` coexists with namespace autoloading and legacy aliases.
2. Dependencies are cyclic in places: Core initializes all layers; Engine calls Provider; Provider calls Engine; Portal reuses Admin services.
3. The schema uses the plugin version as its migration version and has no ordered migration ledger. Equal-version repair is narrowly payment/refund focused.
4. No database foreign keys were found; referential integrity is application-enforced across 28 tables.
5. Several very large controllers/pages combine rendering, request handling, permissions, and orchestration.

### Main production-integrity risks

The highest remaining risks are external acceptance and operations rather than known blind-write defects: real database/concurrency behavior is not certified; multi-room Clock creation can end partially fulfilled; schema history lacks an ordered migration ledger; WP-Cron/provider rights/current production state are unknown; and log retention, durable email retry ownership, plus passive PokPay credential probes remain unresolved.

See [Production-integrity risk register](#8-production-integrity-risk-register) for both resolved and open findings.

### Cleanup readiness

- **Safe now:** canonical documentation consolidation, tracked obsolete Markdown retirement, and read-only inventory work.
- **Safe after review:** ignored/generated artifact cleanup and retirement of obsolete diagnostic evidence.
- **Not safe without a scoped plan:** dead-code removal, service consolidation, destructive schema work, or provider/production mutation.

## 2. Evidence and audit scope

### Areas inspected

- Plugin bootstrap, custom autoloader, eager module loading, activation/deactivation, database upgrade, managed pages, roles, and updater.
- `src/Core`, `src/Database`, `src/Engine`, `src/Provider`, `src/Admin`, `src/Frontend`, `src/Portal`, and `src/Elementor` entry points.
- All current REST route registrations, major AJAX registrations, WordPress hooks, cron hooks, configuration storage, schema definitions, repositories, templates, assets, tests, tools, and release workflow.
- The complete active-worktree Markdown inventory, ignored Markdown artifacts, inbound links, nested worktree state, tags, branches, recent commits, milestone commits, and targeted diffs.
- Current `main` compared with unmerged commits `8be9f0e` and `b5b8fbf` only as historical/intended evidence.

### Git history inspected

- Repository creation from 2026-03-12.
- Major provider release `v0.4.0` (`a676b6a`).
- PokPay introduction (`d0e9805`, released as `v0.4.5`).
- Provider/payment hardening through `v0.4.82`–`v0.4.88`.
- Payment-first Clock creation in `v0.4.89` (`1aab2ec`).
- Linux-compatible packaging in `v0.4.90` (`dcff3b4`).
- Unmerged confirmation-integrity branch commits `8be9f0e` and `b5b8fbf` from merge base `016e5ac`.

### Representative commands

```powershell
git status --short --untracked-files=all
git status --short --ignored
git branch --show-current
git log --graph --decorate --oneline --all
git tag --sort=-version:refname
git show --stat <commit>
git diff --stat v0.4.88..HEAD
git ls-files '*.md'
rg --files src tests tools
rg -n "register_rest_route|wp_schedule_event|add_action|add_filter|add_shortcode|register_block_type" must-hotel-booking.php includes src
rg -n "CREATE TABLE|dbDelta|must_hotel_booking_db_version" src/Database/install-tables.php src/Core/Plugin.php
rg -n "reservation_ids|booking_id|getConfirmationRows" src/Frontend src/Database src/Engine
```

### Limitations

- No WordPress request, database write, browser flow, cron event, package build, deployment, or provider request was run.
- Current production configuration, credentials, provider rights, provider state, database contents, theme overrides, and WordPress cron health are unknown.
- Clock/API claims are limited to current source, current tests, and dated repository evidence. Provider contracts were not refreshed externally.
- Ignored backups, E2E evidence, and provider cache payloads were inventoried by path only; customer/provider payload contents were not copied into documentation.
- Static reference searches cannot rule out external plugins/themes calling public FQCNs or legacy functions.

## 3. Existing documentation inventory

`MERGE` means durable content was moved into the named canonical destination and the source document is retired. `DELETE` means no unique durable content remains outside Git history.

| Exact path | Current purpose | Accuracy / duplication | Historical value | Operational value | Destination | Final classification |
| --- | --- | --- | --- | --- | --- | --- |
| `AGENTS.md` | Agent safety/workflow | Strong but overly task-log oriented | Medium | High | `AGENTS.md` | `REWRITE` |
| `README.md` | Project entry/install/release notes | Stale; unsupported shortcode/block claim | Medium | Medium | `README.md`, `OPERATIONS.md` | `REWRITE` |
| `todo.md` | Raw backlog | Status unverified; environment-specific | Low | Medium | Risk register and phases in this plan | `MERGE` |
| `docs/INDEX.md` | Task router | Useful but routes to obsolete documents | Medium | High | `docs/INDEX.md` | `REWRITE` |
| `docs/README.md` | Legacy doc index | Based on `0.3.45`; duplicates index | Medium | Low | `docs/INDEX.md` | `MERGE` |
| `docs/PROJECT_CONTEXT.md` | Product summary | Calls `0.4.80` current | Medium | High | `docs/PROJECT_CONTEXT.md` | `REWRITE` |
| `docs/ARCHITECTURE.md` | Short architecture | Useful but incomplete/stale | Medium | High | `docs/ARCHITECTURE.md` | `REWRITE` |
| `docs/FILE_MAP.md` | Task-to-file map | Useful, duplicated by architecture/index | Low | High | `docs/ARCHITECTURE.md`, `docs/INDEX.md` | `MERGE` |
| `docs/ADMIN_DASHBOARD.md` | Admin route/UI notes | Useful, duplicated by manual | Medium | High | `docs/ARCHITECTURE.md`, `docs/UI_UX.md` | `MERGE` |
| `docs/STAFF_PORTAL.md` | Portal notes | Useful, predates later payment work | Medium | High | `docs/ARCHITECTURE.md`, `docs/UI_UX.md` | `MERGE` |
| `docs/CUSTOMER_DASHBOARD.md` | Guest surfaces | Partial; access warning unresolved | Medium | High | `docs/PROJECT_CONTEXT.md`, `docs/UI_UX.md`, `docs/DOMAIN_LIFECYCLES.md` | `MERGE` |
| `docs/UI_RULES.md` | CSS/JS conventions | Mostly stable, duplicated by new UI contract | Low | High | `docs/UI_UX.md` | `MERGE` |
| `docs/BOOKING_FLOW.md` | Booking lifecycle | Missing v0.4.89 payment-first behavior | High | High | `docs/DOMAIN_LIFECYCLES.md` | `MERGE` |
| `docs/PAYMENTS.md` | Payment/refund lifecycle | Missing v0.4.89 ordering/recovery gap | High | High | `docs/DOMAIN_LIFECYCLES.md`, `docs/INTEGRATIONS.md` | `MERGE` |
| `docs/DATABASE.md` | Schema summary | Stale version; useful table map | High | High | `docs/ARCHITECTURE.md` | `MERGE` |
| `docs/INTEGRATIONS.md` | Provider reference | Detailed but stale before v0.4.89 | High | High | `docs/INTEGRATIONS.md` | `REWRITE` |
| `docs/TROUBLESHOOTING.md` | Technical diagnostics | Useful but duplicated and provider-heavy | Medium | High | `docs/OPERATIONS.md` | `MERGE` |
| `docs/DECISIONS.md` | Decision log | Valuable; incomplete and malformed in places | High | High | `docs/DECISIONS.md`, ADRs | `REWRITE` |
| `docs/TASK_LOG.md` | Task diary | Duplicates Git; stops before current release | High | Medium | `CHANGELOG.md`, `PROJECT_TIMELINE.md`, `DECISIONS.md` | `MERGE` |
| `docs/admin/admin-manual.md` | Admin manual | Based on `0.3.45`; defaults conflict with code | High | Medium | `docs/UI_UX.md`, `docs/OPERATIONS.md` | `MERGE` |
| `docs/developer/architecture-overview.md` | Detailed architecture | Based on `0.3.45`; duplicates architecture | High | Medium | `docs/ARCHITECTURE.md` | `MERGE` |
| `docs/developer/clock-provider-setup.md` | Clock setup | Useful but predates split scheduler/payment-first | High | High | `docs/INTEGRATIONS.md`, `docs/OPERATIONS.md` | `MERGE` |
| `docs/developer/configuration-and-settings.md` | Settings catalogue | Substantially stale | High | High | `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, `docs/OPERATIONS.md` | `MERGE` |
| `docs/developer/database-schema.md` | Column reference | Based on `0.3.45`; missing later schema | High | Medium | `docs/ARCHITECTURE.md` | `MERGE` |
| `docs/developer/hooks-endpoints.md` | Hook/endpoint reference | Missing later routes/hooks | High | High | `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md` | `MERGE` |
| `docs/developer/managed-pages-and-migrations.md` | Pages/upgrades/updater | Partially stale | High | High | `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md` | `MERGE` |
| `docs/developer/payments-and-stripe.md` | Detailed payment reference | Useful through v0.4.87; duplicate/stale | High | High | `docs/DOMAIN_LIFECYCLES.md`, `docs/INTEGRATIONS.md` | `MERGE` |
| `docs/developer/roles-capabilities.md` | Role/capability matrix | Useful but old | High | High | `docs/UI_UX.md`, `docs/ARCHITECTURE.md` | `MERGE` |
| `docs/elementor/elementor-widgets-guide.md` | Elementor guide | Older but mostly stable | Medium | Medium | `docs/UI_UX.md`, `docs/INTEGRATIONS.md` | `MERGE` |
| `docs/getting-started/installation-setup-guide.md` | Setup guide | Based on `0.3.45` | High | High | `README.md`, `docs/OPERATIONS.md` | `MERGE` |
| `docs/guest/guest-booking-guide.md` | Guest guide | Predates later payment-first behavior | Medium | Medium | `docs/UI_UX.md`, `docs/DOMAIN_LIFECYCLES.md` | `MERGE` |
| `docs/internal/documentation-gaps-and-unverified-areas.md` | Ambiguity register | Some findings resolved; others remain | High | Medium | `PROJECT_CONTEXT.md` risks and this plan | `MERGE` |
| `docs/internal/release-checklist-v0.4.0.md` | Historical release checklist | Accurate only as dated history | High | Low | `PROJECT_TIMELINE.md`, `OPERATIONS.md` | `MERGE` |
| `docs/CANCELLATION_FINANCIAL_CLEANUP_ACCEPTANCE.md` | v0.4.82 acceptance snapshot | Dated, not current readiness | High | Low | `DOMAIN_LIFECYCLES.md`, `PROJECT_TIMELINE.md`, plan risks | `MERGE` |
| `docs/CLOCK_ACCOMMODATION_CHARGE_CLEANUP_DESIGN.md` | Manual Clock cleanup design | Durable boundary in oversized form | High | Medium | `ADR-0003`, `INTEGRATIONS.md` | `MERGE` |
| `docs/CLOCK_CANCELLATION_FEE_ACCOUNTING_DESIGN.md` | Manual fee accounting design | Durable boundary in oversized form | High | Medium | `ADR-0003`, `INTEGRATIONS.md` | `MERGE` |
| `docs/RESERVATION_AMENDMENT_ACCEPTANCE.md` | Amendment acceptance | Dated v0.4.82 snapshot | High | Low | `DOMAIN_LIFECYCLES.md`, `PROJECT_TIMELINE.md` | `MERGE` |
| `docs/research/clock/README.md` | Research cache policy | Accurate dated provenance | Medium | Low | `INTEGRATIONS.md`, plan limitations | `MERGE` |
| `docs/research/clock/SOURCE_MANIFEST.md` | Research source manifest | Dated provenance; not current API truth | High | Low | `PROJECT_TIMELINE.md`, Git history | `MERGE` |
| `docs/research/clock/postman-endpoint-index.md` | Large endpoint snapshot | Accurate as 2026-06-19 snapshot; costly context | High | Medium | `INTEGRATIONS.md`, `ADR-0003`, Git history | `MERGE` |
| `docs/research/clock/acceptance-evidence.md` | v0.4.81 evidence | Dated and superseded in parts | High | Low | `PROJECT_TIMELINE.md`, plan risks | `MERGE` |
| `docs/research/clock/inbound-push-sns.md` | SNS protocol/audit | Protocol useful; implementation snapshot dated | High | High | `INTEGRATIONS.md`, `DOMAIN_LIFECYCLES.md` | `MERGE` |
| `docs/staff/staff-portal-guide.md` | Staff manual | Large and stale before later provider/payment work | High | Medium | `UI_UX.md`, `OPERATIONS.md` | `MERGE` |
| `docs/troubleshooting/troubleshooting-and-faq.md` | Legacy FAQ | Based on `0.3.45`; duplicates troubleshooting | High | Medium | `OPERATIONS.md` | `MERGE` |
| `tests/E2E/README.md` | E2E safety contract | Current intent, but “read-only” needs nuance | Medium | High | `OPERATIONS.md` | `MERGE` |

### Pre-existing ignored Markdown retained

These files are not tracked and were not changed or deleted because they are pre-existing local artifacts:

| Exact path | Classification | Reason |
| --- | --- | --- |
| `tmp/clock-postman-index-generated.md` | `INVESTIGATE` | Generated, uncurated duplicate; may contain example-data indicators. Remove only in the generated-artifact phase. |
| `tmp/release-v0.4.82-notes.md` | `INVESTIGATE` | Dated local release draft; confirm no external operational dependency before cleanup. |

The ignored `.worktrees/p0-confirmation-integrity-phase1/**` and `.worktrees/p0-payment-first-phase2/**` Markdown copies belong to separate worktrees. They must not be changed from `main`. The second worktree is dirty and contains untracked Phase 2 notes.

## 4. Canonical documentation merge map

| Retired source | Durable destination |
| --- | --- |
| `todo.md` | Unresolved items in Sections 6–10 of this plan; exact history remains in Git. |
| `docs/README.md`, `docs/FILE_MAP.md` | `docs/INDEX.md`, with file ownership details in `docs/ARCHITECTURE.md`. |
| `docs/ADMIN_DASHBOARD.md`, `docs/STAFF_PORTAL.md`, `docs/CUSTOMER_DASHBOARD.md`, `docs/UI_RULES.md` | `docs/UI_UX.md`; routing/runtime boundaries in `docs/ARCHITECTURE.md`. |
| `docs/BOOKING_FLOW.md`, `docs/PAYMENTS.md` | `docs/DOMAIN_LIFECYCLES.md`; provider contracts in `docs/INTEGRATIONS.md`. |
| `docs/DATABASE.md`, `docs/developer/database-schema.md` | `docs/ARCHITECTURE.md`. |
| `docs/TROUBLESHOOTING.md`, `docs/troubleshooting/troubleshooting-and-faq.md` | `docs/OPERATIONS.md`. |
| `docs/TASK_LOG.md`, acceptance snapshots, release checklist | `CHANGELOG.md` and `docs/PROJECT_TIMELINE.md`; exact details remain in Git. |
| Clock accounting design documents | `docs/decisions/ADR-0003-clock-deposit-and-manual-accounting-boundaries.md`, `docs/INTEGRATIONS.md`, and this plan’s risk register. |
| Clock research documents | Sanitized durable behavior in `docs/INTEGRATIONS.md`; dates/confidence in `PROJECT_TIMELINE.md`; raw history in Git. |
| Long admin/staff/guest manuals | Stable interface contract in `docs/UI_UX.md` and operational setup/recovery in `docs/OPERATIONS.md`. |
| Developer architecture/config/hooks/managed-page docs | `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`, and `docs/OPERATIONS.md`. |
| `tests/E2E/README.md` | Test effect/safety matrix in `docs/OPERATIONS.md`. |

## 5. Non-document repository inventory

| Path or exact group | Role | Recommendation | Rationale / precondition |
| --- | --- | --- | --- |
| `must-hotel-booking.php`, `includes/autoloader.php`, `includes/config.php` | Bootstrap/loading | `KEEP` | Active runtime contract. |
| `src/Core/**`, `src/Database/**`, `src/Engine/**`, `src/Provider/**` | Core, persistence, business and provider logic | `KEEP` | Behavioral source; only targeted later phases may change it. |
| `src/Admin/**`, `src/Frontend/**`, `src/Portal/**`, `src/Elementor/**` | UI/application surfaces | `KEEP` | Active WordPress hooks and routes. |
| `frontend/templates/**`, `assets/**` | Templates and assets | `KEEP` | Active public/admin/portal/Elementor presentation. |
| `lib/plugin-update-checker/**` | Bundled updater dependency | `KEEP` | Vendor code; do not modify casually. |
| `src/Database/install-tables.php` | Current schema installer/repair | `KEEP` | Historical installation compatibility is mandatory. |
| Root and namespaced `index.php` files | Directory access guards | `KEEP` | Do not classify as dead solely because they contain no runtime logic. |
| `src/legacy-functions.php` and config aliases | Compatibility API | `KEEP` | Active legacy namespace calls and possible external consumers. |
| `tests/*.php` | Standalone static/mocked tests | `KEEP` | Useful coverage; strengthen rather than delete wholesale. |
| `tests/E2E/production-lifecycle-*.php` | Guarded local/provider lifecycle harness | `KEEP` | Read-only by flag, but loads WordPress; external writes require explicit approval and non-production gates. |
| `tests/E2E/evidence/MHB-E2E-20260614-FULL.json` | Dated E2E evidence | `ARCHIVE OUTSIDE REPOSITORY` | Review/redact before removal; do not expose provider/customer data. |
| `tools/lifecycle-sync-smoke-test.php` | Pure local smoke test | `KEEP` | No provider writes; useful lifecycle regression. |
| `tools/provider-preflight-report.php` | External read-only provider probes | `KEEP` | Not offline: performs Clock/Stripe/PokPay GET/auth requests. Explicit approval required. |
| `tools/clock-accounting-environment-report.php`, `tools/clock-accounting-readiness.php` | Environment/accounting diagnostics | `INVESTIGATE` | Confirm read/write behavior before operational use. |
| `tools/clock-e2e-backup.php` | Local sensitive backup | `KEEP` | Writes ignored backups containing sensitive data; access controls and cleanup required. |
| `tools/clock-e2e-settings.php`, `tools/clock-e2e-cleanup.php` | Settings/status mutation helpers | `KEEP` | Explicitly mutating; require scoped approval and backup. |
| `tools/release-plugin.ps1`, `.github/workflows/release-package.yml` | Release automation | `KEEP` | Mutates versions/releases or packages; run only in release workflow. |
| `must-hotel-booking-0.4.79-local-20260614-004106.zip`, `must-hotel-booking-0.4.79-local-20260614-140031.zip`, `must-hotel-booking-0.4.80.zip`, `must-hotel-booking-0.4.82.zip` | Ignored generated release artifacts | `ARCHIVE OUTSIDE REPOSITORY` | Verify no operational dependency, then remove locally. |
| `.playwright-cli/**`, `tmp/*.log`, `tmp/release-download-v0.4.82/**` | Generated browser/test/download artifacts | `DELETE` | Delete only after exact inventory and evidence retention review. |
| `tmp/vendor-docs/clock/**` | Ignored provider research cache | `ARCHIVE OUTSIDE REPOSITORY` | Dated external material; refresh from authoritative source when needed. |
| `tools/backups/**` | Ignored local backups | `ARCHIVE OUTSIDE REPOSITORY` | Sensitive; move to access-controlled retention, never commit. |
| `.worktrees/**` | Active/dirty Git worktrees | `INVESTIGATE` | Manage through Git worktree/branch workflow, not filesystem deletion. |
| `.vscode/**` | Editor settings | `KEEP` | Small project configuration. |

## 6. Suspected dead or duplicated code

| Exact path(s) | Role / references found | Reason for suspicion | Removal risk and required verification | Recommendation |
| --- | --- | --- | --- | --- |
| `src/Provider/Clock/ClockUnavailableAvailabilityProvider.php`, `ClockUnavailableQuoteProvider.php`, `ClockUnavailableReservationProvider.php` | Definitions only in repository search; current `ClockBookingProvider` constructs real providers | Likely obsolete fallback scaffold | External FQCN callers and old install compatibility unknown; run public API/reference and provider-mode tests | `INVESTIGATE` |
| `src/Provider/Clock/ClockBookingNotEnabledException.php`, `ClockDirectApiUnsupportedException.php` | Definitions only in current repository | No current throw/catch references | External consumers may catch these public FQCNs | `INVESTIGATE` |
| `src/Provider/Clock/ClockFolioPaymentSyncService.php`, `ClockFolioRefundSyncService.php` | Definitions/docs; runtime centers on `ClockPaymentAccountingService` | May be superseded adapters | Verify hooks, dynamic construction, provider jobs, old serialized callbacks, and Git history | `INVESTIGATE` |
| `frontend/templates/portal/accommodations.php`, `frontend/templates/portal/availability-rules.php` | No current include found; old routes redirect to rooms/availability | Likely superseded portal partials | Render every module, inspect theme overrides and old links | `INVESTIGATE` (likely `DELETE`) |
| `src/Provider/Clock/ClockReservationAutoSyncScheduler.php` with `ClockSyncScheduler.php` | Legacy hook cleanup plus active `runScheduledSync()` call | Overlapping scheduler responsibilities | Cron migration/history is high risk; inventory scheduled hooks on upgraded installs | `MERGE` only after runtime audit |
| `src/Provider/ProviderRegistry.php`, `ProviderManager.php`, Local adapters, and `ReservationEngine.php` | Registry/selection plus thin delegating adapters | Some wrapper duplication | Public interfaces and provider substitution depend on these layers | `KEEP`; architectural review only |
| Uppercase Elementor class files plus lower-case registration files | Widget class vs hooks/assets | Naming appears duplicated | Current split is intentional and active | `KEEP` |
| `includes/config.php` eager includes plus PSR-like autoloader | Function files and class loading overlap | Loading order is harder to reason about | Many function files depend on eager inclusion; regression/package tests required | `INVESTIGATE` |

## 7. Architecture and documentation contradictions

| Conflicting sources | Current implementation evidence | Intended/historical evidence | Risk | Future resolution |
| --- | --- | --- | --- | --- |
| Root README says use a shortcode or block | No `add_shortcode()` or `register_block_type()` registration found; managed pages drive frontend | Old README copy | Developers configure a nonexistent entry point | Keep README aligned with managed pages/Elementor only. |
| Core docs called `0.4.80` current | Header/constant/readme now state release-candidate `0.4.92` | June 11 knowledge-base snapshot | Wrong architecture/lifecycle assumptions | Canonical docs state the working-tree evidence baseline and require code verification. |
| Booking/payment docs say Clock booking is created during confirmation | v0.4.89 defers Clock creation for online `pending_payment` rows until verified payment | Pre-v0.4.89 behavior | Critical misunderstanding of recovery/order | `DOMAIN_LIFECYCLES.md` and ADR-0001 own current ordering. |
| Old manuals default Pay at Hotel on | Current defaults: PokPay enabled, Pay at Hotel disabled unless explicitly opted in | v0.3.45 settings | Unpaid confirmations may be enabled accidentally | `PROJECT_CONTEXT`, lifecycle and operations docs own current policy. |
| Earlier branches described immutable confirmation authorization and verification tables | The current working tree includes those controls and related additive schema | `8be9f0e`, `b5b8fbf`, later integration work | Historical branch state can be mistaken for current absence | Canonical architecture/lifecycle docs own current behavior. |
| `readme.txt` previously ended at `0.4.88` | Header/constant/stable tag now agree on `0.4.92` and the release entry is present | Text changelog lagged release work | Distribution history was incomplete | Keep metadata synchronized for every release. |
| Release/version history looks continuous in old docs | Tag gaps include `v0.4.72`, `v0.4.73`, `v0.4.80`, `v0.4.84`; tag `0.4.18` lacks `v` | `readme.txt` has additional version headings | Fabricated version groupings/dates | Canonical changelog includes only evidence-supported releases. |
| E2E harness described as read-only | Default avoids explicit provider writes, but it loads WordPress; plugin boot may sync pages/roles/options/cron | Harness README | Local DB may change even without provider writes | Operations doc distinguishes offline static tests, WordPress-loaded checks, external reads, and external writes. |
| Plugin header/readme declare PHP 7.4+ | Active payment, email, portal, and quote paths now use PHP 7.4-compatible helpers | Distribution metadata and lint | Exact deployment runtime can still differ | Keep PHP 7.4 syntax/behavior checks in release verification. |
| Diagnostics presents table health | Installer defines 34 tables while the diagnostic sample checks 24 | Settings diagnostics vs installer | Missing schema can be overlooked | Expand/label diagnostics in a scoped operations/schema task. |
| Legacy manuals describe a factory reset | Current source exposes only the guarded Demo / Test Hotel Data reset | `v0.3.45` manuals | Operators may expect a nonexistent or differently scoped destructive action | Current operations doc owns the exact reset boundary. |
| Provider preflight is described as read-only | Tool performs external Clock/Stripe/PokPay reads/authentication | Tool label and implementation | An apparently safe diagnostic contacts providers | Require explicit network/provider approval and rename/relabel only in a scoped tools phase. |

## 8. Production-integrity risk register

| ID | Severity | Finding and current evidence | Consequence | Required future action |
| --- | --- | --- | --- | --- |
| R-01 | Resolved | Public confirmation/cancellation access uses opaque, hashed, expiring reservation-set grants exchanged for scoped cookie-backed contexts; numeric query IDs are not authorization. | Anonymous IDOR paths are blocked by ownership proof. | Keep anonymous access and expiry/revocation tests current. |
| R-02 | Resolved | PokPay success/finalize paths require the authorized reservation set and stored order binding; cancel/failure browser returns are informational and do not mutate booking state. | Forged return parameters cannot release inventory or fail a payment row. | Keep forged-return regression tests current. |
| R-03 | Resolved | Authoritative paid-provider evidence and exact allocations persist before Clock fulfillment; failures retain durable recovery/manual-review evidence without success hooks. | Captured payments remain traceable and recoverable without false confirmation. | Keep payment-first failure and replay tests current. |
| R-04 | Resolved | Clock fulfillment uses an owner-token lease and a durable local idempotency claim; the undocumented provider header was removed and ambiguous outcomes require reread/manual review. | Duplicate Clock reservations are reduced without assuming unsupported provider idempotency. | Keep provider contract and timeout/replay tests current. |
| R-05 | Resolved | First confirmed-equivalent transitions route through centralized flow-specific authorization and return explicit outcomes; hooks run only after committed transitions. | Callers cannot silently bypass payment/provider confirmation authority. | Keep repository-guard and lifecycle-result tests current. |
| R-06 | Resolved for pending-payment failure | Pending payment failure/expiry now writes reservation and failed-ledger state in one local transaction and dispatches hooks only after commit. | Partial failure is rolled back for this lifecycle. | Extend the same boundary to any future manual multi-row command. |
| R-07 | High | Multi-room Clock creation loops without transaction/compensation across all mirror/provider writes. | Partial booking group after later room fails | Checkout-group identity, compensation/reconciliation, and multi-room failure tests. |
| R-08 | Resolved | Refund rows use a deterministic idempotency key, a serialized database claim, and provider idempotency for Stripe/PokPay. | Concurrent duplicate refund calls are blocked before provider write. | Keep retry and provider contract tests current. |
| R-09 | Resolved | Accounting recovery now requires an exact Clock credit-item match by reference, amount, currency, and real provider item ID; balance-only inference and synthetic IDs were removed. | Duplicate or falsely verified Clock credit items are prevented from being auto-accepted. | Keep exact-correlation and ambiguous-outcome tests current. |
| R-10 | High | Schema history is reconstructed through `dbDelta()` plus current-version repair; no numbered migration chain or foreign keys. | Upgrade drift and partial schema repairs | Upgrade matrix across historical releases/MySQL/MariaDB; introduce additive migration ledger only with compatibility plan. |
| R-11 | Medium | Final Clock fulfillment revalidates after payment; availability/price/policy can change after money capture. | Paid but unfulfilled booking | Document/implement a customer-safe compensation and staff escalation policy; never auto-refund without verified rules. |
| R-12 | Medium | Static source-marker tests pass without proving concurrency, atomicity, provider binding, or recovery. | False confidence | Replace critical static assertions with database/integration tests while retaining cheap structural checks. |
| R-13 | Medium | Provider logs contain response summaries; recursive sanitizer exists but every new field/path must use it. | Secret/PII leakage | Redaction regression tests and bounded retention review. |
| R-14 | Medium | WP-Cron jobs depend on traffic unless server cron is configured; stale locks/jobs have recovery logic but live health is unknown. | Stale inventory locks or provider mirrors | Production cron monitoring, bounded queues, and read-only health verification. |
| R-15 | Medium | Clock accommodation-charge cleanup, cancellation-fee posting, checked-in moves, and ambiguous financial adjustments remain manual. | Operational drift if staff assumes automation | Preserve manual-review states and explicit runbooks until contracts/ownership are durable. |
| R-16 | Resolved | `ReservationEngine::createReservations()` resolves `$selectedRatePlanMap` before final pricing and local assembly. | Selected rate-plan attribution is retained. | Keep the quote/reservation regression test. |
| R-17 | Resolved | `BookingQuoteDraft::cancellationPolicyMatches()` compares the room-specific signed policy with fresh final pricing before Clock writes. | Policy changes require guest review before payment/provider creation. | Keep field-complete policy tests. |
| R-18 | Resolved | Guest access uses random hashed grants with purpose, reservation-set scope, expiry, atomic execution consumption, and revocable cookie contexts. | Long-lived deterministic bearer access is removed. | Keep token scope, expiry, consumption, and revocation tests current. |
| R-19 | Medium | `PokPayPayment::validatePayment()` may authenticate externally when an unverified gateway is rendered in a public flow. | Passive public traffic can trigger credential probes, provider load, and diagnostic state changes. | Move probes to explicit privileged operations; public rendering should consume cached state only. |
| R-20 | Resolved | Payment, email, portal, and quote paths use PHP 7.4-compatible helpers; metadata remains PHP 7.4. | Declared runtime and active code are aligned for these paths. | Keep full source lint in release checks. |
| R-21 | Medium | Table diagnostics cover 24 of 34 installer tables; provider/activity retention and durable email retry ownership are not defined. | Incomplete health signal, unbounded evidence/storage, and lost notifications after transient failure. | Expand schema diagnostics, define retention, and design an idempotent notification retry boundary. |

## 9. Target repository structure

The target keeps the current runtime layout and removes documentation/task artifacts without proposing a rewrite.

```text
must-hotel-booking/
├── .github/workflows/
├── admin/                       # directory guard compatibility
├── assets/
├── database/                    # directory guard compatibility
├── elementor/                   # directory guard compatibility
├── engine/                      # directory guard compatibility
├── frontend/
│   └── templates/
├── includes/
├── lib/
├── src/
│   ├── Admin/
│   ├── Core/
│   ├── Database/
│   ├── Elementor/
│   ├── Engine/
│   ├── Frontend/
│   ├── Portal/
│   └── Provider/
├── templates/                   # directory guard compatibility
├── tests/
│   └── E2E/
├── tools/
├── AGENTS.md
├── CHANGELOG.md
├── README.md
├── readme.txt
├── must-hotel-booking.php
└── docs/
    ├── INDEX.md
    ├── PROJECT_CONTEXT.md
    ├── ARCHITECTURE.md
    ├── DOMAIN_LIFECYCLES.md
    ├── INTEGRATIONS.md
    ├── OPERATIONS.md
    ├── UI_UX.md
    ├── PROJECT_TIMELINE.md
    ├── DECISIONS.md
    └── decisions/
        ├── ADR-0001-payment-first-clock-fulfillment.md
        ├── ADR-0002-final-live-quote-revalidation.md
        ├── ADR-0003-clock-deposit-and-manual-accounting-boundaries.md
        └── ADR-0004-provider-source-of-truth-and-lifecycle-routing.md
```

`docs/REPOSITORY_CONSOLIDATION_PLAN.md` exists only until all approved phases finish.

## 10. Ordered execution phases

### Phase 1: Documentation consolidation

- **Objective:** Establish the approved canonical documentation and retire the 38 tracked Markdown sources classified `MERGE`.
- **Exact files involved:** `README.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/INDEX.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN_LIFECYCLES.md`, `docs/INTEGRATIONS.md`, `docs/OPERATIONS.md`, `docs/UI_UX.md`, `docs/PROJECT_TIMELINE.md`, `docs/DECISIONS.md`, `docs/decisions/*.md`, this plan, and every tracked source listed as `MERGE` in Section 3.
- **Must not touch:** every non-Markdown file; ignored `tmp/**`; ignored `.worktrees/**`.
- **Preconditions:** clean active worktree or preserved unrelated changes; evidence map complete.
- **Actions:** rewrite canonical files; validate claims; map and remove retired Markdown; repair references.
- **Verification:** `git diff --name-only`; Markdown link checker; canonical presence check; secret-pattern scan; `git diff --check`.
- **Expected result:** only the approved canonical set plus this plan remains tracked.
- **Rollback:** revert the single Phase 1 commit; do not use a destructive reset.
- **Stop conditions:** any non-Markdown diff, unmapped unique operational content, or overlapping user change.
- **Commit boundary:** one documentation-only commit.
- **Risk:** Low.

### Phase 2: Generated and temporary artifact cleanup

- **Objective:** Remove or externally archive ignored generated artifacts after evidence/retention review.
- **Exact paths:** the four root ZIPs named in Section 5; `.playwright-cli/**`; `tmp/*.log`; `tmp/clock-postman-analysis.json`; `tmp/clock-postman-index-generated.md`; `tmp/release-v0.4.82-notes.md`; `tmp/release-download-v0.4.82/**`; other exact files enumerated by `Get-ChildItem tmp -Recurse -File` before approval.
- **Must not touch:** tracked runtime/test/tool files; `tools/backups/**`; `.worktrees/**`.
- **Preconditions:** retention owner approves deletion/archive destinations; secret/PII review complete.
- **Actions:** generate exact manifest; archive required evidence outside repository; delete approved generated files only.
- **Verification:** compare pre/post manifests; `git status --short --ignored`; plugin package source remains unchanged.
- **Expected result:** no obsolete generated release/test/browser artifacts in the plugin root.
- **Rollback:** restore from approved archive; ignored files cannot be restored from Git.
- **Stop conditions:** any file contains unique incident evidence, secrets, customer data, or active process locks.
- **Commit boundary:** normally no commit for ignored files; commit only `.gitignore` changes separately if explicitly approved.
- **Risk:** Medium.

### Phase 3: Obsolete diagnostic or investigation-file cleanup

- **Objective:** Rationalize operational scripts and dated E2E evidence without deleting useful recovery tools.
- **Exact files:** `tests/E2E/evidence/MHB-E2E-20260614-FULL.json`; `tools/clock-accounting-environment-report.php`; `tools/clock-accounting-readiness.php`; `tools/clock-e2e-backup.php`; `tools/clock-e2e-cleanup.php`; `tools/clock-e2e-settings.php`; `tools/provider-preflight-report.php`; `tools/lifecycle-sync-smoke-test.php`.
- **Must not touch:** runtime `src/**`; current tests outside the explicit list; backups until retention decision.
- **Preconditions:** inspect references, side effects, secrets, E2E/runbook use, and Git history per file.
- **Actions:** classify each tool as keep, merge, archive, or delete; add safe `--help`/dry-run behavior only in a separate approved implementation task.
- **Verification:** PHP lint; targeted dry-run/static checks; documentation/runbook references; no external request.
- **Expected result:** a minimal, clearly classified operations toolset.
- **Rollback:** revert the phase commit; restore archived evidence from controlled storage.
- **Stop conditions:** provider/customer data is discovered, or a recovery procedure depends on the candidate.
- **Commit boundary:** one non-behavioral tools/evidence commit after review.
- **Risk:** Medium.

### Phase 4: Test and fixture consolidation

- **Objective:** Organize standalone tests and separate static, mocked, local-DB, external-read, and external-write suites.
- **Exact files:** `tests/*.php`; `tests/E2E/production-lifecycle-harness.php`; `tests/E2E/production-lifecycle-runner.php`; `tests/E2E/evidence/MHB-E2E-20260614-FULL.json`; `.github/workflows/release-package.yml` only if CI test execution is added.
- **Must not touch:** production PHP except when a separately failing test proves a scoped defect; providers and production systems.
- **Preconditions:** baseline every current standalone test; document which tests write `tmp/` or load WordPress.
- **Actions:** remove duplicated source-marker assertions only after behavioral coverage exists; add deterministic runner and CI lint/test stage.
- **Verification:** run all offline tests and PHP lint; CI-equivalent local command; confirm no network/provider calls.
- **Expected result:** one documented offline command and separate gated E2E commands.
- **Rollback:** revert test-only commit; CI changes in a separate commit if needed.
- **Stop conditions:** a test needs live credentials, production data, or destructive fixtures.
- **Commit boundary:** test consolidation commit, then CI commit.
- **Risk:** Medium.

### Phase 5: Dead-code removal

- **Objective:** Remove only candidates proven unused and compatibility-safe.
- **Exact candidates:** the three `ClockUnavailable*Provider.php` files; `ClockBookingNotEnabledException.php`; `ClockDirectApiUnsupportedException.php`; `ClockFolioPaymentSyncService.php`; `ClockFolioRefundSyncService.php`; `frontend/templates/portal/accommodations.php`; `frontend/templates/portal/availability-rules.php`.
- **Must not touch:** migrations/schema; public interfaces; legacy functions; index guards; active provider/accounting services.
- **Preconditions:** runtime loading, autoloading, hook, theme/plugin, test, package, migration, operational and Git history checks completed.
- **Actions:** remove one coherent candidate group at a time; update tests/docs in the same commit.
- **Verification:** full offline suite, PHP lint, managed-page/portal render smoke, release package content check.
- **Expected result:** only proven-unused files removed with no public contract break.
- **Rollback:** revert each candidate-group commit.
- **Stop conditions:** any dynamic/external reference or uncertain compatibility significance; classify `INVESTIGATE` instead.
- **Commit boundary:** one commit per independently reversible candidate group.
- **Risk:** High.

### Phase 6: Duplicate-service consolidation

- **Objective:** Reduce overlapping orchestration without altering behavior.
- **Exact review set:** `ClockSyncScheduler.php`; `ClockReservationAutoSyncScheduler.php`; `ProviderManager.php`; `ProviderRegistry.php`; Local provider adapters; `ReservationEngine.php`; `ClockPaymentAccountingService.php`; Clock folio sync adapters; Elementor class/registration pairs; `includes/config.php`; `includes/autoloader.php`; `src/legacy-functions.php`.
- **Must not touch:** database schema, public FQCNs, hooks, route names, option keys, or templates without a compatibility layer.
- **Preconditions:** Phase 4 behavioral coverage; call graph and public-contract inventory.
- **Actions:** write an explicit compatibility plan; consolidate only where two services own the same transition; retain shims for public contracts.
- **Verification:** full offline suite, cron schedule migration test, Elementor registration smoke, booking/payment lifecycle tests.
- **Expected result:** one owner per responsibility with compatibility preserved.
- **Rollback:** revert each service-boundary commit; retain old shim until post-release evidence.
- **Stop conditions:** unclear ownership or inability to simulate upgraded installs.
- **Commit boundary:** one boundary per commit.
- **Risk:** High.

### Phase 7: Architecture-boundary cleanup

- **Objective:** Untangle request handling/rendering/orchestration after integrity fixes are protected.
- **Exact review set:** `src/Portal/PortalController.php`; `src/Admin/dashboard.php`; large `src/Admin/*.php` pages; `src/Frontend/confirmation-page.php`; `src/Engine/ReservationEngine.php`; `src/Engine/PaymentEngine.php`; `src/Core/Plugin.php`; `src/Engine/01-repositories.php`.
- **Must not touch:** public routes/hooks/options/schema names; provider contracts; UI behavior unless explicitly tested.
- **Preconditions:** Phases 4–6 complete; route/hook snapshots and render tests exist.
- **Actions:** extract request commands and view-data builders behind existing callbacks; preserve public signatures and URLs.
- **Verification:** hook/route snapshot, capability/nonce tests, frontend/admin/portal render smoke, full offline suite.
- **Expected result:** smaller units with the same external behavior.
- **Rollback:** revert per extracted boundary.
- **Stop conditions:** extraction needs a behavioral policy decision; defer to a separate ADR/task.
- **Commit boundary:** one controller/service extraction per commit.
- **Risk:** High.

### Phase 8: Booking and payment integrity fixes

- **Objective:** Close current-main confirmation, paid-outcome, atomicity, access-control and refund-concurrency risks.
- **Exact current files:** `src/Frontend/confirmation-page.php`; `src/Database/ReservationRepository.php`; `src/Database/PaymentRepository.php`; `src/Database/RefundRepository.php`; `src/Database/install-tables.php`; `src/Engine/BookingStatusEngine.php`; `src/Engine/PaymentEngine.php`; `src/Engine/PaymentRefundService.php`; `src/Engine/ReservationEngine.php`; `src/Engine/BookingQuoteDraft.php`; `src/Admin/ReservationAdminActions.php`; `src/Admin/PaymentAdminActions.php`; `src/Portal/PortalController.php`; `src/Core/StaffAccess.php`; relevant tests under `tests/`.
- **Historical evidence only:** commits `8be9f0e`, `b5b8fbf` and their branch docs/classes. Do not cherry-pick blindly.
- **Must not touch:** Clock accounting behavior except the explicit fulfillment interface; unrelated UI; production data.
- **Preconditions:** database snapshot, migration plan, anonymous access regression test, concurrency-capable local DB tests, accepted ADR/spec.
- **Actions:** signed/session-bound confirmation access; expiring cancellation authorization; immutable provider-attempt/allocation binding; durable provider-paid outcome; central explicit confirmation authorization; atomic offline/manual transitions; unique refund claims; selected rate-plan propagation; complete final policy comparison; dedicated capability; truthful action results.
- **Verification:** anonymous IDOR and forged-return tests; duplicate/late callback tests; wrong reservation/amount/currency/account/mode tests; transaction rollback tests; concurrent refund tests; upgrade/idempotency matrix.
- **Expected result:** no first confirmation without authoritative online verification or explicit authorized offline command; paid outcomes are never lost.
- **Rollback:** additive schema only; revert code while leaving backward-compatible unused columns/tables; documented feature gate if required.
- **Stop conditions:** migration cannot preserve existing rows, provider identity cannot be established, or failure recovery is ambiguous.
- **Commit boundary:** separate commits for access control, schema/migration, confirmation policy, paid-outcome recovery, refund concurrency, and capabilities.
- **Risk:** Critical.

### Phase 9: Clock PMS integration fixes

- **Objective:** Make paid Clock fulfillment, reservation creation, and folio accounting retry-safe and recoverable.
- **Exact files:** `ClockReservationProvider.php`; `ClockMirrorReservationService.php`; `ClockApiClient.php`; `ClockPaymentAccountingService.php`; `ClockFolioService.php`; `ClockPaymentReconciliationService.php`; `ClockFolioPaymentSyncService.php`; `ClockFolioRefundSyncService.php`; `ProviderSyncJobRepository.php`; `ProviderSyncJobRunner.php`; `ReservationRepository.php`; `ClockFolioAccountingRepository.php`; relevant Clock/payment tests.
- **Must not touch:** provider endpoints/payloads without current authoritative contract evidence; unrelated local booking behavior; live provider.
- **Preconditions:** Phase 8 durable paid outcome; current Clock contract/rights verified in non-production; backup and correlation plan.
- **Actions:** exclusive fulfillment leases; reread-before-retry; internal recovery jobs; provider idempotency where supported; exact credit-item identity; multi-room compensation; manual review for ambiguous outcomes.
- **Verification:** mocked failure injection, concurrent duplicate callback, timeout-after-write, late callback, multi-room partial failure, folio balance collision, refund replay, bounded worker retry tests; staged external E2E only with explicit approval.
- **Expected result:** retries cannot create duplicate Clock bookings or accounting entries; ambiguous states remain visible and recoverable.
- **Rollback:** code feature flag/queue pause; additive data retained; manual reconciliation runbook.
- **Stop conditions:** provider contract/rights unclear, provider cannot supply durable identity, or staging cannot isolate test records.
- **Commit boundary:** reservation fulfillment, queue recovery, accounting identity, and external acceptance are separate commits.
- **Risk:** Critical.

### Phase 10: Final verification and documentation synchronization

- **Objective:** Verify the final repository and remove this temporary plan.
- **Exact files:** all tracked files via `git ls-files`; canonical Markdown; `readme.txt`; `must-hotel-booking.php`; `.github/workflows/release-package.yml`; release script; retained tests/tools.
- **Must not touch:** production data/provider systems without separate approval.
- **Preconditions:** all approved earlier phases completed and unresolved items moved to an issue system.
- **Actions:** full offline verification, upgrade matrix, package validation, canonical doc refresh, changelog/readme alignment, final structure check, delete this plan.
- **Verification:** PHP lint; offline suite; Markdown links; secrets scan; package manifest; version alignment; `git diff --check`; clean status after commit.
- **Expected result:** small canonical docs, tested runtime, no obsolete tracked artifacts, no temporary plan.
- **Rollback:** revert final synchronization commit; restore this plan only if phases remain unfinished.
- **Stop conditions:** any unresolved critical risk lacks tracked ownership, or docs/runtime disagree.
- **Commit boundary:** final verification/docs commit; plan deletion in the same commit after conditions are met.
- **Risk:** Medium.

## 11. Model execution instructions

```text
Execute only Phase X from docs/REPOSITORY_CONSOLIDATION_PLAN.md.

Read:
- AGENTS.md
- docs/INDEX.md
- docs/PROJECT_CONTEXT.md
- Documents explicitly required by Phase X
- Only the Phase X section of the consolidation plan

Do not execute later phases.
Do not perform unrelated refactoring.
Stop if repository evidence contradicts the plan.
Preserve unrelated user changes.
Run the verification defined for Phase X.
Report exact files changed, verification results, unresolved issues, and PASS / PASS WITH RISKS / BLOCKED.
```

## 12. Final removal condition

Delete `docs/REPOSITORY_CONSOLIDATION_PLAN.md` only after:

1. All approved phases have been completed.
2. Durable information has been transferred to canonical documentation.
3. Remaining unresolved work exists in an appropriate issue or tracked work system.
4. The final repository structure has been verified.
