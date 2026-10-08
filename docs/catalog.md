# Documentation catalog

Maintained inventory and filename migration map. Start at [README](README.md) for task routing; do not read the entire catalog for routine implementation. Current documents describe checked-in code as of their evidence date. Historical completion is not a fresh acceptance/deployment certificate.

## Relocated and consolidated documents

Old names remain searchable here for source comments and external references. The old roadmap process and index are archived; their authoritative replacement is [roadmap/README.md](roadmap/README.md). No unique historical artifact was intentionally deleted.

| Previous path | Current location | Classification |
| --- | --- | --- |
| `docs/PROJECT_CONTEXT.md` | [product-overview.md](product-overview.md) | CURRENT implementation |
| `docs/ARCHITECTURE.md` | [architecture/overview.md](architecture/overview.md) | CURRENT implementation |
| `docs/TENANCY.md` | [architecture/data-and-access.md](architecture/data-and-access.md) | CURRENT implementation |
| `docs/BILLING.md` | [architecture/platform-billing.md](architecture/platform-billing.md) | CURRENT implementation |
| `docs/CLOCK_ARCHITECTURE.md` | [integrations/clock/architecture.md](integrations/clock/architecture.md) | CURRENT implementation |
| `docs/CLOCK_BOOKING_STATE_MACHINE.md` | [integrations/clock/booking-lifecycle.md](integrations/clock/booking-lifecycle.md) | CURRENT implementation |
| `docs/CLOCK_DATA_MAPPING.md` | [integrations/clock/data-mapping.md](integrations/clock/data-mapping.md) | CURRENT implementation |
| `docs/CLOCK_ENDPOINT_MATRIX.md` | [integrations/clock/endpoint-matrix.md](integrations/clock/endpoint-matrix.md) | CURRENT implementation |
| `docs/CLOCK_ERROR_CATALOGUE.md` | [integrations/clock/errors-and-retries.md](integrations/clock/errors-and-retries.md) | CURRENT implementation |
| `docs/CLOCK_WEBHOOK_FLOW.md` | [integrations/clock/webhooks-and-reconciliation.md](integrations/clock/webhooks-and-reconciliation.md) | CURRENT implementation |
| `docs/CLOCK_RUNBOOK.md` | [integrations/clock/runbook.md](integrations/clock/runbook.md) | CURRENT implementation |
| `docs/CLOCK_CERTIFICATION_GAPS_PLAN.md` | [archive/clock-certification-plan-2026-09-03.md](archive/clock-certification-plan-2026-09-03.md) | HISTORICAL / SUPERSEDED |
| `docs/CLOCK_FINANCIAL_RECONCILIATION_PLAN.md` | [archive/clock-financial-plan-2026-09-03.md](archive/clock-financial-plan-2026-09-03.md) | HISTORICAL / SUPERSEDED |
| `docs/CLOCK_INTEGRATION_SUMMARY.md` | [archive/clock-certification-summary-2026-09-04.md](archive/clock-certification-summary-2026-09-04.md) | HISTORICAL / SUPERSEDED |
| `docs/CLOCK_SANDBOX_VALIDATION_REPORT.md` | [archive/clock-sandbox-validation-2026-08-05.md](archive/clock-sandbox-validation-2026-08-05.md) | HISTORICAL / SUPERSEDED |
| `docs/CLOCK_TEST_EVIDENCE_LOG.md` | [archive/clock-test-evidence-2026-09-04.md](archive/clock-test-evidence-2026-09-04.md) | HISTORICAL / SUPERSEDED |
| `docs/roadmap/milestones/20-staff-dashboard-redesign.md` | [archive/20-staff-dashboard-redesign-unverified-origin.md](archive/20-staff-dashboard-redesign-unverified-origin.md) | UNKNOWN / NEEDS VERIFICATION; foreign scope |
| `docs/roadmap/README.md` | [archive/roadmap-process-before-initialization.md](archive/roadmap-process-before-initialization.md) | HISTORICAL / SUPERSEDED |
| `docs/ROADMAP.md` | [archive/roadmap-index-before-initialization.md](archive/roadmap-index-before-initialization.md) | HISTORICAL / SUPERSEDED |
| `docs/design/DESIGN_SYSTEM.md` | [design/design-system.md](design/design-system.md) | REFERENCE / historical comparison |

## Current owners and new coverage

| File | Purpose / classification |
| --- | --- |
| [README](README.md) | CURRENT canonical router and authority rules. |
| [INDEX](INDEX.md) | DUPLICATE navigation consolidated into README; compatibility pointer only. |
| [Booking and payments](architecture/booking-and-payments.md) | CURRENT inventory, quote, lifecycle, guest-money and concurrency behavior; known limitations explicit. |
| [Frontends and API](architecture/frontends-and-api.md) | CURRENT Next.js/WordPress transport, API ownership and legacy boundaries. |
| [Operations](operations/README.md) | CURRENT source-backed setup/test/job/deployment map; live host state UNKNOWN. |
| [Maintenance](maintenance.md) | CURRENT ownership and owner/Claude workflow. |
| [ADR index](decisions/README.md) | HISTORICAL accepted intent and supersession metadata; all 30 ADR files individually indexed there, bodies preserved. Acceptance is not implementation. |
| [Roadmap](roadmap/README.md) | CURRENT task authorization, implemented-but-unreviewed work, future scope and deferrals. |
| [Completed index](roadmap/completed/README.md) | HISTORICAL delivery evidence, individually classified below. |
| [Source index](source/README.md) and [Clock brief](source/clock-pms-integration.pdf) | REFERENCE requirements, not a complete vendor API contract or proof of implementation; original PDF unchanged. |
| [Archive index](archive/README.md) | HISTORICAL plans/reports and one UNKNOWN-origin plan, individually classified there. |
| This catalog | CURRENT inventory and migration map; update when owners move. |

## Milestone files

Descriptions below distinguish task records from current behavior. Follow the main roadmap for authorization; archived milestone numbering is retained for traceability.

| File | Purpose / classification |
| --- | --- |
| [Milestone 0: Repository & Infrastructure Foundations](roadmap/completed/00-repo-and-infra-foundations.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 1: Tenancy & Auth Core](roadmap/completed/01-tenancy-and-auth-core.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 2: Self-Serve Signup & Free Plan Onboarding](roadmap/completed/02-signup-and-free-trial-onboarding.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 3: Property, Room & Rate Management (Local)](roadmap/completed/03-property-room-rate-management.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 4: Local Booking Domain & State Machine](roadmap/completed/04-local-booking-domain.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 5: Guest Payments](roadmap/completed/05-guest-payments.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 6: WordPress Plugin Retrofit (Guest-Facing Frontend)](roadmap/completed/06-public-booking-widget.md) | HISTORICAL recorded close-out with 51 Done rows; stale 19/20 header corrected without new acceptance claims. |
| [Milestone 7: Auth Pages](roadmap/completed/07-auth-pages.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 8: Platform Admin Dashboard](roadmap/completed/08-platform-admin-dashboard.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 9: Tenant Admin Dashboard](roadmap/completed/09-tenant-admin-dashboard.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 10: Individual Room Booking](roadmap/completed/10-individual-room-booking.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 11: Clock PMS+ Adapter (Basic Integration)](roadmap/completed/11-clock-pms-adapter-basic.md) | HISTORICAL / recorded completed; later behavior may supersede original task prose. |
| [Milestone 11.5: Pre-Release Fixes (before Milestone 12)](roadmap/completed/11.5-pre-release-fixes.md) | HISTORICAL pre-release fixes; original deferrals must be checked against later Clock work. |
| [Milestone 12: Integration, Hardening & Initial Release Readiness](roadmap/completed/12-integration-and-initial-release.md) | HISTORICAL mixed close-out: Task 16 reopened/In review, Task 17 parked; Tasks 1/2/6 deferred to Milestone 14. |
| [Milestone 13: Application UI/UX & Feature Enhancements](roadmap/milestones/13-app-ui-ux-and-features.md) | PARTIALLY OUTDATED kickoff prose retained; implementation exists, 36 tasks need acceptance reconciliation. |
| [Milestone 14: Environment Rebuild & Security Audit](roadmap/milestones/14-security-and-architecture-audit.md) | PLANNED security/architecture audit; not authorized as current implementation. |
| [Milestone 15: Platform Billing](roadmap/milestones/15-platform-billing.md) | PLANNED paid platform billing; only foundation exists. |
| [Milestone 21: Clock PMS Certification Fixes](roadmap/milestones/21-clock-certification-fixes.md) | CURRENT parallel Clock task record; mixed reviewed/pending/superseded evidence. |

## Intent/code discrepancies

Ownership is local to the relevant current document: paid-billing stubs, provider-boundary coupling, WordPress legacy activation tables, webhook enqueue/hydration gaps, SNS request hardening, financial reference-filter inconsistency and rate-cache scope are documented beside their source paths. Do not copy these into a second backlog here. The roadmap links those owners for future scoped decisions.

Repository-root agent/Claude/readme instructions, contribution guidance, the WordPress README/agent instructions and container README route into this system. Local setup and infrastructure instructions remain operational sources linked by the operations owner; deployment history does not establish the live environment.

## Imported WordPress documentation

The 15 files formerly in `apps/wordpress-plugin/docs/` moved, with their names and relative structure preserved, to [archive/wordpress-plugin-pre-retrofit/](archive/wordpress-plugin-pre-retrofit/README.md). That index individually classifies every file. The former `INDEX.md` body is archived; a short compatibility index remains in the plugin. This historical namespace includes five ADRs distinct from the 30 platform ADRs.
