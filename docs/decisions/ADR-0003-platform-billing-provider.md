# ADR-0003: Platform billing provider

Status: Accepted
Date: 2026-07-27

## Context

The platform needs to charge tenants a recurring subscription (confirmed scope — see `BILLING.md`, `PROJECT_CONTEXT.md`). This is separate from guest room payments (Stripe Checkout/PokPay), which are unaffected by this decision.

## Options

1. **Stripe Billing** (Subscriptions + Invoicing + Customer Portal) — plans, proration, dunning, hosted portal largely provided; fastest to implement and battle-tested; ties platform billing to Stripe as a vendor.
2. **Custom subscription ledger on top of Stripe Payments primitives** — more control over edge cases, but reimplements proration/dunning/invoicing logic that Stripe Billing already solves.
3. **Paddle or another merchant-of-record provider** — offloads tax/VAT compliance (relevant if tenants span multiple countries/VAT regimes), at the cost of less flexibility than Stripe.

## Decision

Stripe Billing for now, following the recommendation. The owner explicitly wants room to add a second platform-billing provider later — specifically PokPay, once it is brought into scope — for tenants who need or prefer a regional/local payment method for their own subscription, not only for guest payments.

Accepted by the owner on 2026-07-27.

## Consequences

- Platform billing is implemented behind a `BillingProvider` interface (mirroring the `PmsProvider` pattern in `ARCHITECTURE.md`), not by calling the Stripe SDK directly from subscription/invoice domain code. `StripeBillingProvider` is the first and only implementation for now.
- Do not design the subscription/invoice data model around Stripe-specific object shapes (e.g. don't leak Stripe subscription/invoice IDs as the primary key of the domain's subscription entity) — store them as external references, same discipline as the Clock PMS mapping tables in `docs/source/clock-pms-integration.pdf`.
- A tenant's chosen platform-billing provider/payment method is a per-tenant setting, not a global one — the data model must support a tenant being on Stripe while another tenant is later on PokPay (or another provider), without a schema change.
- PokPay-for-platform-billing is explicitly deferred, not scheduled — it is added when PokPay is brought into scope for this purpose (per the owner's note), not as part of Phase 3's initial delivery. Do not build a second provider speculatively before that request lands; the interface boundary above is what keeps that addition cheap later.
- Remains separate from PokPay's existing role as a *guest* payment provider (`docs/source/clock-pms-integration.pdf` section 25) — same vendor, two independent integrations, per `PROJECT_CONTEXT.md`'s billing-domain separation rule.
