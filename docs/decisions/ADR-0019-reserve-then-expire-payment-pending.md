# ADR-0019: Reserve inventory immediately, expire on payment timeout

Status: Accepted
Date: 2026-07-30

## Context

Milestone 4's `createBooking` runs synchronously start-to-finish in a single call: reserve inventory, then confirm, all in one transaction. Milestone 5 introduces real Stripe Checkout payment, which is inherently asynchronous — a guest may take minutes to complete payment, or abandon it entirely. This breaks the single-call assumption and requires deciding when inventory is actually consumed: at the moment checkout starts (holding the room while the guest pays) or only once Stripe confirms payment succeeded (via webhook).

## Decision

Reserve inventory immediately when the booking enters `PAYMENT_PENDING` (the same `reserveBookedUnits` call Milestone 4 already built, at the same point in the flow), before the guest has actually paid. A scheduled sweep (BullMQ job, per `docs/ARCHITECTURE.md`'s existing queue infrastructure) transitions any booking still in `PAYMENT_PENDING` past a short window (e.g. 30 minutes — exact value confirmed at task implementation, not fixed by this ADR) to `EXPIRED`, releasing its reservation via the existing `releaseBookedUnits` path — both `EXPIRED` and the release-on-cancel mechanism already exist in Milestone 4's state machine and `LocalPmsProvider`; this reuses them rather than inventing new ones.

## Consequences

- `createBooking`'s flow changes from Milestone 4's fully-synchronous version: it now reserves inventory and returns with the booking in `PAYMENT_PENDING` plus a Stripe Checkout URL, rather than continuing straight through to `CONFIRMED` in the same call. The webhook-driven continuation (`PAYMENT_PENDING → PMS_CREATION_PENDING → PMS_CONFIRMATION_PENDING → CONFIRMED`) happens later, asynchronously, on `checkout.session.completed`.
- A guest who reaches checkout has a firm hold on the room — no "it sold out while I was paying" failure mode, which is the primary guest-experience reason this option was chosen over reserve-on-confirm.
- The expiry sweep is new required infrastructure for Milestone 5 (not optional): without it, an abandoned checkout would hold inventory forever. The sweep job, its interval, and the exact `PAYMENT_PENDING` timeout duration are implementation details for whichever Milestone 5 task builds it — this ADR fixes the reserve-then-expire shape, not the specific numbers.
- If Stripe's webhook reports payment success for a booking that has *already* expired and released its inventory (a slow guest, or webhook delivery delay past the expiry sweep), that is a real edge case Milestone 5's webhook-handling task must resolve explicitly (e.g. re-attempt reservation, or refund and notify) — not silently ignored. Flagged here so it isn't lost; the exact resolution is Milestone 5 task-level work.
- Reserve-on-confirm (the alternative) is not used: it would mean a guest's card can be successfully charged and then immediately require a compensating refund if someone else took the last unit during their checkout — a strictly worse failure mode than a timeout releasing an unpaid hold.

## Implementation detail (Milestone 5, Task 5)

The payment hold is **30 minutes**. A BullMQ worker sweeps once per minute, expires eligible
`PAYMENT_PENDING` bookings, and releases their booked inventory in the same tenant-scoped
transaction.

A verified payment webhook that arrives after expiry deliberately does not re-reserve or confirm
the booking. It records an immutable `CHARGE` ledger row with status `LATE_AFTER_EXPIRY`, writes an
audit entry, immediately issues an idempotent refund through the Task 6 shared refund flow, and leaves
the booking `EXPIRED`.

## Alternatives considered

- Reserve only after payment succeeds (webhook re-runs the availability check/reservation): rejected per the owner's explicit preference — trades a rare, guest-favorable failure mode (a false "still available" during checkout, resolved by expiry) for a rare but worse one (a successful charge immediately followed by a forced refund).
