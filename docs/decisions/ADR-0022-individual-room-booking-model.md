# ADR-0022: Individual room booking model

Status: Accepted — booking-mode model unchanged; [ADR-0023](ADR-0023-platform-admin-dashboard-resequencing.md) further renumbered/reordered this milestone (now Milestone 10, after the Tenant Dashboard rather than before)
Date: 2026-07-31

## Context

Milestone 4's booking domain tracks availability as an anonymous count per room type (`InventoryUnit`, ADR-0013): a booking references `roomTypeId` only, and whichever unit within that type happens to be free gets consumed. Neither the guest nor the system ever distinguishes between individual physical rooms of the same type. This surfaced as a real limitation while live-testing Milestone 6's retrofitted WordPress plugin against a real hotel site — the plugin's "accommodation type" selector implied a room-category concept, and the owner clarified that some tenants need guests to book a *specific* physical room, not just any unit of a type.

The owner described two real hotel operating models:
- **Room-Type-Only**: guest picks a type (e.g. "Basic"), system auto-assigns any available unit; the guest never sees or cares which physical room they get. This is exactly what already exists today.
- **Individual-Room-Only**: guest browses and picks a *specific* room (e.g. one of several rooms all displayed as "Basic Room" but each with its own internal ID), or is sent directly to one specific room's own booking page/calendar (skipping type selection). The same physical room must never be double-booked, and price can vary per room even within a nominal "type."
- **Mixed**: within a room type, the guest may either pick a specific room directly, or choose "any room of this type" and let the system decide — but only among rooms sharing the exact same price, so auto-assignment can never surprise the guest with an unexpected total.

Manual availability blocking (staff marking dates unavailable) needs to support the same granularity: a single blocking action can target "all," one or more specific room types, and/or one or more specific individual rooms, combined freely (e.g. block room X and room type Y in the same action).

## Decision

Add a per-property `bookingMode` setting with three values: `ROOM_TYPE_ONLY` (today's model, unchanged), `INDIVIDUAL_ROOM_ONLY`, and `MIXED`. The mode is chosen once for the whole property — never mixed per room type at a given time — but can be changed later by the tenant.

This requires:
- **Room-level availability tracking**, alongside (not replacing) Milestone 4's pooled per-room-type count, so a specific `Room` can be marked booked/blocked for a date range without affecting the existing `ROOM_TYPE_ONLY` model.
- **Optional per-room pricing**: a rate can be set on a specific `Room`, not just its room type, for properties where individual rooms are priced independently.
- **`createBooking` accepts an optional specific `roomId`**, validated against the property's `bookingMode` and that room's real-time availability, in addition to today's required `roomTypeId`.
- **A same-price invariant on `MIXED` mode's auto-assign path**: the system may only auto-pick a room on the guest's behalf among rooms of that type sharing an identical price — enforced server-side, not assumed.
- **Flexible manual blocking**: staff can target "all," one or more room types, and/or one or more specific rooms in a single blocking action, freely combined.
- **Guest-facing exposure**: the WordPress guest widget's accommodation step (Milestone 6) needs a follow-up to list individual rooms (not just types) for `INDIVIDUAL_ROOM_ONLY`/`MIXED` properties, and to support the direct-room-entry flow the original legacy plugin already had UI stubs for (`$fixed_room_mode` — guest lands on one specific room's page, sees only that room's availability, skips type selection).

## Consequences

- **A new milestone is inserted**: Milestone 7, "Individual Room Booking," between Milestone 6 (WordPress guest widget) and the former Milestone 7 (Tenant Admin Dashboard, now Milestone 8). The roadmap grows from 11 milestones (0–10) to 12 (0–11); Milestones 7–10 (Tenant Admin Dashboard, Platform Billing, Clock PMS+ Adapter, Integration & Initial Release) are renumbered to 8–11. `docs/ROADMAP.md`, `docs/roadmap/README.md`, all four renumbered milestone files, and every ADR/completed-milestone file referencing those numbers are updated accordingly.
- **Milestone 8 (Tenant Admin Dashboard) depends on Milestone 7**, not directly on Milestone 6 — the booking-mode setting and the flexible manual-blocking controls are staff-facing configuration that the dashboard needs to expose from day one, rather than building it blind and retrofitting the controls in later.
- **`ROOM_TYPE_ONLY` properties are entirely unaffected.** This ADR adds capability alongside Milestone 4's existing pooled-count model; it does not change behavior for tenants who never touch the new `bookingMode` setting.
- **Milestone 6's guest widget gets a follow-up task**, not a full rewrite: the individual-room browsing/selection UI and the direct-room-entry flow are new work items inside Milestone 7's task table, landing once the backend capability exists, not retrofitted into Milestone 6 itself (which is scoped to the guest journey as it exists today).
- **The exact schema shape** (how room-level availability is tracked, how per-room pricing overrides are modeled, how manual blocks are stored) is left to Milestone 7's kickoff and task-level design, not fixed by this ADR — this ADR settles the product model (three modes, per-property scope, same-price invariant, flexible blocking targets), not the implementation.

## Alternatives considered

- **Room type only, never add individual-room booking**: rejected — a real tenant need, described directly by the owner, not a hypothetical.
- **Booking mode chosen per room type** (mix `ROOM_TYPE_ONLY` and `INDIVIDUAL_ROOM_ONLY` room types within one property): rejected per the owner's explicit answer — the whole property uses one model at a time, changeable later but not mixed.
- **Folding this into Milestone 6 or Milestone 8** instead of its own milestone: rejected — this is a genuine booking-domain/schema expansion (room-level availability, per-room pricing, blocking granularity), not specific to the WordPress widget (Milestone 6) or the staff dashboard UI (Milestone 8); it needs its own scoped task table like any other domain-level milestone.
