# Milestone 30: Permissions (RBAC) — replace hardcoded role checks with a permission model

Status: **Planned — designed 2026-10-28, nothing implemented, nothing dispatched.** Number 30 chosen because 25-29 are taken (25 Native PMS, 26 Public API, 27-28 release gates, 29 currency).
Runs as an authorized ad hoc track. It does not renumber the main sequence.

## Why

On 2026-10-28 the Empire Beach Resort manager needed access to Settings. That was impossible with the permissions we had, even though a `settings.manage` capability exists and the built-in "Property Manager" template holds it. Two layers disagreed and the stricter, hardcoded one always won. The manager was promoted to ADMIN in the live database as a stop-gap (membership `b2f51290-d68e-4638-ac6d-57b30025c4f0`, `iliamati022@gmail.com`); that gives him **everything** owner/admin has, which is more than intended. This milestone removes the need for such stop-gaps.

## Current state (verified in code 2026-10-28)

| Layer | What it does today | Problem |
| --- | --- | --- |
| `@Roles(...)` / `RolesGuard` | Reads `tenant_memberships.role` (OWNER/ADMIN/STAFF) and `property_staff_assignments` on every request | Hardcoded. 100+ call sites. STAFF can never reach anything marked `TenantOwner, TenantAdmin` |
| `@RequiresCapability(...)` / `CapabilitiesGuard` | Looks up `capabilities` rows. OWNER/ADMIN get all keys; STAFF get template grants overridden by per-user grant/revoke rows | Real data model, but only 10 keys, and every controller that uses it **also** has `@Roles`, so the capability can never widen access |
| Web `ownerAdminOnlySections` ([dashboard-shell.tsx:157](../../../apps/web/app/dashboard/dashboard-shell.tsx)) | Hardcoded set that hides Accommodations, Rates & Pricing, Inventory, Staff, Settings from STAFF regardless of capabilities | Third, separate copy of the rules; must be edited by hand to match the API |
| Roles guard vs capability guard | Two DB transactions per request to answer one question | Wasteful and a place for the two answers to drift |

Endpoints with `@Roles` and **no** capability at all (owner/admin only, not delegable): room types, rooms, amenities, rate plans, property image library, WordPress pairing, availability writes (blocks / stop-sale), property create/delete, notifications/overview (any assigned staff).

Other findings that shape the design:

- The seeded "Property Manager" template gets "all capabilities **that exist at seed time**" ([property-role-templates.service.ts:117-127](../../../apps/api/src/tenancy/property-role-templates.service.ts)). New capability keys added later are not added to existing templates, so a catalogue change needs an explicit sync step.
- Audit log viewing is gated by `staff.manage_permissions`, which conflates two different rights.
- Role and capability are evaluated from the database on **every request** (not cached in the session), so a role change takes effect immediately; only the web's `capabilities/mine` snapshot can be stale until the page reloads.
- Platform admins are a separate system (`is_platform_admin`, ADR-0021). Out of scope; they stay as is.

## Target design (industry-standard RBAC)

Reference points: NIST/ANSI RBAC (INCITS 359), OWASP ASVS V4 (access control) and the OWASP Authorization Cheat Sheet. The key principles and how each lands here:

1. **Deny by default, enforced centrally.** Every tenant-scoped route must declare either a permission or an explicit marker (`@AnyMember`, `@Public`). A test fails the build if a route has neither. This replaces "forgot the decorator = open".
2. **Check permissions, never roles, in business code.** Roles become named bundles of permissions. `@RequiresPermission('rates.manage')` is the only access decorator; `@Roles` is removed (platform-admin routes keep their own guard).
3. **Permission = `resource.action`, one catalogue in code.** The catalogue (key, description, scope, sensitivity, group) lives in one typed module and is synced into the `capabilities` table per tenant. Existing keys are kept for compatibility.
4. **Roles are data.** Owner and Admin become **system roles** (fixed, not editable): Owner = everything, Admin = everything except owner-only rights. Property roles (Property Manager, Front Desk, Finance, plus custom) remain per-property templates the owner can edit.
5. **Two scopes.** *Tenant-level* permissions (create/delete property, billing, tenant staff) versus *property-level* permissions (everything operational). A user can hold different roles at different properties (already supported by `property_staff_assignments`).
6. **Least privilege and separation of duties.** Money-moving and credential-touching rights are separate, individually grantable permissions (refund, record manual payment, view vs manage integration credentials).
7. **No privilege escalation.** A user can only grant permissions they hold themselves; cannot change their own role or overrides; cannot modify an Owner; the last Owner cannot be demoted or removed; ownership transfer is an explicit action.
8. **One resolution path, once per request.** A single `PermissionsService.effective()` result is computed once and attached to the request; guards, services and `/permissions/mine` all read it. This removes the double transaction.
9. **The UI mirrors, never decides.** The web asks the server for the effective permission set and shows/hides navigation and actions from it with one `can()` helper. The hardcoded section sets go away. API enforcement is the only real control.
10. **Everything auditable.** Role assignment, override, custom-role edit, invite and ownership changes write audit entries with before/after. Viewing the audit log gets its own `audit.view` permission.
11. **Tested as a matrix.** A generated test walks every route's declared permission and asserts each built-in role gets the expected allow/deny, so the role-to-permission mapping is reviewable as a table and cannot silently drift.

## Proposed permission catalogue (to be confirmed in Task 1)

Existing keys are marked *(exists)*. Everything else is new.

| Group | Keys |
| --- | --- |
| Bookings | `bookings.view`, `bookings.manage` *(exists)*, `bookings.cancel` |
| Payments | `payments.view`, `payments.record_manual`, `payments.refund` *(exists)* |
| Guests | `guests.view`, `guests.manage` *(exists)*, `guests.merge` |
| Calendar & inventory | `calendar.view` *(exists)*, `calendar.manage` (blocks, stop-sale, availability edits) |
| Accommodations | `accommodations.view`, `accommodations.manage` *(exists)* (room types, rooms, amenities, photos) |
| Rates | `rates.view`, `rates.manage` *(exists)* |
| Reports | `reports.view` *(exists)*, `reports.export` |
| Property settings | `settings.view`, `settings.manage` *(exists)*, `policies.manage` (cancellation policies) |
| Integrations | `integrations.view`, `integrations.manage` (credentials, PMS/payment connections, Clock sync, rate ranking), `website.manage` (WordPress pairing) |
| Staff | `staff.view`, `staff.invite` *(exists)*, `staff.manage_permissions` *(exists)*, `staff.remove`, `roles.manage` (create/edit custom roles) |
| Audit | `audit.view` |
| Tenant-level | `properties.create`, `properties.delete`, `billing.manage`, `ownership.transfer` (owner-only, never delegable) |

Open owner decision (not an assumption): the default role-to-permission mapping. See Task 9; a draft table is deliberately **not** pre-filled here.

## Rollout strategy (no big-bang)

Three phases so production behavior never changes silently:

1. **Add** the catalogue, sync and `PermissionsGuard` alongside the old guards. No behavior change.
2. **Dual-check**: migrate controllers one group at a time to `@RequiresPermission`, keeping behavior identical for the existing roles (Owner/Admin all, STAFF only what their template grants). Each group ships with its matrix test.
3. **Remove** `@Roles`, `RolesGuard` tenant branch and the web `ownerAdminOnlySections`; only then expose the new delegation (e.g. Settings for a manager) and update live roles.

## Tasks

Each task is one reviewable unit. Statuses use the roadmap vocabulary. Nothing is dispatched.

| # | Task | Output / acceptance | Status |
| --- | --- | --- | --- |
| 1 | **ADR-0032 + final catalogue.** Record the design above as an ADR; confirm the permission catalogue and which keys are tenant-level vs property-level and which are owner-only | ADR merged; catalogue table final; owner has approved key names | Planned |
| 2 | **Catalogue module + sync.** Typed catalogue in code; idempotent sync into `capabilities` for every tenant (migration + on-property-create); sync also fills **existing** Property Manager templates with newly added keys; add `scope`/`group` columns if needed | Migration safe to re-run; test proves a new key reaches existing tenants and Property Manager templates; no role loses an existing permission | Planned |
| 3 | **`PermissionsService` + `PermissionsGuard`.** One `effective()` resolution per request (cached on the request); `@RequiresPermission`, `@AnyMember`; `GET .../permissions/mine` (keep `capabilities/mine` as alias) | Single DB round trip for resolution; unit + integration tests for OWNER, ADMIN, STAFF with/without assignment, override grant and revoke | Planned |
| 4 | **Deny-by-default coverage test.** Test walks all Nest routes and fails if a tenant-scoped route has no permission or explicit marker | Test red on a deliberately undecorated route; green on the tree | Planned |
| 5 | **Migrate controllers, group A: tenancy catalogue** (properties, room types, rooms, amenities, image library, rate plans, cancellation policies, availability writes, WordPress pairing) from `@Roles` to `@RequiresPermission` | Identical behavior for existing roles proven by the matrix test; each handler maps to a catalogue key | Planned |
| 6 | **Migrate controllers, group B: operations** (bookings, staff booking, manual payment, refund, ledger, guests, notifications, overview, reports, audit log) | As above; audit log moves from `staff.manage_permissions` to `audit.view` | Planned |
| 7 | **Migrate controllers, group C: integrations and staff** (integration connections, Clock sync, rate ranking, admin-staff, staff-invite); split credentials (`integrations.manage`) from read (`integrations.view`) | As above; secrets never returned to holders of view-only | Planned |
| 8 | **Escalation and ownership safeguards.** Grant-only-what-you-hold; no self role/override change; Owner immutable; last-Owner protection; explicit ownership transfer; audit entries with before/after for every permission/role/invite change | Integration tests for each rule including the concurrent last-owner race | Planned |
| 9 | **Role-to-permission mapping (owner decision).** Owner reviews the generated matrix and sets defaults for Admin, Property Manager, Front Desk, Finance; seed and migrate; document in the user-facing docs | Owner-approved table committed; migration applied to tenants without removing any currently held right | Planned — **needs owner input** |
| 10 | **Web: remove hardcoded gating.** `usePermissions()` / `can()` driven by `permissions/mine`; delete `ownerAdminOnlySections` and per-section capability lists; actions (refund, delete, edit) also gated | Nav and buttons match the server for every built-in role; browser test per role; stale-permission refresh on 403 | Planned |
| 11 | **Web: role and access management UI.** Custom role editor (permission matrix grouped by resource), assign role per user per property, per-user override, "effective access" preview, invite with role | Uses `components/ui` per the components-only rule; owner can reproduce the Empire manager case (Settings without Staff) without a code change | Planned |
| 12 | **Remove legacy.** Delete `@Roles` (tenant use), `RolesGuard` tenant branch, `Role.PropertyStaff`/`TenantOwner`/`TenantAdmin` usage, duplicated tests; keep platform-admin guard | Grep shows no tenant `@Roles`; full suite green | Planned |
| 13 | **Live rollout and stop-gap cleanup.** Deploy, then move the Empire manager from ADMIN back to STAFF with the agreed role; verify on the live host | Manager can use exactly what was decided; before/after recorded in docs | Planned |
| 14 | **Docs.** Update [data-and-access](../../architecture/data-and-access.md) and the roadmap; document the catalogue and how to add a permission (one place, one test) | Docs match behavior; "how to add a permission" checklist exists | Planned |

## Verification expectations

Run the full API suite and the web suite, not a subset (cross-cutting guard changes can break files nobody touched). Integration tests must run against real Postgres with RLS, since permission resolution reads RLS-protected tables. A source-text assertion is not proof; every migrated route needs a behavioral allow/deny test for each built-in role.

## Out of scope

Platform-admin authorization (ADR-0021), attribute-based or per-record rules (e.g. "only bookings I created"), SSO/SCIM role mapping, time-boxed access. Revisit only if a customer needs them.

## Stop-gap currently live (remove in Task 13)

`iliamati022@gmail.com` (Empire Beach Resort) is ADMIN as of 2026-10-28. Revert target: STAFF with the role decided in Task 9.
