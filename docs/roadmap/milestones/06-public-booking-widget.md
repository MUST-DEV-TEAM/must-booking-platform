# Milestone 6: WordPress Plugin Retrofit (Guest-Facing Frontend)

Status: Not started
Depends on: Milestone 5

## Goal

Per [ADR-0016](../../decisions/ADR-0016-guest-frontend-is-retrofitted-legacy-plugin.md) (2026-07-30): the guest-facing frontend is not a new green-field widget. It is the legacy single-tenant WordPress plugin (`MUST-DEV-TEAM/must-hotel-booking`), imported into this monorepo as `apps/wordpress-plugin` and retrofitted so its own booking domain logic, payment integration, and Clock PMS sync code are stripped out and replaced with calls to the MUST Public API, while its existing UI/templates/guest-facing look and feel are kept. Multi-tenant configuration (API base URL, tenant ID, property ID, plugin-scoped API credential) is added to its settings screen so each tenant's own WordPress install can point at their own tenant/property in the shared backend. Done means: a guest can complete a full booking end-to-end through the retrofitted plugin, talking only to the MUST Public API, with no PMS/payment credentials or booking domain logic left inside WordPress.

## Draft task areas (not final — define the real 10 tasks at kickoff; the first task must be the audit pass below, before any UI-wiring task is written)

1. Import the legacy plugin's code into this monorepo as `apps/wordpress-plugin`.
2. Audit pass: inventory every place the legacy code assumes single-tenant operation (hardcoded hotel identity, stored Clock/payment credentials, direct PMS/payment calls, its own booking state handling) — produces the concrete list the remaining tasks are scoped against, not assumptions.
3. Strip the plugin's own booking domain logic (state handling, availability checks) and replace with calls to Milestone 4's booking API.
4. Strip the plugin's own payment integration and replace with calls to Milestone 5's guest-payment API.
5. Strip the plugin's own Clock PMS sync code entirely (no direct PMS calls of any kind from WordPress).
6. Add tenant/property configuration to the plugin's settings screen (API base URL, tenant ID, property ID, plugin-scoped API credential), replacing every hardcoded single-tenant assumption found in the audit.
7. Rewire the existing UI templates (search, room selection, checkout, confirmation) to the MUST Public API responses, keeping the existing look/feel/markup as-is wherever it doesn't depend on removed code.
8. Signed-link cancellation flow (guest cancels via a signed URL, no login), matching the plugin's existing cancellation UI where one exists.
9. Credential/config security pass: confirm no PMS/payment credentials or secrets remain in the plugin's code, database options, or logs.
10. E2E test: full guest journey (search → select → checkout → confirmation → cancel) against a seeded test tenant, running the actual retrofitted plugin against a real WordPress instance.

## Explicitly not included

- A separate framework-agnostic widget for non-WordPress sites (backlog, only if an actual tenant needs it).
- Full white-labeling/theming beyond whatever the legacy plugin's existing theming already supports.
- Multi-tenant marketplace distribution of the plugin (e.g. WordPress.org listing) — each tenant's install is configured directly for now.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
