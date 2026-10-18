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

I1 implemented by Codex under the owner's explicit backend authorization (2026-10-18); awaiting review. I2 and I3 contracts remain pending. Inventory screens are I4 and are not built in I1.

### I1 restrictions

Base: `/tenants/:tenantId/properties/:propertyId/inventory/restrictions`. Every route uses tenant/property context. Reads require `calendar.view`; validation and mutations require `calendar.block` and a verified email. No capability keys were added. An enabled Clock PMS assignment makes local restriction validation/mutations read-only, including when that connection is unhealthy; it does not trigger a provider call.

| Method | Path relative to base | Request | Result |
| --- | --- | --- | --- |
| GET | `/` | None | List envelope below |
| GET | `/:id` | UUID | One saved record, derived lifecycle, validation and conflicts; 404 outside scope |
| GET | `/:id/history` | UUID | Scoped audit entries with actor ID, action, before/after snapshots and timestamp; deleted drafts retain history |
| POST | `/validate` | Restriction fields below; optional `id` excludes that saved rule | `{ valid, conflicts, errors }`; advisory only, activation repeats validation under lock; no stock reservation or mutation |
| POST | `/` | Restriction fields; optional `lifecycle: "Draft"` only | 201; new Draft, generated ID/reference, version 1 |
| PATCH | `/:id` | Full editable restriction fields plus current `version`; no lifecycle field | 200; saved record and incremented version |
| POST | `/:id/activate` | `{ version }` | 201; Scheduled or Active according to property-local today; revalidates conflicts |
| POST | `/:id/pause` | `{ version }` | 201; Paused; only Active/Scheduled rules |
| POST | `/:id/archive` | `{ version }` | 201; Archived |
| POST | `/:id/duplicate` | `{ version }` | 201; new Draft, new reference, version 1; source unchanged |
| DELETE | `/:id` | `{ version }` | 200 `{ deleted: true, id }`; Draft only; other states must be archived |

All mutating routes require `Idempotency-Key` (1?128 non-space printable ASCII characters). Use one new key per intended operation and retain it when retrying that operation. The key is unique within the tenant/property across all restriction mutations. A property row lock serializes writes and conflict checks; an atomic receipt stores the normalized request hash (including actor/action/version) and response in the same transaction as the record, reference sequence and audit. Identical concurrent/retried requests replay the original response without another version/audit/sequence increment. Reusing a committed key for a different request returns 409 `IDEMPOTENCY_KEY_REUSED`. Failed transactions leave no success receipt. Keys/receipts currently have no expiry. `version` is optimistic concurrency control, independent of the idempotency key; stale writes return 409 `RESTRICTION_VERSION_CONFLICT` with `currentVersion`. UPDATE/DELETE also predicate on the expected version.

Editable fields:

```json
{
  "name": "Weekend minimum stay",
  "type": "minimum_stay",
  "value": 3,
  "scope": "category",
  "targetIds": ["category-uuid"],
  "startsOn": "2026-11-01",
  "endsOn": "2026-11-30",
  "weekdays": [5, 6, 7],
  "priority": 50,
  "internalReason": "Local operations policy"
}
```

- Types: `minimum_stay`, `maximum_stay`, `closed_to_arrival`, `closed_to_departure`, `stop_sell`, `minimum_advance`. Values are integers: stay lengths >=1, advance >=0, closures 1 = closed / 0 = open exception. Maximum stored integer is 2,147,483,647. Minimum advance applies to the arrival date, for guest and staff alike; the existing guest-only same-day cutoff remains separate.
- Scope is `property` with `targetIds: []`, or `category`/`room_type` with 1?500 unique target UUIDs belonging to this property. UUID casing and target/weekday order are normalized. There is no per-room or rate-plan restriction scope. Category membership is resolved at evaluation time, so moving a type changes which category rules apply.
- Dates are valid ISO property-local calendar dates. Restriction end dates are **inclusive**, unlike the stay's exclusive checkout. A same-date restriction is valid. `endsOn: null` or omitted means no end. Weekdays use ISO Monday=1 to Sunday=7, default all; duplicates, empty selections and finite periods containing none of the selected weekdays are rejected.
- Priority defaults to 50, accepts integer 1?100 (presets 25/50/75/100). Higher priority wins per type/applicable date, including open exceptions; scope specificity is not a tiebreaker. Equal-priority differing values conflict, even if two minimums could be interpreted as a stricter combined minimum. Identical values do not conflict.
- Name is required, trimmed, <=200 characters; it need not be unique. Internal reason is optional, trimmed, <=4,000 characters. Reference `RST-YYYY-NNNN` is allocated per property and property-local current year; the suffix can grow past four digits and is not reused after draft deletion. Author IDs and creation/update timestamps are server-owned.

List envelope: `{ source: "LOCAL" | "CLOCK_PMS", readOnly, timezone, today, baseRestrictions, items, providerRestrictions? }`. Each item has the editable fields plus `id`, `reference`, `lifecycle`, `version`, `createdByUserId`, `updatedByUserId`, `createdAt`, `updatedAt`, `validation` (`Healthy`, `Conflict`, `Missing targets`), and `conflicts: [{ id, name, date, code }]`. Settings min/max stay and maximum advance appear in `baseRestrictions` as read-only property rules at priority 0 with source `settings`; their IDs start `base:` and cannot be mutated here. Scoped min/max stay winners can relax these base values (S82/S86). The existing maximum-advance setting stays enforced and is not an editable new restriction type.

Lifecycle is derived without a scheduled writer: enabled records are Scheduled before start, Active from start through inclusive end, then Expired. Draft/Archived take precedence; a paused rule becomes Expired after end. Drafts may have historical dates, but an already-ended rule cannot activate. Archived and Expired records cannot be edited; duplicate to a new draft. Archived is terminal. A draft duplicate is fully target-validated. Active material edits (type, value, scope, targets, dates, weekdays, priority) revalidate; name/reason-only edits do not rerun overlap validation. Pausing/archiving/deleting a draft remains possible after a catalog target is removed.

Targets are retained as scoped UUID arrays rather than cascading away when a catalog object is deleted. Save/activation validates ownership in the serialized transaction. A removed target is reported as Missing targets, never promoted to property scope; searches cannot match a missing type/category. Later catalog membership changes can create a new tie: list validation detects it and the live evaluator rejects affected stays with `RESTRICTION_PRIORITY_CONFLICT`; there is no force override. This does not edit the catalog or an existing booking.

Errors: 400 `RESTRICTION_INVALID` for invalid fields/actions, 409 `RESTRICTION_PRIORITY_CONFLICT` with conflict records for blocked activation/material edits, 409 version/key conflicts as above, 403 `EXTERNAL_RESTRICTIONS_READ_ONLY` for local restriction writes/validation at Clock hotels, scoped 404 for missing records, existing authentication/capability 401/403. The validation endpoint reports an already-ended period as `RESTRICTION_EXPIRED` with `valid: false`.

### I1 shared evaluation and client effects

`booking/booking-rules.ts` calls the pure `inventory-restriction-rules.ts` helper. It is used by quote creation/pricing (website and staff), local availability, public catalog searches with dates, calendar selection, and the reservation boundary before local inventory is claimed. No restriction code writes a booking, payment, cancellation or Clock record. Existing inventory/room locks remain responsible for stock concurrency. If a rule changes after quoting, the reservation path reads restrictions again in its transaction. Concurrent in-flight work is evaluated at that read; activation does not retroactively invalidate an already evaluated/created booking.

Rule errors: `MIN_STAY`, `MAX_STAY`, `CLOSED_TO_ARRIVAL`, `CLOSED_TO_DEPARTURE`, `STOP_SELL`, `MINIMUM_ADVANCE`, `RESTRICTION_PRIORITY_CONFLICT`. Different types all apply. Manual blocks/reservations retain their separate constraints; an open stop-sell exception cannot reopen blocked or occupied inventory. Restriction effects do not apply to creating a manual block. No new rule changes capacity, prices or existing reservations.

`GET .../booking-rules/evaluate` retains its endpoint and returns effective selected-stay min/max metadata from the evaluator when scoped rules apply. The existing CalendarBoard header/night stepper uses that metadata; its New booking action follows `booking.valid`, independently of `block.valid`. The future I3 preview must call this evaluator, not implement its own semantics.

Local `GET .../availability` may add `restrictionErrors: [{ code, message }]` when rules reject a stay and returns `availableUnits: 0, isAvailable: false`. Calendar day projections add restriction error metadata when local rules exist; only stop-sell/arrival closures or priority conflicts close a day cell, because the cell has no selected departure. Length/departure decisions use full-stay evaluation. The public catalog with dates omits types rejected by applicable local restrictions; no-date catalog reads retain their existing behavior and no response field was removed. WordPress code was not edited: its dated catalog, availability and quote calls inherit the server rejection without client-side rule logic.

For Clock properties the list returns `readOnly: true`, `items: []`, `baseRestrictions: []`, `providerRestrictions: null`. Existing `GET .../availability-calendar?roomTypeId=...&month=YYYY-MM` supplies supported Clock day/minimum-stay/stop-sale observations read-only. A complete provider restriction/lifecycle/history catalog is not available (G186); I4 must omit unsupported values and show Unknown when provider data cannot be verified. No Clock request was made during I1 verification; Clock regressions use mocks.

### I1 migration and verification

Migration `20261018150000_inventory_restrictions` creates `inventory_restrictions`, `inventory_restriction_sequences`, and `inventory_restriction_operations`. Every table has mandatory tenant/property IDs, a composite property FK, and forced RLS requiring both contexts. Database constraints enforce supported types/scopes/states, integer values, date order, weekday bounds, priority/version and property-vs-target shape. There is no booking/backfill mutation. Audit snapshots use existing scoped `audit_logs`. Schema models and tenant test-fixture cleanup are updated.

Applied on verified localhost, then executed again successfully to check idempotency. Behavioral tests cover direct application-role RLS rejection, HTTP capabilities, concurrent create replay/activation ties/stale edits, receipt/audit/version behavior, public search/quote/calendar/local stock enforcement and a confirmed booking snapshot remaining unchanged. The browser used the existing calendar to verify a temporary three-night rule; it was archived afterward. Inventory remains its existing placeholder until I4. Detailed command results and screenshots are in the dashboard progress log.
