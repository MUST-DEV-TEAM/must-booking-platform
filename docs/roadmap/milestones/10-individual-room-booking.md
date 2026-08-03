# Milestone 10: Individual Room Booking

Status: Not started
Depends on: Milestone 4 (booking domain/inventory model); Milestone 9 (Tenant Admin Dashboard, for the staff-facing manual-blocking/booking-mode UI's follow-up tasks); Milestone 6 (guest widget, gets follow-up work here); ADR-0022 (booking-mode model)

## Goal

Per [ADR-0022](../../decisions/ADR-0022-individual-room-booking-model.md): today, availability is tracked as an anonymous count per room type (Milestone 4's model) — a guest booking "Deluxe" gets whichever unit is free, and nobody, guest or system, distinguishes between them. Some tenants need the opposite: guests pick (or are assigned) a *specific* physical room, tracked individually so the same room is never double-booked, sometimes with its own price. This milestone adds that as a per-property choice — Room-Type-Only, Individual-Room-Only, or Mixed (guest may pick a specific room or let the system auto-assign one, only among same-priced rooms) — without breaking the existing pooled model tenants already use. Done means: a property can be configured into any of the three modes, guests can complete a booking correctly under each, and staff can manually block availability targeting any combination of "all," a room type, or specific individual rooms.

## Draft task areas (not final — define the real tasks at kickoff; task count is whatever the real scope needs, not fixed at 10)

1. `Property.bookingMode` setting (`ROOM_TYPE_ONLY` / `INDIVIDUAL_ROOM_ONLY` / `MIXED`), chosen once for the whole property, changeable later but never mixed per room type at a given time (ADR-0022).
2. Room-level availability tracking: extend beyond Milestone 4's anonymous per-room-type count so a specific `Room` can be marked unavailable for a date range, without breaking the existing pooled-count model for `ROOM_TYPE_ONLY` properties.
3. Optional per-room price override: a `RateRule` (or sibling concept) can price a specific `Room` differently from its room type's base rate, for properties where individual rooms are priced independently.
4. `createBooking` accepts an optional specific `roomId` (in addition to today's required `roomTypeId`), validated against the property's booking mode and that room's real-time availability.
5. Guest-facing catalog/availability API changes: expose individual rooms (with their own IDs, even where display names repeat within a type) when the property's mode requires or allows room-level choice.
6. "Same price" invariant for Mixed mode's auto-assign path: a guest may only "let the system decide" among rooms of a type that share an identical price; enforce this server-side, don't just assume the data satisfies it.
7. Manual blocking: staff can block availability targeting any combination of "all," one or more room types, and/or one or more specific rooms in a single action (per the owner's kickoff answer) — new schema + staff-facing endpoint.
8. Guest widget follow-up (Milestone 6): the accommodation step lists individual rooms (not just types) for `INDIVIDUAL_ROOM_ONLY`/`MIXED` properties, with a "let the system choose" option where the same-price invariant allows it.
9. Direct-room-entry flow: a guest can land on one specific room's page and see availability/book against only that room, skipping the type-selection step entirely (the original plugin's `$fixed_room_mode` concept, currently unwired).
10. E2E test: a property configured under each of the three modes completes a real guest booking correctly, and staff can exercise every manual-blocking target combination (all / type / specific room(s), combined) without breaking the pooled-count model still used by `ROOM_TYPE_ONLY` properties.

## Explicitly not included

- Per-room rich content (galleries, floor plans) beyond what's needed to distinguish rooms in the picker — a possible future polish item, not core to the booking-mode capability.
- Booking multiple specific rooms in a single guest transaction (multi-room individual booking) — out of scope unless an actual tenant needs it.
- Complex per-room seasonal/date-bounded pricing beyond a flat override — reuses whatever `RateRule` already supports; no new pricing-rule engine.
- Retrofitting the WordPress Admin back-office removed in Milestone 6 Task 5 — manual blocking and booking-mode configuration are staff-facing, but ship in Milestone 9's Tenant Admin Dashboard, not by resurrecting the deleted plugin admin screens.

## Sequencing note (2026-07-31, updated)

Milestone 6 (WordPress plugin) is paused — backend milestones take priority for now, with one consolidated guest-widget integration pass planned before Milestone 12 (Integration & Initial Release Readiness — see Milestone 6's Status line; renumbered from 13 by ADR-0025). This milestone's own draft tasks 8-9 above are guest-widget work by nature. At this milestone's actual kickoff, split those two out explicitly as **deferred** in the task table (not silently dropped, and not counted against this milestone's close-out) — the backend capability (tasks 1-7, 10) can be built and tested standalone against real API calls, same as Milestone 5's PokPay/email follow-ups are being done without touching WordPress at all. Tasks 8-9 get picked up together with Milestone 6's own remaining items in that later integration pass.

**Order flip (2026-07-31):** this milestone now runs *after* Milestone 9 (Tenant Admin Dashboard), reversing the original plan. Milestone 9 already ships against today's room-type-only pooled model and carries its own explicit deferred-follow-up tasks for this milestone's manual-blocking/booking-mode UI — so starting this milestone after Milestone 9 doesn't block anything; it just means those two follow-up tasks in Milestone 9 get implemented once this milestone's backend (tasks 1-7, 10) actually exists.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
