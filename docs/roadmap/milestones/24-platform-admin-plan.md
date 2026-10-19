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
Hotel-side: `GET support/current`, `POST support/end`, `GET tenants/:tenantId/support-sessions` (Owner), `POST tenants/:tenantId/support-sessions/:id/approve|deny|revoke` (Owner). Also `GET /auth/session` and `GET /auth/memberships` answer for a support cookie so the hotel dashboard loads inside a session.

Mutating routes require `Idempotency-Key`; records with a `version` (lifecycle, team role and status) take it in the body and answer 409 when stale. Routes that set or clear a cookie, sign in or out, or return a file skip the key (listed in a test).

## Security notes

Basic by decision. Implemented: separate cookie (`must_platform`, HttpOnly, SameSite=Strict, Secure in production, path `/`), token stored hashed, absolute 12 h and idle 2 h expiry, login throttle per email in Redis, and per IP only when `PLATFORM_TRUSTED_PROXY_HOPS` says the client address can be trusted (X-Forwarded-For is read from the right, never the client-controlled left side; found by the automated security review and fixed), generic errors, one bcrypt comparison even for unknown emails, bcrypt cost 12, every login/logout/failed login audited, logout everywhere, suspending an account revokes its sessions, and a role change applies at once because capabilities are read from the database on every request, state-changing requests require a custom header `X-Platform-Console: 1` plus an `Origin` that matches `WEB_APP_URL` when present (cheap CSRF defence on top of SameSite=Strict), no secrets in responses or logs (connections show status only).

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
| 2026-10-19 | Plan, worktree, local database `must_booking_platform`, ports 3100/3101, Redis db 7 for tests | Done |
| 2026-10-19 | Migrations `20261020000000` to `20261020030000` (platform tables, lifecycle, support sessions, login state function, directory facts function); applied twice to prove re-runnable | Done |
| 2026-10-20 | Platform accounts, sessions, capability guard, audit (append-only), idempotency, team | Done, e2e verified |
| 2026-10-20 | Hotel lifecycle with enforced effects, directory, detail, connections, staff and usage, onboarding checklist, owner invite | Done, e2e verified |
| 2026-10-20 | Support access: view-as, act-as with approval, banner endpoints, owner decisions | Done, e2e verified |
| 2026-10-20 | Admin migration script (dry run, apply, rollback) | Done; **not run against any real database** |
| 2026-10-20 | Web: sign-in, overview, hotels, new hotel, hotel detail (3 tabs), support access, team, audit, invitation page, hotel-side banner and owner notice | Done; screenshots for 4 roles and both banners |
| Open | Removal of the old `is_platform_admin` flag path (old `/platform/*` API routes, `RolesGuard` branch) | **Not done on purpose**: the spec says only after the console is proven, as its own commit. The web pages that used those routes are gone; the routes are unused but still work |

### Verification (2026-10-20, local isolated database)

- API unit and e2e on `must_booking_platform`: full suite 1242 tests, 1237 pass, 5 fail. The same 5 fail identically on the untouched base commit 3a46d94 (date-dependent or state-dependent specs: local-demo-seed, local-pms-provider, overview-front-desk, properties, public-catalog-individual-rooms), so they are not caused by this work.
- New API specs: 6 e2e files and 3 unit files, 60 tests (auth and team 18, hotels and lifecycle 13, support 11, audit coverage and role drift 2, migration 1, route policy 5, lifecycle rules 3, client IP 4, plus the existing guard specs). The route-policy test was shown to fail when an audit decorator is removed.
- Web: full suite 105 files, 535 tests pass (new: console components 5, console pages 21, support bar 4).
- API build, Prisma validate, API and web type-check: pass (one pre-existing type error in `test/room-types.e2e.spec.ts`, untouched).
- Existing guard-related e2e (auth, capabilities, page visibility, admin staff, onboarding) pass with the guard changes.

## Assumptions

- Hotel suspension had no effect before this work; the new effects are defined in State machines. Archived hotels allow read-only sign-in.
- Owner notification and approval is a banner in the hotel dashboard (new `support-bar.tsx`), not an entry in the Notifications inbox, because Notifications belongs to the other agent's area. Wiring a topic there is a small follow-up.
- Act-as acts as the hotel's earliest Owner user so existing handlers work; the hotel audit rows carry the platform account in `request_context.support` and a separate `support.action.performed` row.
- The act-as allow-list is the capability list in `platform-capabilities.ts`; a handler without a declared capability is read-only in a support session.
- A hotel's mode is its stored `onboarding_mode`, else Clock when a Clock PMS connection exists, else MUST (built-in).

## Gaps (kept current)

Security hardening, **not implemented, do not claim**: mandatory two-factor; shorter sessions and re-authentication for sensitive actions (cancel, archive, act-as, team changes); IP allow-list; session and device list; password breach check and rotation; separate admin hostname; audit retention and external write-once export; custom roles UI (the model supports it); break-glass procedure. Client IP for rate limiting and audit is only as good as `PLATFORM_TRUSTED_PROXY_HOPS` (unset means the socket address, which is the web proxy behind Next).

Product gaps:
- Platform invitation links are shown once to the inviter; no email is sent for platform invitations (hotel owner invitations do send email).
- View-as shows the hotel's write buttons; the server refuses them (403 with a plain message) but the UI does not hide them yet.
- Owner approval is not in the Notifications inbox (see Assumptions); no email to the owner when a session starts.
- Support banner polls once a minute; an ended session shows up on the next request or poll.
- Directory has no health score or plan filter (Phase 2 and Milestone 15); plan and limits are placeholders.
- No unarchive; Archived is terminal in the console.
- Idempotency records and expired support sessions are never purged.
- Onboarding checklist cannot tell an unconnected website from one the hotel simply has not built; it only trusts the plugin connection time.
- Remove the old flag path after the migration script has been run in production and the console is accepted.

Local use (from `apps/api`): `pnpm migrate:platform-admins` (dry run; `--apply`, `--rollback`), `pnpm seed:platform-console-demo` (local demo data, API on 3100), environment `PLATFORM_TRUSTED_PROXY_HOPS`.
