# Milestone 20: Staff Dashboard Restructure & Visual Redesign

Status: **Scoped 2026-08-28**, Tasks 1-9 implemented and awaiting review. Distinct from Milestone 9 (Staff, functional completeness — done), Milestone 17 (wp-admin visual redesign, Owner/Main Admin only), and Milestone 18 (Customer dashboard visual redesign). This is the deferred follow-up both ADR-0005 and Milestone 18's own plan flagged: "Staff/wp-admin get a matching pass later, as a separate piece of work" — this milestone is that pass for Staff.

## Goal

Turn the flat, 11-item, visually-flat Staff dashboard sidebar into a properly grouped information architecture with real content-management capability, closing the two biggest functional gaps found during the 2026-08-28 audit — no staff-facing Tour create/edit at all, and a Hotel edit form that's a thin echo of wp-admin's real 12-tab editor — while giving the Dashboard/Reports pages the same icon-bubble-stat/real-chart treatment the Customer dashboard just got in Milestone 18.

## Context (2026-08-28 audit)

Full findings live in the published blueprint (`Staff Dashboard Blueprint` artifact, shared with the owner) — summarized here for anyone picking up a task without that link.

Both dashboards are generated off one shared registry, `Soves\Dashboard\AdminMenuRegistry`. wp-admin renders every group via `wpAdminGroups()` plus a set of dedicated, richer page classes (`HotelsPage`, `ToursPage`, `HotelEditPage`, `TourEditPage`, etc.). The Staff frontend (`templates/dashboards/staff/*`) only exposes a hand-maintained flat list, `AdminMenuRegistry::frontendSidebarItems()` (11 entries) — each mapping to one of 25 real `staffRoutes()` templates. Three confirmed gaps:

1. **No staff-facing Tour management at all.** `PostTypes::POST_TYPE` tours can only be created/edited through wp-admin's `TourEditPage` (13 tabs, built in Milestone 17). There is no `tours.php` under `templates/dashboards/staff/sections/` — only `tour-bookings.php` and `tour-availability.php` (read-only views). `manage_tours` is already a declared permission in `PermissionRegistry.php` — just never wired to any staff route.
2. **Hotel editing in Staff is thin.** `templates/dashboards/staff/sections/hotels.php` posts to `admin_post_soves_staff_save_hotel` with a handful of fields; wp-admin's `HotelEditPage` (1,533 lines, 12 tabs: media library, rooms & rates, policies, location, payments) is the real editor and stays wp-admin-only today.
3. **No visual structure.** Milestone 8 (2026-08-18) only harmonized color tokens and reused existing card/table/badge classes CSS-only — it never touched layout. The sidebar (`templates/dashboards/staff/partials/sidebar.php`) is one flat `<nav>` list; the Dashboard's stat row (`templates/dashboards/staff/sections/overview.php`) is 4 tiles behind a raw inline `style="display:grid..."` attribute; zero Chart.js usage anywhere in `assets/css/pages/dashboard-system.css` despite Chart.js 4.4.7 already being pinned and scoped-enqueued (`src/Core/Assets.php`) for wp-admin's own charts.

**Working principle for every task below**: reuse, don't re-derive. `HotelEditPage`/`TourEditPage` already do the real work of validating and saving 20+ tab's worth of fields through `HotelRepository`/`TourRepository`/`TourDepartureRepository`. Nothing in this milestone changes what those repositories accept or how they persist — it's a UI relocation into the staff frontend, posting through the same save paths.

## Sequencing

1. **Task 1 first** (URL rename) — trivial, zero dependencies, do it before anything else links to the dashboard's new pages.
2. **Task 2** (grouped sidebar) next — every later task's new page needs somewhere to live in the nav; build the shape before filling it.
3. **Tasks 3-8** can run in any order once Task 2 lands — each is scoped to one section of the IA.
4. **Task 9 last** — the registry/integrity pass that reconciles everything the earlier tasks added.
5. **Task 10** (theme-chrome decoupling) is independent of 1-9 and can run any time — it changes rendering isolation, not IA content.
6. **Task 11** (sidebar visual finish: full tree, pine accent, profile actions) depends on **Task 2 being merged** — it extends that grouping rather than replacing it, and should also follow whichever of Tasks 4-8 land first so the sub-items it exposes point at real routes rather than placeholders.

## Tasks

| # | Task | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 1 | Rename the dashboard URL off `soves-admin/dashboard` | See brief below. | In review |
| 2 | Grouped sidebar navigation + profile chip | See brief below. | In review |
| 3 | Dashboard page visual rebuild (KPI cards + real charts) | See brief below. | In review |
| 4 | Hotels: Create Hotel / Edit Hotel — port the real tabbed editor into Staff | See brief below. | In review |
| 5 | Tours: Tours landing, List, Create, Edit — port the real 13-tab editor into Staff | See brief below. | In review |
| 6 | Reviews: staff-facing moderation queue | See brief below. | In review |
| 7 | Reports page visual pass (real charts) | See brief below. | In review |
| 8 | Promote Manual Booking and Guest Details to first-class Bookings pages | See brief below. | In review |
| 9 | Registry/integrity reconciliation pass | See brief below. | In review |
| 10 | Decouple the Staff dashboard from theme (Elementor) chrome | See brief below. | Not started |
| 11 | Sidebar visual finish: full page tree, pine accent, profile actions | See brief below. | Not started |

## Task briefs (Codex-ready)

Template shapes are in `docs/roadmap/TASK_TEMPLATES.md`. All tasks below use the Feature shape unless noted.

---

### Task 1 — Rename the dashboard URL off `soves-admin/dashboard`

Template shape: Bug fix (it's a naming defect, not new functionality).

**Goal**: `ManagedPages::config()['admin_dashboard']['path']` is `'soves-admin/dashboard'` — a leftover from before the Owner/Main Admin vs. Staff split solidified. The actual audience is Staff, and the path reads like a wp-admin URL despite being the front-end staff dashboard. Rename it to something that reads as what it is — `staff-dashboard` is the obvious pick, but confirm against `docs/adr/0017-staff-lifecycle-mutation-controls-frontend.md` and `docs/REFERENCE.md` in case either has a reason to keep the old naming (unlikely, but check before assuming).

**What already exists, don't rebuild it**: `ManagedPages` already has an `obsoletePaths()` mechanism used for exactly this kind of rename (see `register_hotel`/`register_tour_agency`/etc. entries) — old URLs 301 to their replacement rather than 404ing. Use that same mechanism here, don't invent a new redirect path.

**Fix**:
1. Change `'admin_dashboard' => ['path' => 'soves-admin/dashboard', ...]` to `['path' => 'staff-dashboard', ...]` in `src/Core/ManagedPages.php`. Consider also updating `'title' => 'Soves Admin Dashboard'` to `'Staff Dashboard'` while touching this row — check whether the title is user-visible anywhere (browser tab, page `<title>`) before deciding.
2. Add the old path to `obsoletePaths()` so existing bookmarks/links redirect instead of breaking.
3. Confirmed low blast radius (checked 2026-08-28): only `src/Core/ManagedPages.php` defines the literal path; `src/Admin/StaffPage.php`, `AGENTS.md`, `docs/REFERENCE.md`, and ADR-0017 reference it only in text/comments — update those references for accuracy, not because anything there breaks. The many other `soves-admin` hits across the codebase are the unrelated CSS/PHP class-naming convention (`soves-admin-section`, `soves-admin-dashboard-panel`, etc.) — do not touch those, they're a naming convention, not this URL.
4. Confirm the plugin's existing "Managed Pages" repair tool (`content_managed_pages`/`content_page_repair` in the registry, `ManagedPagesPage`) picks up the new path on next run rather than needing a manual DB edit — that's the tool's whole purpose, use it rather than writing a one-off migration.

**Non-goals**: no change to what's rendered at the URL (that's Tasks 2-8). No change to any other managed page's path.

**Required reading**: `src/Core/ManagedPages.php` (`config()`, `obsoletePaths()`), `src/Admin/ManagedPagesPage.php` (the repair tool), `docs/adr/0017-staff-lifecycle-mutation-controls-frontend.md`.

**Acceptance criteria**: visiting `/staff-dashboard/` renders the staff dashboard; visiting the old `/soves-admin/dashboard/` 301-redirects to it; the managed-pages repair tool reports the page healthy with no manual DB intervention.

**Implementation notes (2026-08-28):** `admin_dashboard` now uses the user-visible title and canonical `/staff-dashboard/` path. The managed-pages sync version creates the replacement page, the repair action also cleans up the retired page, and the legacy URL is preserved as a 301 redirect (including its query string). Route references in ADR-0017, the operational reference, and Staff wp-admin guidance were updated. PHP lint passed; runtime and PHPUnit verification remain subject to the Local WordPress shell and required CLI extensions being available.

---

### Task 2 — Grouped sidebar navigation + profile chip

**Goal**: Replace the flat 11-item `<nav>` in `templates/dashboards/staff/partials/sidebar.php` with a grouped sidebar — section headers, not one long list — mirroring the pattern Milestone 18 already built for the Customer dashboard's sidebar (icon-bubble profile chip, grouped nav with visible section labels).

**What already exists, don't rebuild it**: `AdminMenuRegistry::frontendSidebarItems()` already returns each item's `permissions`/`active_sections` — the permission-filtering logic in `sidebar.php` (the `array_filter` over `$visibleMenuItems`) is correct and shouldn't change. This task adds a grouping layer on top of that filtered list, it doesn't touch how items get shown or hidden.

**Fix**:
1. Add a `group` key to each `frontendSidebarItems()` entry (Main / Operate / Services / Availability & Pricing / Bookings & Orders / Customers / Businesses / Finance / Reports / Team — see the blueprint's route-map for the exact grouping) and extend the new items Tasks 4-8 add with the same key.
2. Render `<nav>` as grouped sections with a small uppercase label per group (same visual weight as the Customer dashboard's Main/Account headers), collapsing/hiding a group entirely when none of its items are visible to the current user's permissions (reuse the existing per-item filter, just group the output).
3. Replace the plain `<div class="soves-admin-dashboard-user"><strong>Name</strong><span>Role</span></div>` block with an icon-bubble profile chip matching the Customer dashboard's own profile-chip markup/CSS — check `templates/dashboards/customer/partials/sidebar.php` for the exact pattern to port, don't design a new one.
4. CSS changes go in `assets/css/pages/dashboard-system.css`, reusing `--soves-dashboard-*` tokens — no new color values.

**Non-goals**: no change to which items are visible to which permission (that's unchanged). No change to the Customer dashboard's own sidebar (source, not target, here).

**Required reading**: `templates/dashboards/staff/partials/sidebar.php`, `src/Dashboard/AdminMenuRegistry.php::frontendSidebarItems()`, `templates/dashboards/customer/partials/sidebar.php` (the pattern to port), `assets/css/pages/dashboard-system.css`.

**Acceptance criteria**: the sidebar renders 10 visually distinct groups (fewer if a staff member's permissions hide entire groups); a staff member with only `view_customers` sees just the Customers group (plus Dashboard/My Queue, always visible) rather than a flat list with everything mixed in; the profile chip matches the Customer dashboard's visual pattern.

**Implementation notes (2026-08-28):** Every current Staff sidebar item now carries one of the 10 canonical group keys and the frontend template renders those groups only after the existing permission filter runs. The Customer sidebar's image/name/subtitle profile-chip structure was ported using the Staff member's WordPress avatar and role. No permission behavior changed: in particular, My Queue remains visible only to staff who already have one of its existing queue-view permissions. PHP lint passed; the focused PHPUnit run is blocked before tests start because this CLI PHP lacks `mbstring`.

---

### Task 3 — Dashboard page visual rebuild (KPI cards + real charts)

**Goal**: `templates/dashboards/staff/sections/overview.php`'s stat row is 4 tiles behind a raw inline `style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;"` attribute, and its "Operational attention" panel is literal `<div><strong>Label</strong><span>value</span></div>` pairs — zero charts anywhere, despite Chart.js 4.4.7 already being pinned and scoped-enqueued in `src/Core/Assets.php` for wp-admin's own Dashboard.

**What already exists, don't rebuild it**: `OverviewPage::renderDashboardDonutChart()`/`renderDashboardBarChart()` (wp-admin) already establish the exact Chart.js wiring pattern (`data-soves-donut-chart`/`data-soves-bar-chart` attributes + a JS initializer). Port that pattern, don't invent a second one. `AdminUi.php`'s `kpi()`/`attentionCard()` helpers already render icon+value+label tiles in a structured way — check whether they're reusable as-is for Staff's icon-bubble stat cards before writing new markup.

**Fix**:
1. Rebuild the stat row using real CSS classes (not inline `style=`), icon-bubble treatment matching the Customer dashboard's stat cards.
2. Add a booking-mix donut chart (hotel vs. tour booking counts — `$stats`/`$operations` in `AdminDashboard::context()` already has the raw numbers; confirm exact shape while reading) and a short activity/bookings-over-time bar chart, reusing `renderDashboardBarChart()`/`renderDashboardDonutChart()`'s pattern and enqueuing Chart.js the same scoped way wp-admin does — confirm it's only loaded on this one staff route, not globally.
3. Rebuild "Operational attention" as real cards with severity treatment (warn/danger), not bare label/value pairs — reuse `AdminUi::attentionCard()` if it fits, adapt if the frontend context needs something slightly different (don't just copy wp-admin markup verbatim into a front-end template without checking escaping/enqueue differences).

**Non-goals**: no new data queries — every number here is already computed by `AdminDashboard::context()`/`OperationsOverviewRepository`. This is presentation only.

**Required reading**: `templates/dashboards/staff/sections/overview.php`, `src/Dashboard/AdminDashboard.php::context()`, `src/Admin/Pages/Dashboard/OverviewPage.php` (`renderDashboardDonutChart()`/`renderDashboardBarChart()`), `src/Admin/Pages/Shared/AdminUi.php`, `src/Core/Assets.php` (Chart.js enqueue pattern).

**Acceptance criteria**: the Dashboard page shows icon-bubble stat cards (no inline `style=` grid), a real donut and a real bar chart with correct live numbers, and a redesigned Operational attention panel — all using data already computed today, zero new queries; Chart.js confirmed still scoped to only the pages that need it.

**Implementation notes (2026-08-28):** Rebuilt the staff overview with icon-bubble KPI cards, severity-aware operational cards, and the existing Chart.js initializer. The current overview context provides local booking-status totals and current operational queues, but no hotel-versus-tour split or date series; the donut and bar chart therefore show those live, already-computed values without adding a query. Chart.js is enqueued only on the Staff Dashboard overview route. The sidebar's internal scroll constraints were also removed so it takes the page's full height.

---

### Task 4 — Hotels: Create Hotel / Edit Hotel — port the real tabbed editor into Staff

**Goal**: Give Staff the same real hotel-editing capability wp-admin's `HotelEditPage` already has, instead of the thin form in `templates/dashboards/staff/sections/hotels.php`.

**What already exists, don't rebuild it**: `HotelEditPage.php` (1,533 lines) already implements every tab's fields, validation, and save logic against `HotelRepository`. This task ports its UI into the staff frontend and reuses the identical POST handling — it is not a rewrite of hotel-saving logic. `manage_hotels`/`view_hotels` permissions already exist and already gate the current thin form; reuse them unchanged.

**Fix**:
1. Add two staff routes — `hotel-edit` (create + edit, matching `soves-tour-edit`'s pattern of one page handling both) reachable from a "Create Hotel" action and each row's edit link on the existing Hotels list.
2. Build the tab shell reusing `HotelEditPage`'s tab-switching JS/markup pattern, adapted for the staff frontend's template system (`AdminDashboard::context()`/`$includeStaffSection` pattern, not wp-admin's page-render flow).
3. Post through the exact same `admin-post.php` actions/save methods `HotelEditPage` already uses — this task does not touch `HotelRepository::saveMeta()` or any validation logic.
4. Once this lands, decide whether `hotels.php`'s existing thin inline form should be removed (replaced entirely by links to the new Create/Edit pages) or kept as a quick-edit shortcut — default to removing it, since having two different hotel-edit surfaces with different field coverage is confusing; only keep both if there's a real reason found during implementation.

**Non-goals**: no change to `HotelRepository`, no change to wp-admin's own `HotelEditPage` (both surfaces can coexist, reusing the same backend). No media-pipeline or validation changes.

**Required reading**: `src/Admin/HotelEditPage.php` in full, `templates/dashboards/staff/sections/hotels.php`, `src/Hotels/HotelRepository.php`, `src/Dashboard/AdminDashboard.php` (staff render/context pattern), `src/Dashboard/AdminMenuRegistry.php::staffRoutes()`.

**Acceptance criteria**: a staff member with `manage_hotels` can create a new hotel and edit an existing one from the staff dashboard with full field coverage matching wp-admin's editor (rooms & rates, media, policies, location, payments); a value saved through the new staff page reads back correctly in wp-admin's editor and vice versa (same underlying storage).

**Implementation notes (2026-08-28):** Added a non-sidebar `hotel-edit` Staff route gated by `manage_hotels`, reachable from Create Hotel and each Hotels-list row. The editor reuses `HotelEditPage`'s field/tab rendering and its extracted shared save routine, so both Staff and wp-admin persist through `HotelRepository` and the existing payment settings layer. The thin inline editor and its duplicate room forms were removed from the Hotels list. Room actions accept `manage_hotels` for the complete hotel-editor workflow (and continue to accept the existing `manage_room_types` permission); standalone room-management permissions and storage were not changed.

---

### Task 5 — Tours: Tours landing, List, Create, Edit — port the real 13-tab editor into Staff

**Goal**: Close the single biggest gap found in the audit — Tours have zero staff-facing management surface today. Mirror what Task 4 does for Hotels, for Tours.

**What already exists, don't rebuild it**: `TourEditPage.php` (Milestone 17) already implements all 13 tabs' fields and save logic against `TourRepository`/`TourDepartureRepository`/`TourPaymentSettings`. `manage_tours` is already a declared permission in `PermissionRegistry.php`, currently unused anywhere — this is exactly the gate this task needs. wp-admin's rebuilt Tours list (`ToursPage.php`, Milestone 17 Task 2) already has the real table/filter pattern to reuse for the staff-facing "List of Tours" page.

**Fix**:
1. Add a `tours` staff route (section landing page — status counts, links onward) and a `tour-edit` route (create + edit, one page, mirroring `soves-tour-edit`'s own create/edit duality).
2. Build "List of Tours" reusing `ToursPage.php`'s table/badge/filter pattern, adapted to the staff frontend's template system.
3. Build the Create/Edit Tour tab shell porting all 13 of `TourEditPage`'s tabs (Basics, Pricing & Capacity, Booking Mode & Scope, Payments, Departures, Media, Guide & Contact, Location & Map, Itinerary, Inclusions/Exclusions/Important, FAQ, Highlights, Bookings) — this is the largest single task in this milestone; consider whether it's worth splitting into 2-3 sub-tasks (e.g. shell + first 4 tabs, then Departures, then the rest) the same way `TourEditPage` itself was originally built across Milestone 17 Tasks 3-11, rather than one enormous PR.
4. Post through the exact same save paths `TourEditPage` already uses (`TourRepository::saveMeta()`, `TourDepartureRepository`, `saveDeparturesAndPayments()`) — no changes to any of them.
5. Gate every new route on `manage_tours` (write) / a `view_tours`-equivalent (read) — confirm during implementation whether a dedicated `view_tours` permission needs adding to `PermissionRegistry.php` (it doesn't currently appear to exist, unlike `view_hotels`) or whether `manage_tours` alone is intended to cover both, and flag which you chose in the implementation notes.

**Non-goals**: no change to `TourRepository`/`TourDepartureRepository`/any tour save logic. No change to wp-admin's own `TourEditPage` (both surfaces coexist). No booking-integrity changes — Departures tab reuses the exact same capacity/booked_count guards `TourEditPage` already enforces.

**Required reading**: `src/Admin/TourEditPage.php` in full, `src/Admin/ToursPage.php`, `src/Tours/TourRepository.php`, `src/Tours/TourDepartureRepository.php`, `src/Tours/PostTypes.php`, `src/Staff/PermissionRegistry.php` (`manage_tours`), `src/Dashboard/AdminDashboard.php`, `src/Dashboard/AdminMenuRegistry.php::staffRoutes()`.

**Acceptance criteria**: a staff member with `manage_tours` can create a new tour and edit an existing one from the staff dashboard with full field coverage matching wp-admin's 13-tab editor, including adding/editing/removing departures with the same booking-safety guards; a tour saved through the new staff page renders identically on the public tour page to one saved through wp-admin.

**Implementation notes (2026-08-28):** Added the `tours` Staff sidebar page and non-sidebar `tour-edit` route, both gated by the pre-existing `manage_tours` permission. The Tours landing has live local-tour status totals, a status filter, and Create/Edit links. The Staff editor reuses all 13 existing `TourEditPage` tab renderers (including read-only booking context and the Departures controls) and its existing repeaters/media UI. Its dedicated frontend action reuses the same sanitization, post/meta/payment persistence, and `TourDepartureRepository` safety rules; the departure handler still prevents capacity below bookings, date changes after reservations, duplicates, and deletion of reserved departures. A small metadata-persistence extraction makes the existing normalization available after Staff's separate Soves permission check, without granting wp-admin capabilities or changing wp-admin behavior. Tour deletion remains intentionally unavailable from the Staff dashboard. `manage_tours` covers both list and editor access because no separate `view_tours` permission exists today. PHP lint and diff-whitespace checks passed; focused PHPUnit cannot start in this local CLI because `mbstring` is unavailable.

---

### Task 6 — Reviews: staff-facing moderation queue

**Goal**: `listings_reviews` already exists in `AdminMenuRegistry::groups()` ("Hotel and event review moderation overview") but isn't in `FRONTEND_ITEMS`, has no `staffRoutes()` entry, and no `reviews.php` template exists under `templates/dashboards/staff/sections/`. Give Staff a real combined Hotel + Tour review moderation queue.

**What already exists, don't rebuild it**: `manage_reviews` is already a declared permission. The hotel/tour review approve/reject/owner-reply backend logic already exists (used by the public-facing review edit/reply forms built in earlier sessions) — confirm the exact repository/service methods while reading, this task is a staff-facing moderation UI over existing data, not a new review system.

**Fix**:
1. Add a `reviews` staff route + template, listing pending/flagged reviews across both Hotels and Tours in one queue.
2. Approve/reject actions, plus an owner-reply view if one doesn't already exist for staff (check the existing hotel/tour single-page templates' owner-reply forms — this may already be staff-manageable through each listing's own edit surface, in which case this page is read-only oversight + approve/reject only, not a duplicate reply UI).
3. Add `listings_reviews` to `FRONTEND_ITEMS`, wire it into the new grouped sidebar under Services (Task 2).

**Non-goals**: no change to the review data model or the public-facing review submission/reply flow.

**Required reading**: `src/Dashboard/AdminMenuRegistry.php` (`listings_reviews` item), review-related repository/service classes (locate via search — check both Hotels and Tours domains), `templates/hotels/single.php`/`templates/tours/single.php` (existing owner-reply markup, for reference on what's already possible from the public template's own forms).

**Acceptance criteria**: a staff member with `manage_reviews` sees one combined moderation queue for Hotel + Tour reviews, can approve/reject, and the item is reachable from the grouped sidebar.

**Implementation notes (2026-08-28):** Added the permission-gated `reviews` Staff route and Services sidebar item. The queue combines the existing local Hotel and Tour review stores, supports Pending, Approved, and Rejected filters, shows existing owner replies for oversight, and posts approve/reject actions through a dedicated `manage_reviews`-guarded dashboard endpoint. It calls the existing repository moderation methods and logs the Staff action; public submission, customer editing, and owner-reply flows remain unchanged. PHP lint and diff-whitespace checks passed; focused PHPUnit cannot start in this local CLI because `mbstring` is unavailable.

---

### Task 7 — Reports page visual pass (real charts)

**Goal**: Apply the same chart treatment Task 3 gives the Dashboard to the Reports page — `templates/dashboards/staff/sections/reports.php` already renders real data (Milestone 9, Task 3: revenue by listing type, customer report, listing performance) but check whether it's still flat-table-only presentation.

**What already exists, don't rebuild it**: `AdminReportRepository`'s query methods are done and correct (Milestone 9). This is presentation only, reusing Task 3's now-established chart-enqueue pattern.

**Fix**: Add chart visualization (bar/donut, whichever fits each report type) alongside the existing tables — don't replace the tables, real numbers in a table are still useful for a report page, charts add a glance-level view on top.

**Non-goals**: no new report types or queries.

**Required reading**: `templates/dashboards/staff/sections/reports.php`, `src/Dashboard/AdminReportRepository.php`, and this milestone's Task 3 (for the established chart pattern to reuse).

**Acceptance criteria**: Reports page shows real charts backed by existing data, tables remain available, no new queries added.

**Implementation notes (2026-08-28):** Added a paid-revenue Hotel/Tour donut and a top-listing paid-revenue bar chart above the existing report tables. Both consume only `AdminReportRepository::reportData()` rows already loaded for the page; the tables and filters remain unchanged. The existing Chart.js initializer is now enqueued only for Staff Dashboard Overview and Reports, rather than globally across Staff routes. PHP lint and diff-whitespace checks passed; focused PHPUnit cannot start in this local CLI because `mbstring` is unavailable.

---

### Task 8 — Promote Manual Booking and Guest Details to first-class Bookings pages

**Goal**: The blueprint's Bookings & Orders group lists Manual Booking and Guest Details as their own pages; today both are folded into other templates (`bookings.php`'s form, `booking-detail.php`'s guest rows) without a direct sidebar entry.

**Fix**: Give each its own reachable entry point under the Bookings & Orders group (Task 2's grouping) — this is primarily an IA/navigation change, not new functionality; the underlying forms/data already work (Milestone 9, Task 4 for Manual Booking).

**Non-goals**: no change to the manual-booking validation/inventory-locking flow, no change to guest-row data.

**Required reading**: `templates/dashboards/staff/sections/bookings.php`, `templates/dashboards/staff/sections/booking-detail.php`, `src/Dashboard/AdminMenuRegistry.php::staffRoutes()`.

**Acceptance criteria**: both are directly reachable from the sidebar without hunting inside the Bookings page; no behavior change to either feature.

**Implementation notes (2026-08-28):** Added direct, permission-gated Staff routes and Bookings & Orders sidebar entries for Manual Booking (`create_bookings`) and Guest Details (`view_guest_details`). The manual page submits the existing `soves_admin_create_manual_booking` workflow unchanged, including its room-type-only availability and internal allocation safeguards. Guest Details renders the existing paginated `BookingOrdersOverviewRepository::guests()` read model without changing guest data. PHP lint passed; focused PHPUnit remains unavailable in this CLI because `mbstring` is missing.

---

### Task 9 — Registry/integrity reconciliation pass

Template shape: Audit, with authorized follow-up fixes.

**Goal**: After Tasks 1-8 land, reconcile `AdminMenuRegistry` end-to-end against the new IA and catch anything left inconsistent — new routes without permissions, sidebar groups pointing at dead sections, wp-admin's own menu accidentally affected by a Staff-only change.

**Fix**:
1. Run `AdminMenuRegistry::integrityReport()` (already exists, checks for duplicate slugs, missing handlers, permission mismatches, orphaned nav entries) and resolve everything it flags.
2. Confirm every new staff route added by Tasks 4-8 has a `visible_staff_items_without_permissions`-clean entry (a real permission gate, not blank).
3. Confirm wp-admin's own menu (`Menu::adminMenu()`) is unaffected by any Staff-only registry change — the two surfaces share the registry, so this needs an explicit check, not an assumption.
4. Run the full test suite (`AdminMenuRegistryTest.php`, `StaffSectionTemplateContextTest.php`, `StaffSidebarTemplateTest.php`, plus anything new Tasks 4-6 added) and `composer lint`.
5. Update `docs/ROADMAP.md`'s Milestone 20 row and this file's task statuses to reflect what actually shipped.

**Non-goals**: no new features — this task only fixes inconsistencies the earlier tasks introduced.

**Required reading**: `src/Dashboard/AdminMenuRegistry.php::integrityReport()`, `tests/Dashboard/AdminMenuRegistryTest.php`, `tests/Dashboard/StaffSectionTemplateContextTest.php`, `tests/Dashboard/StaffSidebarTemplateTest.php`.

**Acceptance criteria**: `integrityReport()` returns all-empty arrays; full test suite passes with no new failures beyond the one pre-existing, unrelated local-environment gap; wp-admin's menu unchanged in structure/behavior; `docs/ROADMAP.md` reflects real status.

**Implementation notes (2026-08-28):** Reconciled the active Tours registry item with its Staff route by assigning its declared `manage_tours` permission. The Staff route integrity report is clean, including the two new Bookings pages; both visible routes have explicit permissions and renderer templates. The wp-admin group structure was inspected without adding or removing menu items. PHP lint and scoped diff-whitespace checks passed. PHPUnit cannot initialize in this local CLI because `mbstring` is unavailable; no browser/runtime verification was performed.

---

### Task 10 — Decouple the Staff dashboard from theme (Elementor) chrome

Template shape: Bug fix / rendering infrastructure.

**Goal**: Staff dashboard routes currently render inside the active theme's `get_header()` / `get_footer()`, so the theme's (Elementor-built) site header, footer, and any theme/Elementor-enqueued CSS/JS load on every dashboard page. That's wrong for a tool people use as their working surface — it should read and behave as its own system, not a page embedded in the public site, and it also creates real conflict risk: theme/Elementor CSS and JS (sliders, popups, cookie banners, its own breakpoints) can collide with the dashboard's own styles and the interactive sidebar behavior Tasks 2/11 add (collapsing groups, chevrons, icon buttons). wp-admin is unaffected — it never goes through the theme.

**What already exists, don't rebuild it**: check `ManagedPages` for whether it already has a bare-shell / isolated-rendering mechanism used by any other managed page (e.g. a `template_include` filter that bypasses the theme for the booking widget or another standalone page) before writing a new one — if such a mechanism exists, reuse it for `staff-dashboard` rather than inventing a second isolation path.

**Fix**:
1. Confirm the current rendering path for `staff-dashboard` (post-Task 1 rename) — does it call the theme's `get_header()`/`get_footer()`, and does it inherit any theme/Elementor asset enqueues? Verify from the actual code (`ManagedPages`, `AdminDashboard`, whatever `template_include`/`the_content` hook renders the page) rather than assuming.
2. Route `staff-dashboard` (and everything under it) through a dedicated bare-page template — its own minimal `<html>` shell, enqueuing only the dashboard's own assets (`dashboard-system.css`, the scoped Chart.js enqueue from Task 3/7, etc.) — no theme header, footer, nav, or Elementor scripts/styles.
3. Preserve staff auth/capability gating exactly as it is today.

**Non-goals**: no change to wp-admin's rendering (already isolated). No visual redesign here — that's Tasks 2/3/11. No routing/URL change beyond what Task 1 already did.

**Required reading**: `src/Core/ManagedPages.php` (rendering/template-selection logic), `src/Dashboard/AdminDashboard.php`, `src/Core/Assets.php` (current enqueue conditions for dashboard vs. theme assets).

**Acceptance criteria**: every staff-dashboard route renders with zero theme/Elementor markup or enqueued assets — verified by inspecting the rendered DOM and the actual enqueued script/style list, not just a visual check; existing `AdminMenuRegistry`-driven pages keep working unchanged; staff auth/capability gating is unchanged. Real verification required: before/after screenshots plus dev-tools evidence (enqueued asset list) attached to the PR.

---

### Task 11 — Sidebar visual finish: full page tree, pine accent, profile actions

Depends on **Task 2** (grouped sidebar) being merged — this extends that grouping, it doesn't replace it. Where possible, also sequence after whichever of Tasks 4/5/6/8 have landed, since several of the sub-items this task exposes (List/Create/Edit Hotel, List/Create/Edit Tour, Reviews) only have real destinations once those tasks ship — link to what already exists and use the existing `not-available`-style placeholder pattern for anything that doesn't yet, rather than a dead link.

**Reference**: [Sidebar mockup](https://claude.ai/code/artifact/d1dc94d1-34b9-4745-b9eb-2d141b859e07) — build to match this, not just approximate it.

**Goal**: Task 2 shipped the grouped sections and an icon-bubble profile chip. This task finishes what the owner and Claude worked out visually: every group's real sub-pages exposed as collapsible children (not just top-level links), the accent switched from red to the plugin's pine tokens, and two small profile-chip affordances (edit-profile shortcut, notification/message icons) that Task 2 didn't include.

**What already exists, don't rebuild it**: Task 2's permission-filtered grouping logic is correct — this task only adds a collapse/expand layer and children on top of it, it does not change which groups/items are visible to which permission. Reuse whatever token names the plugin's other Milestone 17/18 visual work already established for its accent color rather than introducing a new one — confirm the exact token/variable while reading `dashboard-system.css`.

**Fix**:
1. For Hotels, Tours, All Customers, Overview Reports, and Staff Users, add a chevron-toggle that reveals their real sub-pages: Hotels → List of Hotels / Create Hotel / Edit Hotel / Room Inventory; Tours → List of Tours / Create Tour / Edit Tour; All Customers → Customer Profile / Customer Notes; Overview Reports → Booking / Revenue / Listing / Customer Reports; Staff Users → Roles / Permissions / Activity Logs. Link each child to its real route where Tasks 4-8 already built one; use the existing placeholder pattern where one doesn't exist yet, and note any remaining gaps in the PR.
2. Swap the active/hover nav accent from red to the pine accent token already used elsewhere in the plugin's redesigned dashboards — confirm the exact variable name in `dashboard-system.css` before adding a new one.
3. Add a small edit-icon badge on the profile chip's avatar (bottom-right corner) linking to the staff member's profile-edit screen.
4. Add two icons to the right of the name/role block in the profile chip: notifications (unread-count badge, if a real unread-count source exists — check before wiring; omit the badge rather than fake a number if it doesn't) and conversations/messages (same rule).
5. Add a Settings entry (gear icon, normal text styling) above a divider in the sidebar footer, ahead of Logout — Logout keeps its current red icon/text styling unchanged.

**Non-goals**: don't build destination pages for sub-items that still don't exist after Tasks 4-8 — link to the nearest existing placeholder and note the gap. Don't touch Task 2's permission-filtering/grouping logic beyond adding the collapse/expand layer. No responsive/breakpoint changes.

**Required reading**: `templates/dashboards/staff/partials/sidebar.php` (post-Task 2), `src/Dashboard/AdminMenuRegistry.php::frontendSidebarItems()` (including whatever Tasks 4-8 added), `assets/css/pages/dashboard-system.css` (accent token names).

**Acceptance criteria**: Hotels/Tours/All Customers/Overview Reports/Staff Users each expand via a chevron to their listed children, linking to real routes where they exist; active/hover state uses the pine accent, not red; the avatar has a working edit-profile badge; notification/message icons are present, with badges shown only where real data backs them; Settings + Logout sit in the footer with a divider between them, Logout still styled red; no nav item leads to a blank page or 404.
