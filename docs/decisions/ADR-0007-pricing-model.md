# ADR-0007: Pricing model shape

Status: Proposed — **explicitly left open by the owner on 2026-07-27**
Date: 2026-07-27

## Context

Options presented were: flat tiered plans (Starter/Growth/Enterprise) with fixed limits, per-property metered pricing, or usage-based pricing (e.g. per booking/month). This shapes the billing schema and plan-limit design in `BILLING.md` and interacts with ADR-0003 (billing provider) and ADR-0005 (limit enforcement, already accepted).

## Options

1. **Flat tiered plans** — simplest to build and to explain to customers; fixed limits per tier.
2. **Per-property metered** — price scales with number of connected properties; natural fit given ADR-0006 (multi-property from v1).
3. **Usage-based** (e.g. per booking/month) — fairest across very different hotel sizes, but requires a metering pipeline and more complex invoicing.

## Decision

_Left open — the owner was asked directly and chose not to decide yet. Do not design the billing database schema or Stripe product/price catalog until this is resolved. Re-raise before Phase 3 (platform billing) starts, and no later than ADR-0003._

## Consequences

_To be filled in once decided._
