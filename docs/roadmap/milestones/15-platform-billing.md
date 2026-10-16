# Milestone 15: Platform Billing

Status: Not started
Depends on: Milestone 9 (Tenant Admin Dashboard, for shared `apps/web` UI foundation); Milestone 12 (Integration & Initial Release Readiness — billing intentionally lands after the initial usable version, not before); Milestones 13-14 (Application UI/UX & Feature Enhancements, Security & Architecture Audit — billing lands after those passes too, per ADR-0028); ADR-0003 (Stripe Billing), ADR-0005 (hybrid enforcement), ADR-0007 (plan shape — illustrative, PMS connections capped not unlimited, finalized here), ADR-0008 (permanent Free plan + separate paid-plan trial), ADR-0009 (30-day tenant-data retention, billing/legal records excluded)

**Scope note (2026-07-31):** ADR-0020 originally folded the Platform Admin dashboard into this milestone. That's since been split out into its own, earlier Milestone 8 (see ADR-0020's amendment) — this milestone is billing only: subscriptions, dunning, plan enforcement, cancellation. Don't reintroduce platform-admin dashboard tasks here.

**Resequencing note (2026-08-03, ADR-0025):** moved from Milestone 11 to last (Milestone 13 at the time), after Clock (11) and Integration & Initial Release Readiness (12) rather than before them. Billing is monetization for MUST, not a blocker to a functional product — Milestone 2's permanent Free plan already lets tenants use the platform without it. The owner asked to reach a working end-to-end product first; this milestone now follows that checkpoint instead of gating it.

**Resequencing note (2026-08-17, ADR-0028):** renumbered from Milestone 13 to Milestone 15 — two new milestones (13: Application UI/UX & Feature Enhancements, 14: Security & Architecture Audit) were inserted ahead of it. No change to this milestone's own scope.

## Goal

Tenants can be on a real subscription: start an optional paid-plan trial or upgrade directly from Free to a paid tier, get billed, get dunned on failed payment, and get properly offboarded on cancellation. This milestone starts with a **kickoff decision**: finalize the real plan catalog including per-property PMS connection caps and add-on pricing (ADR-0007's table is illustrative only, and must not ship "unlimited" PMS), and which tier(s) offer a paid-plan trial plus its length (ADR-0008's open detail) with the owner, before building the schema.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. **Kickoff decision with the owner**: finalize the real plan tier table including PMS connection caps + add-on pricing (replacing ADR-0007's illustrative numbers) and which tier(s) offer a paid-plan trial + trial length (replacing ADR-0008's open detail). Update those ADRs in place once decided.
2. `BillingProvider` interface implementation: `StripeBillingProvider` (`docs/architecture/overview.md`).
3. Subscription/plan schema: tenant ↔ plan ↔ Stripe customer/subscription mapping (external IDs as references, not primary keys — per ADR-0003's consequence).
4. Upgrade flow: self-serve in-app action, Stripe Checkout/Billing session, webhook-driven activation.
5. Stripe Customer Portal (or custom) for invoices/payment method management.
6. Dunning: failed-payment webhook handling, retry/grace period, tenant notification.
7. Plan-limit enforcement wiring: hard-block on properties/staff/PMS-connection-cap per ADR-0005, using the finalized plan table from task 1 (including the paid PMS add-on for extra connections).
8. Paid-plan trial start/expiry job (new in this milestone — Milestone 2 did not build a trial mechanism): tenant opts into a trial from the dashboard, `trial_ends_at` set only then; on expiry without conversion, revert to Free (not lock, not delete). By this point tenants have been running on Free since Milestone 12's release checkpoint, so this is the first real trial/paid path they see.
9. Cancellation flow + the 30-day grace/hard-delete job from ADR-0009 (tenant-data-only scope; invoices/tax/security-log records excluded from deletion).
10. E2E test: signup (Free) → start paid-plan trial → upgrade → simulated failed payment → dunning → cancellation → 30-day deletion job (time-travel/fast-forward in test, not a real 30-day wait) → verify invoices survive deletion.

## Owner direction (2026-10-14) — inputs for the kickoff decision, not final design

Recorded from the owner during plan-catalog discussion. These are intent, not shipped behavior; the real tier table is still decided in task 1.

- **Free tier gets a 2-week time limit.** This replaces the current "permanent Free, no expiry clock" behavior (see [platform billing](../../architecture/platform-billing.md)). ADR-0007, ADR-0008 and ADR-0009 describe Free as permanent / trial-then-revert-to-Free, so they need an amendment when this milestone starts.
  - **Decided (owner, 2026-10-14):** when the 2 weeks end the account is **locked** (not deleted, not downgraded). Exact lock semantics (read-only vs. fully blocked, what the owner can still do such as export data or upgrade, interaction with the ADR-0009 cancellation grace period) are still to be specified at kickoff.
  - **Still open, owner must decide:** whether the clock starts at signup or first property; whether any warning emails precede expiry; and what this does to the existing "optional paid-plan trial" in task 8 (it may become redundant).
- **Tier shape under discussion** (numbers illustrative, not a commercial catalog): Free (1 property, small seat cap, no PMS), Standard (1 property, ~10 seats, 1 PMS connection), Pro (~5 properties, ~30 seats, 1 PMS connection per property), Enterprise (custom, sales-assigned, not self-serve), plus the hidden Internal Testing tier below.
- **Seat counting:** `max_staff_seats` counts **all** non-auto-provisioned tenant memberships **including the owner** (`PlanUsageService`). Today's Free value of 3 therefore means owner + 2 staff. **Decided (owner, 2026-10-14):** Free should allow owner + 3 staff, i.e. `max_staff_seats = 4`. Not applied yet; change it together with the Free time-limit rework in this milestone, since Free is live and the number is part of the same catalog decision.
- **Rules to apply when enforcing limits:** enforce on the server, not only in the UI; going over a limit blocks the new action and never deletes existing data; a downgrade is allowed only once usage fits the new limits; PMS access is the main paid differentiator.
- **Hidden tiers:** plans carry `is_public`. Only public plans may be offered at signup or on any upgrade screen; non-public plans (Internal Testing, Enterprise) are assigned by a platform admin only. Task 4's upgrade flow and any plan-change endpoint must filter on `is_public` and reject non-public plan IDs from tenant callers (**owner confirmed: enforcement belongs in this milestone**).

## Explicitly not included

- Guest payments (Milestone 5) — no code/table sharing with this milestone.
- A second billing provider (PokPay) — interface-ready per ADR-0003, not built here unless the owner requests it.
- Multi-currency billing.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
