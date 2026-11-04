# Restaurant venues - Stage 1 Implementation Plan (venue, areas, tables, floor map, venue staff, plan flag)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenant on a dining-enabled plan can create venues, define areas and tables, arrange tables on a per-area floor map, and give people venue-limited access, all without touching hotel behaviour.

**Architecture:** New tenant-level tables (`venues`, `venue_areas`, `venue_tables`, `venue_table_combinations`, `venue_staff_assignments`) with RLS on `tenant_id`, a new `venues` NestJS module following the `amenities` controller/service pattern, a `venueParam` scope in `TenantContextGuard` plus a `Role.VenueStaff`, and Next.js pages under `/dashboard/[tenantId]/venues`. Venue authorization is tenant OWNER/ADMIN or an active venue staff assignment mapped to a fixed capability set. The venue is deliberately not a `Property`.

**Tech Stack:** NestJS + Prisma (hand-written SQL migrations + `schema.prisma`), Postgres RLS, Vitest (unit + e2e against local Postgres), Next.js 16 / React 19, `@must/ui` and `apps/web/components/ui`, `@dnd-kit/core` for the map editor.

**Spec:** `docs/superpowers/specs/2026-11-03-restaurant-venues-design.md` (sections 3, 4, 8 and 10 stage 1). Later stages (services/availability, policies/deposits, public API, hotel link) get their own plans.

## Global Constraints

- Follow `AGENTS.md`: every table and query carries `tenant_id`; RLS stays on (`ENABLE` + `FORCE`, policy on `app_current_tenant_id()`); migrations additive and re-runnable (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`); money not involved in stage 1.
- No change in behaviour for existing hotel tenants: no edits to hotel booking, payment, property or staff tables. The only edit to an existing table is two additive columns on `plans`, defaulting to off (`dining_enabled=false`, `max_venues=0`).
- Components only: look in `@must/ui` (`packages/ui/src`) and `apps/web/components/ui` first; add any missing piece as a shared component; pages only compose.
- Everything works with `property_id` null on the venue (standalone). Never require a hotel.
- Work locally on an isolated worktree off `main` (not on `feat/stay-lifecycle`, which has uncommitted work). No push, PR or deploy without the owner. Commit with pathspecs only (the git index may be shared) and read `git show --stat` after each commit.
- Code and docs in English. Run `pnpm -w lint`, `pnpm --filter api test`, `pnpm --filter web test`, `pnpm -w build` before calling it done; report failures honestly.
- **Stage-1 simplification (my call, owner to confirm):** venue staff get two fixed roles (`MANAGER`, `HOST`) mapped to fixed capabilities, instead of the customisable role templates the hotel side has. Spec section 4 says "same shape"; fixed roles are the smallest thing that works and the table is shaped so templates can replace it later.

## Review Focus

- Tenant A cannot read or write tenant B's venues, areas or tables (RLS and guard both). Pinned in Task 3.
- A tenant whose plan has `dining_enabled=false` gets a clear 403 on every venue route, and the venue limit is enforced under concurrent creates. Pinned in Task 3.
- A venue staff user can reach only their assigned venue; a suspended assignment loses access immediately. Pinned in Task 4.
- Table with `min_seats > max_seats`, zero seats, duplicate label in the same area, or a position outside the map canvas is rejected. Pinned in Task 5.
- Deleting an area or table that is later referenced by reservations (stage 2) must be a soft deactivate, not a hard delete, so history survives. Pinned in Task 5 (`active` flag; no hard delete when referenced is a stage-2 test, hard delete allowed now only when nothing references it).
- A table cannot be combined with itself or with a table in another venue. Pinned in Task 5.

---

### Task 1: Schema, migration and plan flag

**Files:**
- Create: `apps/api/prisma/migrations/20261103100000_restaurant_venues/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (add models, add two `Plan` fields)
- Modify: `apps/api/test/helpers/cleanup-tenant.ts` (delete venue tables first, FK-safe)
- Test: `apps/api/test/venues-schema.e2e.spec.ts`

**Interfaces:**
- Produces tables (all with `tenant_id UUID NOT NULL`, RLS policy `tenant_id = app_current_tenant_id()`):
  - `venues(id, tenant_id, property_id NULL, name VARCHAR(200), slug VARCHAR(100), timezone, currency CHAR(3), address, phone, contact_email, active BOOLEAN DEFAULT true, created_at, updated_at)`; unique `(tenant_id, id)` and `(tenant_id, slug)`; FK `(tenant_id, property_id)` to `properties(tenant_id, id)` ON DELETE RESTRICT.
  - `venue_areas(id, tenant_id, venue_id, name VARCHAR(100), sort_order INT, map_width INT DEFAULT 1000, map_height INT DEFAULT 700, active, created_at, updated_at)`; unique `(tenant_id, venue_id, id)` and `(tenant_id, venue_id, name)`.
  - `venue_tables(id, tenant_id, venue_id, area_id, label VARCHAR(30), min_seats INT, max_seats INT, map_x INT, map_y INT, map_width INT DEFAULT 80, map_height INT DEFAULT 80, shape VARCHAR(10) CHECK IN ('square','round','rect'), active, created_at, updated_at)`; CHECKs `min_seats >= 1 AND max_seats >= min_seats`; unique `(tenant_id, area_id, label)`.
  - `venue_table_combinations(tenant_id, venue_id, table_a_id, table_b_id)` PK all four, CHECK `table_a_id < table_b_id` (one row per unordered pair).
  - `venue_staff_assignments(id, tenant_id, venue_id, user_id, role VARCHAR(10) CHECK IN ('MANAGER','HOST'), suspended_at NULL, created_by_user_id, created_at, updated_at)`; unique `(tenant_id, venue_id, user_id)`; FK `(tenant_id, user_id)` to `tenant_memberships(tenant_id, user_id)`.
  - `plans.dining_enabled BOOLEAN NOT NULL DEFAULT false`, `plans.max_venues INT NOT NULL DEFAULT 0`.
- Prisma models: `Venue`, `VenueArea`, `VenueTable`, `VenueTableCombination`, `VenueStaffAssignment`; `Plan.diningEnabled`, `Plan.maxVenues`.
- Grants to `must_booking_app`: SELECT/INSERT/UPDATE/DELETE on the five new tables (check how an existing migration, e.g. the amenities one, handles grants/default privileges and copy it).

- [ ] **Step 1: Write the failing test** `venues-schema.e2e.spec.ts`: using the `admin` PrismaClient pattern from `test/amenities.e2e.spec.ts`, create a tenant, insert a venue with `property_id` null; assert insert succeeds; assert inserting a table with `min_seats=4,max_seats=2` fails (CHECK); assert a second table with the same label in the same area fails (unique); assert a combination row with `table_a_id > table_b_id` fails. Add: via the app role (`must_booking_app`, `set_config('app.tenant_id', ...)`), tenant B's context sees zero of tenant A's venue rows.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run test/venues-schema.e2e.spec.ts` - Expected: FAIL (relation "venues" does not exist).
- [ ] **Step 3: Write the migration and `schema.prisma` models** per the Interfaces block; apply with `pnpm --filter api exec prisma migrate deploy` against local Postgres, then `pnpm --filter api prisma:generate`. Add the five tables to `cleanupTenant` before `properties`/`tenant_memberships` deletes.
- [ ] **Step 4: Run** the spec again - Expected: PASS. Also run `pnpm --filter api exec vitest run test/amenities.e2e.spec.ts` to prove existing e2e still passes with the new plan columns.
- [ ] **Step 5: Commit** `git add apps/api/prisma apps/api/test/helpers/cleanup-tenant.ts apps/api/test/venues-schema.e2e.spec.ts` then `git commit -m "feat(dining): venue, area, table and venue staff schema"` (with the Co-Authored-By line).

---

### Task 2: Venue scope, role and capabilities (authorization core)

**Files:**
- Create: `apps/api/src/tenancy/venue-capability-catalog.ts`
- Modify: `apps/api/src/tenancy/tenant-context.decorator.ts` (add `venueParam?: string` to `TenantScopeOptions`)
- Modify: `apps/api/src/tenancy/tenant-context.guard.ts` (verify venue exists via `venues` row; put `venueId` on `tenantContext`)
- Modify: `apps/api/src/tenancy/roles.decorator.ts` (`Role.VenueStaff = 'VENUE_STAFF'`), `roles.guard.ts` (grant `VenueStaff` when an active `venue_staff_assignments` row exists), `capabilities.service.ts` (+ `effectiveForVenue`), `capabilities.guard.ts` (use it when `venueId` present)
- Test: `apps/api/src/tenancy/venue-access.test.ts`

**Interfaces:**
- Produces: `VENUE_CAPABILITY_CATALOG: readonly CatalogEntry[]` with keys `venue.view`, `venue.manage` (setup: areas, tables, map), `venue.staff` (assign staff), `reservations.view`, `reservations.manage` (the last two reserved for stage 2 but defined now); `VENUE_ROLE_CAPABILITIES: Record<'MANAGER'|'HOST', string[]>` (MANAGER all; HOST `venue.view`, `reservations.view`, `reservations.manage`).
- Produces: `CapabilitiesService.effectiveForVenue(ctx: { tenantId: string; venueId: string; userId: string }): Promise<string[]>` - tenant OWNER/ADMIN get every venue capability; assigned unsuspended staff get their role's list; everyone else `[]`.
- Produces: `request.tenantContext.venueId?: string`.
- Existing hotel routes unchanged: when `venueParam` is absent all current guard behaviour is identical.

- [ ] **Step 1: Write failing tests** in `venue-access.test.ts` (mock `database.withTenantTransaction` like `amenities.service.test.ts`): `effectiveForVenue` returns all keys for an OWNER; returns the HOST list for an active HOST; returns `[]` for a suspended assignment; returns `[]` for a plain tenant STAFF member with no assignment. Guard test: a route with `venueParam` and an unknown venue id throws `ForbiddenException('The requested tenant or property is outside this session scope.')`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/tenancy/venue-access.test.ts` - Expected: FAIL.
- [ ] **Step 3: Implement** the catalog, decorator option, guard branch (venue existence check inside the same transaction as the membership check; also in `authorizeSupport`, support sessions keep their current read-only/act-as limits - act-as for venue routes is simply not on the allow-list, so non-GET is refused), `Role.VenueStaff`, and the capability resolution.
- [ ] **Step 4: Run** the new test plus `pnpm --filter api exec vitest run src/tenancy` - Expected: PASS (no hotel regression).
- [ ] **Step 5: Commit** the listed files only.

---

### Task 3: Venues API with plan gating and limit

**Files:**
- Create: `apps/api/src/tenancy/venues.service.ts`, `venues.controller.ts`
- Modify: `apps/api/src/app.module.ts` (register controller + service next to `AmenitiesController`/`AmenitiesService`)
- Modify: `apps/api/src/tenancy/plan-usage.service.ts` (add `diningEnabled`, `maxVenues` to `plan` and `venues` count to `usage`)
- Modify: `apps/api/src/tenancy/audit-event.ts` (add `venue.created`, `venue.updated`, `venue.deactivated`) **only if** Step 0 below shows audit supports tenant-level entries
- Test: `apps/api/src/tenancy/venues.service.test.ts`, `apps/api/test/venues.e2e.spec.ts`

**Interfaces:**
- Routes (all under `tenants/:tenantId`): `GET venues` (tenant-scoped; returns the venues the caller may see: all for OWNER/ADMIN, assigned ones for staff), `POST venues` (OWNER/ADMIN, `venue.manage`), `GET venues/:venueId`, `PATCH venues/:venueId` (`venue.manage`), `POST venues/:venueId/deactivate`.
- `VenuesService`: `list(tenantId, userId): Promise<Venue[]>`, `create(tenantId, actorUserId, input: unknown): Promise<Venue>`, `get(tenantId, venueId)`, `update(tenantId, venueId, actorUserId, input: unknown)`, `deactivate(...)`. Input validated like `amenities.service` (name 1-200 chars, slug derived from name and unique per tenant, `timezone` valid IANA zone, `currency` 3 letters, optional `propertyId` must belong to the tenant).
- Gating: every method first checks `plan.dining_enabled`; false -> `ForbiddenException({ message: 'Dining is not enabled for this plan.', code: 'DINING_NOT_ENABLED' })`. `create` also enforces `count(active venues) < max_venues` inside the transaction using `SELECT ... FOR UPDATE` on the `organizations` row so concurrent creates cannot exceed the limit; over the limit -> `ConflictException({ code: 'VENUE_LIMIT_REACHED' })`.

- [ ] **Step 0: Verify** whether `AuditLogService.recordInTransaction` accepts an entry with `tenantId` and no `propertyId` for a new action (read `audit-log.service.ts` insert and the `audit_events` table constraints). If it requires a property, skip audit in stage 1, add a `// TODO(stage 2)` note in the plan's open items and tell the owner; do not invent a workaround.
- [ ] **Step 1: Write failing tests.** Unit: `create` throws `DINING_NOT_ENABLED` when the plan flag is false; throws `VENUE_LIMIT_REACHED` at the limit; rejects a `propertyId` from another tenant; rejects an invalid timezone. E2E (`venues.e2e.spec.ts`, copy the setup/cleanup scaffolding from `amenities.e2e.spec.ts`): owner creates a venue on a dining-enabled plan (flip the plan via `admin`); tenant B owner `GET venues/:id` of tenant A's venue returns 403/404; two parallel `POST venues` with `max_venues=1` yield exactly one 201.
- [ ] **Step 2: Run** unit and e2e specs - Expected: FAIL.
- [ ] **Step 3: Implement** service + controller following `amenities.controller.ts` decorators (`@TenantScoped({ venueParam: 'venueId' })` on venue-specific routes, `@Roles(Role.TenantOwner, Role.TenantAdmin, Role.VenueStaff)`, `@RequiresCapability('venue.manage')`, `@RequiresVerifiedEmail()` on mutations) and extend `PlanUsageService`.
- [ ] **Step 4: Run** both specs plus `pnpm --filter api exec vitest run src/tenancy/plan-usage` if present - Expected: PASS.
- [ ] **Step 5: Commit** the listed files only.

---

### Task 4: Venue staff assignment API

**Files:**
- Create: `apps/api/src/tenancy/venue-staff.service.ts`, `venue-staff.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/tenancy/venue-staff.service.test.ts`, extend `apps/api/test/venues.e2e.spec.ts`

**Interfaces:**
- Routes: `GET venues/:venueId/staff`, `PUT venues/:venueId/staff/:userId` body `{ role: 'MANAGER' | 'HOST' }` (creates or changes), `POST venues/:venueId/staff/:userId/suspend`, `.../resume`. Capability `venue.staff`.
- `VenueStaffService.assign(tenantId, venueId, targetUserId, role, actorUserId)`: target must already be a `tenant_memberships` member of the tenant (otherwise 404 "That person is not a member of this workspace."); inviting brand-new people reuses the existing tenant staff-invite flow and is out of scope here (note in docs).
- Seat counting: the plan's `max_staff_seats` counts tenant memberships already; venue assignment does not add a seat.

- [ ] **Step 1: Write failing tests.** Unit: assigning a non-member is rejected; assigning twice updates the role instead of duplicating. E2E: a HOST can `GET venues/:venueId` of their venue but gets 403 on a second venue; after `suspend` the same request returns 403; a HOST gets 403 on `PATCH venues/:venueId` (no `venue.manage`).
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** service and controller.
- [ ] **Step 4: Run** - Expected: PASS.
- [ ] **Step 5: Commit** the listed files only.

---

### Task 5: Areas and tables API (including combinations)

**Files:**
- Create: `apps/api/src/tenancy/venue-layout.service.ts`, `venue-layout.controller.ts`, `venue-layout-input.ts` (pure validators)
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/tenancy/venue-layout-input.test.ts`, `venue-layout.service.test.ts`, extend `apps/api/test/venues.e2e.spec.ts`

**Interfaces:**
- Pure: `parseAreaInput(raw: unknown): { name: string; sortOrder: number; mapWidth: number; mapHeight: number }` (name 1-100, map 400-3000 px); `parseTableInput(raw: unknown, area: { mapWidth: number; mapHeight: number }): { label: string; minSeats: number; maxSeats: number; mapX: number; mapY: number; mapWidth: number; mapHeight: number; shape: 'square' | 'round' | 'rect' }` - throws `BadRequestException` when `minSeats < 1`, `maxSeats < minSeats`, or the table rectangle falls outside the area canvas.
- Routes: `GET venues/:venueId/layout` (areas with tables and combination pairs in one response, for the map screen), `POST venues/:venueId/areas`, `PATCH .../areas/:areaId`, `DELETE .../areas/:areaId`, `POST .../areas/:areaId/tables`, `PATCH .../tables/:tableId`, `DELETE .../tables/:tableId`, `PUT venues/:venueId/layout/positions` (bulk `[{ tableId, mapX, mapY }]`, one transaction, used by the map editor), `PUT .../tables/:tableId/combinable` body `{ tableIds: string[] }` (replaces the set). Capability `venue.manage` for writes, `venue.view` for reads.
- Delete rule: hard delete only when nothing references the row (stage 1: always true for tables/areas without tables); an area with tables returns 409 "Move or remove its tables first."; otherwise offer `active=false` via PATCH.
- Combinations: reject self-pairs and tables from another venue; store one row per unordered pair (`least/greatest` of the two ids).

- [ ] **Step 1: Write failing tests.** Pure: `parseTableInput` rejects `minSeats=4,maxSeats=2`, `minSeats=0`, a table whose `mapX+mapWidth` exceeds the area width, and accepts a valid round table. Service/e2e: duplicate label in the same area returns 409; same label in a different area succeeds; `PUT combinable` with the table's own id returns 400; with a table from another venue returns 404; setting `[B]` on A then reading layout shows the pair once; bulk positions update is atomic (one bad id rolls back all).
- [ ] **Step 2: Run** - Expected: FAIL.
- [ ] **Step 3: Implement** validators, service and controller.
- [ ] **Step 4: Run** `pnpm --filter api test` (full API suite, not a subset) - Expected: PASS.
- [ ] **Step 5: Commit** the listed files only.

---

### Task 6: Dashboard venues list and venue setup screens

**Files:**
- Create: `apps/web/app/dashboard/[tenantId]/venues/page.tsx`, `apps/web/app/dashboard/[tenantId]/venues/[venueId]/page.tsx` (both wrap in `AuthRouteGuard audience="tenant"` like the tenant page), `apps/web/app/dashboard/venues/venue-list.tsx`, `venue-setup.tsx`, `table-form-dialog.tsx`, `area-form-dialog.tsx`, `venue-api.ts` (typed fetch helpers over `/api/tenants/...`)
- Modify: `apps/web/app/dashboard/dashboard-shell.tsx` (a "Restaurants" navigation entry shown only when the plan has `diningEnabled` from plan usage)
- Test: `apps/web/app/dashboard/venues/venue-list.test.tsx`, `venue-setup.test.tsx`

**Interfaces:**
- Consumes: Task 3-5 routes; plan usage `plan.diningEnabled`.
- Produces: `VenueApi` with `listVenues(tenantId)`, `createVenue(tenantId, input)`, `getLayout(tenantId, venueId)`, `saveArea`, `saveTable`, `deleteTable`, `savePositions`, `setCombinable`.
- UI: venue list (cards via existing `list-card`/`card`), create venue dialog (name, timezone, currency, optional linked hotel property), setup page with areas as tabs and a tables list (label, seats, active) with add/edit dialogs built from existing `dialog`, `form-field`, `input`, `number-stepper`, `button` components. Dining disabled -> an `Alert` explaining the plan does not include dining. Mobile/tablet friendly layout (single column under 768px).

- [ ] **Step 1: Write failing tests** (React Testing Library, style of `property-management.test.tsx`): list shows venues from a mocked fetch; empty state offers "Add restaurant"; creating a venue posts the right body; `diningEnabled=false` shows the not-enabled alert and no create button; table form blocks submit when max seats < min seats and shows the message.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run app/dashboard/venues` - Expected: FAIL.
- [ ] **Step 3: Implement** the components and routes, reusing shared components; any new reusable piece (for example a seat-range field) goes to `apps/web/components/ui` with its own test.
- [ ] **Step 4: Run** the new tests and `pnpm --filter web test` - Expected: PASS. Then run the app locally (`/run` skill) and click through create venue -> add area -> add tables at 375px and 1280px widths; capture screenshots and look at them.
- [ ] **Step 5: Commit** the listed files only.

---

### Task 7: Floor map editor

**Files:**
- Modify: `apps/web/package.json` (add `@dnd-kit/core`; it is on the owner's approved library list, record the exact version used)
- Create: `apps/web/components/ui/floor-map.tsx` (generic, presentational: tables positioned on a canvas, drag to move, keyboard moves, snap to grid), `apps/web/app/dashboard/venues/floor-map-editor.tsx` (wires `VenueApi.savePositions`), tests for both
- Modify: `apps/web/app/dashboard/venues/venue-setup.tsx` (Map tab per area)

**Interfaces:**
- `FloorMap` props: `{ width: number; height: number; tables: Array<{ id: string; label: string; seats: string; x: number; y: number; w: number; h: number; shape: 'square'|'round'|'rect'; tone?: 'default'|'selected' }>; editable: boolean; gridSize?: number; onMove(tableId: string, x: number, y: number): void; onSelect(tableId: string): void }` - positions are in canvas pixels of the area's `mapWidth x mapHeight`, scaled to the container.
- Editor: dragging updates local state; "Save layout" sends one bulk positions call; unsaved-changes indicator; selecting a table opens the combine-with checklist (`setCombinable`).
- Accessibility: tables are focusable, arrow keys move by one grid step, Enter selects.

- [ ] **Step 1: Write failing tests**: `FloorMap` renders every table at the scaled position; arrow key on a focused table calls `onMove` with `x + gridSize`; positions clamp inside the canvas; editor "Save layout" calls `savePositions` once with only moved tables; read-only mode has no handlers.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run components/ui/floor-map.test.tsx app/dashboard/venues/floor-map-editor.test.tsx` - Expected: FAIL.
- [ ] **Step 3: Implement** with `@dnd-kit/core` pointer + keyboard sensors; pure helper `clampToCanvas(x, y, w, h, width, height)` and `snap(value, grid)` in the same file with unit tests.
- [ ] **Step 4: Run** tests, then drag a table in the running local app (mouse and touch emulation), reload, confirm the position persisted.
- [ ] **Step 5: Commit** the listed files only.

---

### Task 8: Venue staff screen

**Files:**
- Create: `apps/web/app/dashboard/venues/venue-staff-panel.tsx` and test
- Modify: `apps/web/app/dashboard/venues/venue-api.ts`, `venue-setup.tsx` ("Staff" tab, visible with `venue.staff` capability)

**Interfaces:** consumes Task 4 routes and the existing tenant members list endpoint used by `staff.tsx` to choose a person; role picker `Manager` / `Host`; suspend/resume buttons using `confirm-dialog`.

- [ ] **Step 1: Write failing tests**: lists current assignments; assigning posts `{ role: 'HOST' }` to the right URL; suspended people show a "Suspended" badge with a Resume action; a user without `venue.staff` does not see the tab.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run app/dashboard/venues/venue-staff-panel.test.tsx` - Expected: FAIL.
- [ ] **Step 3: Implement** the panel from existing components.
- [ ] **Step 4: Run** the test and the full `pnpm --filter web test` - Expected: PASS.
- [ ] **Step 5: Commit** the listed files only.

---

### Task 9: Local enablement, docs and full verification

**Files:**
- Modify: `docs/architecture/data-and-access.md` (venue tables, venue scope, roles, RLS), `docs/product-overview.md` (Dining stage 1 status), `docs/README.md` router row if needed
- Create: `docs/decisions/ADR-0039-restaurant-venues.md` (separate venue model, equivalent staff tables, fixed roles in stage 1, plan flag)
- Create: `apps/api/scripts/enable-dining-local.sql` or document the two-line SQL in the ADR to set `dining_enabled=true, max_venues=3` on the local plan (never run against production)

- [ ] **Step 1:** Write the docs in short factual sentences; no task diary.
- [ ] **Step 2: Run the whole suite**: `pnpm -w lint`, `pnpm --filter api test`, `pnpm --filter web test`, `pnpm -w build`. Expected: all green; report any failure verbatim.
- [ ] **Step 3: Manual local walkthrough** with the local "Must Hotel" sandbox tenant (never Empire): enable dining on its plan locally, create a venue linked to its property and one standalone-style venue (no property), build two areas with tables and a map, assign a HOST user, log in as that user and confirm access is limited to the venue. Screenshot the map at tablet width.
- [ ] **Step 4: Check** `git diff --stat` matches the plan and that `git status` shows no hotel files changed other than the additive `plans` columns and the web shell navigation entry.
- [ ] **Step 5: Commit** docs with pathspecs; do not push.

---

## Self-review (spec coverage)

- Spec 4 Venue/Area/Table/combinations/staff/plan: Tasks 1, 3, 4, 5. Venue payments tables: stage 3 (not in this plan). Services/durations/pacing/online rules/reservations: stage 2. Policy: stage 3. Public API: stage 4. Hotel link/guest visibility: stage 5.
- Spec 8 staff experience: setup screens, map editor, tablet layout in Tasks 6-8; day view and fast add: stage 2.
- Spec 3 constraints (components only, no hotel change, standalone-capable, local-first): Global Constraints, Tasks 1, 6, 9.
- Types consistent across tasks: `VenueApi` methods named once in Task 6 and reused in 7-8; `effectiveForVenue` defined in Task 2 and used by the guard only.

## Open items for the owner (my calls in this plan)

1. Fixed roles (Manager/Host) in stage 1 instead of customisable role templates.
2. `@dnd-kit/core` for the map editor (on the approved library list).
3. Venue audit trail depends on Task 3 Step 0; if audit needs a property, venue audit lands in stage 2.
4. No platform-admin screen to toggle dining yet: stage 1 turns it on by SQL locally; a platform plan editor toggle is a small follow-up.
5. Brand-new people are added through the existing tenant staff invite, then assigned to a venue.
