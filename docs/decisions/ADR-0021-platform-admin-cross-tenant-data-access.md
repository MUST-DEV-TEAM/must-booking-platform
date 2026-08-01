# ADR-0021: Platform Admin cross-tenant data access — narrow read carve-out, no write bypass

Status: Accepted — mechanism unchanged; [ADR-0023](ADR-0023-platform-admin-dashboard-resequencing.md) moved which milestone implements it (was "Milestone 9" throughout this document, now Milestone 8)
Date: 2026-07-31

## Context

ADR-0020 established that a Platform Admin dashboard exists (`/platform`, single `PLATFORM_ADMIN` role, folded into Milestone 9), routed separately from the tenant dashboard. It did not settle how platform-admin requests actually read or write data, given ADR-0002's tenant isolation strategy: shared schema + Postgres RLS, enforced via a per-request `SET LOCAL app.tenant_id` (Milestone 1 Task 4), deny-by-default when no tenant context is set (Milestone 1 Task 2). Platform Admin, by definition, has no single tenant context — nothing in the RLS policies or the DB connection layer currently accounts for that caller shape.

This matters more than an ordinary implementation detail because of a specific piece of history: Milestone 1 Task 2's review found that the app's runtime `DATABASE_URL` connected as a superuser/bypassrls Postgres role, meaning RLS was proven only by a dedicated test role, not actually enforced for the app itself — and fixed it by creating a dedicated non-superuser, non-bypassrls role for the app's runtime connection. Any design for platform-wide access that reintroduces a bypass role or connection would be walking back that fix.

The owner scoped what Platform Admin actually needs, which is materially narrower than general cross-tenant CRUD: read-only oversight/visibility into tenant data, plus a small number of specific administrative actions — suspending a tenant/account, and support actions such as triggering a password reset for a tenant user who's locked out.

## Decision

1. **Reads: a narrow, SELECT-only RLS carve-out — no bypass role, no new connection.** Tables Platform Admin needs visibility into get an additional policy clause alongside the existing tenant clause, e.g. `USING (tenant_id = current_setting('app.tenant_id')::uuid OR current_setting('app.role', true) = 'platform_admin')`, evaluated for the same non-superuser, non-bypassrls application role from Milestone 1 Task 2. Application middleware sets `app.role` per request once a session resolves to `PLATFORM_ADMIN`, the same way `app.tenant_id` is already set today.
2. **Writes: no carve-out, no bypass — every platform-initiated write still targets exactly one named tenant** and reuses Milestone 1 Task 4's existing per-request tenant-context mechanism (`SET LOCAL app.tenant_id` scoped to that one target), reached via a `PLATFORM_ADMIN`-gated route instead of a tenant-membership-gated one. There is no cross-tenant write path, because none of the scoped use cases need one.
3. **Explicit allowlist of platform actions, not general write access.** To start: "suspend/reactivate a tenant" and "trigger a password-reset link for a tenant user," each its own dedicated endpoint/service method (e.g. `POST /platform/tenants/:tenantId/suspend`, `POST /platform/tenants/:tenantId/users/:userId/reset-password`). No generic "act as any tenant API" pass-through is built; a new platform capability means a new allowlisted endpoint and an explicit decision, not a broadened permission.
4. **Every platform-initiated action is audit-logged with the platform admin as actor**, extending Milestone 1 Task 10's audit log — both the allowlisted writes and any read that surfaces sensitive tenant data — distinguishable from a tenant's own self-service actions on the same log.
5. **No materialized/aggregate reporting layer is built now.** Cross-tenant analytics (e.g. MRR or occupancy rollups across all tenants) stay as live, RLS-carve-out SELECTs against primary tables until that's an actual performance problem — not built ahead of need.

## Consequences

- RLS policies on the tables Platform Admin needs to see (at minimum `organizations`, `users`/memberships; others scoped at Milestone 9 kickoff against real dashboard screens) need a migration adding the platform clause. Existing "no session vars ⇒ zero rows" tests need a companion test asserting "platform_admin role ⇒ visible across tenants, SELECT only" — and, just as important, a test that platform role grants **no** write access anywhere it isn't explicitly allowlisted.
- No change to the app's runtime DB connection/role — it stays the non-superuser, non-bypassrls role from Milestone 1 Task 2. This ADR does not reopen that decision, it depends on it.
- Suspending a tenant needs a concrete field/state to suspend (e.g. `organizations.status`), which doesn't exist in the schema yet — a small schema task for whichever Milestone 9 task implements it, not decided here.
- The audit log likely needs an explicit "actor outside the target tenant" shape (platform admin acting on tenant X) if Milestone 1 Task 10's schema doesn't already support that distinction — to be confirmed, not assumed, when Milestone 9 implements this.
- Milestone 9 kickoff should treat the specific list of tables needing the read carve-out, and any additional allowlisted actions beyond the two named here, as kickoff decisions scoped against real dashboard screens — this ADR fixes the *mechanism*, not the full inventory.

## Alternatives considered

- **Bypass-RLS connection/role dedicated to platform routes**: rejected — reintroduces exactly the risk Milestone 1 Task 2's review removed from the app's runtime connection, for a feature that doesn't need it once writes are scoped per-target-tenant and reads use a narrow carve-out instead.
- **Generic pass-through letting Platform Admin call any existing tenant-scoped API as if it were tenant staff**: rejected — no allowlist discipline, makes audit trails ambiguous (tenant actor vs. MUST staff actor), and silently grows platform admin's blast radius every time a new tenant-facing endpoint is added, rather than by deliberate decision.
- **Materialized/read-replica reporting layer built now, ahead of need**: rejected for now — real infrastructure and staleness tradeoffs before there's a concrete tenant-count/performance driver; the narrow RLS carve-out is sufficient at current and near-term scale.
