# Roadmap

The roadmap is 16 milestones, numbered 0-15, worked in order (per [ADR-0023](decisions/ADR-0023-platform-admin-dashboard-resequencing.md); Platform Billing further resequenced by [ADR-0025](decisions/ADR-0025-platform-billing-moved-to-final-milestone.md) and again by [ADR-0028](decisions/ADR-0028-app-polish-and-security-audit-milestones-inserted.md), which also inserted Milestones 13-14). Reaching Milestone 12 done = an initial, usable, end-to-end version of the platform, not the fully hardened/feature-complete product. Milestones 13 (Application UI/UX & Feature Enhancements) and 14 (Security & Architecture Audit) follow that checkpoint before Milestone 15 (Platform Billing) — billing is monetization for MUST, not a blocker to a functional product, since Milestone 2's permanent Free plan already covers that. The process (kickoff, task lifecycle, who marks things done, archiving) is in [docs/roadmap/README.md](roadmap/README.md) — read that before starting or reviewing any milestone work.

## Milestones

| # | Milestone | Goal (one line) |
| --- | --- | --- |
| [00](roadmap/completed/00-repo-and-infra-foundations.md) | Repository & Infrastructure Foundations | Monorepo, CI, local dev environment — no business logic yet. |
| [01](roadmap/completed/01-tenancy-and-auth-core.md) | Tenancy & Auth Core | Org/Property/User models with RLS isolation, auth, RBAC. |
| [02](roadmap/completed/02-signup-and-free-trial-onboarding.md) | Self-Serve Signup & Free Plan Onboarding | Self-serve signup, lands directly on the permanent Free plan (no trial clock). |
| [03](roadmap/completed/03-property-room-rate-management.md) | Property, Room & Rate Management (Local) | Staff can configure inventory/rates locally, no PMS yet. |
| [04](roadmap/completed/04-local-booking-domain.md) | Local Booking Domain & State Machine | `PmsProvider` interface, `LocalPmsProvider`, idempotent booking state machine. |
| [05](roadmap/completed/05-guest-payments.md) | Guest Payments | Stripe Checkout, server-verified payment, refunds — separate from platform billing. Reopened and re-closed 2026-07-31 for tenant-configurable gateways, PokPay, and email completeness. |
| [06](roadmap/completed/06-public-booking-widget.md) | WordPress Plugin Retrofit (Guest-Facing Frontend) | Import and retrofit the legacy plugin (ADR-0016): strip its domain/payment/PMS code, keep its UI, full guest journey. **Done 2026-08-14 (51 tasks — grew from 10 as live testing against a real connected WordPress site repeatedly surfaced real gaps, ending with a full email-branding/content redesign).** |
| [07](roadmap/completed/07-auth-pages.md) | Auth Pages | Shared login/signup/forgot-password UI and the `apps/web` component-library foundation everything after it consumes. **New (ADR-0023). Done 2026-08-01.** |
| [08](roadmap/completed/08-platform-admin-dashboard.md) | Platform Admin Dashboard | MUST's own internal `/platform` tool: cross-tenant oversight, suspend/reactivate a tenant, trigger a password reset (ADR-0021). **New, split out of the old Platform Billing milestone (ADR-0023). Done 2026-08-02 (15 tasks — reopened once for a Figma-conformance/shared-shell gap).** |
| [09](roadmap/completed/09-tenant-admin-dashboard.md) | Tenant Admin Dashboard | Staff-facing operations UI: reservations (including staff-created walk-in bookings), payments, guests, staff, settings. **Done 2026-08-03 (30 tasks — expanded from 23 mid-milestone for nav/property-access gaps and a post-milestone reliability/demo-data follow-up).** |
| [10](roadmap/completed/10-individual-room-booking.md) | Individual Room Booking (ADR-0022) | Per-property booking-mode (room-type-only / individual-room / mixed), room-level availability and optional per-room pricing, flexible All/type/room manual blocking. Now sequenced after the Tenant Dashboard, not before. **Done 2026-08-03 (10 tasks — one send-back on task 5, otherwise clean).** |
| [11](roadmap/completed/11-clock-pms-adapter-basic.md) | Clock PMS+ Adapter (Basic) | Sandbox-validated `ClockPmsProvider`: connect, catalog sync, availability, bookings. **Done 2026-08-04 (16 tasks).** |
| [12](roadmap/completed/12-integration-and-initial-release.md) | Integration & Initial Release Readiness | Everything working together, including WordPress's deferred consolidated integration pass; demoable initial version; go/no-go review. **This is now the "initial usable version" checkpoint (ADR-0025), not Milestone 13.** **Done 2026-08-23** (20/25 tasks; 3 deferred to Milestone 14, 2 parked). |
| [13](roadmap/milestones/13-app-ui-ux-and-features.md) | Application UI/UX & Feature Enhancements | Figma-fidelity audit pass, open frontend-library decisions, accessibility/responsive verification, owner-directed feature work. **New (ADR-0028).** |
| [14](roadmap/milestones/14-security-and-architecture-audit.md) | Environment Rebuild & Security Audit | Build a new production environment from scratch off the homelab (DenisZoi), then a systematic security pass across tenancy isolation, payment/billing separation, PMS-integration idempotency, auth, webhooks, database, secrets, public API surface, and the WordPress plugin's domain-logic boundary. **New (ADR-0028); scope expanded 2026-08-21 to fold in the environment rebuild.** |
| [15](roadmap/milestones/15-platform-billing.md) | Platform Billing | Real subscriptions via Stripe Billing, plan enforcement, dunning, cancellation/retention. Platform Admin dashboard moved to Milestone 8 — this is billing only now. **Moved to last, after Milestones 12-14, per ADR-0025 and ADR-0028 — monetization for MUST, not a blocker to a functional product.** |

## Backlog — after Milestone 15, not scheduled

Explicitly deferred, not forgotten. Bring any of these back as a new milestone when the owner wants to prioritize it:

- Full production hardening of the Clock integration: complete reconciliation, WAF-suspicion circuit breakers, full observability/alerting, and the remaining deliverable documents from `docs/source/clock-pms-integration.pdf` section 37 (`CLOCK_ARCHITECTURE.md`, `CLOCK_DATA_MAPPING.md`, `CLOCK_BOOKING_STATE_MACHINE.md`, `CLOCK_WEBHOOK_FLOW.md`, `CLOCK_RECONCILIATION.md`, `CLOCK_ERROR_CATALOGUE.md`, `CLOCK_SECURITY_REVIEW.md`, `CLOCK_RUNBOOK.md`) and every ADR listed in the brief's section 38.
- A framework-agnostic, non-WordPress guest booking widget (for a tenant without a WordPress site) — not built preemptively per ADR-0016; only if an actual tenant needs it.
- Additional PMS vendors beyond Clock (Mews, Cloudbeds, Opera) — `PmsProvider` keeps this cheap, but no vendor work starts without an explicit go-ahead.
- Second platform-billing provider (PokPay) per ADR-0003's deferred consequence.
- Additional plan tiers beyond what Milestone 13 finalizes.
- Multi-currency platform billing, marketplace/reseller billing.
- Multi-region expansion (ADR-0004 keeps the door open, not scheduled).
