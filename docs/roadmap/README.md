# Roadmap and delivery process

Status reconciled against repository evidence on **2026-09-19**. This page owns the current pointer, milestone index and backlog. Historical review results remain in the individual files; this audit does not mark implementation tasks Done.

## Current work

**Main active milestone: [13 - Application UI/UX & Feature Enhancements](milestones/13-app-ui-ux-and-features.md).** It has **36 numbered tasks**, not four or 32. Much of its code exists while the old table still said Not started. Its current state is **implementation present; acceptance/status reconciliation pending**. Do not dispatch a rebuild of a feature solely from the old label.

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
| [13 - App enhancements](milestones/13-app-ui-ux-and-features.md) | Active, implementation evidence exists; task acceptance needs reconciliation |
| [14 - Environment/security](milestones/14-security-and-architecture-audit.md) | Kickoff/task list exists; host move recorded but acceptance unverified |
| [15 - Platform billing](milestones/15-platform-billing.md) | Planned; draft areas are not approved concrete task rows |
| [21 - Clock fixes](milestones/21-clock-certification-fixes.md) | Authorized parallel track; preserve per-task review and supersession |
| [22 - Email notifications](milestones/22-email-notifications.md) | Planned 2026-09-30; triggered by a live booking that sent no emails; owner decisions pending, nothing dispatched |

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
