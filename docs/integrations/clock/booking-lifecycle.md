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

## Manual refunds

PaymentRefundService owns the gateway/local refund and invokes `postRefund` after the local transaction. ClockBookingService finds the original deposit folio using the original payment reference and posts a negative credit item with `must-refund:{refundId}`. It neither creates a detached refund folio nor reopens the original.

A mirrored refund still requires Clock's human Deposit Adjustment/correction-document action according to the recorded contract evidence. Success and failure both leave the appropriate manual-review/staff notice; a sync failure cannot undo the guest refund. Automated refund synchronization must not be inferred for every cancellation path merely because manual refunds mirror.

## Historical evidence

The [sandbox report](../../archive/clock-sandbox-validation-2026-08-05.md) and [test log](../../archive/clock-test-evidence-2026-09-04.md) record dated runs. [Milestone 21](../../roadmap/milestones/21-clock-certification-fixes.md) contains later live observations and reversals. None of those tests were rerun for this documentation initialization.
