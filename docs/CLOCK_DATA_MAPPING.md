# Clock PMS+ Data Mapping

Milestone 11 deliverable (source brief section 37/Appendix B, section 13 "Modelet dhe mapping-et e katalogut", section 15 "Normalizimi i të dhënave"). Describes the mapping tables and field-level translations actually built by Tasks 7-10.

## Catalog mapping table

`clock_catalog_mappings` (Task 7) — one row per Clock entity MUST has ever seen, per the brief's exact column list (section 13): `hotel_id` (→ `property_id`), `connection_id`, `entity_type`, `local_entity_id`, `external_entity_id`, `sync_status`, timestamps. Also carries `external_parent_id` (a room's Clock room-type id, for the parent-before-child confirm rule) and `external_name` (for display before confirmation).

| Column | Meaning |
| --- | --- |
| `entity_type` | `ROOM_TYPE` \| `ROOM` — **only these two**. No `RATE_PLAN` entity type exists yet (see "Rate plan mapping gap" below). |
| `sync_status` | `PROPOSED` → `CONFIRMED` (creates the local `room_types`/`rooms` row and links it) or `REJECTED`. Never auto-applied — an admin must act on every proposal (source brief section 14). |
| `local_entity_id` | Null until confirmed; then the local `room_types.id`/`rooms.id`. |

Confirming a `ROOM` requires its parent `ROOM_TYPE` mapping to already be `CONFIRMED` — enforced in `ClockCatalogSyncService.confirm` (throws `BadRequestException` otherwise), not just a UI suggestion.

## Rate plan mapping gap

Clock's rate plans are **not** mapped in `clock_catalog_mappings` at all. `ClockAvailabilityService` and `ClockBookingService` both call Clock's `/rate_plans` directly and:

- **Availability** (Task 8): uses *every* rate plan id the property has, passed as a bracket array (`rates[]=id1&rates[]=id2`) to `/rates_availability`, then takes the best (`free && room_type_free_rooms > 0`) result across all of them per night.
- **Booking creation** (Task 10): requires the property to have **exactly one** Clock rate plan. Zero or multiple rate plans is a hard `clock_configuration` error — automatic rate selection for a multi-rate-plan property is not supported.

This is a deliberate, documented "basic milestone" simplification, not an oversight — extending the catalog mapping to a `RATE_PLAN` entity type (so a specific local rate plan maps to a specific Clock rate id, the way room types/rooms already do) is real follow-up work.

## Booking field mapping

Local `bookings` table ↔ Clock booking resource (`POST/GET/PUT /bookings/`):

| Local (`bookings` table) | Clock field | Notes |
| --- | --- | --- |
| `id` (uuid, PK) | — | Never sent to Clock; MUST's own identity. |
| `external_booking_id` | `id` (Clock's own numeric booking id) | New column added in Task 10 — `LocalPmsProvider` doesn't need this (it reuses its own `id`), but a real external PMS has a genuinely separate id. |
| `external_reference` | `reference_number` | MUST's own idempotency-safe reference (source brief section 38's open item, resolved: `reference_number` is the field). Used for the creation-timeout reconciliation lookup (section 18) via `GET /bookings/?reference_number=`. |
| `version` | — | MUST's own optimistic-concurrency counter (matches `LocalPmsProvider`'s semantics — `command.expectedVersion`). **Not the same value as Clock's `lock_version`.** |
| — | `lock_version` | Clock's own optimistic-concurrency token. Re-fetched via `GET /bookings/{id}` immediately before every `PUT`, never cached locally. The two concurrency tokens are intentionally decoupled — see `CLOCK_ARCHITECTURE.md`. |
| `starts_on` / `ends_on` | `arrival` / `departure` | Local `date`, Clock's ISO date string — same format, direct passthrough. |
| `room_type_id` | `arrival_room_type_id` | Via `clock_catalog_mappings` (`ROOM_TYPE`, must be `CONFIRMED`). |
| `room_id` | `arrival_room_id` | Via `clock_catalog_mappings` (`ROOM`, must be `CONFIRMED`); optional both sides. |
| `rate_plan_id` | `rate_id` | **Not** a real per-booking mapping — see "Rate plan mapping gap" above; the property's single Clock rate plan is used regardless of which local rate plan was selected. |
| `guest_id` | `guest_e_mail`/`guest_first_name`/`guest_last_name` | See "Guest mapping" below. |
| `status` (BookingStatus enum) | `status` (Clock string: `expected`/`checked_in`/`checked_out`/`canceled`/`no_show`) | **Not mapped at all** — see "Status mapping gap" below. |

## Guest mapping

Matches `LocalPmsProvider`'s existing convention exactly: match-or-create by lowercased email within the tenant (`guests` table, `ON CONFLICT (tenant_id, lower(email)) DO NOTHING` then re-select). No Clock-side guest id is stored or reconciled — MUST's guest record and Clock's guest record are independent; Clock is only ever given guest details inline on the booking payload (`guest_e_mail`/`guest_first_name`/`guest_last_name`), never created as a standalone Clock guest via a separate call. Source brief section 24's fuller guest-matching requirement (external ID, phone, booking relationship, manual confirmation) is **not built** — email-only matching is what shipped.

## Status mapping gap

MUST's `BookingStatus` (the state machine — see `CLOCK_BOOKING_STATE_MACHINE.md`) tracks the *local* booking lifecycle (draft → confirmed → cancelled, etc.). Clock's own `status` field (`expected`/`checked_in`/`checked_out`/`canceled`/`no_show`) reflects Clock's *operational* hotel-desk status (has the guest arrived, checked out, etc.) — a genuinely different concept. **This milestone never reads or interprets Clock's `status` field** — it's fetched as part of the booking resource but never compared, translated, or acted on. This means:

- A guest checking in/out in Clock's own front-desk UI produces no corresponding change in MUST's `BookingStatus` (no code path reacts to it).
- The `UNKNOWN_STATUS` manual-review category (source brief section 26) has no producing code yet, because nothing currently classifies a Clock status value as "known" or "unknown" — there's no vocabulary comparison at all.

Building a real Clock-status → MUST-status mapping (and wiring `UNKNOWN_STATUS` manual-review entries for anything outside Clock's documented 5 values) is real follow-up work, likely alongside the webhook hydration pipeline (`CLOCK_WEBHOOK_FLOW.md`) in a later milestone.

## Normalization pipeline (source brief section 15)

The brief's proposed pipeline is `Clock API response → validated Clock DTO → Clock Normalizer → Canonical MUST PMS Model`. What actually exists: inline TypeScript interfaces (`ClockBookingResource`, etc.) checked with a narrow type guard (`isClockBookingResource`) at the one point it matters (after a successful booking-create response, before trusting `id`/`lock_version`) — not a general-purpose validated-DTO/normalizer layer applied uniformly to every Clock response. Unrecognized/malformed shapes on the booking-create path are caught (routed to `SCHEMA_MISMATCH` manual review, never trusted); other response paths (`/room_types`, `/rooms`, `/rate_plans`, `/rates_availability`) are consumed with looser inline typing and no equivalent guard.
