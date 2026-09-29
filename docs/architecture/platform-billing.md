# Platform billing

Status: **PARTIALLY IMPLEMENTED foundation; paid billing PLANNED**. Code inspected 2026-09-19.

This domain is MUST charging tenants for the platform. Guest room charges/refunds are documented separately in [booking/payments](booking-and-payments.md).

## Implemented now

- `Plan` and `Organization.planId` in the [schema](../../apps/api/prisma/schema.prisma); the Free plan is seeded by migrations.
- Self-service signup onto permanent Free, with no automatic expiry clock or card collection.
- `PlanUsageService` exposes property count, non-auto-provisioned membership count and plan limits.
- `PropertiesService` and staff invitation/membership paths enforce capacity caps. Auto-provisioned property accounts are cap-exempt.
- `IntegrationConnectionsService` checks PMS entitlement and connection limits. Plans carry both `pms_enabled` and `max_pms_connections_per_property`; "unlimited whenever enabled" was inaccurate.
- A Settings billing placeholder; no real customer portal.

## Accepted intent, not shipped functionality

[ADR-0003](../decisions/ADR-0003-platform-billing-provider.md) selects Stripe Billing behind `BillingProvider`; the interface currently returns `unknown` and has **no implementation**. No subscription/invoice/dunning models, StripeBillingProvider, paid-plan trial scheduler or subscription-cancellation deletion worker were found.

[ADR-0007](../decisions/ADR-0007-pricing-model.md) accepts flat tiers and capped PMS connections with possible paid add-ons. Old Free/Basic numbers are illustrative; do not turn them into a final commercial catalog. [ADR-0008](../decisions/ADR-0008-onboarding-model.md) separates permanent Free from an optional paid-tier trial that falls back to Free.

[ADR-0009](../decisions/ADR-0009-data-retention-churn.md) records a future 30-day tenant-data cancellation grace period. Billing/legal records and guest operational history have distinct retention rules. No automated enforcement should be inferred from this accepted decision.

[Milestone 15](../roadmap/milestones/15-platform-billing.md) is the planning home. Final tiers, prices, trial duration/eligibility, cancellation access and legally required retention details remain unresolved implementation inputs. Do not build against illustrative values.

## Guardrail

Guest `payments`, payment sessions, refund state and Clock folios must never become the subscription ledger. Sharing a vendor name (Stripe/PokPay) or the generic encrypted-connection infrastructure does not make those business flows interchangeable.
