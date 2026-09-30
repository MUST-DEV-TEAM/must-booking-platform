# Clock booking and financial lifecycle

Status: **IMPLEMENTED paths; recovery and acceptance limits remain**. Code inspected 2026-09-19.

[Platform booking/payments](../../architecture/booking-and-payments.md) owns the common state graph, quote and payment rules. ClockBookingService uses that same BookingStatus/BookingStateMachine; there is no separate vendor state machine.

## Two creation entry points

1. **Guest/staff checkout**: LocalPmsProvider creates the local reservation and orchestrates inventory/quote/payment. Online payment stays PAYMENT_PENDING until authoritative confirmation; `continueAfterPayment` moves to PMS_CREATION_PENDING and calls `ClockBookingService.attachRealReservation`. Free/pay-at-hotel flows attach without charging online. MultiRoomBookingService fans out attachment for each child.
2. **Direct PMS interface**: `ClockPmsProvider.createBooking` calls `ClockBookingService.createBooking`, which builds a local row and takes PAYMENT_NOT_REQUIRED. This lower-level path does not collect payment. Do not substitute it for checkout.

Both Clock create paths resolve mappings, shared live rate selection and guest identity, send the booking request, validate the result and attach the external ID. `client_request` carries special requests, and adults/children are sent explicitly.

On timeout/network ambiguity, `linkIfClockHasIt` searches by MUST reference before deciding the outcome. A found reservation can be linked; an unresolved result becomes PMS_UNKNOWN_RESULT/manual review. Clean rejection and malformed success have separate handling. No blanket "retry means create another booking" guarantee is supported.

**Contract gap:** the reference lookup expects booking resources, whereas dated evidence for overlap-list reads says `GET /bookings/` returns numeric IDs. The exact reference-filtered result shape still needs verification; do not silently assume it matches either form.

## Versions, updates and cancellation

Local commands use tenant-scoped operation records/request hashes and MUST `expectedVersion`. Vendor updates fetch the current Clock `lock_version` separately and send changed fields. The service supports dates, but the public update controller does not expose them.

The normal guest/staff cancellation path is LocalPmsProvider, which evaluates policy, calls `cancelRealReservation` when attached, releases local claims and orchestrates refund/notifications. Calling the lower-level Clock cancel directly would omit these domain steps. Multi-room cancellation retains per-child outcomes when Clock only partly succeeds.

Some Clock calls happen within 30-45 second interactive transactions. A timeout or failed local commit after a successful external request remains a recovery concern; the SQL transaction cannot roll back Clock.

## Deposits stay open

`postDeposit` finds a matching deposit folio/credit item or opens a deposit folio, then posts the positive credit item. It uses a stable reference and lookup-on-ambiguity behavior, with bounded local retries. A prior matching item is a replay; a closed folio with the matching item is also already completed.

**MUST does not close the deposit folio.** The 2026-09-18 Clock correction removed automatic close and document-type lookup. Earlier Milestone 21 Task 1/8 close instructions and 2026-09-16 close evidence are superseded, not current requirements.

Posting failure is distinct from reservation success: manual review and BOOKING_NEEDS_ATTENTION can record a confirmed booking whose accounting entry failed. Do not report the entire reservation as nonexistent solely because deposit posting failed.

## Deposit folios, booking balance and advances (live findings, 2026-09-30)

Empire Beach Resort (Clock account 14688) reported that after a paid website booking the Clock screen showed **Balance 0.00** and no Required Deposit, while their own manual bookings showed the balance still owed. Findings below are read-only observations of live bookings plus Clock's public help pages; none of the behavior is changed by MUST code yet.

**How Clock counts it.** Clock's booking balance sums the booking's folios. An **open deposit folio** (what `postDeposit` creates) counts, so a fully prepaid booking reads 0.00 although the deposit is unused (folio "Remaining Payment" still equals the payment). Clock's help says the booking balance "includes the payments reflected in the deposit folios". A deposit folio that the hotel **closes as an advance** (Clock button "Convert to Advance", fiscal document type `16425`, which also issues an invoice number) is **not** counted: the balance returns to the full stay amount until the advance is consumed at check-in. Clock's "Transfer payment" deposit mode moves the open deposit to the service folio; "Deduct charges" works on advances. Sources: Clock support articles "Deposit Folios and Deposits" and "What is the Difference Between a Deposit and an Advance in Clock PMS+".

**Evidence (all Empire, read through the Base/PMS API, no writes except the test booking noted):**

| Booking | Deposit folio | Booking balance | Notes |
| --- | --- | --- | --- |
| #15784 / id 38619383 (real website booking, 250 EUR PokPay) | open, payment 250 | 0.00 | what the client complained about; `guarantee_policy_id` null |
| #15688 / id 38393911 (reception's reference booking, Booking.com rate 547398) | **closed**, advance type 16425, payment 263.16 | 263.16 (full) | `is_guaranteed` true, `guarantee_policy_id` 13804 |
| #15785 / id 38619743 (test booking created through the API 2026-09-30, then deposit posted like `postDeposit`) | open, then **closed by reception** at 23:42 (invoice no. 22820) | 0.00 then **250.00** | policy 17089 set by a manual PUT; reception confirmed this is the wanted result |

**Required Deposit comes from a guarantee policy**, not from a booking field we send. The website rate "Website / Executive Suite Sea View / BB" (rate 546556) carries `rate_restriction.guarantee_policy_id = 17089`, but a booking created through `POST /bookings/` ends up with `guarantee_policy_id = null`. `PUT /bookings/{id}` with `{booking: {guarantee_policy_id, lock_version}}` is accepted (verified on #15785). The Required Deposit line itself is only visible in the Clock UI; it was not read back through the API.

**Conclusions and open decisions (none implemented):**

- Leaving the deposit folio open stays correct per Clock's 2026-09-18 instruction. The hotel reaches the wanted state by clicking "Convert to Advance" on the deposit folio, which is a fiscal action (numbered invoice) and therefore a hotel decision.
- Automating the conversion would contradict that instruction and needs the `Folio: Close` rights Clock deliberately did not grant. It should be raised with Clock before any code is written. Tracked as Milestone 21 Phase N.
- Sending the rate's `guarantee_policy_id` when a reservation is created would make website bookings match the hotel's manual ones. Tracked as Phase N, not yet built.

**Test artifacts in the live Clock account:** booking #15785 (room 237, 2 Oct 2026, reference `TEST-DEPOSIT-0930`) was cancelled through the API on 2026-10-01 at the owner's instruction. Its advance folio (invoice 22820, 250.00 EUR) was not touched and the booking balance reads 250.00, so the hotel has to settle the advance itself. #15784 was cancelled by the hotel at 23:00 and MUST followed within seconds through the `booking_canceled` webhook (the local row became CANCELLED); its PokPay charge of 250.00 has 100.00 refunded.

## Manual refunds

PaymentRefundService owns the gateway/local refund and invokes `postRefund` after the local transaction. ClockBookingService finds the original deposit folio using the original payment reference and posts a negative credit item with `must-refund:{refundId}`. It neither creates a detached refund folio nor reopens the original.

A mirrored refund still requires Clock's human Deposit Adjustment/correction-document action according to the recorded contract evidence. Success and failure both leave the appropriate manual-review/staff notice; a sync failure cannot undo the guest refund. Automated refund synchronization must not be inferred for every cancellation path merely because manual refunds mirror.

## Historical evidence

The [sandbox report](../../archive/clock-sandbox-validation-2026-08-05.md) and [test log](../../archive/clock-test-evidence-2026-09-04.md) record dated runs. [Milestone 21](../../roadmap/milestones/21-clock-certification-fixes.md) contains later live observations and reversals. None of those tests were rerun for this documentation initialization.
