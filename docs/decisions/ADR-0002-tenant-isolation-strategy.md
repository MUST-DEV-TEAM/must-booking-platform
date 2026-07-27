# ADR-0002: Tenant isolation strategy

Status: Proposed — **requires user decision before the first migration is written**
Date: 2026-07-27

## Context

Every domain table needs a tenant isolation approach decided before schema work starts, because migrating between approaches later is expensive and risky (see `TENANCY.md`). Options and tradeoffs:

1. **Shared schema + `tenant_id` + Postgres row-level security (RLS)** — one database, RLS policies enforce isolation at the database layer as a backstop even if application code has a bug. Simplest operationally; easiest for cross-tenant admin/support tooling and analytics.
2. **Schema-per-tenant** — strongest blast-radius isolation and simplest per-tenant export/delete, but heavier migration fan-out (every migration runs N times) and connection-pool complexity as tenant count grows.
3. **Hybrid** — shared schema + RLS by default, schema-per-tenant reserved for specific enterprise tenants with contractual isolation requirements.

## Recommendation (not yet accepted)

Option 1 (shared schema + RLS), with the hybrid escape hatch (option 3) kept open structurally (tenant_id design supports moving a tenant out later if ever contractually required). This is the common default for early-stage multi-tenant SaaS and matches the predecessor system's likely tenant volume (single-digit to low-hundreds of hotels, not thousands of high-isolation enterprises) — but confirm expected tenant count/profile before accepting.

## Decision

_Pending — confirm with the user, then update this section and set Status to Accepted._

## Consequences

_To be filled in once decided._
