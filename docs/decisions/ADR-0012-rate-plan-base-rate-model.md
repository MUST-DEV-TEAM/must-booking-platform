# ADR-0012: Base rate vs. date-bounded override in rate rules

Status: Accepted
Date: 2026-07-28

## Context

Task 2 modeled `rate_rules` as always date-bounded (`starts_on`/`ends_on` both `NOT NULL`), and Task 4 built overlap-rejection on top of that: two rules for the same room type conflict if their date ranges and applicable weekdays both intersect. Task 6 (admin UI) needs staff to "set a base rate and see/adjust date-specific overrides in a calendar view" — a two-tier model (an ongoing default, plus seasonal exceptions) that the current schema has no way to express. Codex correctly stopped rather than inventing semantics, and separately identified that its own first proposal (treat a full-calendar-date-range rule as the "base rate") does not actually work: Task 4's overlap check would treat that rule's date range as intersecting *any* real seasonal override for the same room type, permanently blocking the exact override pattern Task 6 needs to build. A genuine base/override distinction is required, not a workaround.

## Options

1. **Nullable-date base rule** — allow `starts_on`/`ends_on` to both be `NULL` on a `rate_rules` row, meaning "no date bound, applies unless a dated override matches." At most one such row per `(tenant_id, property_id, rate_plan_id, room_type_id)`, enforced by a partial unique index. Overlap logic changes so a base rule (`NULL` dates) never conflicts with a dated override for the same room type — they're meant to coexist by design — while two overrides with intersecting dates/weekdays still conflict, and two base rules for the same room type still conflict with each other.
2. **A `base_amount` field on `rate_plans`** — one base amount per plan, not per room type. Rejected: a rate plan already spans multiple room types via `rate_rules`, and real properties price room types differently even at their base rate; a single plan-wide amount is wrong for any property with more than one room type.

## Decision

Option 1: a rate rule with both date columns `NULL` is the base rate for its `(rate_plan, room_type)` pair; a rate rule with both date columns set is a dated override.

Accepted by the owner on 2026-07-28.

## Consequences

- **Schema (additive migration on Task 2's tables):** `rate_rules.starts_on`/`ends_on` become nullable. The existing `rate_rules_dates_check` is replaced with a check that permits "both `NULL`" (base) or "both set with `ends_on >= starts_on`" (override) — a half-bounded row (one `NULL`, one set) is rejected as invalid; that half-open case isn't needed for this milestone and would only add ambiguity. A new partial unique index enforces at most one base rule per `(tenant_id, property_id, rate_plan_id, room_type_id)` where `starts_on IS NULL`.
- **Overlap logic (update to Task 4's `rejectOverlap`):** a base rule (`NULL` dates) is never checked against dated override rules — they coexist by design. The existing date-range-and-weekday overlap check continues to apply between two overrides, and the new partial unique index is what prevents two base rules for the same room type (that failure surfaces as a unique-violation-turned-409, matching the existing error-translation pattern, not a new code path in `rejectOverlap` itself).
- **Weekdays on a base rule:** a base rate is a genuine default, not a partial-week rate — it must cover all seven weekdays (`[0,1,2,3,4,5,6]`), not a subset. Reject any base-rule request (`NULL` dates) that specifies a narrower weekday set.
- **Amount resolution for an actual date** (i.e., "what does this room type cost on date X") is not built by this ADR — that's a query/service concern for whichever milestone first needs to resolve a price for a real stay (e.g. availability/booking work), not the admin CRUD/calendar UI Task 6 is building. This ADR only settles the data model and the write-side overlap rule.
- Tasks 2 and 4 remain marked Done for the scope they actually shipped (all-dated rules only, which is what was asked of them at the time) — this ADR's migration and overlap-logic update land as part of Task 6's work, not as a reopening of either earlier task.

## Alternatives considered

- Sentinel full-date-range "base rate" (Codex's original proposal): rejected — demonstrated to be incompatible with Task 4's existing overlap check, which would block any real override from ever being added.
- Plan-wide `base_amount` (option 2 above): rejected — doesn't fit the per-room-type pricing reality the rest of the schema already assumes.
