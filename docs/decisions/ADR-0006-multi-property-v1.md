# ADR-0006: Multi-property tenants supported from v1

Status: Accepted
Date: 2026-07-27

## Context

`docs/TENANCY.md` and `docs/ARCHITECTURE.md` already drafted the tenant model as Organization → one-or-more Properties. This needed explicit owner confirmation before being load-bearing for the schema and billing plan design, rather than left as a draft assumption.

## Decision

A tenant may operate multiple properties starting from v1 — this is not deferred to a later phase.

## Consequences

- `tenant_id` and `property_id` are both present on property-scoped tables from the first migration (already the design in `TENANCY.md`/`ARCHITECTURE.md` — now confirmed, not assumed).
- Plan design (`BILLING.md`, ADR-0007 when decided) must account for "number of properties" as a real plan-tier/limit dimension from v1, not a v2 addition.
- Staff role scoping must support "all properties in tenant" vs. "specific properties" from v1 (already drafted in `TENANCY.md`'s roles section).
- Onboarding flow (ADR-0008 when decided) must support adding a second/third property to an existing tenant, not just a single-property signup wizard.

## Alternatives considered

- Single property per tenant for v1, multi-property later: rejected by the owner — multi-property is wanted from the start rather than retrofitted.
