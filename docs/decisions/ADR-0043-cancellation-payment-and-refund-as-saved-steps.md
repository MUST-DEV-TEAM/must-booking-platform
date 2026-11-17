# ADR-0043: Cancellation, payment confirmation and refunds as saved steps

Status: Proposed (Milestone 40 task 9). Waiting for the owner's approval. Nothing here is built; task 10 builds it in the order at the end, one pull request per step of that order.
Date: 2026-11-17 (revised the same day after reading the code for every point the first draft left open; step history, flow versions, lease limits and the reconciliation safety net added on the owner's request)

## Summary

Each money-and-Clock flow becomes a **saved process**: one row per booking flow that records which step it reached, and one short database transaction per step. Each step makes exactly one call to Clock, PokPay or Stripe, and is safe to repeat because it either passes an idempotency key or reads the outside system before acting again. The request that starts a flow runs its steps straight away, so a guest normally sees the result in the same moment as today. A worker only picks up a flow that stopped part-way. A person is asked only when the worker cannot prove what happened.

This is the standard pattern for this problem: an orchestrated saga with a persisted process record. The process row is the "outbox", written in the same transaction as the state change, so no separate message broker is needed.

## Context

### What the code does today (read 2026-11-17, `apps/api/src`)

| Flow | Where | Held open | Inside the one transaction |
| --- | --- | --- | --- |
| Guest or staff cancellation | `booking/local-pms.provider.ts`, `cancelBooking` | 30 s | Idempotency record, Clock cancellation, room charge clearing, refund call to the provider, room release, cancelled state, audit. Emails after the commit. |
| Payment confirmation (Clock hotels) | `integrations/clock/clock-booking.service.ts` (create step), `booking/multi-room-booking.service.ts` | 45 s | Creates the Clock reservation and moves the booking to CONFIRMED. |
| A paid PokPay order | `payments/pokpay-payment.service.ts`, `processAuthoritativeOrder` | one transaction | Reads the order from PokPay and records the payment. A paid order for an expired booking is refused and recorded nowhere (M40 task 3, the late-payment gap). |
| Approving a cancellation request; a hotel cancelling in Clock | `booking/booking-requests.service.ts`, `payments/hotel-cancellation-refund.service.ts` | 90 s | Runs the cancellation and the refund inside one transaction. |
| Refunds | `payments/payment-refund.service.ts`, `refundCharge` | separate durable record | Already saves the attempt before calling the provider, writes the answer back with retries, and a recovery sweeper (`recoverStuckRefund`) finishes or escalates an attempt that never completed. |

The failure all of these share: if the transaction times out, or the API restarts after the outside party acted, MUST rolls back its own record and the outside change stays. The result is a guest charged, refunded or cancelled somewhere, with no matching record here.

### How safe each outside call is to repeat (verified in the code)

| Call | Repeat-safe today? | How |
| --- | --- | --- |
| Clock: create reservation | Yes | Looks up our own reference first (`linkIfClockHasIt`) and links instead of creating a second one. |
| Clock: cancel reservation | Partly | Reads the booking, then sends `status: canceled` with Clock's `lock_version`. It does not yet treat "already cancelled" as done; the design adds that. |
| Clock: post the refund on the deposit folio | Yes | Looks for the refund's reference on the folio before posting (`postRefund`). |
| Stripe: checkout and refund | Yes | Sends an idempotency key on both calls. |
| PokPay: refund | No provider key | PokPay takes no idempotency key, so a PokPay refund must always be read back from PokPay before any retry. |

### Volume (live, read-only, 2026-11-17)

Nothing is in flight at Empire or Luxury. Must Hotel (test) has 3 bookings waiting for payment and 4 with an unknown Clock result. There were 22 cancellations in the last 30 days across all hotels. The volume is tiny, so a database-driven worker is the right size. A workflow engine or message broker would add a service to run on a one-CPU, 1 GB server for no gain.

## Decision

### 1. The process record

A new table, `booking_flows`, has one row per flow run:

- `kind` (CANCELLATION or PAYMENT_CONFIRMATION), `booking_id`, `state` (the last step completed), `status` (RUNNING, WAITING, NEEDS_PERSON, DONE);
- `attempts`, `next_run_at`, `last_error`, `context` (what the flow decided, for example the refund amount the policy gave, frozen at the start);
- `lease_token`, `lease_until`, the same claim mechanism `clock_sync_jobs` already uses;
- a unique partial index: **one active flow per booking and kind**. A second cancellation of the same booking joins the running one instead of starting another;
- `definition_version`: the version of the step list the flow started under. When the steps change later, a flow already running finishes under the version it started with; the worker keeps the code for every version that still has unfinished flows.

A second table, `booking_flow_events`, keeps the **step history**: one row appended per attempt (flow, step, attempt number, started and finished time, result or error, the outside reference such as the Clock booking or the provider refund id). Rows are never updated or deleted. It answers "what happened to this refund?" for support and staff, and it feeds the booking history (M40 task 14). It holds no card data and no credentials.

Row-level security applies as on every other table. The worker finds work across hotels through a narrow `SECURITY DEFINER` function, the pattern of `payment_refunds_for_clock_check`.

Provider calls keep using `integration_operations` with the key `flow:<flow id>:<step>`, so the existing idempotency checks and the refund recovery apply unchanged.

### 2. How a step runs

1. **Claim** the flow row (lease for 2 minutes, `FOR UPDATE SKIP LOCKED`), so two workers or a worker and a web request never run the same flow at once. Every outside call made by a step has its own time limit well inside the lease (Clock, PokPay and Stripe calls at most 30 s each, a step at most 60 s in total). A step that could run longer renews its lease before it expires. A step whose lease ran out never records its result over a newer claim: the record checks the lease token, as `clock_sync_jobs` already does.
2. **Act**: one outside call, never inside a database transaction.
3. **Record** the result and advance `state` in one short transaction. If the record fails, the next run reads the outside system and records it then.

A step that may already have reached the outside party reads it first and never repeats an action that happened. This uses the table above.

### 3. Cancellation: the steps

| # | Step | Outside call | Repeat rule |
| --- | --- | --- | --- |
| 1 | **Requested**: save the flow, the reason and the refund the policy gives (frozen) | none | the unique index |
| 2 | **Cancelled in Clock** (skipped without a Clock reservation) | Clock | read the booking first; "already cancelled" counts as done |
| 3 | **Room released and booking cancelled** in MUST | none | state check |
| 4 | **Refund sent** (skipped when nothing is due) | PokPay or Stripe | the existing refund attempt record; Stripe key; PokPay read-back |
| 5 | **Refund confirmed** | none or a read | the existing recovery sweeper |
| 6 | **Refund posted to Clock** | Clock | reference lookup on the folio, as today; a failure raises the existing review item and never undoes the refund |
| 7 | **Done**: emails sent once (keyed, as the delivery queue already does) | none | email keys |

The **point of no return** is step 2. Before it, a failure can simply stop the flow and leave the booking as it was. After it, the flow only moves forward: a cancelled Clock reservation is never un-cancelled to "repair" a refund problem. The refund is retried, or handed to a person.

Room charge clearing for a hotel's own Clock cancellation stays out of this flow (decision D6).

### 4. Payment confirmation: the steps

| # | Step | Outside call | Repeat rule |
| --- | --- | --- | --- |
| 1 | **Payment recorded**, also for an expired booking (fixes the late-payment gap first) | read the order | the order id is unique |
| 2 | **Room checked**: still free at the same price | Clock availability read | read only |
| 3 | **Reservation made** in Clock (or locally) | Clock | reference lookup, as today |
| 4 | **Confirmed**, emails once | none | email keys |
| 2b | If the room is gone: **refund** through the cancellation flow's refund steps, then tell the guest and staff | provider | as above |

Step 3 is the point of no return. Step 2b is the only compensation in the design: money taken for a room we cannot give is returned.

### 5. Refunds

Refunds keep their current shape. The only change is that a refund started by a flow uses the flow's key, so the same refund can never be sent twice from two paths (a cancellation and a staff refund).

### 6. Running steps: straight away, then the worker

- The web request that starts a flow runs its steps right away and answers with the state reached. A guest sees "Cancelled, refund on its way" in the same moment as today.
- If any step fails or the request ends early, the flow is left at its last saved step with `next_run_at` set.
- A worker (BullMQ, every minute, like the existing nightly checks) claims flows that are due and runs their next step.

### 7. Retries and handing over to a person

- **Retryable errors** (timeout, connection error, 429, 5xx, Clock's lock-version conflict): retry with exponential backoff and jitter, at about 1, 2, 5, 15 and 30 minutes, then hourly.
- **Errors that prove a refusal** (a 4xx that names the reason, for example "refund exceeds the charge"): no retry. The flow goes straight to NEEDS_PERSON.
- **A person is told after 1 hour** at most for any flow involving money (one review item and one bell notice, the existing ones), while retryable errors keep retrying. A guest's refund should not wait a day before someone looks.
- **Automatic retries stop after 72 hours**; the flow stays NEEDS_PERSON with the exact action needed.
- An operational alert fires when any flow has been unfinished for more than 1 hour (one alert per flow, not per retry).

## What staff and the guest see

| Flow state | Staff | Guest |
| --- | --- | --- |
| Cancellation requested (steps 1 to 2) | "Cancelling" | "We are cancelling your booking" |
| Cancelled (after step 3) | "Cancelled" | "Your booking is cancelled" |
| Refund sent / confirmed (steps 4 to 5) | "Refund sent", then "Refunded" | "Your refund is on its way", then the refund email |
| Posted to Clock (step 6) | "Settled in Clock" | nothing |
| Needs a person | the existing Needs attention item, with the action | nothing new |

The guest is told "cancelled" when the room is released, not when the money arrives, and the refund is shown as a separate line. That is how the large booking sites present it, and it keeps a slow refund from looking like a failed cancellation. The exact words are written with task 10.

## Refund allocation (MBA-014)

A refund row names the charge it reverses. A multi-room order's refund finds the booking that owns the charge, not the booking the guest clicked. This is built with the refund change (order step 4 below).

## Changes made in Clock while a flow runs (MBA-008)

Hydration writes Clock's status over the booking's status (`clock-booking-hydration.service.ts`, the upsert). It already refuses to resurrect a cancellation from an older read, and a test covers that. A flow therefore treats Clock as the source of truth at each step: if the hotel cancels in Clock while a MUST cancellation is running, step 2 reads "already cancelled" and moves on. A payment confirmation that finds the booking cancelled in Clock goes to step 2b (refund). No flow overwrites a change made in Clock.

## The daily reconciliation stays as a safety net

The flows do not replace the checks that compare MUST with the outside systems every night: the PokPay reconciliation and the Clock refund check (`clock-refund-mirror-check.service.ts`). They stay as a second, independent line of defence. If a flow says DONE but PokPay or Clock disagrees, the nightly check raises its own review item. Each flow also records the outside references the nightly checks compare against.

## Tests

For each flow, a test cuts it after every outside call, restarts it, and checks that it finishes correctly:

- **Cancellation:** a restart after each of the seven steps leaves exactly one Clock cancellation, one refund, one Clock posting and one set of emails.
- **Payment confirmation:** a restart after each step confirms once. A room that is gone at step 2 refunds once.
- **Concurrency:** two workers and one web request on the same flow run each step once (the lease).
- **PokPay:** a refund whose answer was lost is read back, not sent again.

The tests run on the real database (the isolated test box and CI) with the outside calls stubbed. One check per flow also runs against the Clock and PokPay sandboxes before each release.

## Moving flows that are running when it is deployed

- A booking with no `booking_flows` row is treated as finished under the old code; the new worker never starts a flow for it.
- Before each deploy, count bookings in flight read-only (today: none at real hotels). Deploy outside busy hours. A flow interrupted by the deploy is finished by the old code's own recovery (refunds) or appears as an existing review item.
- Each step of the order below is its own pull request and its own deploy, behind its own tests.

## Order of work (task 10)

1. **Late payment recorded and resolved** (payment confirmation steps 1, 2 and 2b; slice 40-3b). Fixes a live gap and introduces `booking_flows` and the worker with the smallest flow.
2. **Payment confirmation fully as steps** (steps 3 and 4), which removes the 45 s transaction.
3. **Cancellation as steps**, which removes the 30 s and 90 s transactions. This is the largest change.
4. **Refund allocation** and the shared refund key.

Milestone 38 task 6 lowers the database timeouts only after order step 3 is live.

## Alternatives considered

1. **Keep one transaction and raise the time limits.** Cheapest, but it only moves the failure: a restart still undoes MUST's record after the outside party acted, and a longer transaction holds a database connection and a booking lock longer. Rejected.
2. **A workflow engine (for example Temporal) or a message broker.** It gives saved steps and retries out of the box, but adds a service to run, secure and back up on a one-CPU server, for 22 cancellations a month. Not chosen. The step design above can move there later without changing the steps.
3. **Saved process rows plus a worker (chosen).** It reuses what exists (idempotency records, the refund attempt record and its sweeper, the Clock job lease, BullMQ, review items, the nightly reconciliation) and adds two tables and one worker.

## Risks and what is still not known

- **Wording.** The seven cancellation states change what guests and staff read during a cancellation. The wording needs the owner's approval in task 10.
- **Repeated calls in the sandboxes.** Clock's cancel call and PokPay's refund were each seen to work and to fail in the sandboxes. Their behaviour when called twice in every edge case is protected by the read-before-repeat rule, and that rule must be tested against both sandboxes, not only stubs.
- **PokPay refunds.** The PokPay refund read-back depends on PokPay listing an order's refunds. The current recovery sweeper already reads it, so this is expected to hold, but it is checked again in order step 4.
- **Inline steps.** Running steps inside the web request keeps today's speed, but a slow provider makes that request slow. A cap of about 10 s on the inline part is the plan, after which the request answers with the saved state and the worker continues.

## Consequences

- A restart or a timeout during a cancellation, payment or refund leaves a record of exactly where it stopped, and the worker finishes it.
- The 30, 45 and 90 second transactions go away. That frees database connections and booking locks, and ends the "local record undone, outside change kept" failure.
- Two new tables (the process record and its step history) and one worker. Guests see no slower path in the normal case.

## Decisions requested from the owner

| Question | Recommendation |
| --- | --- |
| Approve the saved-process design (sections 1 to 7)? | Yes |
| When is the guest told "cancelled"? | When the room is released (after step 3); the refund is shown as its own line |
| When is a person told about a stuck money flow? | After 1 hour at most; automatic retries continue up to 72 hours |
| Order of work | As listed: late payment first, then payment confirmation, cancellation, refund allocation |
