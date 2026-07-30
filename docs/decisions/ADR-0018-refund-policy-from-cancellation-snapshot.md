# ADR-0018: Refund amount is driven automatically by the cancellation-policy snapshot

Status: Accepted
Date: 2026-07-30

## Context

Milestone 4's Task 9 evaluates each booking's rate-plan cancellation policy at cancellation time and records the result (`cancellation_is_free`, `cancellation_free_until_hours`, `cancellation_cutoff_at` on `bookings`) — a fact only, no monetary action, since Milestone 4 has no payment integration yet. Milestone 5 introduces real guest payments and refunds, and needs to decide what actually happens to the guest's money when a booking is cancelled: does the recorded `cancellation_is_free` fact automatically trigger a refund, or does every refund require a separate staff decision regardless of policy.

## Decision

`cancelBooking`'s already-recorded `cancellation_is_free` automatically determines the refund outcome: `true` triggers a full automatic refund of the booking's payment (via `PaymentProvider`'s refund call, Milestone 5 task 6's plumbing) as part of the same cancellation flow; `false` triggers no automatic refund. Staff can still issue a manual refund on top of this default (e.g. a goodwill exception for a non-refundable booking) through the staff-initiated refund flow — the automatic behavior is the *default*, not the *only* path.

## Consequences

- Milestone 5's task ordering must land the payment ledger and `PaymentProvider` interface (tasks 1–4) before wiring automatic refund-on-cancel, since the automatic refund needs a real payment record to refund against.
- `cancelBooking` (`apps/api/src/booking/local-pms.provider.ts`) gains a new responsibility once Milestone 5 lands: after computing `cancellationPolicy` and before or alongside the `CANCELLED` transition, check for an associated payment record and issue a refund call when `isFree` is true. This must go through the same idempotency (`integration_operations`) pattern already established, since a retried cancellation must not double-refund.
- A non-refundable or past-cutoff cancellation (`isFree: false`) leaves the guest's payment untouched by default — the booking still cancels, inventory still releases (per Milestone 4's existing behavior), only the refund is skipped. Staff-initiated refund (Milestone 5 task 6) remains available as an explicit override for either case.
- This does not change Milestone 4's Task 9 scope retroactively — it was correctly scoped to record the fact only; this ADR is what makes that fact actionable once payments exist.

## Alternatives considered

- Refund always staff-discretionary, `cancellation_is_free` informational only: rejected per the owner's explicit preference — it would mean a guest cancelling well within a clearly free window still waits on manual staff action to get their money back, a worse default guest experience than automating the common case.
