# Clock PMS+ Booking State Machine

Milestone 11 deliverable (source brief section 37/Appendix B, section 17). `ClockBookingService` drives the **same** `BookingStateMachine` instance and the **same** `BookingStatus` enum `LocalPmsProvider` uses (`apps/api/src/booking/booking-state-machine.ts`, `packages/domain-contracts`) — there is no parallel Clock-specific state machine, per the source brief's explicit requirement (Task 10 acceptance criteria).

## States actually reached by ClockBookingService

```
DRAFT
  │ QUOTED
  │   │ INVENTORY_REVALIDATING
  │   │   │ PAYMENT_NOT_REQUIRED        ← always this branch; see "What's skipped" below
  │   │   │   │ PMS_CREATION_PENDING
  │   │   │   │   ├─→ PMS_CONFIRMATION_PENDING → CONFIRMED     (Clock 2xx, well-formed response)
  │   │   │   │   ├─→ PMS_REJECTED                              (Clock 4xx clean rejection)
  │   │   │   │   └─→ PMS_UNKNOWN_RESULT                        (timeout/network + reference lookup failed)
  │   │   │   │         → manual_review_items row (UNKNOWN_RESULT)
CONFIRMED → CANCELLED                                            (cancelBooking, any confirmed booking)
```

`updateBooking` (dates only) does not transition status at all — it re-fetches Clock's `lock_version`, `PUT`s the new dates, and increments the local `version` counter; the booking stays `CONFIRMED` throughout.

A malformed-but-2xx Clock response (fails `isClockBookingResource`) also lands on `PMS_UNKNOWN_RESULT`, with a `SCHEMA_MISMATCH` manual-review row instead of `UNKNOWN_RESULT` — same terminal status, different manual-review category (see `CLOCK_ERROR_CATALOGUE.md` / `docs/roadmap/milestones/11-clock-pms-adapter-basic.md` Task 12).

## What's skipped: `PAYMENT_PENDING`

`LocalPmsProvider` can transition `INVENTORY_REVALIDATING → PAYMENT_PENDING` (a non-zero total requiring Stripe/PokPay checkout) before reaching `PMS_CREATION_PENDING`. `ClockBookingService` **always** takes the `PAYMENT_NOT_REQUIRED` branch instead, regardless of the booking's total — per this milestone's explicit "PMS-interface-only" scope decision (see `CLOCK_ARCHITECTURE.md`), there is no payment-provider selection or checkout-session creation on this path at all. A Clock booking's `total`/`paymentMethod` fields are recorded on the local row as metadata but never drive an actual payment collection.

## Transitions never reached (this milestone)

- `AVAILABILITY_FAILED` — `ClockBookingService` doesn't run a local inventory check (Clock owns availability); this status is `LocalPmsProvider`-only.
- `PAYMENT_FAILED` — no payment orchestration on this path (see above).
- `MANUAL_REVIEW` (as a `BookingStatus`, distinct from the `manual_review_items` table) — the state machine allows `PMS_REJECTED`/`PMS_UNKNOWN_RESULT` → `MANUAL_REVIEW`, but nothing in `ClockBookingService` performs that transition; a rejected/unknown-result booking just stays there. `manual_review_items` rows are the actual manual-review mechanism built this milestone (Task 12), not a `BookingStatus` value.
- `EXPIRED` — `LocalPmsProvider`'s payment-pending timeout sweep (`expirePaymentPending`) has no Clock equivalent, since Clock bookings never enter `PAYMENT_PENDING`.

## Idempotency

Every `createBooking`/`updateBooking`/`cancelBooking` call is wrapped in the same `integration_operations` pattern `LocalPmsProvider` uses (source brief section 18's exact column list: `idempotency_key`, `aggregate_id`, `request_hash`, `status`, `attempts`, `external_entity_id`) — insert-or-conflict on `(tenant_id, idempotency_key)`, replaying the stored `Result` on a retried call with the same key+request rather than re-calling Clock. Verified for real by `clock-booking.e2e.spec.ts`: a replayed create returns the identical cached failure, creates no second `bookings` row, and increments `integration_operations.attempts`.

## Optimistic concurrency: two independent counters

- **Local** (`bookings.version`): MUST's own counter, exactly like `LocalPmsProvider` — `command.expectedVersion` must match before an update/cancel is allowed, `VERSION_CONFLICT` (retryable) otherwise.
- **Clock** (`lock_version`): Clock's own token, fetched fresh via `GET /bookings/{id}` immediately before every `PUT`, never persisted locally. A stale write on Clock's side surfaces as an HTTP 500 with a fixed message (`"Attempted to update a stale object: Booking"`), specifically reclassified in code as `conflict`/retryable rather than falling through to the generic 5xx handler (which would otherwise call it `permanent`).

These two concurrency tokens are deliberately decoupled — a MUST-side version conflict and a Clock-side `lock_version` conflict are different failure modes with different causes (a MUST-side concurrent request vs. someone changing the booking directly in Clock's own UI) and are surfaced through the same `VERSION_CONFLICT`-style retryable-`Result` shape either way.
