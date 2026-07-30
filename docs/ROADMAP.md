# Roadmap

The roadmap is 11 milestones, numbered 0-10, worked in order. Reaching Milestone 10 done = an initial, usable, end-to-end version of the platform, not the fully hardened/feature-complete product. The process (kickoff, task lifecycle, who marks things done, archiving) is in [docs/roadmap/README.md](roadmap/README.md) — read that before starting or reviewing any milestone work.

## Milestones

| # | Milestone | Goal (one line) |
| --- | --- | --- |
| [00](roadmap/completed/00-repo-and-infra-foundations.md) | Repository & Infrastructure Foundations | Monorepo, CI, local dev environment — no business logic yet. |
| [01](roadmap/completed/01-tenancy-and-auth-core.md) | Tenancy & Auth Core | Org/Property/User models with RLS isolation, auth, RBAC. |
| [02](roadmap/completed/02-signup-and-free-trial-onboarding.md) | Self-Serve Signup & Free Plan Onboarding | Self-serve signup, lands directly on the permanent Free plan (no trial clock). |
| [03](roadmap/completed/03-property-room-rate-management.md) | Property, Room & Rate Management (Local) | Staff can configure inventory/rates locally, no PMS yet. |
| [04](roadmap/completed/04-local-booking-domain.md) | Local Booking Domain & State Machine | `PmsProvider` interface, `LocalPmsProvider`, idempotent booking state machine. |
| [05](roadmap/milestones/05-guest-payments.md) | Guest Payments | Stripe Checkout, server-verified payment, refunds — separate from platform billing. |
| [06](roadmap/milestones/06-public-booking-widget.md) | WordPress Plugin Retrofit (Guest-Facing Frontend) | Import and retrofit the legacy plugin (ADR-0016): strip its domain/payment/PMS code, keep its UI, full guest journey. |
| [07](roadmap/milestones/07-tenant-admin-dashboard.md) | Tenant Admin Dashboard | Staff-facing operations UI: reservations, payments, guests, staff, settings. |
| [08](roadmap/milestones/08-platform-billing.md) | Platform Billing | Real subscriptions via Stripe Billing, plan enforcement, dunning, cancellation/retention. |
| [09](roadmap/milestones/09-clock-pms-adapter-basic.md) | Clock PMS+ Adapter (Basic) | Sandbox-validated `ClockPmsProvider`: connect, catalog sync, availability, bookings. |
| [10](roadmap/milestones/10-integration-and-initial-release.md) | Integration & Initial Release Readiness | Everything working together; demoable initial version; go/no-go review. |

## Backlog — after Milestone 10, not scheduled

Explicitly deferred, not forgotten. Bring any of these back as a new milestone when the owner wants to prioritize it:

- Full production hardening of the Clock integration: complete reconciliation, WAF-suspicion circuit breakers, full observability/alerting, and the remaining deliverable documents from `docs/source/clock-pms-integration.pdf` section 37 (`CLOCK_ARCHITECTURE.md`, `CLOCK_DATA_MAPPING.md`, `CLOCK_BOOKING_STATE_MACHINE.md`, `CLOCK_WEBHOOK_FLOW.md`, `CLOCK_RECONCILIATION.md`, `CLOCK_ERROR_CATALOGUE.md`, `CLOCK_SECURITY_REVIEW.md`, `CLOCK_RUNBOOK.md`) and every ADR listed in the brief's section 38.
- A framework-agnostic, non-WordPress guest booking widget (for a tenant without a WordPress site) — not built preemptively per ADR-0016; only if an actual tenant needs it.
- Additional PMS vendors beyond Clock (Mews, Cloudbeds, Opera) — `PmsProvider` keeps this cheap, but no vendor work starts without an explicit go-ahead.
- Second platform-billing provider (PokPay) per ADR-0003's deferred consequence.
- Additional plan tiers beyond what Milestone 8 finalizes.
- Multi-currency platform billing, marketplace/reseller billing.
- Multi-region expansion (ADR-0004 keeps the door open, not scheduled).
