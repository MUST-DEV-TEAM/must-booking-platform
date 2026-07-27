# ADR-0005: Plan limit enforcement style

Status: Accepted
Date: 2026-07-27

## Context

Plans (see `docs/BILLING.md`) impose limits such as number of properties, staff seats, and bookings/month. Enforcement style (block the action vs. only warn) needed to be decided before the API layer implements limit checks.

## Decision

Hybrid, chosen by the owner:

- **Hard limits** (e.g., number of properties, staff seats — capacity-shaped, plan-tier-defining limits): the constrained action is **blocked** at the API layer once the limit is reached (e.g., cannot add a new property beyond the plan's cap without upgrading).
- **Usage limits** (e.g., bookings/month — volume-shaped, naturally fluctuating limits): the tenant is **warned** (in-app notice + billing/owner email) on approaching or exceeding the limit, but the action is not blocked; overage is handled through the billing relationship (upsell prompt, or usage-based overage charge if ADR-0007 lands on a metered pricing model).

## Consequences

- The plan-limit schema needs a `limit_type: hard | soft` flag per limit, not a single enforcement rule for all limits.
- Hard-limit checks must be synchronous in the request path for the constrained action (e.g., create-property endpoint checks before creating).
- Soft-limit checks can run asynchronously/on a schedule (e.g., nightly usage rollup) and only need to trigger a notification, not block a request.
- Which specific limits are "hard" vs "soft" is a product decision made per-limit when each is defined in `BILLING.md`'s plan table (not yet fully specified — flag per limit as it's added).

## Alternatives considered

- Hard block on everything: rejected — usage limits like bookings/month fluctuate and blocking guest-facing booking creation over a billing technicality was judged too harsh a guest-facing failure mode.
- Soft warn only, never block: rejected — capacity limits like property count need a hard boundary or plan tiers lose meaning.
