# Milestone 40: Booking and payment flow hardening

Status: **Planned 2026-11-14. Owner decisions in section 2 are open. Nothing built.**

Source: [booking flow review, 2026-11-13](../../audit/booking-flow-review-2026-11-13.md) (tasks L1 to L18, found by walking real test bookings) and the September findings that the [2026-11-14 re-check](../../audit/FINDINGS.md) left open for this plan (MBA-002, 003, 004, 008, 014 and the L3 part of 016). The task table is the spec; the review holds the evidence.

## 1. Goal and limits

Every euro a guest pays is recorded, every refund staff or a guest is promised really happens or is clearly reported as not done, and a booking, payment or cancellation survives a restart or a slow provider without leaving MUST, Clock and PokPay in disagreement.

Out of scope here, planned elsewhere:

- Stripe (MBA-001, MBA-011): Milestone 37, before Stripe is switched on.
- Hotels without Clock (MBA-005, native inventory): Milestone 25.
- Review-queue duplicates in general, clean shutdown, health check: [Milestone 39](39-backend-hardening.md). Task 5 here builds on its task 6; task 9 here needs its task 1.
- Bookings made or changed inside Clock, date and room changes, promo codes: not walked in the review. Listed in section 6 as the next walk.

## 2. Owner decisions needed

| # | Question | Recommendation | Blocks |
| --- | --- | --- | --- |
| D1 | A guest pays after the 30-minute hold expired (L1). What should happen? | Record the money, then confirm the booking if the room is still free at the same price; otherwise refund automatically. Guest and staff are told at once in both cases. | Task 3 |
| D2 | While a guest pays by card, nothing holds the room in Clock (L7). Hold it? | Yes, if Clock supports a tentative reservation: standard for a hotel that also sells through reception and channels. First step is only to check Clock's documentation; if it is not supported, keep today's order and rely on D1's automatic refund. | Task 13 |
| D3 | Which address should guest emails come from (L2)? Today it is `noreply@mail.dejvis.dev`, and they land in spam. | A domain that belongs to the product (for example `mail.must.al`), with SPF, DKIM and DMARC. A sender per hotel domain can follow later. | Task 6 |
| D4 | Should staff be told about an unpaid booking attempt (L8)? | No notice when it is created. One notice when it is confirmed. None when an unpaid attempt simply expires. | Task 7 |
| D5 | A booking paid part cash, part card is cancelled with a refund (L14). | Refund the card part automatically and tell staff the cash amount to return by hand. | Task 2 |
| D6 | When the hotel cancels inside Clock and there was no online payment, should MUST clear the room charges in Clock (L4)? | No. That stays reception's job; MUST shows what is still open. | Task 12 |
| D7 | Bookings still "expected" days after arrival (176 at Empire), and stay emails for Empire (L10). | Flag them for staff after 2 days; do not change them or the reports automatically. Stay emails: owner's call per hotel. | Task 15 |
| D8 | Owner's note of 2026-11-13: refund the amount received minus the payment provider's commission. | Not in this milestone. It must first be in the booking terms the guest accepts and checked against consumer rules for Albania and the guest's country. Recorded here so it is decided, not forgotten. | Nothing |

## 3. Rules for whoever executes

- The [Milestone 38 rules](38-database-hardening.md#3-rules-for-whoever-executes) and the two added in [Milestone 39](39-backend-hardening.md#3-rules-for-whoever-executes) apply unchanged.
- AGENTS.md money rules apply to every task: never blind-retry a booking create or a refund; check the operation record and the provider first. Keep payment and refund history; never rewrite it.
- Every task that touches a money path is verified by repeating the review's own test on Must Hotel (the test numbers are given per task) and reading back MUST, PokPay staging and the Clock sandbox. Test bookings are kept, named with TEST.
- No task sends a request to a real hotel's Clock or to live PokPay. Sending test emails from Empire or Luxury (task 6) needs the owner's go for that send.

## 4. Tasks, in execution order

| # | Task | Closes | Needs | Risk | Runs |
| --- | --- | --- | --- | --- | --- |
| 1 | A partial refund that PokPay made is saved as made | L13 | - | Low | Opus |
| 2 | A cancellation says so when its refund did not happen | L14 | D5; task 1 | Medium | Opus |
| 3 | A payment after the hold expired is never lost | L1, MBA-002 | D1 | Medium | Opus |
| 4 | Guest numbers are checked, also for Clock hotels and multi-room | L16, MBA-003 | - | Low | Opus |
| 5 | A booking's version changes only when the booking does; requests can be approved | L6, L15 | - | Medium | Opus |
| 6 | Guest emails reach the inbox | L2 | D3 | Low | Owner, then Sonnet |
| 7 | Staff notices and to-dos only when there is something to do | L5, L8 | D4; Milestone 39 task 6 | Low | Opus |
| 8 | One receipt per payment | L18 | - | Low | Sonnet |
| 9 | Design: cancellation, payment confirmation and refunds as saved steps | L3 (design), MBA-016, MBA-014, MBA-008 | Milestone 39 task 1 | Design | Fable |
| 10 | Build the saved steps: cancellation, then payment confirmation, then refunds | L3, L4 item 2 | Task 9 approved | High | Opus |
| 11 | Multi-room checkout gets the same safety as a single booking | MBA-004 | Task 10 | Medium | Opus |
| 12 | Reception list: cancelled bookings Clock still shows a balance for | L4 items 1 and 3 | D6 | Low | Sonnet |
| 13 | Hold the room in Clock while the guest pays | L7 | D2 | Medium | Fable checks, Opus builds |
| 14 | A readable history on every booking | L11 | Task 10 | Low | Sonnet |
| 15 | Stay status and stay emails | L10 | D7 | Low | Sonnet |
| 16 | Guest-facing wording and small items | L9, L12, L17 | - | Low | Sonnet |

Tasks 1 to 4 are the "now" group: each is a case where money or a promise goes wrong today. They are independent except that 2 follows 1. Task 9 is the main design; nothing in task 10 starts before the owner approves it.

### Task 1. A partial refund that PokPay made is saved as made

- **Where:** `apps/api/src/payments/pokpay-payment.provider.ts` (about line 208): the status comes from PokPay's `isRefunded`, which is true only for a full refund, although the same function has just proved the refund by the fall in the refundable amount.
- **Change:** when the refundable amount fell by exactly the amount sent, return the refund as completed. In the cancellation and refund previews, count pending refunds as already refunded. Give staff an action to resolve a refund that really is pending: re-read PokPay and settle it as refunded or failed. The recovery sweeper should do the same by itself.
- **Verify (review test 18, 21):** refund 50.00 of a 310.00 payment on Must Hotel: saved as refunded, refund email sent, posted to Clock, and a second partial refund works.
- **Live data:** no real hotel has a refund in this state (checked 2026-11-13). The test booking `MH-261113-1357-XE4E` is the fixture for the "resolve" action.

### Task 2. A cancellation says so when its refund did not happen

- **Seen:** tests 22 and 27: cancelled, success, guest emailed, nothing refunded, no warning.
- **Change:** a cancellation that includes a refund reports the refund's real outcome in its answer and on the booking: refunded, pending, or not made with the reason. When it was not made: one review item, a staff notification, and the guest's cancellation email does not promise a refund. For cash plus card (D5): refund the card part, and show staff the cash amount to return.
- **Do not change:** the cancellation itself still goes through when the refund fails; the hotel's room is freed either way.
- **Verify:** repeat tests 22 and 27; the screen, the booking and the review queue all state what is open.

### Task 3. A payment after the hold expired is never lost

- **Where:** `PokPayPaymentService.processAuthoritativeOrder` (`apps/api/src/payments/pokpay-payment.service.ts:105-125`) refuses a paid order whose booking is no longer pending, and records nothing.
- **Change (D1):**
  1. Always record an authenticated paid order first, whatever the booking's state, and answer the webhook 200.
  2. Then, in a separate step: if the booking only expired and the room is still free at the same price, confirm it the normal way. Otherwise refund automatically through the existing refund path.
  3. Email the guest and notify staff at once in both cases. If the refund cannot be made, one review item.
  4. Check PokPay's documentation for an order lifetime or a cancel call, so the payment page stops accepting money when the hold ends. Mark what the documentation does not confirm as unverified.
- **Also covers:** a cancelled unpaid hold whose link is paid later, and a second paid order on an already confirmed booking (refund the second).
- **Verify (the review's L1 test):** an expired booking paid late on Must Hotel ends confirmed or refunded within a minute, with emails; the guest's return page shows the result.
- **Fixture:** `MH-261113-0935-Q9T7` holds 490.00 EUR on PokPay staging with no record in MUST. After the fix, a re-delivered webhook or the nightly check should record and refund it.

### Task 4. Guest numbers are checked, also for Clock hotels and multi-room

- **Where:** `apps/api/src/booking/quote.service.ts` (about line 605: the room's limit is skipped for Clock hotels; line 628: a missing occupancy is read as one adult) and `multi-room-booking.service.ts:125-133`, which passes no occupancy to the quote check.
- **Change:** refuse a quote above the room type's `max_occupancy` or the hotel's "max guests" setting, for Clock hotels too. Pass each room's adults and children into the quote check of a multi-room order, and store what was quoted.
- **Check first (read-only):** that no real hotel's room type has a limit lower than what it sells today, so no valid booking starts being refused.
- **Verify (test 7):** 9 adults in a room for 2 is refused; a family of 4 in two rooms is accepted with the right occupancy on each room.

### Task 5. A booking's version changes only when the booking does; requests can be approved

- **Seen:** a new booking's version goes from 1 to 5 or 6 in seconds because each echo webhook from Clock raises it. A guest cancellation needs a financial reading under 60 seconds old with the same version (`local-pms.provider.ts:1285-1300`), so it turns into a staff request; and staff cannot approve the request, for the same reason (tests 1, 13, 28).
- **Change:** hydration raises the version only when dates, room, total, status or guests change. Approval of a request compares what matters (dates, total, payments), not the raw version. The guest gets an email that the request was received.
- **Do not change:** the freshness rule itself; a cancellation still needs a current financial reading.
- **Verify:** a guest cancellation 10 seconds after booking succeeds on Must Hotel; the open requests from tests 1 and 9 can be approved.

### Task 6. Guest emails reach the inbox

- **Owner (D3):** choose the sending domain; add its SPF, DKIM and DMARC records (Resend shows the exact values). This also closes [open follow-up 4](../open-follow-ups.md).
- **Then:** switch the sender; fix Must Hotel's saved website address (`http://127.0.0.1:4321`) and contact address, which make filters stricter on the test hotel.
- **Verify, with the owner's go for each send:** a test email from Empire's and from Luxury's settings to a Gmail and an Outlook address arrives in the inbox, and the headers show SPF, DKIM and DMARC passing.

### Task 7. Staff notices and to-dos only when there is something to do

- **Change (D4):** write the "booking created" notification when a booking is confirmed, not when an unpaid attempt is created. An expiry of an unpaid attempt sends staff nothing. Create the Deposit Adjustment review item only when the deposit folio is closed or was converted to an invoice, not after every refund. One open item per booking and kind, using the key from Milestone 39 task 6.
- **Verify:** an unpaid attempt that expires produces no staff email; the review's test cancellation leaves no review item when the deposit folio is open at 0.00.

### Task 8. One receipt per payment

- **Seen:** two payments produced four "payment received" emails; a repeated click and the payment re-check each sent it again.
- **Change:** key the receipt email on the payment id, so the delivery queue sends it once.
- **Verify (tests 24, 25):** two payments, two receipts.

### Task 9. Design: cancellation, payment confirmation and refunds as saved steps

- **The problem (L3):** one database transaction stays open while MUST talks to Clock and PokPay: cancellation (30 s limit), payment confirmation (45 s), staff refunds (90 s). It holds a connection and a lock on the booking; if the limit is hit or the API restarts after the provider acted, the local record is undone while the outside change stays.
- **Deliverable, an ADR, no code:**
  - The steps of each flow, each saved in its own short transaction and safe to repeat. For a cancellation: requested, cancelled in Clock, refund sent, refund confirmed, refund posted to Clock, charges cleared.
  - What resumes an unfinished step (a worker), how long it retries, and when it hands over to a person.
  - What staff and the guest see while steps are open: the separate "cancelled / refunded / settled in Clock" states the owner asked for in the [cancellation follow-up](../open-follow-ups.md#cancellation-refunds-and-clock-settlement).
  - Refund allocation (MBA-014): a refund row names the charge it reverses; a multi-room order's refund finds the charge-owning booking.
  - Where a change made in Clock (MBA-008) enters these steps instead of overwriting the booking.
  - The tests: cut each flow after every outside call and show it finishes correctly after a restart, with one refund.
  - The migration path: flows already in flight at deploy time.
- **Then:** the owner approves the ADR. [Milestone 38 task 6](38-database-hardening.md) lowers the database timeouts once task 10 is live.

### Task 10. Build the saved steps

- **Order:** cancellation first, then payment confirmation, then refunds. One pull request each, each behind its own tests that cut the flow after every provider call.
- **Includes:** the "settled in Clock: yes / what is missing" line on every cancelled booking (L4 item 2).
- **Verify:** a test that stops the process after the Clock cancel shows the booking finishing after restart with exactly one refund. On Must Hotel: the review's cancellation, payment and refund tests give the same results as before, and the database shows no transaction open longer than a few seconds during them (`pg_stat_statements` and the slow-query log from Milestone 38).

### Task 11. Multi-room checkout gets the same safety as a single booking

- **Open from MBA-004:** a failed checkout result is returned from the transaction, which commits the pending rooms (`multi-room-booking.service.ts:254`); the final availability and mode checks of a single booking are missing; a free multi-room order is confirmed locally without a Clock reservation.
- **Change:** share the checks and the saved steps of task 10 between single and multi-room checkout. Re-read the parts the re-check did not cover first, and correct this list.
- **Verify:** the multi-room cases the review did not walk: two rooms paid by card, one room unavailable at the last moment, a failed checkout leaving no held rooms.

### Task 12. Reception list: cancelled bookings Clock still shows a balance for

- **Change:** a staff view (and export) per hotel, built from stored readings: booking number, what Clock shows, the one action needed (for example "issue the Deposit Adjustment"). Read-only on Clock. Per D6, MUST does not clear charges on bookings the hotel cancelled in Clock.
- **Found on live 2026-11-13:** 5 of 7 refunded cancellations at Empire and 2 at Luxury still show a balance in Clock.
- **Verify:** the list matches a manual count; the count goes to zero as reception works through it.

### Task 13. Hold the room in Clock while the guest pays

- **Step 1, reading only (D2):** check Clock's documentation for a tentative or option reservation with an expiry, and what it does to availability and channels. Record the answer in `docs/integrations/clock`; do not guess.
- **Step 2, if supported:** create the tentative reservation when the guest starts paying, confirm it on payment, cancel it on expiry or decline. Built on the saved steps of task 10.
- **If not supported:** close the task with the finding; task 3's automatic refund covers the case.

### Task 14. A readable history on every booking

- **Change:** a "payment received" entry and a status-change log on the booking, and the create operation linked to it, shown on one screen. Most of the data exists once task 10 saves its steps.

### Task 15. Stay status and stay emails

- **Change (D7):** flag a confirmed booking still "expected" 2 days after arrival for staff; store the check-in time from Clock's data, not only when MUST happens to see the change, so the check-in-day and after-stay emails can work. Switching those emails on for a hotel is the owner's call.

### Task 16. Guest-facing wording and small items

- PokPay page: send the hotel's name, the booking reference and the dates as the description (L9).
- The payment return page when a booking has no website address; the raw "CONFIRMED" on the Manage booking page; one subject format for the confirmation emails (L9).
- A refused booking answers 409 or 422 instead of 201, and is not stored as a booking; keep refused attempts in their own table if they are worth keeping (L17).
- Find why the first financial refresh right after a booking fails with "Clock is temporarily unavailable" (L12).
- Luxury's 3 future bookings whose total differs from Clock's bill: check which side changed, read-only (L12).

## 5. Done when

- The review's 29 tests, repeated on Must Hotel, all end with MUST, PokPay and Clock in agreement, and tests 7, 18, 21, 22, 27 and 28 and the late payment no longer go wrong.
- No payment exists at PokPay without a record in MUST.
- No cancellation tells anyone a refund is coming unless it was made or is being retried.
- Stopping the API at any point of a cancellation, payment or refund leaves nothing half-done after restart.
- Guest emails from both real hotels arrive in the inbox.
- Each hotel's reception has a short, shrinking list of Clock balances to settle.

## 6. Not covered: the next walk

The review did not test these, so this plan has no tasks for them: bookings made or cancelled inside Clock, date and room changes, multi-room orders end to end, promo codes, approval by a second staff member, staff without refund permission, refunds more than 24 hours after cancellation, and the dashboard screens themselves. Walk them on Must Hotel after tasks 1 to 5 are live, and add what is found here.
