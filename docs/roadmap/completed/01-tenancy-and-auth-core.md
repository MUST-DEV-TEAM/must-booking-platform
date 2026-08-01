# Milestone 1: Tenancy & Auth Core

Status: Done
Depends on: Milestone 0; ADR-0002 (shared schema + RLS), ADR-0006 (multi-property from v1)

## Kickoff decisions (2026-07-27)

- Auth mechanism: **Redis-backed server-side sessions** (opaque session ID in an httpOnly cookie), not JWT — chosen for instant revocation (logout everywhere, role change) using the Redis instance already in the stack.
- Tenant/property RLS context mechanism (the detail ADR-0002 left open for this milestone): a **request-scoped Postgres transaction** wrapper that runs `SET LOCAL app.tenant_id` (and `app.property_id` where applicable) before any query in the request; RLS policies key off `current_setting('app.tenant_id')`/`current_setting('app.property_id')`. This is enforced even if application code forgets a `WHERE` clause.
- Role model: **Tenant Owner** and **Tenant Admin** are distinct roles — Owner is unique per tenant, has full access including billing and cannot be removed by anyone else; Admin has staff/property management access but not billing and cannot remove the Owner.
- Property Staff is a **capability-based** model, not a fixed role, refining `TENANCY.md`'s draft:
  - A fixed (extensible) set of granular **capabilities** (e.g. `staff.invite`, `staff.manage_permissions`, `settings.manage`, `reports.view`, `guests.manage`).
  - Seeded **built-in role templates**: "Property Manager" (broad capability set) and "Front Desk" (narrow, operational set).
  - Tenant Owner/Admin can create **custom role templates** with a hand-picked capability set.
  - Any individual staff assignment (built-in or custom template) can be granted **capability overrides** beyond its template, by Tenant Owner or Tenant Admin.
  - Every grant/override is audit-logged (Task 10).

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
10. Audit logging for auth-sensitive actions (login, role change, invite) — minimal now, extensible later (Milestone 11 observability).

## Explicitly not included

- Self-serve signup UI/flow and Free-plan assignment (Milestone 2).
- Booking domain, billing (later milestones).

## Tasks

| # | Task | Acceptance criteria | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | Core schema migration: `organizations`, `properties`, `users`, `tenant_memberships` (role: owner/admin), `property_staff_assignments`, `capabilities`, `property_role_templates` (seeded: Property Manager, Front Desk) — all with `tenant_id`/`property_id` per `docs/TENANCY.md`. | Migration applies cleanly with Prisma against the Docker-Compose Postgres; every property-scoped table carries both `tenant_id` and `property_id`. | Done | `13c52fa` |
| 2 | Postgres RLS policies for every table from Task 1, plus the request-scoped transaction mechanism that sets `app.tenant_id`/`app.property_id` via `SET LOCAL` before any query. **Required follow-up found in review, must land before Task 3:** (a) the app's actual runtime `DATABASE_URL` currently connects as `must_booking`, which is `SUPERUSER`/`BYPASSRLS` — RLS is proven only by the test's dedicated role, not enforced for the app itself; create a dedicated non-superuser, non-bypassrls Postgres role with the necessary grants (SELECT/INSERT/UPDATE/DELETE) for the app's runtime connection, update `apps/api/.env.example` (and `README`/`CONTRIBUTING.md` if they document the connection string) accordingly, and keep `must_booking` reserved for running migrations only. (b) the `users_deny_insert` policy (`WITH CHECK (false)`) unconditionally blocks every insert into `users` for any non-superuser role, including a correctly-scoped one — confirmed by direct test, this would block Task 3's signup entirely; `users` carries no tenant dimension to check on insert (the real tenant-scoped protection is `tenant_memberships`/`property_staff_assignments`), so replace it with a policy that allows insert (e.g. `WITH CHECK (true)`), not a blanket deny. **Second required follow-up found in review (2026-07-27), must land before Task 3:** `must_booking_app` has no DDL privilege on schema `public` (confirmed by direct test: `CREATE TABLE` and `prisma migrate deploy` both fail with `permission denied for schema public` once `DATABASE_URL` points at it), but `.env.example`/`CONTRIBUTING.md` now point the default `DATABASE_URL` at `must_booking_app` — so any future migration will fail for a contributor following `CONTRIBUTING.md` as written. Fix: add `directUrl` to the `datasource db` block in `schema.prisma` (`url = env("DATABASE_URL")` for the app/Prisma Client, `directUrl = env("MIGRATION_DATABASE_URL")` for `prisma migrate *`, pointing at `must_booking`). Add `MIGRATION_DATABASE_URL` to `.env.example` and update `CONTRIBUTING.md`'s migration step accordingly — no manual env override should be needed in docs or scripts. | Every table has an RLS policy; a query run without the session variables set returns zero rows (deny-by-default), proven by a test; the app's own runtime connection (not just the test role) is non-superuser/non-bypassrls; a non-superuser, correctly-scoped role can insert a new `users` row; `pnpm --filter api prisma migrate dev` succeeds using only the committed `.env.example` values (both vars), with no manual `DATABASE_URL` override. | Done | `13c52fa` |
| 3 | Authentication primitives: signup/login (email+password), Redis-backed session issuance/invalidation (logout), password reset, email verification (reusable primitive for Milestone 2's signup). Note confirmed at review: `signup` creates only a `users` row, no `Organization`/`tenant_membership` — full org-creation + Free-plan assignment is Milestone 2's job; Task 4+ test fixtures must seed a tenant/membership directly (as Tasks 1-2 already do), not rely on signup for that. | Endpoints work end-to-end; passwords hashed (bcrypt/argon2) and never logged; sessions invalidate on logout. | Done | `13c52fa` |
| 4 | Tenant-scoped request context middleware/guard in `apps/api` — every authenticated request resolves `tenantId` (and `propertyId` where the route is property-scoped) before reaching a handler. Note confirmed at review: the guard checks tenant membership and that the property belongs to the tenant, but not per-user property-staff assignment — that finer check is explicitly Task 5/6's job (Owner/Admin should reach any property in their tenant; Property Staff's per-property restriction is a capability-guard concern). | A request with no valid session, or scoped to a different tenant/property than the resource path, is rejected (401/403) before any DB query runs. | Done | `13c52fa` |
| 5 | RBAC guards/decorators for the top-level roles (Platform Admin, Tenant Owner, Tenant Admin, Property Staff). | A `@Roles(...)` guard enforces role checks at the route level; a test proves a Tenant Admin cannot reach an Owner-only endpoint. | Done | `13c52fa` |
| 6 | Property-staff capability system: seeded built-in role templates (Property Manager, Front Desk), custom role templates (created by Owner/Admin), per-staff capability overrides, and a `@RequiresCapability(...)` guard checking effective capabilities (template ∪ overrides). Note: Task 1's schema scopes `property_role_templates` per-property (not tenant-wide), so this task must include a reusable "ensure built-in templates exist for this property" step (called from test fixtures now; wired to real property-creation once that exists in Milestone 3). | A Front-Desk-assigned staff member is denied a Manager-only capability until granted an override; granting the override immediately allows it; a newly created property automatically gets its two built-in templates seeded. | Done | `13c52fa` |
| 7 | Staff invite flow: Tenant Owner/Admin invites a user by email, assigns them to one or more properties with a role template (built-in or custom) and optional initial capability overrides. | Invited user completes activation and has exactly the assigned access, no more, no less. | Done | `13c52fa` |
| 8 | Cross-tenant and cross-property isolation test suite. | Automated tests attempt cross-tenant reads/writes and cross-property access beyond a staff member's assigned properties/capabilities; all fail at both the RLS layer and the application layer. | Done | `13c52fa` |
| 9 | Admin API surface: list/invite/remove/change-role for tenant memberships; list/assign/change-role/grant-or-revoke-capability for property-staff assignments. | All endpoints are scoped to the caller's own tenant and gated by the RBAC/capability guards from Tasks 5-6. | Done | `13c52fa` |
| 10 | Audit logging for auth-sensitive actions: login, logout, role change, staff invite, capability grant/revoke. | Each action produces a durable audit log entry (actor, action, target, timestamp, tenant/property context); a basic read path exists to query a tenant's audit log. | Done | `13c52fa` |
