# ADR-0007: Pricing model shape

Status: Accepted
Date: 2026-07-27

## Context

Options presented were: flat tiered plans with fixed limits, per-property metered pricing, or usage-based pricing (e.g. per booking/month). This shapes the billing schema and plan-limit design in `BILLING.md` and interacts with ADR-0003 (billing provider, accepted) and ADR-0005 (limit enforcement, accepted).

## Decision

Flat tiered plans. The owner gave an initial two-tier draft as the starting shape; further tiers (e.g. a Pro/Enterprise tier above Basic) are expected but not yet specified — treat the table below as the confirmed shape and starting content, not the final complete catalog.

| Plan | Properties (hard limit, ADR-0005/0006) | Staff seats (hard limit, ADR-0005) | PMS connections | Notes |
| --- | --- | --- | --- | --- |
| **Free** | 1 | 3 | None — local/direct booking only, no PMS integration | Self-serve entry point (ADR-0008) |
| **Basic** | 3 | 10 | Unlimited | |
| _(further tier(s), e.g. Pro/Enterprise)_ | TBD | TBD | TBD | Not yet specified — add when the owner defines it; not blocking Phase 3 start with Free + Basic |

PMS connection availability is a **feature gate**, not a numeric hard/soft limit — Free simply has the Clock (or any) PMS adapter switched off at the plan level, enforced the same way a hard limit is (API rejects/hides the capability), not warned-and-allowed.

## Consequences

- The plan/limit schema needs, per plan: `max_properties` (int), `max_staff_seats` (int), `pms_enabled` (bool) at minimum, extensible for future tiers and future usage-shaped limits (e.g. bookings/month) if those are added later.
- `max_properties` and `max_staff_seats` are enforced as **hard** limits per ADR-0005 (block the action, e.g. "add property"/"invite staff", once reached).
- `pms_enabled` gates whether the tenant can configure any `PmsProvider` connection at all (including `LocalPmsProvider` is always available; `ClockPmsProvider` and future vendors require `pms_enabled`).
- Stripe Billing (ADR-0003) product/price catalog should mirror this table: one Stripe Product per plan tier (Free may be a $0 price or handled outside Stripe entirely — decide during Phase 3 implementation, not a blocking ADR-level question).
- Additional tiers beyond Free/Basic are added to this table (not a new ADR) when the owner specifies them, unless a new tier changes the *shape* of pricing (e.g. introduces usage-based billing) rather than just adding a row — that would need a new ADR superseding this one.
