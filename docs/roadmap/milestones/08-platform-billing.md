# Milestone 8: Platform Billing

Status: Not started
Depends on: Milestone 7; ADR-0003 (Stripe Billing), ADR-0005 (hybrid enforcement), ADR-0007 (plan shape — illustrative, finalized here), ADR-0008 (30-day Free trial), ADR-0009 (30-day retention then tenant-data delete)

## Goal

Tenants can be on a real subscription: upgrade from Free to a paid tier, get billed, get dunned on failed payment, and get properly offboarded on cancellation. This milestone starts with a **kickoff decision**: finalize the real plan catalog (ADR-0007's table is illustrative only) and the exact Free-trial-expiry behavior (ADR-0008's open detail) with the owner, before building the schema.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. **Kickoff decision with the owner**: finalize the real plan tier table (replacing ADR-0007's illustrative numbers) and the Free-trial-expiry behavior (replacing ADR-0008's open detail). Update those ADRs in place once decided.
2. `BillingProvider` interface implementation: `StripeBillingProvider` (`docs/ARCHITECTURE.md`).
3. Subscription/plan schema: tenant ↔ plan ↔ Stripe customer/subscription mapping (external IDs as references, not primary keys — per ADR-0003's consequence).
4. Upgrade flow: self-serve in-app action, Stripe Checkout/Billing session, webhook-driven activation.
5. Stripe Customer Portal (or custom) for invoices/payment method management.
6. Dunning: failed-payment webhook handling, retry/grace period, tenant notification.
7. Plan-limit enforcement wiring: hard-block on properties/staff/PMS-gate per ADR-0005, using the finalized plan table from task 1.
8. Trial-expiry job finalized (Milestone 2 built the mechanism; this task implements the real decided behavior from task 1).
9. Cancellation flow + the 30-day grace/hard-delete job from ADR-0009 (tenant-data-only scope).
10. E2E test: signup → trial → upgrade → simulated failed payment → dunning → cancellation → 30-day deletion job (time-travel/fast-forward in test, not a real 30-day wait).

## Explicitly not included

- Guest payments (Milestone 5) — no code/table sharing with this milestone.
- A second billing provider (PokPay) — interface-ready per ADR-0003, not built here unless the owner requests it.
- Multi-currency billing.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
