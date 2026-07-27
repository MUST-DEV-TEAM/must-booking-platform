# Milestone 6: Public Booking Widget (Guest-Facing Frontend)

Status: Not started
Depends on: Milestone 5

## Goal

A guest-facing booking UI — search, select room, checkout, confirmation, cancellation — that talks only to the MUST Public API, buildable as an embeddable bundle. This is the first concrete piece of `apps/booking-widget` from `docs/ARCHITECTURE.md`, and proves the "no provider credentials, no domain logic in the frontend" principle before it is ever pointed at the legacy WordPress plugin. Done means: a guest can complete a full booking end-to-end through this widget in a standalone test page.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. `apps/booking-widget` scaffold: isolated React bundle/web component, per `docs/ARCHITECTURE.md`.
2. Search/availability UI against Milestone 3/4's local availability query.
3. Room selection and quote display UI.
4. Checkout UI (guest details form + Stripe Elements/Checkout redirect from Milestone 5).
5. Booking confirmation page.
6. Signed-link cancellation flow (guest cancels via a signed URL, no login — per predecessor system's model in `docs/PROJECT_CONTEXT.md`).
7. Responsive/mobile layout pass.
8. Basic theming/design tokens so the widget can be reskinned per tenant later (not full white-labeling — just the mechanism).
9. Embed packaging: a build target that can be dropped into a plain HTML page or WordPress via a script tag/shortcode stub (full WordPress plugin integration is a post-Milestone-10 backlog item, not this milestone).
10. E2E test: full guest journey (search → select → checkout → confirmation → cancel) against a seeded test tenant.

## Explicitly not included

- Rebuilding/decommissioning the legacy WordPress plugin's own booking flow (post-Milestone-10 backlog, per `docs/ROADMAP.md`).
- Multi-tenant white-labeling/theming beyond the basic token mechanism.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
