# Milestone 24 — Platform admin console, Phase 1 (plan)

Owner: Astra plans, Claude implements and verifies. Branch `claude/platform-admin` (worktree `Must-Booking-platform`). This is the **ground-zero console for MUST Group staff** at `/platform`. It is not the hotel dashboard and not the owner's all-hotels view (D5, S41). Phase 2 (health and integrations, Page 20) and Phase 3 (notes, timeline, tasks) are separate.

## Findings from the code before building (verified 2026-10-19)

- **Hotel suspension is not enforced anywhere today.** `organizations.status` (ACTIVE/SUSPENDED) is written by `platform-admin.service.ts` and read only by the platform list; no guard, login or public-booking path checks it. Phase 1 adds the enforcement (see Lifecycle effects).
- Platform identity today is `users.is_platform_admin` with the hotel session cookie `must_session`; there are no roles beyond that flag, and `RolesGuard` resolves it. Platform audit rows are `audit_logs` rows with `actor_type = PLATFORM_ADMIN` (no FK on `actor_user_id`).
- Sessions are Redis keys `auth:session:<uuid>` (7 days); login throttling is a Redis counter keyed by email; there is no CSRF token anywhere (cookie is `SameSite=Lax`).
- The staff invite service only creates `STAFF` memberships; an owner invitation needs a small additive option.

## Scope (Phase 1)

1. Separate **platform accounts** (own table, login route, cookie, rate limit, sessions), four capability-based roles, team management.
2. **Platform audit log**, append-only, searchable, exportable.
3. **Hotel lifecycle** (Trial, Active, Past due, Suspended, Cancelled, Archived) with reasons, history, tested effects.
4. **Guided onboarding** (create hotel, invite owner, computed checklist).
5. **Hotel directory and detail** (Overview and lifecycle, Connections, Staff and usage).
6. **Support access**: view-as (reason, time-limited, read-only), act-as (approval, limited capability set), banners, owner visibility.
7. Rebuilt web screens on the shared component set.

Not in Phase 1 (listed again under Gaps): health scores, integration diagnostics, notes/timeline/tasks, billing and plan changes (Milestone 15), custom platform roles UI, mandatory two-factor.

## Decisions (owner, do not re-litigate)

Separate platform accounts; four roles; basic console security now with a written hardening gap list; append-only platform audit; additive lifecycle; view-as first, act-as with approval; components only; both hotel modes everywhere.

## Data model (all migrations `20261020…` or later, additive, re-runnable)

Platform-global tables have **no `tenant_id`** and are not reachable through tenant RLS. They are protected by (a) no tenant policy granting the hotel session role anything, (b) the `PlatformAccessGuard` + per-route capability on every platform route, and (c) `FORCE ROW LEVEL SECURITY` with a policy that only opens for `app.role = 'platform_console'`, set by a new `withPlatformConsoleTransaction`. Tenant-scoped tables get ordinary forced RLS.

| Table | Purpose |
| --- | --- |
| `platform_accounts` | id, email (unique, lower-cased), first/last name, `password_hash`, `role_id`, `status` (INVITED, ACTIVE, SUSPENDED), `last_login_at`, `failed_attempts`-free (throttle is in Redis), `created_by`, timestamps, `version` |
| `platform_roles` | id, `key` (super_admin, operations, finance, auditor, or custom later), name, description, `is_built_in`, `capabilities text[]`. Custom roles later = more rows, no code change |
| `platform_sessions` | id, `token_hash` (sha-256, the cookie holds the raw token), account, created/last_seen/expires (absolute 12 h, idle 2 h), `revoked_at`, ip, user agent. Logout, "logout everywhere", suspend and role change revoke rows |
| `platform_invitations` | id, email, role, token hash, expires (7 days), accepted/revoked, invited_by |
| `platform_audit_log` | append-only (see below) |
| `organizations` (additive columns) | `lifecycle_state`, `lifecycle_reason`, `lifecycle_changed_at`, `lifecycle_version`, `country`, `time_zone`, `currency`, `onboarding_mode` (CLOCK / MUST_SOURCE), `created_by_platform_account_id` |
| `organization_lifecycle_events` | tenant-scoped history: from, to, reason, actor account, created_at. Forced RLS, insert-only |
| `support_sessions` | tenant-scoped: kind VIEW/ACT, status PENDING_APPROVAL / ACTIVE / EXPIRED / REVOKED / DENIED, reason, account, token hash, `expires_at`, approval fields. Partial unique index: one open (PENDING or ACTIVE) session per account per hotel |
| `platform_idempotency_keys` | account, key, request hash, response, created_at (replays return the stored response) |

### Capability catalog (`platform.*`, enforced on every route, fail closed)

`platform.hotels.view`, `platform.hotels.create`, `platform.hotels.lifecycle` , `platform.hotels.dangerous` (cancel, archive), `platform.connections.view`, `platform.integrations.manage` (Phase 2), `platform.billing.view`, `platform.billing.manage` (placeholder), `platform.support.view_as`, `platform.support.act_as`, `platform.support.approve`, `platform.team.view`, `platform.team.manage`, `platform.audit.view`, `platform.audit.export`.

| Role | Capabilities |
| --- | --- |
| Super admin | all |
| Operations / support | hotels.view/create/lifecycle, connections.view, integrations.manage, support.view_as, support.act_as, support.approve, audit.view |
| Finance | hotels.view, billing.view, billing.manage, connections.view (read-only everywhere else) |
| Read-only auditor | hotels.view, connections.view, billing.view, team.view, audit.view |

Rules: nobody can grant a role with capabilities they lack; the last active Super admin cannot be suspended or demoted; a route with no capability metadata is denied.

### Platform audit log

Columns: id, created_at, actor account id + email + role key (snapshotted), action, `tenant_id`, `property_id`, target type/id, `before`/`after` jsonb, reason, `result` (succeeded / failed / denied), ip, user agent, request id. **Append-only:** a trigger raises on UPDATE/DELETE/TRUNCATE; the app role is granted INSERT and SELECT only; RLS policy opens only for the platform console role. Retention policy is a gap (never deleted by code). Export is formula-safe CSV (cells starting `= + - @ tab CR` are prefixed with `'`) and is itself audited.

**Every mutating platform route is audited**: a `@PlatformAudit('action')` decorator is required on every POST/PUT/PATCH/DELETE; a global interceptor writes the row (success and failure) from data the handler places on the request; denials are recorded by the guard. A unit test walks all platform controllers and fails when a mutating handler has no audit metadata, and an end-to-end test checks a row is written per route.

## State machines

**Hotel lifecycle** (`organizations.lifecycle_state`; reason required; `lifecycle_version` checked, so two admins changing at once yield one winner and one 409):

| From | Allowed to |
| --- | --- |
| TRIAL | ACTIVE, PAST_DUE, SUSPENDED, CANCELLED |
| ACTIVE | PAST_DUE, SUSPENDED, CANCELLED |
| PAST_DUE | ACTIVE, SUSPENDED, CANCELLED |
| SUSPENDED | ACTIVE, CANCELLED |
| CANCELLED | ARCHIVED, ACTIVE (reinstatement, Super admin only) |
| ARCHIVED | none (terminal in Phase 1; unarchive is a gap) |

Cancelled and Archived need `platform.hotels.dangerous`. Effects: `organizations.status` is kept as the access flag (`SUSPENDED` for lifecycle SUSPENDED, CANCELLED, ARCHIVED; otherwise `ACTIVE`) so existing code keeps working, and a database trigger keeps it consistent.

| State | Hotel logins | Hotel dashboard writes | Public booking and availability |
| --- | --- | --- | --- |
| Trial, Active, Past due | allowed | allowed | allowed (Past due and Trial are set manually until Milestone 15) |
| Suspended, Cancelled | blocked (403 with a plain message) | n/a | blocked |
| Archived | read-only (GET only; any write returns 403) | blocked | blocked |

No data is deleted by any transition. The old `POST /platform/tenants/:id/suspend|reactivate` routes remain and now go through the same transition service.

**Support session**: `PENDING_APPROVAL → ACTIVE → EXPIRED | REVOKED`, or `PENDING_APPROVAL → DENIED | EXPIRED`. VIEW starts ACTIVE immediately (reason required, default 60 minutes, max 120). ACT starts PENDING_APPROVAL, needs approval by the hotel Owner in the dashboard (notification) or by a different platform account holding `platform.support.approve` (never the requester), then ACTIVE for at most 60 minutes. Approval is a single conditional UPDATE (`WHERE status = 'PENDING_APPROVAL'`), so a double approval has one winner. Expiry is checked on every request (`expires_at > now()`), not by a sweeper.

**Onboarding checklist** (computed per request from real rows, never stored as done): owner invited / accepted (invite record and membership), hotel details complete (country, time zone, currency, address, contact), mode chosen (Clock connection present, or MUST-source with a property and room types), payment gateway connected (a CONNECTED payment connection), website connection (public website origin or plugin heartbeat when it exists, otherwise "not detected"), first test booking made (a booking exists). Each item returns `state` (done / todo / unknown), `evidence`, and a `fixHref`.

## Support access mechanics

- A platform user opens a hotel with a reason; `POST /platform-console/support-sessions` creates the row and sets the cookie `must_support` (HttpOnly, SameSite=Lax, Secure in production) holding a random token; only its hash is stored.
- `TenantContextGuard` is extended (additive): when the normal hotel session does not authorise the request and a valid support session exists for **exactly the tenant in the URL**, the request runs in a *support context* (`tenantContext.support`). The tenant id always comes from the session row and must equal the URL tenant, so a session cannot cross tenants. The platform account's status and capability are re-checked on every request, so suspension or a role change ends access immediately.
- View-as: GET/HEAD only; every other method returns 403. Act-as: only handlers whose required capability is in a fixed allow-list (bookings view/create/edit/cancel, calendar view/block, guests view, payments view/record, accommodations manage, rates manage, reports view), never DELETE, never a handler that requires a tenant role (staff, settings, credentials, role changes), never billing, refunds or data deletion. A handler with no declared capability is read-only in support context. Everything else fails closed.
- In support context the data user id is the hotel's Owner (so existing handlers work), and the audit request context carries `supportSessionId`, `platformAccountId`, `onBehalfOf`; every `audit_logs` row written during the session therefore says "performed by platform account X on behalf of the hotel". Each support request also writes a `platform_audit_log` row.
- Hotel side: `GET /support/current` (platform cookie) feeds a persistent banner in the dashboard shell (who, until when, view or act, End session). Starting a session writes a hotel `audit_logs` row and an in-app notification to the Owner; the Owner can list sessions and approve or deny pending act-as requests (`/tenants/:id/support-sessions`).

## API contract (all under `/platform-console`, JSON, errors `{ message }`)

Auth (own cookie `must_platform`): `POST auth/login`, `POST auth/logout`, `POST auth/logout-everywhere`, `GET auth/me`, `POST auth/invitations/accept`.
Team: `GET team`, `GET team/roles`, `POST team/invitations`, `POST team` (create with password), `PATCH team/:id/role`, `PATCH team/:id/status`.
Hotels: `GET hotels` (search, lifecycle, mode, sort, page), `POST hotels` (onboarding), `GET hotels/:id`, `GET hotels/:id/connections`, `GET hotels/:id/staff-usage`, `GET hotels/:id/onboarding`, `POST hotels/:id/lifecycle`, `POST hotels/:id/owner-invitations`.
Support: `POST support-sessions`, `GET support-sessions`, `POST support-sessions/:id/revoke`, `POST support-sessions/:id/approve`, `POST support-sessions/:id/deny`, `POST support-sessions/:id/enter` (sets the cookie).
Audit: `GET audit` (filters actor, action family, tenant, from, to, page), `POST audit/export` (CSV, audited).
Hotel-side: `GET support/current`, `POST support/end`, `GET tenants/:tenantId/support-sessions` (Owner), `POST tenants/:tenantId/support-sessions/:id/approve|deny` (Owner).

Mutating routes require `Idempotency-Key`; records with a `version` require `If-Match`/`version` in the body.

## Security notes

Basic by decision. Implemented: separate cookie (`must_platform`, HttpOnly, SameSite=Strict, Secure in production, path `/`), token stored hashed, absolute 12 h and idle 2 h expiry, login throttle per email and per IP in Redis (generic error, constant-time compare), bcrypt cost 12, every login/logout/failed login audited, logout everywhere, suspend and role change revoke sessions, state-changing requests require a custom header `X-Platform-Console: 1` plus an `Origin` that matches `WEB_APP_URL` when present (cheap CSRF defence on top of SameSite=Strict), no secrets in responses or logs (connections show status only).

**Hardening gap list (NOT implemented, do not claim):** mandatory two-factor authentication; shorter sessions and re-authentication for sensitive actions (cancel, archive, act-as, team changes); IP allow-list; device/session list UI; password breach check and rotation policy; separate admin hostname; audit retention and external (WORM) export; custom platform roles UI; break-glass account procedure.

## Migration of existing platform admins

`apps/api/scripts/migrate-platform-admins.ts` (explicit, idempotent, run by hand): for each `users.is_platform_admin = true` it creates a `platform_accounts` row with the same email and password hash as Super admin (status ACTIVE) and records an audit row; it never deletes the old user or flag. Reversal: set the new account SUSPENDED (or delete the rows); the old flag path keeps working. The flag path (`is_platform_admin`, old `/platform/*` routes, `RolesGuard` branch) is removed in a separate final commit once the console is proven.

## Build order

1. Plan, worktree, local database and ports.
2. Migrations and schema (accounts, roles, sessions, audit, lifecycle, support).
3. Platform auth and capability guard, audit interceptor, team management, migration script. Tests.
4. Lifecycle service and enforcement (logins, public booking, archived read-only). Tests.
5. Hotels directory/detail endpoints, onboarding, checklist, owner invite. Tests.
6. Support sessions and the hotel-side guard extension, banner endpoint, owner approval. Tests.
7. Platform audit search/export.
8. Web: shared components, login, shell, overview, hotels, hotel detail, onboarding, team, audit, support; hotel banner.
9. Verification, screenshots per role, docs, gap list.

## Progress

| Date | Step | Status |
| --- | --- | --- |
| 2026-10-19 | Plan written, worktree created, dependencies installed | Done |

## Gaps (kept current)

See "Hardening gap list" above plus the Phase 2/3 items. Additions are recorded here as they are found.
