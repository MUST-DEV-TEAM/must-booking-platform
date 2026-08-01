# ADR-0010: Dashboard tenant routing

Status: Accepted
Date: 2026-07-28

## Context

A single user can belong to more than one tenant — Milestone 1's `acceptExisting` staff-invite flow lets an existing user accept an invitation into a different organization, so this is a real scenario, not an edge case. Every property-scoped API route already requires an explicit `tenantId` in its path. Milestone 3's Task 1 (add a second/third property, per ADR-0006) surfaced that the dashboard (`apps/web`) had no equivalent concept: `/auth/session` returns only user identity/verification state, with no tenant list, no selected-tenant model, and no tenant-scoped dashboard route — so a new "create/list property" UI page had no reliable way to determine which tenant it was acting on for a multi-tenant user.

## Options

1. **Tenant ID in the dashboard URL** (e.g. `/dashboard/:tenantId/...`) — matches the API's own explicit-tenant-in-path convention already used everywhere; a tenant switcher/picker at `/dashboard` lists the user's memberships and links into each.
2. **Session-based selected tenant** — extend `/auth/session` with the user's memberships plus a "current" tenant (defaulting to first/most-recent), with a switch endpoint to change it; dashboard routes stay tenant-agnostic and read the current tenant server-side.

## Decision

Option 1: the tenant ID lives in the dashboard URL (`/dashboard/:tenantId/...`), not in server-side session state.

Accepted by the owner on 2026-07-28.

## Consequences

- Every tenant-scoped dashboard page under `apps/web` is namespaced by `tenantId` in its route, mirroring the API's path convention.
- `/dashboard` (no tenant ID) is a tenant picker: it lists the caller's tenant memberships (from a session/membership-list endpoint) and links into `/dashboard/:tenantId/...` for each.
- No "current tenant" server-side state is introduced — multiple browser tabs can safely operate on different tenants simultaneously without desyncing each other.
- Every dashboard page/component built from Milestone 3 onward (including Milestone 8's admin dashboard) must read `tenantId` from the route, not assume a single implicit tenant.
- `/auth/session` does not need a "current tenant" field for this purpose; it may still need a memberships list for the picker page, decided at whichever milestone builds that page in full (Milestone 3 needs at least enough to build the picker for its own add-property UI).

## Alternatives considered

- Session-based selected tenant (option 2 above): rejected — the cross-tab desync risk (switching tenant in one tab silently changing what another tab operates on) was judged worse than the minor URL-verbosity cost of option 1.
