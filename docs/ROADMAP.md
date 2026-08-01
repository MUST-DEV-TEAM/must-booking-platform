# Roadmap

The roadmap is 14 milestones, numbered 0-13, worked in order (per [ADR-0023](decisions/ADR-0023-platform-admin-dashboard-resequencing.md)). Reaching Milestone 13 done = an initial, usable, end-to-end version of the platform, not the fully hardened/feature-complete product. The process (kickoff, task lifecycle, who marks things done, archiving) is in [docs/roadmap/README.md](roadmap/README.md) — read that before starting or reviewing any milestone work.

## Milestones

| # | Milestone | Goal (one line) |
| --- | --- | --- |
| [00](roadmap/completed/00-repo-and-infra-foundations.md) | Repository & Infrastructure Foundations | Monorepo, CI, local dev environment — no business logic yet. |
| [01](roadmap/completed/01-tenancy-and-auth-core.md) | Tenancy & Auth Core | Org/Property/User models with RLS isolation, auth, RBAC. |
| [02](roadmap/completed/02-signup-and-free-trial-onboarding.md) | Self-Serve Signup & Free Plan Onboarding | Self-serve signup, lands directly on the permanent Free plan (no trial clock). |
| [03](roadmap/completed/03-property-room-rate-management.md) | Property, Room & Rate Management (Local) | Staff can configure inventory/rates locally, no PMS yet. |
| [04](roadmap/completed/04-local-booking-domain.md) | Local Booking Domain & State Machine | `PmsProvider` interface, `LocalPmsProvider`, idempotent booking state machine. |
| [05](roadmap/completed/05-guest-payments.md) | Guest Payments | Stripe Checkout, server-verified payment, refunds — separate from platform billing. Reopened and re-closed 2026-07-31 for tenant-configurable gateways, PokPay, and email completeness. |
| [06](roadmap/milestones/06-public-booking-widget.md) | WordPress Plugin Retrofit (Guest-Facing Frontend) | Import and retrofit the legacy plugin (ADR-0016): strip its domain/payment/PMS code, keep its UI, full guest journey. **Paused 2026-07-31** — resumes as one consolidated pass before Milestone 13. |
| [07](roadmap/completed/07-auth-pages.md) | Auth Pages | Shared login/signup/forgot-password UI and the `apps/web` component-library foundation everything after it consumes. **New (ADR-0023). Done 2026-08-01.** |
| [08](roadmap/milestones/08-platform-admin-dashboard.md) | Platform Admin Dashboard | MUST's own internal `/platform` tool: cross-tenant oversight, suspend/reactivate a tenant, trigger a password reset (ADR-0021). **New, split out of the old Platform Billing milestone (ADR-0023).** |
| [09](roadmap/milestones/09-tenant-admin-dashboard.md) | Tenant Admin Dashboard | Staff-facing operations UI: reservations (including staff-created walk-in bookings), payments, guests, staff, settings. |
| [10](roadmap/milestones/10-individual-room-booking.md) | Individual Room Booking (ADR-0022) | Per-property booking-mode (room-type-only / individual-room / mixed), room-level availability and optional per-room pricing, flexible All/type/room manual blocking. Now sequenced after the Tenant Dashboard, not before. |
| [11](roadmap/milestones/11-platform-billing.md) | Platform Billing | Real subscriptions via Stripe Billing, plan enforcement, dunning, cancellation/retention. Platform Admin dashboard moved to Milestone 8 — this is billing only now. |
| [12](roadmap/milestones/12-clock-pms-adapter-basic.md) | Clock PMS+ Adapter (Basic) | Sandbox-validated `ClockPmsProvider`: connect, catalog sync, availability, bookings. |
| [13](roadmap/milestones/13-integration-and-initial-release.md) | Integration & Initial Release Readiness | Everything working together, including WordPress's deferred consolidated integration pass; demoable initial version; go/no-go review. |

## Backlog — after Milestone 13, not scheduled

Explicitly deferred, not forgotten. Bring any of these back as a new milestone when the owner wants to prioritize it:

- Full production hardening of the Clock integration: complete reconciliation, WAF-suspicion circuit breakers, full observability/alerting, and the remaining deliverable documents from `docs/source/clock-pms-integration.pdf` section 37 (`CLOCK_ARCHITECTURE.md`, `CLOCK_DATA_MAPPING.md`, `CLOCK_BOOKING_STATE_MACHINE.md`, `CLOCK_WEBHOOK_FLOW.md`, `CLOCK_RECONCILIATION.md`, `CLOCK_ERROR_CATALOGUE.md`, `CLOCK_SECURITY_REVIEW.md`, `CLOCK_RUNBOOK.md`) and every ADR listed in the brief's section 38.
- A framework-agnostic, non-WordPress guest booking widget (for a tenant without a WordPress site) — not built preemptively per ADR-0016; only if an actual tenant needs it.
- Additional PMS vendors beyond Clock (Mews, Cloudbeds, Opera) — `PmsProvider` keeps this cheap, but no vendor work starts without an explicit go-ahead.
- Second platform-billing provider (PokPay) per ADR-0003's deferred consequence.
- Additional plan tiers beyond what Milestone 11 finalizes.
- Multi-currency platform billing, marketplace/reseller billing.
- Multi-region expansion (ADR-0004 keeps the door open, not scheduled).
