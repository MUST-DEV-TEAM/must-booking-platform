# Milestone 9: Tenant Admin Dashboard

Status: Not started
Depends on: Milestone 7 (Auth Pages — shared login + component library); Milestone 5 (guest payments ledger)

**Sequencing note (2026-07-31):** this milestone now lands *before* Milestone 10 (Individual Room Booking) — the reverse of the original order. Tasks 3 and 7 below reference Milestone 10 features that won't exist yet when this milestone starts; they ship against today's room-type-only pooled model and get an explicit deferred follow-up task once Milestone 10 lands, rather than blocking on it.

**Carried forward from Milestone 2 (Task 8, 2026-07-28):** Milestone 2 built a read-only tenant plan-usage API (staff-seat count vs. `max_staff_seats`) but shipped no UI, since the dashboard had no staff-management screen yet. When this milestone's staff-management UI (invite/role-change/remove) is built, surface a disabled "Invite staff" control with an "Upgrade to unlock more" prompt once the plan-usage API reports the seat cap reached — no trial countdown, no real upgrade flow (that's Milestone 11).

## Goal

The staff-facing `apps/web` Next.js dashboard covers day-to-day hotel operations: reservations, payments, guests, staff, and settings — RBAC-gated per `docs/TENANCY.md`. Done means: a hotel's staff can run their day (see bookings, create a walk-in reservation, handle a refund, add a staff member, adjust settings) without touching the database directly.

## Draft task areas (not final — define the real tasks at kickoff; task count is whatever the real scope needs, not fixed at 10)

1. Dashboard shell/navigation, RBAC-gated per role (`docs/TENANCY.md`) — consumes the component library/design tokens Milestone 7 already built; no ad hoc styling here.
2. Reservations list + detail view (status, guest, dates, payment status).
3. Staff-initiated booking creation — **new (2026-07-31), the reception walk-in case.** A distinct `@TenantScoped` booking-creation endpoint (not the guest-facing `@PublicTenantScoped` one) — same `LocalPmsProvider` domain logic, but authenticated via the staff's real session, no guest-session cookie, and no Stripe redirect (settled at the desk — reuses the `PAY_AT_HOTEL`/manual-settlement path already established in Milestone 5). Plus the UI screen for it: search availability, pick room/rate, enter guest details, create.
4. Calendar view of bookings/availability. Deferred follow-up once Milestone 10 lands: add its manual-blocking controls (target All / a room type / specific individual room(s), combinable).
5. Payments/refunds view (surfacing Milestone 5's ledger, refund action from the UI).
6. Guests view (guest records, booking history per guest).
7. Staff management UI (invite, role change, remove — surfacing Milestone 1's APIs).
8. Settings UI: hotel identity, booking rules, managed-page-style configuration (mirroring the predecessor plugin's settings scope, per `docs/PROJECT_CONTEXT.md`, but for the new backend). Deferred follow-up once Milestone 10 lands: add its per-property booking-mode setting (A/B/C).
9. Basic reports (occupancy/bookings-over-time — simple, not the full observability suite from Milestone 13).
10. In-app notifications/activity log surface (trial countdown from Milestone 2, payment events, etc.).
11. E2E test covering the core staff workflows above, including the new staff-booking-creation path.

## Explicitly not included

- Platform billing/subscription management UI (Milestone 11 — a tenant's *own* billing/upgrade screen, as distinct from operational settings here).
- Full analytics/BI-grade reporting.
- Milestone 10's room-level picker/manual-blocking UI (tracked as explicit deferred follow-ups above, not built until Milestone 10 lands).

## Resolved ahead of kickoff (2026-07-31)

The owner has produced Figma designs for this dashboard (page "01 — Admin Dashboard", 22 sections) ahead of this milestone starting. Reviewed node-by-node against current backend decisions; three conflicts were found and resolved with the owner before kickoff, so the real task table (written when Milestone 8 closes and this milestone actually starts) doesn't have to re-litigate them:

- **Coupons (design section 10, fully designed: list/create/edit/usage/expired states) is out of scope.** Milestone 6 Task 4's review already established coupons are architecturally incompatible with the signed-quote model (`QuoteService` verifies an exact, server-computed total; no discount concept exists anywhere in the schema/API). The design section is not built; the backend decision stands.
- **WordPress Plugin settings (design section 14) is trimmed to "Connect + basic settings" only.** The full designed flow (Connect Website → Select Hotel → Choose Frontend → Configure Branding → Create & Map Pages → Verify & Publish) is a page-builder-style feature, materially bigger than ADR-0016's decision to keep the legacy plugin's existing UI as-is and only add tenant ID/property ID/API-base-URL fields to its settings screen. Only the "Connect Website" + basic tenant/property/API-URL settings piece is in scope — it matches what Milestone 6 Task 3 already built. "Choose Frontend / Configure Branding / Map Pages" is parked as a future idea, not built now, and would need its own ADR revisiting ADR-0016's scope if it's ever picked up.
- **Settings → Billing Account (design section 13.13) ships as a read-only summary/link only**, not full billing management — a plan-name display plus a link into Milestone 11's real billing screen once that exists. This keeps the "Explicitly not included" boundary above intact rather than letting billing logic leak into two milestones.

Overall, the design was assessed as generally reliable for kickoff purposes beyond these three conflicts — deep and consistently structured (states, empty/error variants, prototype overlays throughout) rather than throwaway, per the owner.

Page 00 ("00 — Base & Components", the shared design system) was separately reviewed and found materially more mature than page 01 — a versioned token architecture with a deprecation process, an explicit `WCAG 2.2 AA baseline`, and defined breakpoints (mobile ≤767, tablet, desktop) with a `Navigation/Mobile Drawer` already designed to replace the desktop sidebar below tablet width. Scoping questions resolved against it:

- **Dark mode is deferred.** The system itself notes "Light theme active · dark mode not yet defined" — ship light-only for Milestone 9; dark-mode tokens are a future pass, not blocking.
- **Responsive/mobile-tablet support is a real requirement, not a nice-to-have.** The design already assumes it (drawer nav, 44px touch targets for front-desk-on-tablet use) — each screen task's acceptance criteria should include its responsive behavior, not treat it as a later retrofit.
- **The WordPress plugin's own settings screen (wp-admin, Milestone 6 Task 3, already Done) is not restyled to match this design system.** It's three plain fields rendered in PHP inside native wp-admin — a different stack entirely; the "WordPress Admin desktop shell" example in the component library illustrates the system's range, it isn't a build target. Leave Milestone 6 Task 3 as-is.
- **Moved (2026-07-31): the shared component-library task lives in Milestone 7 (Auth Pages) now, not here.** Originally this milestone was going to open with it, but since Auth Pages became the actual first `apps/web` UI milestone, implementing page 00's tokens/components in code (e.g. a `packages/ui` package) belongs there — this milestone's tasks consume that package from day one rather than each re-deriving tokens/components ad hoc.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
