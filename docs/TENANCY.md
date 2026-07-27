# Tenancy

## Model

```
Organization (tenant)
  └── Property / Hotel (one or more)
        └── Room types, rooms, rate plans, bookings, guests, PMS connections
  └── Users (staff, roles scoped to tenant, optionally scoped further to specific properties)
  └── Subscription (platform billing — see BILLING.md)
```

- A tenant is the billing unit and the top-level isolation boundary.
- A tenant operates one or more properties from v1 (**ADR-0006, accepted** — not deferred to a later phase); plan limits may cap property count (see `BILLING.md`, ADR-0007 for the exact shape).
- Every domain row, cache key, queue message, and stored credential is scoped by `tenant_id`, and by `property_id` where the entity is property-level (rooms, rates, bookings, PMS connections).
- Hosting region: EU now, with the isolation design expected to allow multi-region expansion later without a rewrite (**ADR-0004, accepted**).

## Isolation strategy — open decision (ADR-0002)

Candidates:

1. **Shared schema + row-level security (RLS)**: one Postgres database/schema, `tenant_id` on every table, Postgres RLS policies enforce isolation at the database layer regardless of application-layer bugs. Lower operational overhead, easier cross-tenant admin tooling, but a single logical database.
2. **Schema-per-tenant**: stronger blast-radius isolation and easier per-tenant backup/restore/export, but heavier migration fan-out and connection management as tenant count grows.
3. **Hybrid**: shared schema + RLS by default, with schema/database-per-tenant reserved for enterprise tenants with contractual data-isolation requirements.

This is a foundational, very-hard-to-reverse decision. The owner was asked directly on 2026-07-27 and **explicitly chose to leave it open** rather than pick a candidate now. It must be recorded as an ADR and resolved before the first migration is written — do not guess. See `decisions/ADR-0002-tenant-isolation-strategy.md`.

## Roles (initial draft, refine before auth implementation)

- **Platform admin** (MUST staff): cross-tenant support/ops access, no default access to guest PII.
- **Tenant owner/admin**: full access within their tenant, manages subscription and staff.
- **Property staff**: capability-gated access scoped to one or more properties within the tenant (mirrors the predecessor plugin's staff-portal capability model).
- **Guest**: no account; interacts only through the public booking widget and signed links (booking confirmation, cancellation), consistent with the predecessor system's model — no separate guest login area unless a future decision changes this.

## Non-goals for v1

- Cross-tenant data sharing or marketplace features.
- Guest single sign-on across tenants.
