# Milestone 13: Platform Billing

Status: Not started
Depends on: Milestone 9 (Tenant Admin Dashboard, for shared `apps/web` UI foundation); Milestone 12 (Integration & Initial Release Readiness — billing intentionally lands after the initial usable version, not before); ADR-0003 (Stripe Billing), ADR-0005 (hybrid enforcement), ADR-0007 (plan shape — illustrative, PMS connections capped not unlimited, finalized here), ADR-0008 (permanent Free plan + separate paid-plan trial), ADR-0009 (30-day tenant-data retention, billing/legal records excluded)

**Scope note (2026-07-31):** ADR-0020 originally folded the Platform Admin dashboard into this milestone. That's since been split out into its own, earlier Milestone 8 (see ADR-0020's amendment) — this milestone is billing only: subscriptions, dunning, plan enforcement, cancellation. Don't reintroduce platform-admin dashboard tasks here.

**Resequencing note (2026-08-03, ADR-0025):** moved from Milestone 11 to last (Milestone 13), after Clock (11) and Integration & Initial Release Readiness (12) rather than before them. Billing is monetization for MUST, not a blocker to a functional product — Milestone 2's permanent Free plan already lets tenants use the platform without it. The owner asked to reach a working end-to-end product first; this milestone now follows that checkpoint instead of gating it.

## Goal

Tenants can be on a real subscription: start an optional paid-plan trial or upgrade directly from Free to a paid tier, get billed, get dunned on failed payment, and get properly offboarded on cancellation. This milestone starts with a **kickoff decision**: finalize the real plan catalog including per-property PMS connection caps and add-on pricing (ADR-0007's table is illustrative only, and must not ship "unlimited" PMS), and which tier(s) offer a paid-plan trial plus its length (ADR-0008's open detail) with the owner, before building the schema.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. **Kickoff decision with the owner**: finalize the real plan tier table including PMS connection caps + add-on pricing (replacing ADR-0007's illustrative numbers) and which tier(s) offer a paid-plan trial + trial length (replacing ADR-0008's open detail). Update those ADRs in place once decided.
2. `BillingProvider` interface implementation: `StripeBillingProvider` (`docs/ARCHITECTURE.md`).
3. Subscription/plan schema: tenant ↔ plan ↔ Stripe customer/subscription mapping (external IDs as references, not primary keys — per ADR-0003's consequence).
4. Upgrade flow: self-serve in-app action, Stripe Checkout/Billing session, webhook-driven activation.
5. Stripe Customer Portal (or custom) for invoices/payment method management.
6. Dunning: failed-payment webhook handling, retry/grace period, tenant notification.
7. Plan-limit enforcement wiring: hard-block on properties/staff/PMS-connection-cap per ADR-0005, using the finalized plan table from task 1 (including the paid PMS add-on for extra connections).
8. Paid-plan trial start/expiry job (new in this milestone — Milestone 2 did not build a trial mechanism): tenant opts into a trial from the dashboard, `trial_ends_at` set only then; on expiry without conversion, revert to Free (not lock, not delete). By this point tenants have been running on Free since Milestone 12's release checkpoint, so this is the first real trial/paid path they see.
9. Cancellation flow + the 30-day grace/hard-delete job from ADR-0009 (tenant-data-only scope; invoices/tax/security-log records excluded from deletion).
10. E2E test: signup (Free) → start paid-plan trial → upgrade → simulated failed payment → dunning → cancellation → 30-day deletion job (time-travel/fast-forward in test, not a real 30-day wait) → verify invoices survive deletion.

## Explicitly not included

- Guest payments (Milestone 5) — no code/table sharing with this milestone.
- A second billing provider (PokPay) — interface-ready per ADR-0003, not built here unless the owner requests it.
- Multi-currency billing.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
