# ADR-0005: Clock exact physical-room availability authority

- Status: Accepted
- Date: 2026-07-16
- Scope: Clock-backed search, fixed-room checks, disabled-date calendars, final checkout, and paid fulfilment
- Supersedes: Treating `rates_availability` physical `rooms[]` requests as exact-room proof
- Superseded by: —
- Evidence confidence: Official saved Clock API contract plus modeled local tests; account acceptance pending

## Context

The mapped website rates are Clock room-type rates. Sending physical IDs through `rates_availability` `rooms[]` still returns `Pms::RoomType` resources, so a strict physical-ID match correctly fails. Relaxing that match would make type sellability appear to prove that a selected physical room is free.

Clock exposes separate evidence: `rates_availability` reports daily sellability and restrictions for parent type/rate combinations, while `room_statuses` reports whether each physical room is available for an inclusive range. `room_statuses` has no physical-room query filter or per-date breakdown.

## Decision

- A physical room is available only when its physical, parent-type, and applicable-rate mappings exist and agree; one applicable type-bound rate passes every occupied date; the exact physical row is `available=true` under that parent in `room_statuses`; and capacity plus local reservation/lock checks pass.
- General search uses one sorted/deduplicated type-level rate request and one range status request. A single candidate type supplies `room_type_id`; mixed-type search omits it and filters locally.
- Fixed checks use any applicable active public mapped rate. Final checkout and paid fulfilment use the exact selected/saved rate and bypass both caches.
- Intermediate type/rate reads may cache for 45 seconds and room status for 15 seconds.
- Missing/malformed/conflicting provider evidence, transport/HTTP failure, or incomplete mappings is provider-unconfirmed. Explicit rate restriction/`free=false`, exact `available=false`, capacity failure, or local conflict is unavailable.
- The long disabled-date calendar remains advisory type/rate data plus local exact-room conflicts. It does not perform per-night physical-room status scans; selected ranges are checked before continuation and writes.
- `ClockQuoteProvider` remains authoritative for price, currency, and guarantee policy.

## Alternatives considered

- Accept the returned room-type resource as proof for every physical room. Rejected because it can oversell a selected room.
- Patch only the old response parser or restore a room-type fallback. Rejected because neither creates physical-room evidence.
- Scan `room_statuses` per night for the 180-day calendar. Rejected because the endpoint is range-based and the request volume would create latency and rate-limit pressure.
- Replace the availability provider interface. Rejected because the provider-specific fresh method can carry guests, selected rate, and operation context without changing shared provider contracts.

## Consequences

### Positive

- Type/rate and exact physical-room authority are explicit and independently testable.
- Search can batch mixed types without one provider request per room.
- Final checkout and paid fulfilment retain fail-closed exact-room behavior and no substitution.

### Negative

- The calendar cannot display all Clock physical-room occupancy in advance.
- A race remains between fresh validation and Clock reservation creation because Clock provides no website hold in this flow.
- Verified payment can reach manual review when exact availability becomes unavailable or unconfirmed before fulfilment.

## Implementation constraints

- Never send physical IDs through `rates_availability` as exact-room proof.
- Convert checkout to the inclusive status end date by subtracting exactly one day.
- Do not infer availability from group counts, another room, a missing row, or an ambiguous wrapper.
- Preserve verified-payment evidence on paid fulfilment failure and never substitute a different physical room.
- Keep logs sanitized; do not record full provider bodies, housekeeping data, credentials, or guest data.
- Do not claim deployment readiness until a separately approved read-only non-production account check confirms rights, shape, available/unavailable examples, and latency.

## Verification

- Strict `room_statuses` request/parser fixtures for available, unavailable, missing, malformed, duplicate, and transport cases.
- Two-source general/fixed tests for mapping, rate/date/restriction, physical-row, local conflict, and mixed-type batching.
- Final checkout and paid-fulfilment tests proving exact guests/rate/room context, cache bypass, pre-write failure, and manual review.
- Advisory disabled-date tests proving type-level requests, local conflict merging, and no long physical-status scan.
- Separately approved account acceptance as defined in `docs/OPERATIONS.md`.
