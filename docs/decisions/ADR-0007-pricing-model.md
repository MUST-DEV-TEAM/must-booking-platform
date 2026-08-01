# ADR-0007: Pricing model shape

Status: Accepted
Date: 2026-07-27

## Context

Options presented were: flat tiered plans with fixed limits, per-property metered pricing, or usage-based pricing (e.g. per booking/month). This shapes the billing schema and plan-limit design in `BILLING.md` and interacts with ADR-0003 (billing provider, accepted) and ADR-0005 (limit enforcement, accepted).

## Decision

Flat tiered plans — this shape is confirmed and accepted. The specific numbers the owner gave (Free: 1 property/3 staff/no PMS; Basic: 3 properties/10 staff/unlimited PMS) were **explicitly illustrative examples**, not a final locked catalog — corrected 2026-07-27 after an earlier version of this ADR mislabeled them as confirmed content. Do not build Stripe products/prices or hardcode these exact numbers as final; the real tier count, names, and limits are confirmed together with the owner at Milestone 9 (Platform Billing) kickoff, using the table below only as a shape placeholder.

| Plan | Properties (hard limit, ADR-0005/0006) | Staff seats (hard limit, ADR-0005) | PMS connections | Notes |
| --- | --- | --- | --- | --- |
| **Free** _(illustrative)_ | 1 | 3 | None — local/direct booking only, no PMS integration | Self-serve entry point (ADR-0008), permanent plan (not a trial) |
| **Basic** _(illustrative)_ | 3 | 10 | 1 PMS connection per property | Additional connections beyond the per-property cap are a paid add-on, not unlimited |
| _(further tier(s))_ | TBD | TBD | TBD | Tier count/names/limits all TBD — finalize at Milestone 9 kickoff |

PMS connection availability is a **feature gate**, not a numeric hard/soft limit — a plan without PMS access simply has the Clock (or any) PMS adapter switched off at the plan level, enforced the same way a hard limit is (API rejects/hides the capability), not warned-and-allowed. This mechanic is confirmed even though which tier(s) get it is not yet finalized.

**Refined by the owner (2026-07-27, second review pass): "unlimited PMS" must not ship on Basic.** Each PMS/channel connection carries real per-connection operational cost (vendor API/partner requirements, support burden), so a plan that includes PMS access gets a capped number of connections (illustrative: 1 per property), with additional connections sold as a paid add-on rather than included unbounded. This constraint is confirmed even though the exact cap and add-on price are TBD at Milestone 9 kickoff — do not finalize a tier with literally-unlimited PMS connections.

## Consequences

- The plan/limit schema needs, per plan: `max_properties` (int), `max_staff_seats` (int), `pms_enabled` (bool) at minimum, extensible for future tiers and future usage-shaped limits (e.g. bookings/month) if those are added later.
- `max_properties` and `max_staff_seats` are enforced as **hard** limits per ADR-0005 (block the action, e.g. "add property"/"invite staff", once reached).
- **Clarified with the owner at Milestone 2, Task 7 (2026-07-28):** `max_staff_seats` counts every `tenant_membership` row for the tenant, including the Owner's own — it is total roster size, not "invited staff beyond the Owner." A Free-plan tenant (illustrative limit of 3) can therefore have the Owner plus 2 invited people before hitting the cap, not the Owner plus 3.
- `pms_enabled` gates whether the tenant can configure any `PmsProvider` connection at all (including `LocalPmsProvider` is always available; `ClockPmsProvider` and future vendors require `pms_enabled`). Where enabled, the schema also needs a `max_pms_connections_per_property` (int, not unlimited) plus a mechanism for a paid add-on to raise it per the owner's refinement above.
- Stripe Billing (ADR-0003) product/price catalog should mirror the *final* table (not the illustrative one above): one Stripe Product per plan tier (a free tier may be a $0 price or handled outside Stripe entirely — decide during Milestone 9).
- The real plan table is defined together with the owner when Milestone 9 (Platform Billing) starts, not assumed from the illustrative example — this is a milestone-kickoff task, not implementation guesswork.
- Once the real table is confirmed, this ADR should be updated in place (numbers corrected, "illustrative" label removed) rather than left permanently provisional.
- A new tier that changes the *shape* of pricing (e.g. introduces usage-based billing) rather than just adding a row would need a new ADR superseding this one; adding/adjusting tiers within the flat-tiered shape does not.
