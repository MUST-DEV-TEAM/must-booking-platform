# Roadmap and delivery process

Status reconciled against repository evidence on **2026-09-19**. This page owns the current pointer, milestone index and backlog. Historical review results remain in the individual files; this audit does not mark implementation tasks Done.

## Current work

**Updated 2026-10-25.** The next release is the redesigned dashboard with the platform admin console, and it is gated by two milestones that must finish before the redesign branch is merged into `main`: **[27 - Clock rates, cancellation and permissions](milestones/27-clock-rates-cancellation-permissions.md)** (rate choice, refund rule, Clock rights) and **[28 - Release and cutover](milestones/28-release-and-cutover.md)** (decisions, merge, rehearsal, deploy, rollback). [24 - Dashboard redesign](milestones/24-dashboard-redesign.md) is built and verified on its branch (not live); its screens are done, its cutover is tracked in 28. [21](milestones/21-clock-certification-fixes.md)'s open rows moved to 27, and [22](milestones/22-email-notifications.md) ships with 24. [13](milestones/13-app-ui-ux-and-features.md) keeps only Tasks 6-7 (payments) and 33-36 (WordPress booking flow). After cutover: [25 - Native PMS](milestones/25-native-pms.md), [26 - Public API](milestones/26-public-api.md), [15 - Platform billing](milestones/15-platform-billing.md).

**Previous pointer (2026-10-16, historical):** 24 was the main active milestone in design intake; it superseded the dashboard/UI tasks of [Milestone 13](milestones/13-app-ui-ux-and-features.md); 13 stays open only for Tasks 6-7 (payments) and 33-36 (WordPress booking flow). Planned next: [25 - Native PMS](milestones/25-native-pms.md).

**Separate authorized track: [21 - Clock Certification Fixes](milestones/21-clock-certification-fixes.md)**, explicitly documented there as ad hoc parallel work. It contains reviewed work through September 18 and superseded folio-close instructions. Task 9 appears in two historical contexts; use "Task 9 special requests" or "Task 9 rate kickoff" when referencing it. No Milestones 16-19 exist in this platform's documentation; do not invent them. **2026-09-19: the owner authorized an existing-system reliability/security remediation pass ahead of new feature work** — reconciled into this milestone's Phase L (Clock-specific findings, Task 22 onward) and into Milestone 14 (security/operational findings not specific to Clock). Task 22 (durable Clock webhook processing) is implemented and corrected five times, four rounds on 2026-09-19 and one on 2026-09-23 (event ownership fenced by a real row lock inside the effect-applying transaction, claim-ordering protection keyed off BullMQ's real `attemptsStarted` generation with a combined token+generation guard, explicit per-caller allowed-status transitions, atomic `NEEDS_RECONCILIATION` parking, corrected non-"safe at any time" rollback guidance for the processing columns, and a job-recreation reset that is now a real compare-and-swap against a pre-recreation snapshot instead of a blind write that could erase a concurrently-acquired claim or clobber a racing recreator — see ADR-0031); verified with unit tests plus real Postgres/Redis/BullMQ integration tests exercising the actual processing paths under deterministic timing barriers, including genuine BullMQ stalled-job reassignment and forced job-recreation race interleavings through the real ingestion/sweep methods. **Status: In review**, not Done; not yet live-verified against a real Clock deployment.

The former Milestone 20 describes Soves tour/staff code absent here and references missing documents. It is [archived with unverified provenance](../archive/20-staff-dashboard-redesign-unverified-origin.md), not an active platform task. Its original review claims are retained without endorsement.

The **one-time documentation initialization** was explicitly authorized outside the task table on 2026-09-19. It does not create a product milestone or waive task scoping for unrelated future work.

## Milestone index

"Recorded completed" means a historical close-out claim with corresponding implementation areas present, not a fresh rerun of every acceptance test.

| Milestone | Current interpretation |
| --- | --- |
| [00 - Foundations](completed/00-repo-and-infra-foundations.md) | Recorded completed; workspace, API/web, CI, Prisma and containers present |
| [01 - Tenancy/auth](completed/01-tenancy-and-auth-core.md) | Recorded completed; schema/RLS/guards/auth/capabilities present |
| [02 - Signup/Free plan](completed/02-signup-and-free-trial-onboarding.md) | Recorded completed; signup and plan enforcement foundation present |
| [03 - Property/room/rate management](completed/03-property-room-rate-management.md) | Recorded completed; catalog/rates/media/inventory present |
| [04 - Local booking](completed/04-local-booking-domain.md) | Recorded completed; state machine, quotes, operations, guest matching present |
| [05 - Guest payments](completed/05-guest-payments.md) | Recorded completed; Stripe/PokPay/manual/refund/expiry paths present |
| [06 - WordPress retrofit](completed/06-public-booking-widget.md) | 51 recorded Done rows; old 19/20 header was stale; legacy installer residue remains |
| [07 - Auth pages](completed/07-auth-pages.md) | Recorded completed; auth routes and browser tests present |
| [08 - Platform admin](completed/08-platform-admin-dashboard.md) | Recorded completed; platform routes/services and shared shell present |
| [09 - Tenant dashboard](completed/09-tenant-admin-dashboard.md) | Recorded completed; tenant screens/capabilities present; later IA changes live in 13 |
| [10 - Individual rooms](completed/10-individual-room-booking.md) | Recorded completed; modes/room claims/blocks/pricing present |
| [11 - Clock basic adapter](completed/11-clock-pms-adapter-basic.md) | Recorded completed for its original scope; current adapter substantially extended since |
| [11.5 - Pre-release fixes](completed/11.5-pre-release-fixes.md) | Historical v1 close-out; deferred orders/hydration later received implementation |
| [12 - Initial release](completed/12-integration-and-initial-release.md) | Recorded closed; Tasks 1/2/6 deferred to 14; Task 16 reopened In review; Task 17 parked |
| [13 - App enhancements](milestones/13-app-ui-ux-and-features.md) | Superseded in part by 24 (2026-10-16); Tasks 6-7 and 33-36 remain open; code exists, acceptance never reconciled |
| [14 - Environment/security](milestones/14-security-and-architecture-audit.md) | Kickoff/task list exists; host move recorded but acceptance unverified. **2026-10-25: Tasks 1-3 (new host, TLS/pipeline, Empire re-onboarded) are effectively in place but not re-stamped; the go-live subset of the audits is chosen in [28](milestones/28-release-and-cutover.md) Task 8, the rest is explicitly after cutover** |
| [15 - Platform billing](milestones/15-platform-billing.md) | Planned; draft areas are not approved concrete task rows |
| [21 - Clock fixes](milestones/21-clock-certification-fixes.md) | Authorized parallel track; preserve per-task review and supersession. Open rows reconciled 2026-10-25: Task 22 in review, Tasks 23-24 not built, Task 26 waiting on Clock, Task 32 partly built on the redesign branch |
| [22 - Email notifications](milestones/22-email-notifications.md) | Delivery and log live since 2026-10-01. Recipient rules, templates, Email screens, transport abstraction and per-hotel SMTP/sender are built on the redesign branch only (not live); platform-wide SMTP (Task 17) moved to the platform admin plan, Phase 2 (2026-10-25). Reconciled 2026-10-25 |
| [23 - Room photo library](milestones/23-room-photo-library-and-import.md) | **Closed 2026-10-25.** Live: 327-photo library, 135 images, every Empire room type has a main image; R2 plan superseded by local-disk storage; follow-ups deferred |
| [24 - Dashboard redesign](milestones/24-dashboard-redesign.md) | Planning complete for the staff dashboard; first-release task list compiled 2026-10-16 (A: T01-T05, B: B01-B12, C: S01-S15, D: R01-R04); foundation committed on codex/design-dashboard-latest. **2026-10-25: screens built and merged with the platform admin console on that branch and verified in isolation (build, lint, 167 migrations, web 710/710, API 1,616 passed, browser 8/8); not live. Cutover tracked in [28](milestones/28-release-and-cutover.md).** |
| [27 - Clock rates, cancellation and permissions](milestones/27-clock-rates-cancellation-permissions.md) | **Planned 2026-10-25.** Gates the cutover. Refund fallback, rate choice, real rate plans, discount display, Clock rights check, retry on rate limits, one complete rights request to Clock; takes over the open rows of 21 |
| [29 - Hotel currency and display conversion](milestones/29-currency.md) | **Planned 2026-10-25.** Hotel money currency and approximate displays; owner-authorized Task 6 is **Done (release verified)**: [PR #394](https://github.com/MUST-DEV-TEAM/must-booking-platform/pull/394), commit `a1e75f958184eb2177006913522d6e919300c49f`, deployed **2026-10-28 20:59:12 UTC**, plugin **0.4.118** active on Empire via the release ZIP/WP-CLI fallback. Tables/image, public ALL rates/ETag/304 and WordPress AJAX verified; Empire rate entry remains with the client. Other rows keep their recorded status. **Gates the cutover (owner, 2026-10-25)** |
| [28 - Release and cutover](milestones/28-release-and-cutover.md) | **Planned 2026-10-25.** Gates the cutover. Owner decisions, merge with `main` (on hold), rehearsal on Empire's data, deploy and rollback; holds the small fixes found during verification |
| [25 - Native PMS](milestones/25-native-pms.md) | Planned 2026-10-16; MUST as source of truth for hotels without an external PMS; scope = front desk + stay money; no tasks yet |
| [26 - Public API](milestones/26-public-api.md) | Planned 2026-10-16; per-hotel API keys so a hotel's own website can use our rooms, availability and booking; paid-plan feature; next release after the dashboard |
| [31 - Delivery pipeline and website connector](milestones/31-pipeline-and-connector.md) | **Opened 2026-10-30.** Owner-approved plan: faster, safer pipeline (docs skip deploy, plugin release gated by tests, locked `main`, parallel tests, deploy window) and the WordPress plugin separated into a general connector; Phase 0 in progress. Empire's look unchanged |

## How work proceeds

Updated 2026-10-08: this roadmap is a backlog and history record, not a gate on what may be worked on. The owner sets priorities in the project conversation; Claude plans and implements with one PR per change and green CI. See the [working agreement](../maintenance.md).

1. Record evidence separately from workflow state: code present, unit tested, integration tested, sandbox observed and deployed are different claims.
2. Mark a task Done only when it is merged and verified; keep deferred and parked work visible.

Status vocabulary: **Planned / Not started**, **In progress**, **In review**, **Done**, **Blocked/Parked**, **Deferred**, **Cancelled**, **Superseded**, and **Needs reconciliation** when recorded status conflicts with evidence. No cancelled work was inferred during this audit.

## Remaining planning boundaries

- Reconcile Milestone 13 against its full acceptance criteria, especially manual accessibility/responsive checks. Existing StatePanel, badges, tabs and shell are not future blank-slate tasks.
- Reconcile Milestone 14 against the current host: secrets, pipeline, isolation/security checks and go-live evidence. See [operations](../operations/README.md).
- Milestone 15 needs real plan catalog/prices, trial/cancellation semantics and retention details; [billing](../architecture/platform-billing.md) distinguishes the Free foundation from absent paid subscriptions.
- Clock reliability/hardening follow-ups are enumerated in [its architecture](../integrations/clock/architecture.md#known-gaps-and-deviations), including actual code/contract discrepancies. Scope those explicitly before implementation; do not silently reopen historical Done rows.
- The full Figma product (coupons, full operational email tooling, approvals/system health, richer inventory/provider screens) exceeds the implemented UI. Use [design](../design/design-system.md), not placeholders, to define future work.
- Staff date changes are not exposed by the current booking PATCH contract; cancel/rebook is not a designed replacement for that future capability.
- Additional PMS vendors, direct OTA/Booking.com integration, a non-WordPress guest widget, second subscription provider, marketplace/usage billing and multi-region are unscheduled ideas. No speculative implementation.
- Clock metrics/normalization/security acceptance and the source brief's remaining deliverables are not all complete merely because individual documents now exist.

Older chronology and duplicated index prose are preserved in [archive](../archive/README.md). Their "up next" sentences are historical, not dispatch instructions.
