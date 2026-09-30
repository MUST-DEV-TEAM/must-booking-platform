# Milestone 24: Living style guide

Status: **Implemented 2026-10-01 (tasks 1-9), committed, not yet deployed and not yet seen rendered in a browser** (no platform-admin session was available to screenshot it; verified by type-check, 209 passing web tests including an axe scan, and a successful `next build` that lists `/platform/styleguide`).
Runs as an authorized ad hoc track alongside Milestones 22 and 23. It does not renumber the main sequence.

## Goal

One single page, `/platform/styleguide`, that shows every design foundation and every shared component we have, in every state, so screens are assembled from known parts and drift is visible. Internal only.

## Decisions (owner answers 2026-10-01)

| # | Decision | Outcome |
| --- | --- | --- |
| 1 | Audience and access | Team only. Route behind platform-admin login; never public. |
| 2 | Source of truth | The code tokens (`packages/ui/src/tokens.ts`, `styles.css`). Figma and the Claude Design System export are references we align to the code. |
| 3 | Layout | One long single page with a sticky side menu and jump links. No tabs, no per-component pages. |
| 4 | State display | Static grid of every state side by side (default, hover, focus, active, disabled, loading, error). Hover and focus are forced so they can be screenshotted. No playground in v1. |
| 5 | Helper | Click a swatch, token or class name to copy it. No contrast table, usage notes or code snippets in v1 (the automated axe scan covers accessibility, below). |
| 6 | Theme | Light only. "Dark theme" is a planned title; the app has no dark tokens today. |
| 7 | Stay current | An automated test fails when a component exported from `@must/ui` has no entry on the page. |
| 8 | Hardcoded colours | The page reports raw hex values in CSS modules ("token drift", about 107 today vs 461 token uses). Fix gradually, starting with the photo-library components. No big-bang cleanup. |
| 9 | Planned sections | Title plus one line on what it will contain. Notifications, Data display, Dark theme, Email templates. No components are built for these. |
| 10 | Deprecated tokens | Shown in their own "Deprecated" group with the replacement token and removal version. |
| 11 | Accessibility | Automated axe scan over the page in the test suite. |
| 12 | Timing | Built while waiting on the R2 bucket; deployed after the photo release so it stays off the release's critical path. |

## Page sections, in order

1. **Foundations:** colours (grouped by role and status pairs), type scale and font families, spacing, radii, shadows.
2. **Form controls:** buttons, inputs, selects, checkboxes, date pickers.
3. **Feedback:** badges (booking and payment status pairs), toasts, state panels (empty / loading / error), dialogs including the property photo library dialog.
4. **Token drift:** raw hex values found in CSS modules, grouped by file, with the nearest token.
5. **Deprecated tokens.**
6. **Planned (titles and one line only):**
   - Notifications: in-app list, bell, banners.
   - Data display: cards, tables, KPI tiles, calendar, photo gallery.
   - Dark theme: dark token set and theme switch.
   - Email templates: branded layouts from Milestone 22.

## Tasks

| # | Task | Status |
| --- | --- | --- |
| 1 | Inventory what `@must/ui` exports and which shared components live only in `apps/web`; decide which belong on the page and which move into `@must/ui`. | Done |
| 2 | Route and shell: `/platform/styleguide` behind the platform-admin guard (`AuthRouteGuard audience="platform"`), sticky side menu, section anchors, responsive layout. | Done |
| 3 | Foundations sections generated from `tokens.ts`/`styles.css` (single source, nothing retyped by hand), with click-to-copy. | Done |
| 4 | State-grid helper that renders a component in every state with forced hover/focus/active. | Done |
| 5 | Form-control and feedback sections built on the helper. | Done |
| 6 | Token-drift report (scan of `apps/web/app/**/*.css`) and Deprecated-tokens group. | Done |
| 7 | Planned sections (titles and one line). | Done |
| 8 | Tests: coverage test (every `@must/ui` export has an entry), axe accessibility scan over the page, render smoke test. | Done |
| 9 | Fix the hardcoded colours in the photo-library components as the first drift cleanup, verified visually. | Done |

## Acceptance

- The page renders every foundation and in-scope component in every state, using the real components and tokens.
- Adding an exported component to `@must/ui` without an entry fails the test suite.
- The axe scan passes (or every exception is documented).
- The route is unreachable without a platform-admin session.
- No new design values are typed by hand on the page; it reads the tokens.

## Risks

- **A second design authority:** the page must show code tokens only. Figma and the Claude export are not re-entered into it.
- **Forced hover/focus:** needs a documented approach (class-based state overrides vs pseudo-class emulation) that does not change the components' real CSS.
- **Stale entries:** mitigated by the coverage test; the test only checks exports, so it cannot catch a stale state grid.

## Implementation notes (2026-10-01)

- Code: `apps/web/app/platform/styleguide/`. Foundations, form controls and feedback are built from the real `@must/ui` components; token values are read from the live stylesheet at runtime, nothing is retyped.
- Forced hover/focus/active: rules using those pseudo-classes are cloned from the live stylesheets with the pseudo-class swapped for `.sg-hover` / `.sg-focus` / `.sg-active` (see `specimens.tsx`). Needs a visual check in a browser.
- Coverage test: every PascalCase export of `@must/ui` needs an entry in `coverage.ts`. `NavigationSectionTabBar`, `NavigationSectionTabItem` and `NavigationPagination` are documented under Form controls; `AppShell`, `SidebarNavigation` and `MobileDrawerNavigation` are listed under Planned (they need a full-page or phone-width preview).
- Token drift: `drift.ts` scans `apps/web/app/**/*.css`; `token-drift.generated.json` is checked in and the test fails when it is stale (`UPDATE_DRIFT=1 pnpm --filter web test styleguide` regenerates it). It also lists tokens declared in `styles.css` but missing from the `designTokens` registry.
- Axe scan: jsdom has no layout, so the color-contrast rule is disabled; contrast still needs a visual check against the token pairs.
- Task 9: the three photo-library CSS modules now use tokens only (hardcoded colors 112 → 58 across 3 remaining files). Note the brand green used there before (`#245846`) was not the `ink` token (`#174c3c`), so those components are now very slightly darker.
- Select, checkbox and radio have no shared component; the page shows the native controls and says so.
