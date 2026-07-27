# ADR-0002: Tenant isolation strategy

Status: Accepted
Date: 2026-07-27

## Context

Every domain table needs a tenant isolation approach decided before schema work starts, because migrating between approaches later is expensive and risky (see `TENANCY.md`). Options and tradeoffs:

1. **Shared schema + `tenant_id` + Postgres row-level security (RLS)** — one database, RLS policies enforce isolation at the database layer as a backstop even if application code has a bug. Simplest operationally; easiest for cross-tenant admin/support tooling and analytics.
2. **Schema-per-tenant** — strongest blast-radius isolation and simplest per-tenant export/delete, but heavier migration fan-out (every migration runs N times) and connection-pool complexity as tenant count grows.
3. **Hybrid** — shared schema + RLS by default, schema-per-tenant reserved for specific enterprise tenants with contractual isolation requirements.

## Decision

Option 1 (shared schema + `tenant_id` + Postgres RLS) as the default, with option 3's hybrid escape hatch kept structurally open: the schema is designed so a specific tenant could be moved to a dedicated schema/database later if a contractual enterprise isolation requirement ever demands it, without that being the default path for every tenant.

Accepted by the owner on 2026-07-27, following the recommendation above.

## Consequences

- Every domain table gets `tenant_id` from its first migration, plus a Postgres RLS policy scoping all reads/writes to the request's tenant context. RLS is a backstop — application code must still scope queries by tenant explicitly; RLS is not a substitute for that discipline, only a second line of defense.
- Connection/session must set the tenant context (e.g. a session variable RLS policies reference) on every request — this needs a concrete mechanism decided during the tenant+auth skeleton implementation (Phase 0), not left implicit.
- No per-tenant schema/database is provisioned by default. If a future enterprise tenant contractually requires dedicated isolation, that is a deliberate, explicit migration for that one tenant — not a change to the default architecture.
- Consistent with ADR-0004 (EU now, multi-region-later): a single shared schema per region is assumed; a future multi-region expansion would replicate this shared-schema-per-region pattern rather than requiring per-tenant schemas.
