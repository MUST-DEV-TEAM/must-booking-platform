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

## Isolation strategy — decided (ADR-0002)

Shared schema + `tenant_id` + Postgres row-level security (RLS) as the default, with a structural hybrid escape hatch: a specific tenant can be moved to a dedicated schema/database later if a contractual enterprise isolation requirement ever demands it, without that being the default path. RLS is a backstop, not a substitute for explicit tenant scoping in application queries. See `decisions/ADR-0002-tenant-isolation-strategy.md` for full consequences, including how this interacts with ADR-0004's EU-now/multi-region-later hosting.

## Roles (initial draft, refine before auth implementation)

- **Platform admin** (MUST staff): cross-tenant support/ops access, no default access to guest PII.
- **Tenant owner/admin**: full access within their tenant, manages subscription and staff.
- **Property staff**: capability-gated access scoped to one or more properties within the tenant (mirrors the predecessor plugin's staff-portal capability model).
- **Guest**: no account; interacts only through the public booking widget and signed links (booking confirmation, cancellation), consistent with the predecessor system's model — no separate guest login area unless a future decision changes this.

## Audit context

Sensitive tenant actions are retained in the tenant-scoped audit log with actor, action, target, timestamp, and optional property context. Authentication login/logout events are retained as global audit rows because a user can authenticate before belonging to a tenant; they are not exposed by a tenant's audit-log read path.

Self-serve signup records `tenant.created` for the new organization and `property.created` for its first property in that tenant-scoped log. Both entries identify the new Owner as actor; the property event carries its property context.

## Non-goals for v1

- Cross-tenant data sharing or marketplace features.
- Guest single sign-on across tenants.
