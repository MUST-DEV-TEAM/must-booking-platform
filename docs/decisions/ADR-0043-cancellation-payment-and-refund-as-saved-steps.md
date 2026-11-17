# ADR-0043: Cancellation, payment confirmation and refunds as saved steps

Status: Proposed (Milestone 40 task 9). Waiting for the owner's approval. Nothing here is built; task 10 builds it in three pull requests only after approval.
Date: 2026-11-17

## Context

Three flows talk to the outside world (Clock, PokPay, Stripe) while MUST keeps one database transaction open. If the transaction hits its time limit, or the API restarts after the outside party has already acted, MUST undoes its own record while the outside change stays. The guest is then charged, refunded or cancelled somewhere with no matching record here.

What the code does today (read 2026-11-17, `apps/api/src`):

| Flow | Where | Held open | What happens inside the one transaction |
| --- | --- | --- | --- |
| Guest or staff cancellation | `booking/local-pms.provider.ts`, `cancelBooking` | 30 s | Saves the idempotency record, cancels the booking in Clock, clears room charges, asks the payment provider for the refund, releases the rooms, saves the cancelled state and the audit record. Emails go out after the commit. |
| Payment confirmation (Clock hotels) | `integrations/clock/clock-booking.service.ts` (the create-booking step) and `booking/multi-room-booking.service.ts` | 45 s | Creates the reservation in Clock and moves the booking to CONFIRMED in the same transaction. |
| A paid PokPay order | `payments/pokpay-payment.service.ts`, `processAuthoritativeOrder` | one transaction | Reads the order from PokPay and records the payment against the booking. A paid order for a booking that has already expired is refused and recorded nowhere (the late-payment gap, M40 task 3). |
| Staff approval of a cancellation request, and a hotel cancelling in Clock | `booking/booking-requests.service.ts`, `payments/hotel-cancellation-refund.service.ts` | 90 s | Approval runs the cancellation above and the refund inside one transaction. |
| A staff or cancellation refund | `payments/payment-refund.service.ts` | uses a separate durable record | See below: refunds are already partly saved steps. |

What already exists and this design builds on:

- **Refunds are the furthest along.** `refundCharge` saves the refund attempt as its own durable record (`integration_operations`, status PENDING) before it calls the provider, writes the provider's answer back with retries, and a recovery sweeper (`recoverStuckRefund`, fed by the `payment_stuck_refund_operations` list) reads the provider for an attempt that never finished and tells staff if it cannot prove the outcome.
- **Idempotency keys** (`withIdempotency`) already make a repeated request return the saved answer.
- **Review items and notifications** (`manual_review_items`, `notifications`) already exist for "a person must look".
- **Clock sync jobs** (`clock_sync_jobs`) and BullMQ workers already exist for work that must be retried.

Cancellation is the flow that is still one big transaction. Payment confirmation is in between.

## Decision

Each flow becomes a list of **steps**. Every step is saved in its own short transaction, does exactly one outside action, and is safe to repeat. A step that did not finish is picked up again by a worker; a person is only asked when the worker cannot prove what happened.

The rules every step follows:

1. **Save the intention first, then act, then save the result.** The intention is a row with a stable key (the booking id plus the step name), written before the outside call. The result is written after. A repeat finds the row and either returns the saved result or asks the outside party whether it already did the action.
2. **Ask before repeating.** A step that may have reached the outside party reads it first (Clock: the booking's status; PokPay and Stripe: the order or refund). It never repeats an action that already happened. This is what the refund recovery already does.
3. **No outside call inside a database transaction.** The transaction only reads and writes MUST's own rows.
4. **The booking states are shown to people as they are** (see "What people see").

### Cancellation: the steps

1. **Requested.** Save the cancellation as requested (who, why, the refund the policy gives). The booking keeps its dates and rooms. Answer the guest "we are cancelling".
2. **Cancelled in Clock.** Cancel the reservation in Clock (skipped for a booking with no Clock reservation). Repeat-safe: read Clock's status first.
3. **Refund sent.** Ask the payment provider for the refund through the existing refund attempt record (no new mechanism).
4. **Refund confirmed.** The provider's answer is saved; a refund still pending is read again by the existing recovery sweeper.
5. **Refund posted to Clock.** The negative payment on the deposit folio, as `postRefund` does today. A Clock failure here never undoes the refund; it raises the review item that exists today.
6. **Charges cleared.** Release the rooms and clear room charges, for bookings MUST itself cancelled (not for a hotel's own Clock cancellation, decision D6).
7. **Closed.** Mark the booking cancelled and send the emails, once.

The guest-visible "cancelled" moment is step 2 (the room is no longer held), not step 7.

### Payment confirmation: the steps

1. **Payment seen.** A paid order is recorded against the booking first, even when the booking has expired (this is the late-payment fix, M40 task 3, and is the one step that must be built before any other change here).
2. **Room checked.** Confirm the room is still free at the same price.
3. **Reservation created in Clock** (or the local reservation made). It must be repeat-safe: read Clock for a reservation carrying the booking's reference before creating one. Unverified: whether today's create step already does this; it is read when task 10 starts.
4. **Confirmed.** Mark the booking CONFIRMED and send the emails, once.
5. **If step 2 fails:** refund through the refund steps above, tell the guest and staff.

### Refunds: the steps

Refunds keep their current shape (intention, provider call, saved answer, recovery sweeper). The change is only that a refund started from a cancellation uses the same record, so one refund can never be sent twice from two flows.

### The worker that resumes unfinished steps

- A single BullMQ worker (the pattern of `clock-refund-mirror-check.service.ts`) reads the open step rows every minute and runs the next step of each.
- A step is retried with backoff: 1, 5, 30 minutes, then hourly, for 24 hours.
- After 24 hours, or after any answer that proves the outside party refused, the step becomes **needs a person**: one review item and one bell notice (the existing ones), with the exact action. It is never retried silently forever.

## What staff and the guest see

The owner asked for separate states (the cancellation follow-up in `open-follow-ups.md`):

| State | Staff see | Guest sees |
| --- | --- | --- |
| Cancellation requested | "Cancelling", with the step it is on | "We are cancelling your booking" |
| Cancelled in Clock | "Cancelled" | "Your booking is cancelled" |
| Refund sent / confirmed | "Refund sent" then "Refunded" | "Your refund is on its way" then the refund email |
| Posted to Clock | "Settled in Clock" | nothing |
| Needs a person | the existing Needs attention item | nothing new |

The exact wording is decided when task 10 is built.

## Refund allocation (MBA-014)

A refund row names the charge it reverses. A multi-room order's refund finds the charge-owning booking instead of the booking the guest clicked. This is a data change on the refund record and is built with the refund pull request (task 10, third), not before.

## Changes made in Clock (MBA-008)

A change made in Clock while a step is open (for example the hotel cancels in Clock mid-refund) enters as an event the step reads, not as an overwrite of the booking: the step sees the booking is already cancelled in Clock and skips "Cancelled in Clock". Unverified: the exact fields hydration overwrites today; this must be read when task 10 starts.

## Tests

For each flow, a test that **cuts the flow after every outside call** and shows it finishes correctly after a restart:

- cancellation: a restart after each of the seven steps leaves exactly one Clock cancellation, one refund and one email;
- payment confirmation: a restart after the payment is seen, and after the reservation is created, confirms once;
- refunds: a restart after the provider call leaves one refund.

## Migration path for flows in flight at deploy time

Each of the three pull requests is a deploy that changes behaviour. The rule for each: deploy outside a busy hour; the new code treats a booking with no step rows as "finished under the old code" and never starts a step for it; a flow already running when the old API stops is finished by the old code's own recovery (refunds) or by a person (the existing review items). Unverified: how many bookings are mid-flow at any moment. It must be counted read-only before each deploy.

## Order of work (task 10)

1. **Payment confirmation, step 1 only** (record a late payment, M40 task 3, slice 40-3b). Smallest change, fixes a live gap, no ADR dependency beyond this paragraph.
2. **Cancellation** as seven steps. The largest change and the one that shortens the 30 s transaction.
3. **Refund allocation and the shared refund record.**

Milestone 38 task 6 lowers the database timeouts only after step 2 is live.

## Risks and what is not known

- The seven cancellation steps change what a guest and staff see during a cancellation. The wording and the "cancelled" moment need the owner's decision.
- Clock's cancel call and PokPay's refund call were each seen to work and to fail in the sandbox; their behaviour when called twice is **not verified** for every case. Rule 2 (ask before repeating) is the protection and must be tested against the real sandboxes.
- A worker that retries money steps must never run twice at once. The existing idempotency keys and one advisory lock per booking are the plan; the exact lock is decided in task 10.
- The recovery for payment confirmation depends on the late-payment slice (40-3b), which is marked for the strongest model.

## Consequences

- A restart or a timeout during a cancellation, payment or refund leaves a record that says exactly where it stopped, and a worker finishes it.
- The 30, 45 and 90 second transactions go away, which frees database connections and removes the "local record undone, outside change kept" failure.
- More rows (one per step) and one more worker. A hotel sees a cancellation take a few seconds longer to reach "refund confirmed", because it is no longer all-or-nothing.

## Decision requested

The owner approves, changes or rejects: the seven cancellation steps and the "cancelled" moment; the retry schedule (24 hours, then a person); and the order of work above.

## Alternatives considered

1. **Keep one transaction and raise the time limits.** Cheapest, but it only moves the failure: a restart still undoes MUST's record after the outside party acted, and a longer transaction holds a database connection and a booking lock longer. Rejected.
2. **A workflow engine (for example Temporal).** Gives saved steps and retries out of the box, but adds a new service to run, secure and back up on a one-CPU, 1 GB server. Not chosen now; the steps above are written so they could move there later.
3. **Saved step rows plus a worker (chosen).** Uses what already exists (idempotency keys, the refund attempt record, the recovery sweeper, BullMQ, review items) and adds only step rows and one worker.
