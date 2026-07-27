# Platform Billing

This document covers only **platform billing**: the subscription MUST charges tenants (hotels) for using the platform. It does not cover guest room payments (Stripe Checkout/PokPay/pay-at-hotel/Clock folios) — those are a separate domain, carried from `docs/source/clock-pms-integration.pdf` and detailed once the guest-payment work starts. Do not merge the two in code, data model, or ledger.

## Scope (v1)

- Plans (e.g. Starter/Growth/Enterprise) with limits such as number of properties, bookings/month, staff seats.
- Trial period.
- Provider-hosted subscription billing (Stripe Billing is the default assumption — confirm/record as ADR before implementation).
- Invoicing, payment method on file, dunning (failed-payment retry/grace period), plan upgrade/downgrade proration.
- Usage metering where limits are usage-based (e.g. bookings/month) feeding enforcement in the API layer.
- Tenant-facing billing portal (Stripe Customer Portal or custom) for invoices/payment method management.

## Explicit non-goals (v1)

- Marketplace/revenue-share billing.
- Usage-based billing granular enough to require a dedicated metering pipeline (defer unless a plan requires per-booking metering beyond simple monthly counts).
- Multi-currency tenant billing (confirm with the user before scoping in).

## Enforcement boundary

Plan limits are enforced in the API layer at the point of the constrained action (e.g. creating a new property, inviting a new staff seat), not retroactively. A tenant over a soft limit is warned; enforcement of hard limits (blocking the action) vs. soft limits (warn + notify billing) is an open product decision to confirm with the user before implementation.

## Open decisions requiring an ADR before implementation

- Billing provider: Stripe Billing vs. a custom ledger + Stripe Payments primitives.
- Hard-block vs. soft-warn enforcement per limit type.
- Trial length and what happens to tenant data/access at trial expiry without a payment method.
- Whether platform billing currency/region constraints differ from guest-payment currency/region constraints.

See `decisions/` once these are resolved.
