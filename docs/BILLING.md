# Platform Billing

This document covers only **platform billing**: the subscription MUST charges tenants (hotels) for using the platform. It does not cover guest room payments (Stripe Checkout/PokPay/pay-at-hotel/Clock folios) — those are a separate domain, carried from `docs/source/clock-pms-integration.pdf` and detailed once the guest-payment work starts. Do not merge the two in code, data model, or ledger.

## Scope (v1)

- Plans with limits such as number of properties (properties confirmed multi-per-tenant from v1, ADR-0006), bookings/month, staff seats. Exact plan tiers/shape: open, ADR-0007.
- Trial period — length and expiry behavior open, tied to ADR-0008 (onboarding model).
- Provider-hosted subscription billing — provider open, ADR-0003.
- Invoicing, payment method on file, dunning (failed-payment retry/grace period), plan upgrade/downgrade proration.
- Usage metering where limits are usage-based, feeding enforcement in the API layer per the hybrid model in ADR-0005.
- Tenant-facing billing portal (Stripe Customer Portal or custom, depending on ADR-0003) for invoices/payment method management.

## Explicit non-goals (v1)

- Marketplace/revenue-share billing.
- Multi-currency tenant billing (not scoped in; revisit if ADR-0004's future multi-region expansion brings non-EUR/USD tenants).

## Enforcement boundary — decided (ADR-0005)

Plan limits are enforced in the API layer at the point of the constrained action (e.g. creating a new property, inviting a new staff seat), not retroactively. Hybrid model: **hard** limits (capacity-shaped, e.g. property count, staff seats) block the action at the limit; **soft** limits (usage-shaped, e.g. bookings/month) only warn (in-app + email) without blocking. Each limit added to a plan must be tagged `hard` or `soft`.

## Data retention after cancellation — open (ADR-0009)

No cancellation/offboarding data-deletion job may be implemented until ADR-0009 is resolved.

## Open decisions blocking implementation

- ADR-0003 — billing provider.
- ADR-0007 — pricing model shape (plan tiers vs. metered vs. usage-based).
- ADR-0008 — onboarding model (self-serve vs. sales-assisted), which determines how early ADR-0003/ADR-0007 must land.
- ADR-0009 — tenant data retention after cancellation.

See `decisions/` for full context and status on each.
