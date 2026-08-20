# Milestone 13: Application UI/UX & Feature Enhancements

Status: Not started
Depends on: Milestone 12 (Integration & Initial Release Readiness — this milestone does not start until Milestone 12 is fully closed out, per ADR-0028's "no parallel milestones" decision)

**New milestone (2026-08-17, ADR-0028).** Inserted after Milestone 12 and before the Security & Architecture Audit (Milestone 14) and Platform Billing (Milestone 15), at the owner's request — a dedicated pass for application polish and feature work that Milestone 12's integration/hardening scope deliberately excludes.

## Goal

Close the gap between "functional end-to-end" (Milestone 12's checkpoint) and a product that actually looks and feels finished, plus land feature requests that don't have a home in any other milestone. This milestone starts with a **kickoff conversation** with the owner to scope real feature work — the draft areas below are known, already-documented gaps, not the full list.

## Draft task areas (not final — define the real tasks at kickoff)

1. **Figma-fidelity audit pass.** Milestone 9 close-out deliberately deferred this ("build features first, fix Figma-fidelity gaps in a later dedicated pass, don't block on them per-task") — this is that pass. Screenshot-compare real pages against the Figma file (`zhCG5chiRQccT69cqBRLaK`) across the Tenant Dashboard, Platform Admin Dashboard, and WordPress guest flow; fix real visual mismatches, not just token traceability (a page can use only real design tokens and still not match the design).
2. **Resolve open frontend-library decisions**: ECharts vs. Recharts for dashboard charts, and the Dinero.js hold-off — both flagged as open in the frontend library stack but never revisited.
3. **Accessibility verification pass**, per `apps/wordpress-plugin/docs/UI_UX.md`'s own closing note: "Browser, theme, Elementor, keyboard, and screen-reader acceptance were not executed during this consolidation and remain unverified." Also restore the documented focus-outline suppression defect in `assets/css/pages/booking-page.css` (same file, "Current defect" note).
4. **Responsive verification pass** across the guest flow (desktop/tablet/phone) and the staff dashboards — `UI_UX.md`'s "Responsive and compatibility verification" section lists this as expected but unexecuted.
5. **Owner-directed feature work** — scoped at kickoff; no specific features are pre-committed by this ADR.

## Explicitly not included

- Anything that's actually a correctness/security bug, not a polish/feature gap — those belong in Milestone 12's bug-fix buffer or Milestone 14 (Security & Architecture Audit).
- Platform Billing UI (Milestone 15).
- New PMS vendors, new payment providers — backlog per `docs/ROADMAP.md`.

## Tasks

**Kickoff in progress (2026-08-17).** Owner and Claude are going through `apps/web`'s pages one at a time — Tenant Dashboard and Platform Admin first, WordPress guest flow later — deciding per page whether it needs a Figma-fidelity/polish pass, real feature work, or both, then locking a task. Tasks below are added as each page is finished; this is not the full 10 yet.

Design sources for this pass: the Figma file (`zhCG5chiRQccT69cqBRLaK`, tokens/components only — see `reference_figma_file` memory) and a Claude-Design-tool export the owner pasted in chat with the same token family plus a named 155-component inventory (see `reference_claude_design_system_export` memory) — use both; the latter is the more direct source for component *names* to build against.

| # | Task | Acceptance criteria | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | Main Dashboard (multi-property) — aggregate KPIs and property cards | Rework `apps/web/app/dashboard/main-dashboard.tsx` to match the design system's stat/entity-card patterns (`KPICardSizeStandardTrend`, `EntityCardTypeHotel`, `AttentionSummaryScopeBookingOperations` in the design export). Aggregate KPI section becomes 4 separate tiles (Arrivals/Departures/In-house/Occupancy) following the same visual pattern as `overview.tsx`'s `Stat` component (share the component, don't duplicate markup). Each property renders as a real clickable card linking to `/dashboard/{tenantId}?propertyId=...&section=overview` (not just reachable via the header dropdown), showing its own compact KPI line plus an "N need attention" badge when `needsAttention.length > 0` — that field is already returned by the existing `/api/tenants/{tenantId}/properties/{propertyId}/overview` call each card makes, just currently discarded, so no new endpoint. Header gets an eyebrow label + one-line description matching Overview's header pattern. Integrations section left as-is (task 2). | Not started | |
| 2 | Integrations panel cleanup (Main Dashboard) | Restyle `apps/web/app/dashboard/[tenantId]/integrations-management.tsx`'s connection list and "Add a connection" form using the design system's icon/status-badge/action-menu patterns (`IconPlugIntegration`, `IconProviderOperation`, status-badge treatment reused from booking/payment statuses, `ActionIconButton`/an overflow action menu, `OverlayStandardModalContextEdit`) instead of raw stacked form controls. Each connection card gets a provider-icon + name + color-coded status badge header row (PENDING/CONNECTED/FAILED mapped to the existing warning/success/danger status tokens, not invented colors); "Test connection"/"Delete" consolidate into a single overflow action menu per card; the always-visible property-checkbox list becomes a more compact/expandable control (all properties must stay reachable and keyboard-accessible); "Add a connection" moves into a modal/drawer opened from a button instead of always rendering inline. Visual only — no change to mutation/query logic, endpoints, credential field definitions, or required-field validation. Clock catalog sync sub-panel untouched. | Not started | |

More tasks to follow as remaining Tenant Dashboard and Platform Admin pages are reviewed.
