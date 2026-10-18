# Milestone 24 — Inventory (Availability) plan (decided 2026-10-18)

Sidebar item "Inventory", design in `24-dashboard-redesign.md` Page 14 (14a to 14i). Rule semantics were decided earlier (D58 to D67, S81 to S97); this file fixes the **first-release scope and build order**. Claude builds the backend, Codex builds the screens against the contract below, Claude verifies both.

## Owner decisions (2026-10-18)

- **Scope:** Overview, Restrictions and Manual Blocks. Conflict Review stays a read-only list for hotels with an external PMS (S95, S96); assignment, SLA and evidence export are later.
- **Restriction targets:** whole property, a category, or a room type. Rate-plan and per-unit restrictions are later.
- **Standard:** industry practice wherever the design leaves a choice (owner instruction).

## What already exists (verified in code)

- `availability_blocks` already stores dates, `reason`, `note`, `reference` and `created_by_user_id`, with property, room-type and room targets. G41 is therefore partly done; lifecycle, title, owner and versioning are not.
- `booking/booking-rules.ts` is the single pure evaluator for property-wide minimum and maximum stay, advance days, same day, capacity and conflicts; `GET .../booking-rules/evaluate` exposes it. **Restrictions must extend this module** so search, staff booking, the calendar and the preview run the same code (S83).

## Restriction model (G85, first release)

Types: minimum stay, maximum stay, closed to arrival, closed to departure, stop sell, minimum advance (S84). Fields: name, reference (RST-YYYY-NNNN), type, value, scope (`property` | `category` | `room_type` plus target ids), start and end date (end optional), weekdays (default all), priority Low 25 / Normal 50 / High 75 / Critical 100 (S85), lifecycle Draft / Scheduled / Active / Paused / Expired / Archived, internal reason, version, created and updated by.

Evaluation (S82): a stay must satisfy every restriction type that applies to it. Within one type and one night or arrival, the **higher priority wins**; equal priority with contradicting values is a blocking conflict and cannot be activated. Date applicability is by **arrival date** for stay-length rules and closed-to-arrival, by **departure date** for closed-to-departure, by **each night** for stop sell. Property-wide numbers in Settings are shown as read-only base restrictions (S86). Clock hotels show Clock's restrictions read-only (S81). Existing bookings are never modified by a restriction.

## Block model v2 (G92, first release)

Add title, lifecycle (Draft / Scheduled / Active / Ended / Cancelled), responsible staff, end reason, version. Reason list per S92. Scope is fixed once active, period may be extended or shortened after validation, ending early needs a reason, overlap with a reservation or payment-pending hold is a hard stop (S91, G93). Date-based only (S90). Clock room-level push stays out until proven in the sandbox (S93, G94).

## Build order

| # | Task | Owner | Done when |
| --- | --- | --- | --- |
| I1 | Migration and API: restrictions CRUD, lifecycle, validation, conflict check, versioning, audit; restriction evaluation added to `booking-rules.ts` and wired into quote, availability and the calendar | Claude | Unit tests for every rule type and priority case, tenant/property scoping tests, integration test, contract below filled in |
| I2 | Block model v2 and list read model (status, reason, creator, ending soon), conflict detection | Claude | Same as I1 |
| I3 | Overview read model: sellable-night percentage, counts by type, needs-attention items (conflicting rules, restriction ending soon), booking-effect preview endpoint | Claude | Preview uses the same evaluator as search |
| I4 | Screens: Overview, Restrictions list and create/edit, booking-effect preview, Manual Blocks list and create/edit, Conflict Review list | Codex | Handoff method; mocked fetch against the contract |

Not in the first release: usage counters (S88), rate-plan scope, daily activation times, maximum advance, conflict assignment and SLA, time-of-day blocks.

## API contract

Filled in by Claude with I1 to I3 before any Codex prompt is written.
