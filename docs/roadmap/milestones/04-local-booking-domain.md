# Milestone 4: Local Booking Domain & State Machine

Status: Not started
Depends on: Milestone 3

## Goal

The provider-agnostic booking domain exists: the `PmsProvider` interface (`docs/ARCHITECTURE.md`), a `LocalPmsProvider` implementation, the booking state machine, and idempotent booking creation/update/cancellation — proven against local inventory before any PMS complexity is introduced. Done means: a booking can be created, updated, and cancelled idempotently, with double-booking provably prevented under concurrency.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. `PmsProvider` interface finalized in `packages/domain-contracts` per `docs/ARCHITECTURE.md`'s signature.
2. `LocalPmsProvider` implementation over Milestone 3's inventory model.
3. Booking state machine (adapted from `docs/source/clock-pms-integration.pdf` section 17 for the local-only path: DRAFT → QUOTED → INVENTORY_REVALIDATING → ... → CONFIRMED, plus failure states).
4. Quote snapshot mechanism (signed/session-bound, tamper/staleness detection per the source brief section 16).
5. Booking create/update/cancel API, idempotent via an `integration_operations`-style table (source brief section 18) even for the local provider, so the pattern is proven before Milestone 9 needs it for Clock.
6. Guest record model and guest-matching rule (source brief section 24 — not name-only matching).
7. Concurrency test: two simultaneous booking attempts for the last unit of inventory — exactly one must succeed.
8. Booking projection/read model for admin/dashboard consumption (source brief section 23).
9. Cancellation policy evaluation (basic local cancellation rules; refund handling is Milestone 5's concern).
10. Unit + integration test suite for every state transition, including failure/edge states (AVAILABILITY_FAILED, MANUAL_REVIEW equivalent for local).

## Explicitly not included

- Any external PMS provider (Milestone 9).
- Payment processing (Milestone 5) — bookings here are payment-agnostic at the state-machine level, with a placeholder payment-pending state.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
