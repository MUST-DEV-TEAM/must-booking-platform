# Milestone 3: Property, Room & Rate Management (Local)

Status: Not started
Depends on: Milestone 2

## Goal

Tenant staff can configure their hotel's sellable inventory entirely locally — no PMS involved yet. Room types, physical rooms, rate plans, and availability exist and are manageable through the admin UI. Done means: staff can create a room type, set a rate, and see it reflected in an availability view, purely on local data.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. Schema: `room_types`, `rooms` (physical inventory units), `rate_plans`, `rate_rules`, `amenities` — independent of any PMS, per `docs/ARCHITECTURE.md`'s catalog model.
2. CRUD API for room types and physical rooms, tenant/property-scoped.
3. CRUD API for rate plans and date-based rate rules (seasonal/weekday overrides).
4. Admin UI: room type/room management screens.
5. Admin UI: rate plan management and a calendar-style rate override view.
6. Image/media upload for room types (object storage per `ARCHITECTURE.md`).
7. Amenities management (simple tagging on room types).
8. Local availability model: `inventory_units` and a query for "is room type X available for date range Y."
9. Validation rules (no overlapping rate rules, sane date ranges, currency handling per `docs/decisions/ADR-0009` — NUMERIC/minor units, no floats, per the source Clock brief's database-constraints guidance).
10. Test coverage for the availability query, including edge cases (single-night, date-range overlaps, zero inventory).

## Explicitly not included

- Any Clock/PMS-backed inventory (Milestone 9).
- The actual booking/checkout flow (Milestone 4-6).

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
