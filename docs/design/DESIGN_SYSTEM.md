# Design System Foundation — Milestone 13 reference

Status: reference document, not an ADR. Written to give Milestone 13 kickoff and every dispatched task a single source of truth for tokens and component names, replacing ad-hoc lookups in the Figma file or the Claude-Design export.

## Sources

1. **Figma file** — `zhCG5chiRQccT69cqBRLaK`, the canonical design source, reachable live via the Figma MCP connection. It has **two pages**, and both matter:
   - `0:1` — **00 — Base & Components**: the token/component library (what the export below mirrors).
   - `3:2` — **01 — Admin Dashboard**: the actual **screen designs** — 23 sections, ~200 frames, covering Auth, Dashboard, Reservations, Calendar, Accommodations, Rates & Pricing, Availability, Payments, Guests, Emails, Coupons, Reports, Provider & Integrations, Settings, WordPress Plugin, Staff/Roles/Audit, Notifications Center, shared states, a responsive system (tablet 1024 / mobile 390), sensitive-action + accessibility contracts, and prototype overlays.

   Note: `get_metadata` with no `nodeId` lists only page `0:1` — page `3:2` must be requested explicitly by node id. Do not conclude from that page list that the file is components-only.
2. **Claude-Design export** (`Design System.zip`, captured 2026-08-13) — a code-level mirror of the same Figma file: 74 Figma component families expanded into 155 importable JSX components with literal design-token references and a `_ds_manifest.json` inventory. This is the more direct source for **component names** used in task acceptance criteria (e.g. `KPICardSizeStandardTrend`); the Figma file remains the source of truth for anything the export doesn't cover (layout intent, states not yet componentized, screenshots for fidelity comparison).

Both sources agree on the token layer (same `--color-*`, `--space-*`, `--radius-*` values), so there is one token vocabulary below, not two.

## Brass tokens — resolved

**Decision (2026-08-23, confirmed by Dejvis):** brass stays as a **semantic exception** to the "pine only" branding rule. It remains wired to `--color-domain-guest`, the no-show/reserved status pairs, and `--color-focus-ring`/`--color-accent-brass` — these are semantic/status uses, decoupled from "brand accent," not a violation of the pine-only decision. The payment/refunded pair uses the verified warning foreground because brass is not AA-readable on its warning surface. No Figma/export changes are required. Safe to scope status-badge, focus-ring, and guest-domain-coloring tasks without further sign-off on this point.

## Token reference

All values below are CSS custom properties; component JSX references them by name (never hardcoded hex), so Figma-fidelity checks should diff against these names, not raw colors.

### Color — surfaces & text

| Token | Resolves to |
| --- | --- |
| `--color-surface-canvas` | neutral-50 `rgb(247,249,252)` |
| `--color-surface-default` | neutral-0 `rgb(255,255,255)` |
| `--color-surface-subtle` | neutral-100 `rgb(241,245,249)` |
| `--color-surface-disabled` | neutral-100 |
| `--color-surface-inverse` | neutral-900 `rgb(23,32,51)` |
| `--color-surface-selected` | pine-50 |
| `--color-text-primary` | neutral-900 |
| `--color-text-secondary` | neutral-500 |
| `--color-text-tertiary` | neutral-400 |
| `--color-text-disabled` | neutral-300 |
| `--color-text-link` | pine-700 |
| `--color-text-inverse` | neutral-0 |
| `--color-border-subtle` / `-default` / `-strong` | neutral-100 / neutral-200 / neutral-300 |
| `--color-border-focus` | pine-600 |
| `--color-focus-ring` | brass-500 (also flagged above — focus ring is brass, separate from the domain/status question) |

### Color — brand & action

| Token | Resolves to |
| --- | --- |
| `--color-brand-strong` | pine-800 |
| `--color-brand-subtle` | pine-50 |
| `--color-action-primary` | pine-800 |
| `--color-action-primary-hover` / `-pressed` | pine-900 |
| `--color-action-primary-soft` | pine-100 |

### Color — status (booking / payment / room)

| Domain | Pending | Confirmed/Paid/Available | Cancelled/Failed/Out-of-service | Checked-in/Occupied | Checked-out | No-show/Reserved (brass) / Refunded (AA warning) |
| --- | --- | --- | --- | --- | --- | --- |
| Booking | amber | green | red | pine | neutral | brass |
| Payment | amber | green | red | — | — | amber (refunded, AA warning pair) |
| Room | amber (maintenance) | green (available) | red (out of service) | pine (occupied) | — | sky (cleaning) / brass (reserved) |

Each status pair is `--color-status-{domain}-{state}-background` / `-foreground` — always use the pair together, never background alone.

### Color — chart series & domain colors

`--color-chart-series-1..6` = pine-800, brass-500, sky-500, violet-500, green-500, amber-500-2 (fixed order — reuse for any new chart, don't invent a 7th).

`--color-domain-{guest|hotel|integration|payment|room|system}` = brass / pine-800 / violet-500 / sky-500 / pine-500 / neutral-600 — used to color-code entity types across cards, icons, and activity timeline items consistently.

### Spacing, radius, shadow, motion

- Spacing scale: `--space-{2,4,6,8,12,16,20,24,32,40,48,64}` (px, matches the value in the name).
- Control/table row heights: `--size-control-default` = 40, `--size-table-row-default` = 48.
- Radius: `--radius-8` / `--radius-12` (base), `--radius-control` = 8, `--radius-card` = 12, `--radius-input` = 12, `--radius-full`/`--radius-pill` = 999.
- Shadow: `--shadow-card` (subtle 1px), `--shadow-overlay` (modals/drawers), `--shadow-focus-ring` (brass-tinted, ties to the open question above).
- Motion: `--motion-duration-fast/normal/slow` = 120/180/240ms.
- Type: `--font-body` = Inter, `--font-display` = Manrope.

### Responsive contract — Milestone 13 Task 25

The application foundation exposes four responsive tiers. The CSS custom properties below are
defined in `packages/ui/src/styles.css` and intentionally remain vocabulary-only until the
responsive shell tasks consume them.

| Tier | Viewport | Page padding | Card gap | Heading | Body | Touch target | Card radius |
| --- | --- | ---: | ---: | --- | --- | ---: | ---: |
| Mobile | ≤767px | 16px | 12px | 24/30px | 14/21px | 48px | 10px |
| Tablet | 768–1199px | 16px | 12px | 24/30px | 14/21px | 44px | 12px |
| Laptop | 1200–1439px | 24px | 16px | 28/34px | 13/20px | 44px | 12px |
| XL desktop | ≥1440px | 32px | 24px | 32/38px | 14/20px | 40px | 12px |

The corresponding tokens are `--must-responsive-page-padding`,
`--must-responsive-card-gap`, `--must-responsive-heading-size`,
`--must-responsive-heading-line-height`, `--must-responsive-body-size`,
`--must-responsive-body-line-height`, `--must-responsive-touch-target`, and
`--must-responsive-card-radius`. Breakpoint constants are also exposed as
`--must-breakpoint-mobile-max`, `--must-breakpoint-tablet-min`, `--must-breakpoint-laptop-min`,
and `--must-breakpoint-xl-min`.

For the desktop shell, the persistent sidebar is 220px in the laptop tier and 252px in the XL
tier. It must not be progressively narrowed below those readable widths; the tablet rail and mobile
drawer are the later collapse steps.

At 768–1199px, the shell uses a 72px icon rail. Navigation labels remain in the accessible name
of each link while their visual text is collapsed; the tablet header remains visible and sticky.

At ≤767px, the persistent sidebar is replaced by a hamburger-triggered full navigation drawer and
a four-item fixed bottom navigation: Home, Bookings, Calendar, and More. More opens the same full
drawer, so sections outside the three primary slots remain reachable. The bottom bar reserves
`env(safe-area-inset-bottom)` and every interactive item is at least 44px high.

## Component inventory (155 components, 9 categories)

Full JSX source for every component lives in the Claude-Design export (`Design System.zip`); each file's top comment links back to its Figma node id, e.g. `// figma node: 269:8793 KPI Card / Size=Standard, Trend=Positive, Chart=Yes`. That node-id comment is how to jump from a component name straight to its Figma frame for a fidelity check.

| Category | Count | Covers | Notable named components |
| --- | --- | --- | --- |
| Actions | 37 | Buttons, icon buttons, split/bulk actions, the canonical icon set | `ActionButton`, `ActionIconButton`, `ActionSplitButton`, `ActionBulkToolbar`, `ActionDropdownItem`, `BrandLogo` |
| Activity & Audit | 33 | Timeline events/states/controls, audit entries, notes, payment events | `MUSTActivityTimelineEvent`, `MUSTActivityImmutableAuditEntry`, `MUSTActivityPokPayPaymentEvent`, `MUSTActivityProviderOperation`, `MUSTActivityInternalNoteItem` |
| Cards & Panels | 17 | Entity cards, booking card, alert panels, attention summary | `EntityCardTypeHotel`, `EntityCardTypeRoomType`, `BookingCardDensityStandardAttention`, `AttentionSummaryScopeBookingOperations`, `AlertPanelSeverityCritical/Warning/Information` |
| Charts & KPI | 15 | Chart containers, KPI cards, booking lifecycle timeline | `KPICardSizeStandardTrend`, `KPICardSizeCompactTrend`, `MUSTChartsRevenuePerformance`, `MUSTChartsBookingVolumeTrend`, `MUSTChartsBookingStatusDistribution`, `MUSTChartsPaymentRefundDistribution`, `MUSTChartsProviderOperations`, `MUSTChartsLegend`, state variants (`StateEmpty`, `StateLoading`) |
| Feedback | 5 | Loading spinner, status badge, dismiss/sync buttons | `FeedbackStatusBadgeReference`, `FeedbackLoadingSpinnerReference`, `FeedbackSyncButton` |
| Navigation | 22 | Sidebar, top header, breadcrumb, tabs, pagination, mobile drawer | `NavigationSidebar`, `NavigationSidebarItem/Section`, `NavigationTopHeader`, `NavigationBreadcrumb`, `NavigationTabBar/TabItem`, `NavigationSectionTabBar/TabItem`, `NavigationPagination`, `NavigationMobileDrawer` |
| Overlays: charts & tooltip | 5 | Chart container/header, error/restricted state, tooltip | `MUSTChartsContainer`, `MUSTChartsHeaderControls`, `MUSTChartsStateErrorRestricted`, `OverlayTooltip` |
| Overlays: booking flows | ~18 | Action menus, drawers, modals, date range picker, search, panels, payment/provider status cards | `OverlayActionMenuContextBooking`, `OverlayBookingDetailsDrawerTab`, `OverlayStandardModalContextEdit`, `OverlayConfirmationModalActionConfirm`, `OverlayDestructiveConfirmation`, `OverlayDateRangePickerState`, `OverlaySearchCommandStateResults`, `PaymentCardStatusPaidReconciliation`, `PanelSurfaceDefaultFooterAction/SubtleFooterNone` |

(Component counts are per-file-folder from the export; icon components dominate the Actions/Activity/Navigation counts — see the full 155-name list in the export's `_ds_manifest.json` for exact component-by-component detail when scoping a task.)

## How to use this for Milestone 13 task-writing

- When a draft task says "match the design system's X pattern," name the actual component (e.g. `KPICardSizeStandardTrend`, not "a KPI card") so Codex has one unambiguous target, per the milestone doc's own convention (already done for Tasks 1-2).
- For the Figma-fidelity audit pass (draft area 1), use the component's `figma node:` comment to jump straight to the comparable Figma frame — avoids eyeballing the whole page.
- Status/domain color usage should always go through the semantic token names above, never a raw hex or a primitive color name — this is what "real design tokens" vs. "just uses tokens but doesn't match" (the Task-1-area distinction in the milestone doc) is actually checking.
- Read the relevant screen on page `3:2` before writing any task's acceptance criteria. The screens are far more specified than the built app, and scoping from components alone produces guesses that the design already answers.

## Design vs. built app — known IA divergences (2026-08-23)

Recorded from `01.0 — Dashboard / Overview` (node `298:5113`); the rest of page `3:2` is not yet reviewed screen-by-screen.

- **No separate "Main Dashboard."** The design has one Dashboard with a property-scope control ("Today · single hotel") plus a **Hotels** sidebar item and a Property Selector overlay. The app instead renders a distinct `MainDashboard` for multi-property tenants and `DashboardShell` for single-property — a split the design does not have.
- **Dashboard is tabbed**, not a single scroll: `Overview · Needs Attention · Approvals · Quick Booking · System Health`, plus Empty / Loading / Error & Partial Data states and a KPI & Data Definitions reference screen.
- **Designed sidebar**: Dashboard, Bookings, Calendar, Hotels, Inventory, Payments, Guests, Staff, Reports, Settings. The app has no **Inventory** page and no **Hotels** page; the app's "Reservations" is labelled "Bookings" here; Integrations is not a sidebar item in the design (it sits under Settings / Provider and design section 12).
- **Overview KPI row is 8 cards in two rows of four**, each with icon, context count, delta chip and 7-day trend sparkline — the app currently renders 4 plain stat tiles with no trend or comparison.
- Design sections with **no counterpart in the app at all**: Coupons (10), Emails/templates (09), Availability as distinct from Calendar (06), Notifications Center (16), Roles & permission matrix (15), and a 10-screen Provider & Integrations section (12) versus the app's single integrations panel.
