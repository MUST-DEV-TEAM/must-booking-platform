# ADR-0014: Booking state machine is the full production state list from Milestone 4

Status: Accepted
Date: 2026-07-30

## Context

Source brief section 17 (`docs/source/clock-pms-integration.pdf`) defines the booking state machine as:

```
DRAFT -> QUOTED -> INVENTORY_REVALIDATING -> PAYMENT_PENDING/NOT_REQUIRED
      -> PMS_CREATION_PENDING -> PMS_CONFIRMATION_PENDING -> CONFIRMED
```

with failure states `AVAILABILITY_FAILED`, `PAYMENT_FAILED`, `PMS_UNKNOWN_RESULT`, `PMS_REJECTED`, `MANUAL_REVIEW`, `CANCELLED`, `EXPIRED`. Milestone 4 builds this against `LocalPmsProvider` only — there is no real PMS or payment integration yet (Milestone 5 is payments, Milestone 9 is the Clock adapter). The `PMS_CREATION_PENDING`/`PMS_CONFIRMATION_PENDING` states name a PMS round-trip that doesn't exist locally, and `PAYMENT_PENDING` names a payment flow that doesn't exist yet either, so Milestone 4 needs to decide whether to build the state machine Milestone 9/5 will eventually need now, or a smaller local-only version now with new states added later.

## Decision

Milestone 4 implements the full state list from section 17, unchanged, from day one: `DRAFT → QUOTED → INVENTORY_REVALIDATING → PAYMENT_PENDING/NOT_REQUIRED → PMS_CREATION_PENDING → PMS_CONFIRMATION_PENDING → CONFIRMED`, plus all seven failure states. `LocalPmsProvider.createBooking` resolves `PMS_CREATION_PENDING` and `PMS_CONFIRMATION_PENDING` synchronously (same transaction, no real async wait), and every Milestone 4 booking takes `PAYMENT_NOT_REQUIRED` (a placeholder — Milestone 5 introduces `PAYMENT_PENDING`'s real semantics and payment verification).

## Consequences

- The state machine, its transition table, and the `integration_operations`-style idempotency table (task 5) are the actual production versions from Milestone 4 onward — Milestone 9 changes only which `PmsProvider` implementation resolves `PMS_CREATION_PENDING`/`PMS_CONFIRMATION_PENDING` (synchronously and locally now, asynchronously against real Clock API calls later), and Milestone 5 changes only how `PAYMENT_PENDING`/`PAYMENT_NOT_REQUIRED` is decided and what unblocks it. Neither milestone needs to add new states or migrate existing bookings to a new state enum.
- `LocalPmsProvider.createBooking` must still go through the same `PMS_CREATION_PENDING → PMS_CONFIRMATION_PENDING → CONFIRMED` transitions (recorded, not skipped) even though it resolves them immediately, so the audit trail and any code that reacts to state-change events behaves identically regardless of which provider is active.
- Task 3's "failure states" acceptance criteria covers all seven from the brief, not a reduced local subset: `AVAILABILITY_FAILED`, `PAYMENT_FAILED`, `PMS_UNKNOWN_RESULT`, `PMS_REJECTED`, `MANUAL_REVIEW`, `CANCELLED`, `EXPIRED`. `PMS_UNKNOWN_RESULT`/`PMS_REJECTED` are reachable in principle even from `LocalPmsProvider` (e.g. a simulated/injected failure path in tests) so the transition table and its guards are exercised now rather than left untested until Milestone 9.
- The booking `status` column is a Postgres enum (or equivalent constrained type) with exactly these values; adding a state later (if one is ever needed) is an additive migration, not a rename — enum values already in use are never renamed or removed.

## Alternatives considered

- Reduced local-only state list (`DRAFT → QUOTED → INVENTORY_REVALIDATING → PAYMENT_PENDING/NOT_REQUIRED → CONFIRMED`), adding `PMS_CREATION_PENDING`/`PMS_CONFIRMATION_PENDING` in Milestone 9: rejected — the milestone's own goal is to prove the state machine and idempotency pattern before Clock needs them; deferring the PMS-shaped states means Milestone 9 has to extend a live enum and retrofit transition logic under real integration pressure instead of just plugging in a new provider.
