# ADR-0003: Platform billing provider

Status: Proposed — **requires user decision before billing implementation**
Date: 2026-07-27

## Context

The platform needs to charge tenants a recurring subscription (confirmed scope — see `BILLING.md`, `PROJECT_CONTEXT.md`). This is separate from guest room payments (Stripe Checkout/PokPay), which are unaffected by this decision.

## Options

1. **Stripe Billing** (Subscriptions + Invoicing + Customer Portal) — plans, proration, dunning, hosted portal largely provided; fastest to implement and battle-tested; ties platform billing to Stripe as a vendor.
2. **Custom subscription ledger on top of Stripe Payments primitives** — more control over edge cases, but reimplements proration/dunning/invoicing logic that Stripe Billing already solves.
3. **Paddle or another merchant-of-record provider** — offloads tax/VAT compliance (relevant if tenants span multiple countries/VAT regimes), at the cost of less flexibility than Stripe.

## Recommendation (not yet accepted)

Stripe Billing, given Stripe is already a guest-payment provider in the source architecture (operational familiarity) and Stripe Billing directly covers the v1 scope in `BILLING.md`. Revisit if tenant billing needs to span jurisdictions where a merchant-of-record materially simplifies VAT/tax handling.

## Decision

_Explicitly deferred by the owner on 2026-07-27 — asked directly, chose to leave this open rather than pick an option. Do not start billing implementation until this is resolved; re-raise before Phase 3._

## Consequences

_To be filled in once decided. Depends in part on ADR-0007 (pricing model shape) and ADR-0004 (EU-now, multi-region-later hosting, which affects VAT/tax exposure across regions)._
