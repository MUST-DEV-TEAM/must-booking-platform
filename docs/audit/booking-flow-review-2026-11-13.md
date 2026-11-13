# Booking flow review, 2026-11-13

Step 4 of the layered review: one booking followed through its whole life. Earlier steps: [database](database-review-2026-11-13.md), [backend](backend-review-2026-11-13.md), [frontend](frontend-review-2026-11-13.md). This file is the task list for the models that execute the work.

**How it was checked.**

- The flow's code was read: checkout and cancellation (`booking/local-pms.provider.ts`), payment confirmation (`payments/pokpay-payment.service.ts`), and the documented Clock lifecycle.
- Three real test bookings were made on the test hotel (Must Hotel, Clock sandbox, PokPay staging) through the public guest API, the PokPay checkout page and the guest's Manage booking page. After every step the database, the emails and what Clock reported were read back.
- Live records of Empire Beach Resort and Luxury Premium Finese were read as counts and amounts only. Nothing was changed on either hotel.

**Test bookings left on the test hotel** (kept, per the test-booking convention):

| Reference | What was done | State now |
| --- | --- | --- |
| `MH-261113-0931-ABL6` (Clock 39365606) | Website booking, pay at hotel | Confirmed |
| `MH-261113-0935-546N` (Clock 39365774) | Website booking, paid 264.00 EUR by card, then cancelled by the guest | Cancelled, refunded |
| `MH-261113-0935-Q9T7` | Website booking left unpaid, expired, then paid 490.00 EUR 3.5 hours late | Expired. **PokPay staging holds 490.00 EUR that MUST has no record of** (task L1) |

## The flow, stage by stage

| Stage | What the system does | Walked live? | Result |
| --- | --- | --- | --- |
| Created on the website, pay at hotel | Saves the booking and creates the Clock reservation at once | Yes | Confirmed in 4 seconds; Clock bill 220.00; two emails sent |
| Created on the website, pay by card | Saves the booking as "payment pending" for 30 minutes; nothing is created in Clock yet | Yes | Worked |
| Paid | Re-reads the order at PokPay, records the payment, creates the Clock reservation, posts the deposit | Yes | Confirmed 3 seconds after paying; deposit posted |
| Not paid | Reminder email at 20 minutes; expires at 30 minutes; staff told | Yes | Worked as designed |
| Paid after expiry | Nothing (task L1) | Yes | **Money taken, no booking, no record, nobody told** |
| Cancelled by the guest | Cancels in Clock, clears room charges, refunds at PokPay, posts the refund to Clock, emails guest and staff | Yes | Cancelled and refunded in about 10 seconds; Clock deposit back to 0.00 |
| Clock after a cancellation | Room charge stays when Clock refuses the clearing right, or when the hotel turned the deposit into an advance invoice | Read on real hotels | Zero balance reached on 2 of 7 Empire cases (task L4) |
| Check-in and check-out | Done by staff in Clock; MUST copies Clock's status | Read on real hotels | Works; details in task L10 |
| Created or cancelled by staff, staff refunds, balance collection | Same engine with staff permissions and approval rules | Yes, in the second walk | Creation, links, cash and full refunds worked; partial refunds and refund-on-cancel did not (L13, L14) |
| Cancelled by the hotel inside Clock | Webhook marks the booking cancelled; refund follows the hotel's setting | No (an earlier session tested it on 2026-11-12) | Not re-verified |

## Ranked tasks

| # | Task | Priority | Risk of the fix | Who runs it |
| --- | --- | --- | --- | --- |
| L1 | A payment made after the hold expired is lost | Now | Medium | Opus |
| L2 | Guest emails land in spam | Now | Low | Owner decision, then Sonnet |
| L3 | Clock and PokPay are called inside one long database transaction | Soon, the main structural task | High | Fable designs, Opus builds |
| L4 | After a cancellation and refund, Clock rarely shows zero | Soon | Low for the list, medium for code | Sonnet for the list, Opus for code |
| L5 | Every refund creates a staff to-do, needed or not | Soon | Low | Opus |
| L6 | A guest cancellation can fail because Clock's own echoes change the booking's version | Soon | Medium | Opus |
| L7 | No room is held in Clock while the guest pays | Owner decision | Medium | Fable or Opus after the decision |
| L8 | Staff are told about a booking before it is real | Soon | Low | Sonnet |
| L9 | What the guest sees on the payment pages | Later | Low | Sonnet |
| L10 | Stay status: old bookings still "expected", and stay emails | Later | Low | Owner answers, then Sonnet |
| L11 | A booking has no readable history | Later | Low | Sonnet |
| L12 | Small items | Later | Low | Sonnet |
| L13 | A partial refund through PokPay stays "pending" for ever and blocks the booking | Now | Low | Opus |
| L14 | A cancellation reports success when the chosen refund did not happen | Now | Medium | Opus |
| L15 | A guest's cancellation request cannot be approved | Soon (with L6) | Medium | Opus |
| L16 | The number of guests is not limited on Clock hotels | Soon | Low | Opus |
| L17 | Refused bookings answer "201 Created" and are saved as bookings | Later | Low | Sonnet |
| L18 | Receipt emails are sent twice | Later | Low | Sonnet |

Tasks L13 to L18 come from the second walk; see [Second walk](#second-walk-full-website-and-staff-grid).

## Task details

### L1. A payment made after the hold expired is lost

- **Seen live:** booking `MH-261113-0935-Q9T7` expired at 10:06 UTC. At 13:43 UTC its PokPay checkout page was still open and showed "Pay 490.00 EUR". Paying it succeeded at PokPay. PokPay called MUST three times; MUST answered 400 each time and logged it only as a normal request line. The booking stayed Expired, with no payment row, no review item, no notification and no email. The guest's screen stayed on "Checking your payment".
- **Why:** `PokPayPaymentService.processAuthoritativeOrder` (`apps/api/src/payments/pokpay-payment.service.ts:105-125`) refuses a paid order whose booking is no longer pending and records nothing. The nightly PokPay check may flag it the next morning; until then the guest holds a receipt and the hotel knows nothing.
- **Change:** when PokPay confirms a paid order for a booking that is expired or cancelled, always record the money first. Then either re-confirm the booking if the room is still free, or refund automatically; in both cases email the guest, notify staff at once and answer the webhook with 200. Also check PokPay's documentation for a way to cancel the order or set its lifetime to the hold time, so the page stops accepting payment.
- **Verify:** repeat this test on the test hotel: an expired booking paid late ends as either confirmed or refunded within a minute, with emails.
- **Clean-up:** the 490.00 EUR on PokPay staging for `MH-261113-0935-Q9T7` is test money. It can be refunded from the PokPay staging dashboard, or left to see whether tonight's check reports it.

### L2. Guest emails land in spam

- **Seen live:** all five emails MUST sent to the guest (two confirmations, cancellation, refund) went to Gmail's Spam folder. PokPay's own receipts for the same bookings went to the inbox. MUST showed every one as "DELIVERED", which only means the receiving server accepted it.
- **Likely causes:** the sender is `noreply@mail.dejvis.dev`, a personal development domain with no DMARC record (open follow-up 4). On the test hotel the emails also link to `http://127.0.0.1:4321` (its saved website address) and show `sandbox@example.com` as contact, which makes spam filters stricter; real hotels do not have those two.
- **Why it matters:** the confirmation carries the booking reference and the only link to manage or cancel the booking.
- **Change:** add the DMARC record. Move sending to a domain that belongs to the product or to each hotel. Then send a real test from Empire's and Luxury's settings to a Gmail and an Outlook address and look where it lands (sending needs the owner's go).
- **Verify:** test emails for both real hotels arrive in the inbox.

### L3. Clock and PokPay are called inside one long database transaction

- **Found:** one database transaction stays open while the system talks to outside services:
  - Cancellation (`local-pms.provider.ts:1222-1387`, 30 second limit): cancel in Clock, read and void each folio, refund at PokPay, post the refund to Clock, then save "cancelled".
  - Payment confirmation (`pokpay-payment.service.ts:56-144`, 45 second limit): read the order at PokPay, save the payment, create the Clock reservation, open and fill the deposit folio.
  - Staff refunds use the same pattern with a 90 second limit.
- **Why it matters:** each of these holds one of the 10 database connections and a lock on the booking for the whole time. If the limit is hit or the API is restarted after Clock or PokPay already acted, everything saved locally in that step is undone while the outside change stays. This is the cause behind the lost refund record of 2026-11-06 and the "could not start a transaction" failures. A few cancellations at once in high season would exhaust the pool. The backend review's task B2 (the API is killed on every deploy) makes it more likely.
- **Change (the standard pattern for this):** split each flow into small saved steps, each in its own short transaction, with a worker that resumes an unfinished step. For a cancellation: requested, cancelled in Clock, refund sent, refund posted to Clock, charges cleared. Each step is safe to repeat. This also gives staff the separate "cancelled / refunded / settled in Clock" states already asked for in the open follow-ups.
- **Order:** cancellation first, then payment confirmation, then refunds. Each needs tests that cut the flow after every outside call.
- **Verify:** a test that kills the process after the Clock cancel shows the booking finishing correctly after restart, with one refund.

### L4. After a cancellation and refund, Clock rarely shows zero

- **Found on live (read-only):**
  - Empire: 7 cancelled bookings were paid online and fully refunded. Clock shows a balance still to collect on 4 of them (500.00 EUR; 43,120.40, 20,680.00 and 16,280.00 ALL). On a fifth, Clock still shows the 250.00 EUR payment with no refund. One has no reading. Clock is fully clear on one.
  - Luxury: 2 bookings cancelled in Clock still show a balance.
  - Test hotel: 253 of 351, because the sandbox account is refused the right to clear charges.
- **Causes already known:** reception converts deposits into advance invoices, which then need a Deposit Adjustment in Clock by the hotel; room charges were not cleared before 2026-11-12; refunds before October were not posted to Clock.
- **Change:**
  1. Give each hotel's reception a short list: booking number, what Clock shows, the one action needed. It is produced from stored readings, with no change to live data.
  2. Show a "settled in Clock: yes / what is missing" line on every cancelled booking (comes with L3).
  3. Decide whether MUST should clear room charges when the hotel cancels in Clock and no online payment exists (Luxury's two cases), or whether that stays reception's job.
- **Verify:** the count of cancelled, refunded bookings with a Clock balance goes to zero and stays there.

### L5. Every refund creates a staff to-do, needed or not

- **Seen live:** the test cancellation left the deposit folio open with balance 0.00, which is the wanted end state. MUST still created an open review item ("issue the Deposit Adjustment") and a "needs attention" notification. One Empire booking has 35 open review items.
- **Change:** create the Deposit Adjustment item only when the deposit folio is closed or converted. Keep one open item per booking and kind. See backend task B3.
- **Verify:** repeat the test cancellation; no review item appears.

### L6. A guest cancellation can fail because Clock's own echoes change the booking's version

- **Seen live:** a new booking's version went from 1 to 5 or 6 within seconds, because every webhook Clock sends back about our own change raises it. A guest may cancel only when a financial reading is under 60 seconds old and carries the same version (`local-pms.provider.ts:1285-1300`). So the Manage booking page waits about 7 seconds to refresh first, and a cancellation that arrives just after any Clock update is turned into a request for staff.
- **Change:** raise the version only when something the guest agreed to changes (dates, room, price, status). Do not raise it when a webhook brings no change.
- **Verify:** a guest cancellation 10 seconds after booking succeeds on the test hotel.

### L7. No room is held in Clock while the guest pays (owner decision)

- **Found:** for a card payment the Clock reservation is created only after the money arrives (a recorded design decision). For up to 30 minutes nothing in Clock stops the same room being sold at reception or through a channel. If that happens, the guest has paid and the booking goes to manual review.
- **On live so far:** no paid booking at Empire ended that way. Two Empire attempts failed on availability on 2026-11-12, before payment.
- **Options:** (a) create a tentative reservation in Clock before payment and cancel it if payment fails; check Clock's documentation for a supported way first; (b) keep the order, and refund automatically when the room is gone. Option (a) is the usual practice for a hotel that also sells through other channels.

### L8. Staff are told about a booking before it is real

- **Seen live:** a "booking created" notification was written when the unpaid booking was created, and stayed after it expired. The expiry then produced seven staff emails for one booking (four sent, three stopped as test addresses).
- **Change:** write the notification when a booking is confirmed. Decide with the owner whether an unpaid attempt deserves one notice or none.

### L9. What the guest sees on the payment pages

- PokPay's page says "Payment at MUST" and "Hotel booking" followed by an internal id. Send the hotel's name, the booking reference and the dates as the description; the merchant name is a PokPay account setting.
- When a booking has no website return address, the return page stays on "Checking your payment" and its only link opens the staff dashboard.
- The Manage booking page shows the raw status word "CONFIRMED".
- The two confirmation emails use different subject formats.

### L10. Stay status: old bookings still "expected", and stay emails

- **How it works:** check-in and check-out are done in Clock. MUST copies Clock's stay status and makes no decision of its own for Clock hotels.
- **Found on live:** Empire has 176 confirmed bookings whose arrival date passed (the oldest in June 2024) that are still "expected": never checked in, never cancelled, never marked no-show. Luxury has 4. They count as confirmed stays in reports.
- **Found on live:** the check-in time is stored only when MUST sees the change as it happens (Empire 1 of 188 recent stays, Luxury 48 of 371). The "check-in day" email depends on it. Luxury sent 1 check-in-day and 2 after-stay emails; Empire sent none of either.
- **Questions for the owner:** should these emails be on for Empire? Should a booking still "expected" some days after arrival be flagged or left out of reports?

### L11. A booking has no readable history

The audit trail of the paid test booking shows created, Clock reservation created, deposit posted, refunded, cancelled. It has no "payment received" entry on the booking and no list of status changes, and the create operation is not linked to the booking. Add a payment entry and a status-change log, so support can answer "what happened to this booking" from one screen.

### L12. Small items

- Right after a booking is created or cancelled, the first financial refresh fails with "Clock is temporarily unavailable" and succeeds on retry (2 of 2 tests). Find the cause.
- Luxury has 3 confirmed future bookings whose MUST total differs from Clock's bill. Check which side changed.
- The test hotel's saved website address is `http://127.0.0.1:4321`, so its emails link to a local machine. Set it back when local testing ends.

## Second walk: full website and staff grid

The owner asked for the full grid on the website and in the system (bookings made inside Clock were left out on purpose). For the staff side, one admin test account was created on the Must Hotel test tenant with the owner's approval: `mustbackupstorage+mb-staff@gmail.com`, named "Claude Review TEST", recorded in the audit log as `staff.test_account_created`. Remove it when the review ends. Twenty more test bookings and attempts were made, all on the test hotel.

### What was tested and what happened

| # | Test | Result |
| --- | --- | --- |
| 1 | Website, pay at hotel, guest cancels seconds after booking | Not cancelled: turned into a request for staff (L6) |
| 2 | Website, pay at hotel, guest cancels after 90 seconds | Cancelled in 7 seconds |
| 3 | Website, second guest books the same room and dates | Refused, correct |
| 4 | Website, same submit repeated with the same key | Refused as a conflict, no second booking |
| 5 | Website, price changed in the request (1.00 instead of 220.00) | Refused, correct; but saved as a booking with the wrong status (L17) |
| 6 | Website, dates in the past | Refused, correct |
| 7 | Website, 9 adults in a room listed for 2 | **Accepted and confirmed in Clock at 400.00 EUR** (L16) |
| 8 | Website, card declined, then paid on the same link | Declined cleanly, second try confirmed |
| 9 | Website, paid, arrival inside 21 days, guest cancels | Turned into a request for staff, no refund offered; correct by the saved terms |
| 10 | Manage link from another booking, or a made-up link | Refused, correct |
| 11 | Reading a booking without its own guest session | Refused, correct |
| 12 | Cancelling an already cancelled booking again | "Already cancelled", no second action |
| 13 | Old cancel route on a paid booking | Refused with "payment position changed" (L6); a minute later the same booking was cancellable |
| 14 | Staff creates a booking, pay at hotel | Confirmed in 4 seconds |
| 15 | Staff creates a booking with a payment link, guest pays | Confirmed |
| 16 | Staff books a room that is already taken | Refused, correct |
| 17 | Staff cancels an unpaid hold | Cancelled |
| 18 | Staff refunds 50.00 of 310.00 | **PokPay paid it; MUST saved it as "pending"** (L13) |
| 19 | Same refund clicked twice (same key) | One refund only, correct |
| 20 | Refund larger than what is left, wrong currency, zero | All refused, correct |
| 21 | Second partial refund after test 18 | Refused: "an earlier refund is pending" (L13) |
| 22 | Staff cancels the booking of test 18 with "refund what is due" | **Cancelled, guest told, nothing refunded, no warning** (L14) |
| 23 | Staff cancels without refund, then refunds 100% | Both worked; refund posted to Clock |
| 24 | Staff records 100.00 cash, same click twice, then too much | Recorded once; too much refused |
| 25 | Staff sends a link for the remaining 140.00, guest pays | Recorded; Clock shows 240.00 paid, balance 0.00 |
| 26 | Staff asks for another link when nothing is owed | Refused, correct |
| 27 | Staff cancels the booking of tests 24 and 25 (cash plus card) with "refund what is due" | **Cancelled, guest told, nothing refunded, no warning** (L14) |
| 28 | Staff approves the two guest requests from tests 1 and 9 | **Both refused: "booking changed, reject it and create a fresh request"** (L15) |
| 29 | Staff cancels with a custom refund of 100.00 | Became a request waiting for approval, as designed |

### L13. A partial refund through PokPay stays "pending" for ever and blocks the booking

- **Seen live:** a 50.00 EUR refund on a 310.00 EUR payment. PokPay refunded it and emailed the guest "Order was successfully refunded". MUST saved it as `REFUND_PENDING`, sent no refund email, posted nothing to Clock and raised a review item. Every later refund on that booking was refused with "an earlier refund is pending or uncertain", and each refusal added another review item. A full refund (100%) on another booking was saved correctly as refunded.
- **Why:** `apps/api/src/payments/pokpay-payment.provider.ts:208` sets the status from PokPay's `isRefunded` flag, which is true only when the whole order is refunded. A few lines above, the same function has already proved the refund by checking that PokPay's refundable amount fell by exactly the amount sent.
- **Also seen:** the staff cancellation preview ignored the pending 50.00 and offered 310.00 as refundable.
- **Change:** when the refundable-amount check passes, save the refund as completed. Count pending refunds as already refunded in previews. Give staff a way to resolve a refund that is really pending. Nothing completes a pending refund today.
- **Verify:** repeat test 18; the refund is saved as refunded, appears in Clock, and a second partial refund works.
- **Real hotels:** no refund is in this state at Empire or Luxury today; every Empire refund so far was for the full amount.

### L14. A cancellation reports success when the chosen refund did not happen

- **Seen live, twice:**
  - Test 22: staff chose "refund what is due" (310.00 shown). The booking was cancelled, the answer was success, the guest got a cancellation email. No refund was made; 260.00 EUR stayed at PokPay. No new warning appeared.
  - Test 27: a booking paid 100.00 in cash and 140.00 by card. Same choice, same result: cancelled, success, guest emailed, nothing refunded, and no review item at all.
- **Why it matters:** staff and guest both believe the money is on its way.
- **Change:** when a cancellation includes a refund and the refund cannot be made, say so in the answer and on the booking ("cancelled, refund NOT made: reason"), raise one clear item, and do not tell the guest a refund is coming. For cash plus card, refund the card part and tell staff how much cash to return.
- **Verify:** repeat tests 22 and 27; the screen and the review queue state that the refund is open.

### L15. A guest's cancellation request cannot be approved

- **Seen live:** both guest requests (one unpaid, one paid) were refused at approval with "The booking or payments changed since this request. Reject it and create a fresh request." Nothing had changed except the version number, raised by Clock's echo webhooks (L6).
- **Why it matters:** together with L6 this is a dead end: the guest's cancellation becomes a request, and staff cannot approve the request.
- **Also seen:** the guest receives no email saying the request was received.
- **Change:** fix L6 first. Compare what matters (dates, total, payments), not the raw version. Send the guest an acknowledgement.

### L16. The number of guests is not limited on Clock hotels

- **Seen live:** a website booking for 9 adults in a double room (shown as "max 2") was priced at 400.00 EUR and confirmed in Clock.
- **Why:** for a Clock hotel the room's own limit is skipped (`apps/api/src/booking/quote.service.ts:605`) and the price comes from whatever Clock's rate allows. `max_guests_per_booking` is empty on all three hotels.
- **Real hotels:** no website booking at Empire or Luxury is over its room's limit today. Whether Clock would price such a request there depends on their rates.
- **Change:** refuse a quote above the room type's limit shown to the guest, or above the hotel's "max guests" setting, also for Clock hotels.

### L17. Refused bookings answer "201 Created" and are saved as bookings

A refused booking (room taken, price mismatch) answers HTTP 201 with `ok: false` in the body. Each refused attempt is also stored as a booking row with status `AVAILABILITY_FAILED`, including the price-mismatch attempt (stored with total 1.00). Answer with 409 or 422, and decide whether refused attempts belong in the bookings table.

### L18. Receipt emails are sent twice

The booking of tests 24 and 25 had two payments and four "payment received" emails. A repeated click with the same key, and the payment re-check, each sent the receipt again.

### Test artefacts left by the second walk

- 3 open requests on the test hotel: tests 1, 9 and 29.
- PokPay staging money that does not match MUST: 260.00 EUR not refunded on `MH-261113-1357-XE4E` (plus 50.00 refunded there but "pending" here), and 140.00 EUR not refunded on `MH-261113-1401-ZGBS` (its 100.00 cash is a record only).
- Confirmed test bookings kept: `…GWZU`, `…RALL`, `…ZSYT` (the 9-adult one), `…HSXD`, `…AYRU`.

## What worked well

- Double booking, tampered prices, forged or borrowed manage links, repeated clicks and oversized refunds were all refused.
- Staff bookings, payment links, cash recording and balance collection worked and matched Clock.
- Booking, payment confirmation, cancellation and refund each completed in seconds, with the right amounts.
- The payment was re-read at PokPay before being trusted; the return page does not claim success by itself.
- The refund went out once, was posted to Clock, and the deposit returned to 0.00.
- The cancellation page showed the guest the exact refund and the deadline before asking for confirmation.
- The unpaid hold expired on time, with a reminder first.
- For future confirmed bookings, MUST's total matches Clock's bill on 121 of 121 at Empire and 88 of 91 at Luxury, and every such booking was checked in the last 24 hours.

## Not checked

- The dashboard screens themselves: staff actions were sent to the same endpoints the screens use, not clicked through the screens.
- Approval by a second staff member, staff without refund permission, refunds more than 24 hours after cancellation.
- Whether a cancelled unpaid hold's PokPay link can still be paid (likely, by the same cause as L1).
- Cancellation by the hotel inside Clock and bookings made in Clock (left out at the owner's request), date and room changes, multi-room orders, promo codes.
- The non-Clock mode: no hotel uses it on live.
- A check-in or check-out made in the Clock sandbox.
- Whether tonight's PokPay check reports the late payment from L1.
