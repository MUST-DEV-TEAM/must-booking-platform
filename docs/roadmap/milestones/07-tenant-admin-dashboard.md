# Milestone 7: Tenant Admin Dashboard

Status: Not started
Depends on: Milestone 6

## Goal

The staff-facing `apps/web` Next.js dashboard covers day-to-day hotel operations: reservations, payments, guests, staff, and settings — RBAC-gated per `docs/TENANCY.md`. Done means: a hotel's staff can run their day (see bookings, handle a refund, add a staff member, adjust settings) without touching the database directly.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. Dashboard shell/navigation, RBAC-gated per role (`docs/TENANCY.md`).
2. Reservations list + detail view (status, guest, dates, payment status).
3. Calendar view of bookings/availability.
4. Payments/refunds view (surfacing Milestone 5's ledger, refund action from the UI).
5. Guests view (guest records, booking history per guest).
6. Staff management UI (invite, role change, remove — surfacing Milestone 1's APIs).
7. Settings UI: hotel identity, booking rules, managed-page-style configuration (mirroring the predecessor plugin's settings scope, per `docs/PROJECT_CONTEXT.md`, but for the new backend).
8. Basic reports (occupancy/bookings-over-time — simple, not the full observability suite from Milestone 10).
9. In-app notifications/activity log surface (trial countdown from Milestone 2, payment events, etc.).
10. E2E test covering the core staff workflows above.

## Explicitly not included

- Platform billing/subscription management UI (Milestone 8 — a tenant's *own* billing/upgrade screen, as distinct from operational settings here).
- Full analytics/BI-grade reporting.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
