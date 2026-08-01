# ADR-0016: Guest-facing frontend is the retrofitted legacy WordPress plugin, not a new widget

Status: Accepted
Date: 2026-07-30

## Context

At project inception, `docs/PROJECT_CONTEXT.md` and `docs/ARCHITECTURE.md` recorded a plan for the guest-facing frontend: build a new, green-field `apps/booking-widget` (an isolated React bundle/web component, framework-agnostic, embeddable via script tag or shortcode into any site including WordPress), and separately, as a post-Milestone-11 backlog item, retrofit the legacy single-tenant WordPress plugin (`MUST-DEV-TEAM/must-hotel-booking`) to use that widget and retire its own domain/payment/PMS code.

The owner has now decided they want the actual guest experience to keep looking and working like the existing WordPress plugin does today, rather than being replaced by a new bespoke UI. The legacy plugin's UI/UX is not the problem being solved by this rewrite — `docs/PROJECT_CONTEXT.md`'s stated reason for the rewrite is that the plugin's *domain logic* (booking state, payment integrity, PMS sync) is entangled inside WordPress and hardcoded single-tenant, not that its frontend is bad. Building a brand-new UI from scratch would mean redoing already-built, presumably-working UI work for no architectural benefit.

## Decision

Import the legacy plugin's code into this monorepo as `apps/wordpress-plugin`. Retrofit it in place: strip its own booking domain logic, payment integration, and Clock PMS sync code entirely, and replace those code paths with calls to the MUST Public API (the same API Milestones 4/5 are building). Keep its existing UI — templates, assets, shortcodes, guest-facing look and feel — largely as-is. Add tenant/property configuration to the plugin's settings screen (API base URL, tenant ID, property ID — all non-secret, safe to store in WordPress options) so each tenant's own WordPress install can be pointed at their own tenant/property within the shared multi-tenant backend, replacing every place the legacy code hardcoded "this WordPress site = the one hotel."

**Refined at Milestone 6 kickoff (2026-07-31): no new plugin credential.** The plugin does not authenticate as itself. Its JS calls the MUST Public API directly from the guest's own browser, exactly like any other guest-facing caller — using ADR-0017's existing anonymous `must_guest_session` cookie model, with tenant/property ID already public in the URL path. No API key/credential issuance, rotation, or storage is needed for the plugin at all; the original "plugin-scoped API credential" language above is superseded by this.

There is no separate green-field `apps/booking-widget` package. The retrofitted plugin is the guest-facing frontend.

**Refined during Milestone 6 Task 4 review (2026-07-31): the plugin's WordPress Admin back-office and Staff Portal are removed, not retrofitted.** Stripping the plugin's own booking-domain logic broke ~40 files' worth of staff-facing tooling (dashboard, reservations, calendar, payments admin, reports, the Staff Portal) that depended on it — none of it is part of the guest journey this ADR scopes, and Milestone 8's Tenant Admin Dashboard is already building the real staff-facing replacement. Rather than repair or retrofit that surface to talk to the MUST API too, it is deleted outright (Milestone 6 Task 5). The plugin's multi-tenant settings screen (tenant ID/property ID/API base URL) is the one piece of admin-side UI that survives, since guest-facing behavior depends on it.

## Consequences

- **Milestone 6 is rescoped**, from "build a new embeddable widget from scratch" to "import and retrofit the legacy plugin." Its draft task areas (`docs/roadmap/milestones/06-public-booking-widget.md`) need rewriting at that milestone's kickoff — the file is updated now with a note pointing here, but the real 10-task table is still written at kickoff per the normal process, not by this ADR.
- **The post-Milestone-11 backlog item "Legacy WordPress plugin migration/decommissioning"** (`docs/ROADMAP.md`) is removed from the backlog — this ADR moves that work into Milestone 6 itself, in-sequence, rather than deferring it.
- **The core principle is unchanged and non-negotiable**: per `docs/PROJECT_CONTEXT.md` and `docs/ARCHITECTURE.md`, the plugin must hold no PMS/payment provider credentials, contain no booking domain logic, and talk only to the MUST Public API. This ADR changes *which codebase* becomes the guest frontend, not the architectural boundary around it — the retrofit's entire purpose is removing the plugin's own domain/payment/PMS code, not adding a new option alongside it.
- **First real task at Milestone 6 kickoff must be an audit pass**, before any UI-wiring task is written: inventory every place the legacy plugin currently assumes single-tenant operation (hardcoded hotel identity, stored Clock/payment credentials, direct PMS calls, its own booking state handling) so the task table is written against known facts, not assumptions about what needs stripping.
- **`packages/domain-contracts`'s `PmsProvider`/`PaymentProvider` interfaces and Milestones 4/5's work are unaffected** — the plugin retrofit is purely a consumer of the same Public API any other frontend would use; no backend contract changes because of this decision.
- **This does not start now.** Milestones are worked in order (`docs/roadmap/README.md`); Milestone 6 depends on Milestone 5 and is not kicked off until Milestone 5 closes out. This ADR records the decision so `PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, and the Milestone 6 file reflect the real plan in the meantime — actually cloning/importing the legacy repo and auditing its code is Milestone 6 kickoff/task work, not something done as part of recording this ADR.
- A framework-agnostic, non-WordPress widget (for hotels without a WordPress site) is not built preemptively — it remains a possible future addition if a tenant without WordPress needs one, but is out of scope until an actual tenant needs it.

## Alternatives considered

- Green-field `apps/booking-widget`, WordPress retrofit deferred to backlog (the original `PROJECT_CONTEXT.md`/`ARCHITECTURE.md` plan): rejected per the owner's explicit preference — it would rebuild UI/UX that already exists and works, and pushes the plugin's real domain-logic problem (the actual reason for this rewrite) further out rather than resolving it during the guest-frontend milestone.
