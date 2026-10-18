# Milestone 24 — Codex handoff (screen restyles on existing data)

Owner: Astra plans, Codex implements, Claude verifies. This file is the spec; the dispatch prompt only points here.

## What Codex may do, and what it may not

**May do (safe):** restyle an existing dashboard screen to the new component set, on the data and API routes that already exist. No new tables, no new endpoints, no changed business rules.

**Must not do:** database migrations, API or domain-contract changes, payment, refund, cancellation or Clock logic, auth, permissions. If a screen seems to need one of these, stop, leave that part hidden or disabled, and write it down as a gap in `24-dashboard-redesign.md` (section for that page). Do not invent data or requirements.

## Tasks (do one at a time, in this order, report after each)

| # | Task | Existing code | Done when |
| --- | --- | --- | --- |
| C1 (done, reworked by Claude) | **S06 Guests: directory and profile.** Directory: page header, tabs or filter chips where data exists, search on the right, sortable shared table like Payments/Bookings, row menu, pagination, empty/no-results/error/loading panels. Profile: detail header, summary tiles, reservations table, notes/flags only if stored today, activity only if the data exists | `guests.tsx`, `guest-detail.tsx`, `guest-lookup.tsx` | Both screens use only `components/ui`; old `@must/ui` imports and `guests.module.css` gone from these files; tests updated; browser check done |
| C2 (done, accepted by Claude 2026-10-17) | **S13 Staff list and detail restyle** (users, invite dialog, suspend dialog). Roles matrix, custom roles and access log stay hidden and logged as gaps | existing staff screens | Same as C1 |
| C4 (done, accepted by Claude 2026-10-17) | **Staff v2 screens against the contract in `24-staff-access-plan.md`**: Add staff dialog (create account with owner-chosen password and a Generate strong password button, or send invitation), Roles tab with a permissions matrix, richer staff detail, list cleanup (no Hotel scope column, plain words, Status and Last active, Suspended tab). Claude builds the endpoints in parallel; Codex codes and tests against the contract with mocked fetch and does not touch the API | `staff.tsx`, `staff-detail.tsx`, `staff-sheet.tsx` | Screens match the plan; tests mock the contract; new shared components in `components/ui`; browser check after Claude's endpoints land |
| C3 (done 2026-10-17; superseded by the Accommodations Parts 1-8 and the 2026-10-18 corrections, reviewed by Claude) | **S08 Accommodation lists restyle** (room types and rooms lists/detail) | existing accommodation screens | Same as C1 |
| C5 (done 2026-10-17) | **Staff permission multi-select** replacing the permission matrix on editable staff screens | staff screens | Same as C1 |
| Next | **Inventory (Page 14), then Rates & Pricing (13), Reports (19), Settings (21/22).** Hotels waits for a design. Each needs a backend contract written first where the design exceeds existing data (Inventory: restrictions G85, block reason/creator G41). Add rows here when the contract exists. | | |

## Lessons from C1 (what the first attempt missed; do not repeat)

A list screen is not finished when it only uses `Table`. It must match the Bookings table feature for feature, using the shared pieces:

- row checkboxes with select-all and a `BulkBar` (copy, export selected);
- `ColumnChooser` and `DensityToggle` with `useTablePreferences('must.<screen>.table', defaults)`;
- sortable headers (`SortableTableHead`), sticky header, pagination with page-size choice, Export CSV;
- tabs with counts for the useful views (derive them from data that exists);
- **a right-hand quick-peek panel on row click** (`QuickPeek`; see `guest-sheet.tsx`), with the row menu and the clickable name opening it too;
- a profile or detail page that is rich, not bare: header with badges and actions, summary tiles, a contact/identity card, and tabs for the related lists and an activity feed.

Copy `guests.tsx`, `guest-sheet.tsx`, `guest-detail.tsx` and `guest-stats.ts` as the reference for structure. Compute figures from data the screen already loads (like `guest-stats.ts`); if a figure needs new data, hide it and log the gap.

## How to work (exactly the method used for Calendar, Payments and Guests)

1. Read `AGENTS.md`, `CLAUDE.md`, `docs/roadmap/milestones/24-dashboard-redesign.md` (the page's section and the progress log) before editing. Inspect the files above first.
2. **Components only.** Open `apps/web/components/ui/` first. Compose pages from it. If a piece is missing, build it as a shared component there (small, typed props, a one-line doc comment) and use it; never write per-page one-off UI. Good references to copy the look and structure from: `payments.tsx` (list), `payment-detail.tsx` (detail), `reservations-page.tsx` (table, preview), `payments-overview.tsx` (lists), `guests.tsx` + `guest-sheet.tsx` + `guest-detail.tsx` (directory, quick peek, profile), `refund-choice.tsx` and `payment-refund-dialog.tsx` (dialogs on `ConfirmDialog`).
3. **Scoped Tailwind gotchas** (the dashboard has no preflight): native `button` needs `bg-transparent p-0`; raw `p`, `ol`, `ul` need `m-0 p-0`; do not put `m-0` on a child of a `space-y-*` parent, use `flex flex-col gap-*`.
4. **Same behaviour, new look.** Keep the data fetching, query keys, hrefs and capability checks. Keep every existing action working (or hidden if it cannot be done on existing data).
5. **Not built means hidden or disabled**, and a row is added to the page's gap list in `24-dashboard-redesign.md`. Never show a feature that does nothing.
6. **Tests.** Update the tests of the files you change for the new markup; Radix menus open on `pointerdown`, dialogs render in `document.body`. Add a test for any new shared component logic. A source-text assertion is not proof of behaviour.
7. **Verify (all must pass, report real output):**
   - Type-check: `cd apps/web && node --max-old-space-size=3500 ../../node_modules/typescript/bin/tsc --noEmit -p .`
   - Tests of what you touched, one worker: `NODE_OPTIONS=--max-old-space-size=3000 npx vitest run --pool=forks --poolOptions.forks.singleFork <paths>`
   - Then the whole web suite the same way. Known failing, unrelated: 2 stale `/design` tests. Report anything else that fails.
   - Look at the page in a browser with the local Playwright scripts in `.local/` (login, then screenshot) and attach what you saw. A page can use only real components and still look wrong.
8. **Docs.** Add one row to the Progress log in `24-dashboard-redesign.md`: what is done, what is not, gaps found. Be factual; do not write "complete" for anything not verified.
9. **Git.** Commit with explicit pathspecs only (`git commit -m "..." -- path1 path2`); the index is shared. Read `git show --stat` after. **Do not push, do not deploy.**
10. **Secrets.** Never print credentials. The local demo data and accounts are for local use only.

## Report format (one per task)

Implementation summary; changed files; tests added/changed; commands run with results (including failures); screenshots seen; assumptions; gaps added to the doc; remaining TODOs. Claude then reviews against this file, runs the full suite, and records status.
