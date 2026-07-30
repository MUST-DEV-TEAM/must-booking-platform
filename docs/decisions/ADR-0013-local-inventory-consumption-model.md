# ADR-0013: Local inventory consumption model for bookings

Status: Accepted
Date: 2026-07-30

## Context

Milestone 3's `inventory_units` table stores `available_units` as a staff-set count per `(tenant_id, property_id, room_type_id, stays_on)` — set directly through the property-management UI, like a channel-manager allotment. Milestone 4 needs booking creation/cancellation to consume and release inventory for every night of a stay, and needs a concurrency test proving that two simultaneous booking attempts for the last unit can only let one succeed. Doing this against `available_units` directly requires deciding whether that column keeps meaning "what staff configured" or starts meaning "what's left after bookings," since both meanings can't coexist in one column.

## Options

1. **Separate `booked_units` counter, availability derived** — add `booked_units` per `(tenant_id, property_id, room_type_id, stays_on)`, defaulting to 0. Booking creation atomically increments it for every night in the stay range; cancellation decrements it. `available_units` stays exactly what staff configured — untouched by booking activity. Sellable inventory for any query is `available_units - booked_units`, computed at read time (already the shape of the `getAvailability` query from Milestone 3 — just adds a second join/aggregate).
2. **Decrement `available_units` directly** — booking creation subtracts 1 per night from `available_units` (with a `CHECK (available_units >= 0)`), cancellation adds it back. One column instead of two, but conflates "capacity staff configured" with "capacity currently sold." A staff edit to `available_units` after bookings exist (e.g. correcting a data-entry mistake, or reducing allotment for a maintenance closure) silently changes what's already sold against, with no way to tell how much of the current number is "real" configured capacity vs. leftover after bookings.

## Decision

Option 1: add `booked_units` to `inventory_units`, keep `available_units` as staff's configured capacity, and derive sellable inventory as `available_units - booked_units` at read time.

This is the conventional PMS/channel-manager pattern (allotment vs. sold count kept separate) and is what Milestone 9's Clock adapter will eventually need to reconcile against too — Clock's own availability data is itself a derived "capacity minus sold" number, not a raw allotment.

## Consequences

- **Schema (Milestone 4 migration on Milestone 3's `inventory_units`):** add `booked_units INTEGER NOT NULL DEFAULT 0`, plus `CHECK (booked_units >= 0)` and `CHECK (booked_units <= available_units)`. The existing primary key `(tenant_id, property_id, room_type_id, stays_on)` is unchanged.
- **`AvailabilityService.getAvailability`** (`apps/api/src/tenancy/availability.service.ts`) changes its aggregate from `MIN(COALESCE(available_units, 0))` to `MIN(COALESCE(available_units, 0) - COALESCE(booked_units, 0))`, still over the same `generate_series` of requested nights; a night with no `inventory_units` row row still yields 0 sellable, matching current behavior for un-configured nights.
- **Booking creation** must, in the same transaction that inserts the booking, upsert `booked_units = booked_units + 1` for every night in the stay range, and reject (routing to `AVAILABILITY_FAILED`) if the update would push any night's `booked_units` above its `available_units` — the `CHECK (booked_units <= available_units)` constraint is the last line of defense, but the service should detect and reject before hitting it so the failure is a normal domain error, not a raw constraint-violation surfaced to the caller.
- **Concurrency test (task 7):** two simultaneous booking attempts for a night with `available_units = 1, booked_units = 0` must serialize such that exactly one commits `booked_units = 1` and the other observes the check-constraint boundary and fails cleanly into `AVAILABILITY_FAILED` — not both succeeding and leaving `booked_units = 2` against `available_units = 1`. This needs the same kind of transaction-scoped locking Milestone 3 used for rate-rule overlap (`pg_advisory_xact_lock`), scoped per `(tenant_id, property_id, room_type_id)` for the affected date range, since a per-row `UPDATE ... SET booked_units = booked_units + 1` alone is safe per-row but the range spans multiple rows and needs the whole range to succeed or fail together.
- **Cancellation** decrements `booked_units` back down for every night of the cancelled booking's stay range, in the same transaction as the state transition to `CANCELLED`.
- Staff can still freely edit `available_units` through Milestone 3's existing endpoint without touching `booked_units` — reducing `available_units` below current `booked_units` for a night is allowed by the schema (no cross-column check ties staff's write path to current bookings) but will correctly make that night appear oversold in any admin view that shows both numbers; this is a display/warning concern for the dashboard, not a constraint violation, and is out of scope for Milestone 4's task list.

## Alternatives considered

- Decrementing `available_units` directly (option 2 above): rejected — makes "what staff configured" and "what's currently sold" indistinguishable, which breaks the first time a staff member edits allotment after bookings exist.
