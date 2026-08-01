# ADR-0015: Guest matching rule for Milestone 4

Status: Accepted
Date: 2026-07-30

## Context

Source brief section 24 (`docs/source/clock-pms-integration.pdf`) requires guest matching not be name-only, and lists external ID, email, phone, booking relationship, and manual confirmation as legitimate signals. Milestone 4 has no external PMS ID yet (`LocalPmsProvider` doesn't sync guests to any outside system — that's Milestone 10's Clock guest sync). Task 6 needs a concrete rule now: given a new booking's guest details, when does it attach to an existing guest record within the tenant versus create a new one.

## Decision

Match on exact email (case-insensitive) within the tenant. A match attaches the booking to that guest record; no match always creates a new guest record. Phone number is stored on the guest record but is never used to automatically merge or match — it's informational/contact data only, not a matching key. There is no auto-merge on name or partial signals, and no manual-merge UI in Milestone 4.

## Consequences

- `guests` table is scoped `(tenant_id, ...)` (not per-property — a guest can book at multiple properties under the same tenant) with a unique index on `(tenant_id, lower(email))`.
- Guest lookup on booking creation is a single exact-match query on normalized email; no fuzzy matching, no phone-based lookup, no name-based lookup.
- A guest who books under two different email addresses gets two separate guest records in Milestone 4 — this is accepted as correct-by-default (avoiding false-positive merges) rather than a gap, consistent with how most booking systems default. Staff-facing manual merge (for the case where staff recognize it's the same person) is out of scope for this milestone and is not blocked by this decision — it can be added later as an additive admin action without changing the matching rule itself.
- When Milestone 10 introduces Clock's own guest sync, external ID becomes an additional, higher-precedence matching signal on top of this rule (per the brief's list) — this ADR only settles the local-only path; it doesn't need to anticipate Clock's external-ID matching now.

## Alternatives considered

- Email OR phone match (either one sufficient to attach to an existing guest): rejected — a shared or reissued phone number (couples, families, reassigned mobile numbers) risks silently merging two different people's booking history onto one guest record, which is worse than the accepted downside of occasional duplicate records for the same real person.
