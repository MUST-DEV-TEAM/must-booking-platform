# Milestone 1: Tenancy & Auth Core

Status: Not started
Depends on: Milestone 0; ADR-0002 (shared schema + RLS), ADR-0006 (multi-property from v1)

## Goal

Organization (tenant), Property, and User models exist in the database with Postgres RLS enforcing tenant isolation on every table from the first migration. Login works, RBAC roles from `docs/TENANCY.md` are enforced, and every API request carries a tenant context that RLS policies key off. Done means: two tenants' data provably cannot leak into each other's queries, proven by a test, not just by inspection.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. Core schema migration: `organizations`, `properties`, `users`, `memberships` (user↔tenant/property + role), all with `tenant_id`/`property_id` per `docs/TENANCY.md`.
2. Postgres RLS policies for every table above, plus the mechanism that sets the per-request tenant context (e.g. a session variable set per request) that policies key off.
3. Authentication: signup/login (email+password to start), session/JWT issuance, password reset.
4. Tenant-scoped request context middleware in `apps/api` — every request resolves `tenantId` (and `propertyId` where relevant) before reaching a handler.
5. RBAC roles per `docs/TENANCY.md` (platform admin, tenant owner/admin, property staff) enforced via guards/decorators in NestJS.
6. Staff invite flow (tenant owner invites a staff user, scoped to one or more properties).
7. Cross-tenant isolation test suite: attempt cross-tenant reads/writes and assert they fail, at both the RLS layer and the application layer.
8. Admin API surface for managing users/roles within a tenant (list/invite/remove/change role).
9. Email verification flow (ties into Milestone 2's signup, built here as the reusable primitive).
10. Audit logging for auth-sensitive actions (login, role change, invite) — minimal now, extensible later (Milestone 10 observability).

## Explicitly not included

- Self-serve signup UI/flow and Free-plan assignment (Milestone 2).
- Booking domain, billing (later milestones).

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
