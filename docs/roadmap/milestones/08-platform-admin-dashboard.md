# Milestone 8: Platform Admin Dashboard

Status: Not started
Depends on: Milestone 7 (Auth Pages — login, `/platform` placeholder route, component library); ADR-0020 (Platform Admin vs. Tenant dashboard routing); ADR-0021 (Platform Admin cross-tenant data access)

**Split out 2026-07-31** from what was originally planned as part of Milestone 11 (Platform Billing) — see ADR-0020's amendment. Originally the Platform Admin dashboard was folded into the billing milestone because both need cross-tenant data access; splitting it into its own, earlier milestone was a deliberate resequencing decision, not a technical requirement — per ADR-0021, Platform Admin's actual backend needs (`organizations`, `users`/memberships read access; two allowlisted write actions) don't depend on Milestone 9 (Tenant Dashboard) or Milestone 11 (Platform Billing) existing first.

## Goal

MUST's own internal team (not tenant staff) gets a working `/platform` dashboard: visibility into tenants/accounts across the whole platform, and the two allowlisted administrative actions ADR-0021 scoped — suspending/reactivating a tenant, and triggering a password-reset link for a locked-out tenant user. Done means: a `PLATFORM_ADMIN` account can log in (Milestone 7), land on `/platform`, see a list of tenants with basic status, and perform both allowlisted actions — all audit-logged, with no cross-tenant write bypass anywhere.

## Draft task areas (not final — define the real tasks at kickoff; task count is whatever the real scope needs, not fixed at 10)

1. RLS read carve-out (ADR-0021 decision 1): add the `current_setting('app.role', true) = 'platform_admin'` `OR` clause to the RLS policies on tables Platform Admin needs to see — at minimum `organizations`, `users`/memberships; the full table list is a kickoff decision scoped against the real dashboard screens below, not assumed here. Application middleware sets `app.role` per request once a session resolves to `PLATFORM_ADMIN`, the same way `app.tenant_id` is already set today (Milestone 1 Task 4's mechanism).
2. `organizations.status` field (ADR-0021's Consequences flagged this doesn't exist yet) — the concrete state a tenant is suspended/reactivated into. Migration + the state-transition logic itself.
3. Two allowlisted platform endpoints, each `@Roles(Role.PlatformAdmin)`-gated, each its own dedicated route (ADR-0021 decision 3 — no generic pass-through): `POST /platform/tenants/:tenantId/suspend` (+ reactivate), `POST /platform/tenants/:tenantId/users/:userId/reset-password`. Both reuse Milestone 1 Task 4's existing per-request `SET LOCAL app.tenant_id` write path scoped to the one named tenant — no bypass-RLS role or connection (ADR-0021 decision 2, and the history behind it: Milestone 1 Task 2 already removed a superuser/bypassrls runtime connection once, this must not reintroduce it).
4. Audit log actor-shape (ADR-0021 Consequences): extend Milestone 1 Task 10's audit log to distinguish "platform admin acting on tenant X" from a tenant's own self-service actions on the same log — every allowlisted write, and any read surfacing sensitive tenant data, gets logged with the platform admin as actor.
5. Tests: RLS carve-out gives `platform_admin` role cross-tenant SELECT and confirms it grants **no** write access anywhere not explicitly allowlisted (ADR-0021 Consequences, explicit negative-case test) — companion to the existing "no session vars ⇒ zero rows" tests.
6. `/platform` dashboard shell: tenant list view (basic identity/status), replacing Milestone 7's placeholder landing page.
7. Tenant detail view: enough to see the tenant's basic state and reach the suspend/reactivate and password-reset actions.
8. Suspend/reactivate action UI, wired to task 3's endpoint, audit-visible.
9. Password-reset-trigger action UI, wired to task 3's endpoint.
10. E2E test: `PLATFORM_ADMIN` account logs in, lands on `/platform`, sees cross-tenant tenant list, suspends a tenant, reactivates it, triggers a password reset for a tenant user — each step audit-logged with the platform admin as actor; a tenant-membership account attempting any `/platform` route or endpoint is rejected.

## Explicitly not included

- Subscription/billing state, dunning, plan enforcement — that's Milestone 11 (Platform Billing), unaffected by this split except that it no longer also needs to build the dashboard shell.
- A capability/template system for platform staff (ADR-0020 decision 4) — `PLATFORM_ADMIN` is the only platform role for now; a second role is new schema/guard work at that time, not pre-built here.
- Materialized/aggregate cross-tenant reporting (ADR-0021 decision 5) — stays as live RLS-carve-out `SELECT`s until an actual performance problem exists.
- Impersonation / "view as this tenant" — explicitly out of scope per ADR-0020's decision 2; a platform account can never also hold a tenant membership, and there is no "act as" mechanism.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
