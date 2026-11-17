# Clock integrations team: correspondence log

What MUST asked Clock's integrations team (integrations@clock-software.com) and what they answered, newest first. Contact: Lyubomir Yosifov, Integrations Success Manager. Our mail goes from support@must.al. Where an answer changes behavior, the canonical doc ([runbook](runbook.md), [booking lifecycle](booking-lifecycle.md), [endpoint matrix](endpoint-matrix.md)) carries the result; this page keeps the wording.

## Open items

| Topic | State | Next step |
| --- | --- | --- |
| Convert deposits to advances automatically | Clock: "no way to automate". The hotel needs it. | Follow-up asking for the exact API sequence (charge + close with the advance document type) or a feature request. See [Milestone 21 Task 26](../../roadmap/milestones/21-clock-certification-fixes.md). |
| Refund mirror on open and closed deposit folios | Rights granted 2026-10-02 | Verify on the next real Empire refund. |
| Find a payment by our own reference | Use `text`, not `reference` | Optional: filter credit items by `text` instead of the current client-side `reference` match. |
| Second hotel on the AppConnector | After the pilot (30 days from Empire's activation) | Ask again once the pilot ends. |

## 2026-10-02: rights, deposit-to-advance, reference filter, second hotel

### Sent by MUST (drafted 2026-10-01)

> Hi
>
> Thank you for granting the webhook and folio-creation rights earlier. The integration is now working for bookings, payments and cancellations. We have one right to request, one question about converting deposits to advances, and one small technical question.
>
> **1. Right we need now: "Payments: Add negative payment to Open folio"**
> When a guest cancels, or the hotel gives a partial refund, we return the money to the guest's card. We then post the same amount as a negative payment on the booking's deposit folio, the folio that holds the online payment. As agreed, we keep these folios open and never close them ourselves.
> Clock rejects this today. Example, 2026-10-01: booking #15787 (id 38620332), deposit folio FL-27495 (id 77313833), 50.00 EUR. The answer was:
> "The User doesn't have the following right granted: Payments: Add negative payment to Open folio"
> The same call works on our sandbox account, so we believe this is only a rights setting. Without it, the guest is refunded but Clock keeps showing the full original payment, and the hotel has to correct every refund by hand.
>
> Also, the hotel converts deposits to advances at its own pace, so a refund can arrive after the folio has been converted (closed). Is a separate right or a different procedure needed to record a refund on a converted folio? If a "Deposit Adjustment" step is required on your side, please tell us.
>
> **2. Automatically converting deposits to advances**
> Every online booking creates a deposit folio with the guest's payment. The hotel's reception then opens each one and clicks Convert to Advance (for example booking #15785 on 2026-09-30). The hotel would like this to happen automatically, so nobody has to do it by hand.
>
> We tested closing a deposit folio through the API in our sandbox. It issues an invoice number, but it is not the same as Convert to Advance: the folio balance stays negative and the booking balance does not change. On the folios converted by the reception we can see that Clock also adds a charge for the deposit amount (net plus VAT), marks the folio as paid and brings its balance to zero.
> Our questions:
>
> - (a) Does the hotel's Clock have a setting that converts deposits to advances automatically, for example when the payment arrives or on the arrival day? If so, the hotel can simply switch it on and we need nothing further.
> - (b) If not, is there an API call or sequence of calls that does exactly what the Convert to Advance button does? Please name every right our API user would need. We expect these, and ask you to confirm and add any others:
>   - "Folio: Close"
>   - "Folio: Close folio with outstanding balance", if it is needed
>   - `base_api_document_types_index`, to list the document types
>   - the rights to create a charge on a folio and to read charge templates (we do not know their names)
> - (c) How should the amount be split by tax group, and which charge template should be used for the pre-invoiced deposit?
> - (d) Does the invoice get a fiscal number immediately, and is anything sent to a fiscal system when it is issued?
>
> We understand that you advised us in September to leave deposit folios open. If you prefer that the hotel keeps converting them by hand, we will continue to do so.
>
> **3. A small technical question**
> Reading the payments of a folio, filtering by our own reference (`reference.eq`) fails with an error that the column does not exist. Is there a supported way to find a payment on a folio by a reference we set? We use this to check that a payment was not posted twice.
>
> **4. Smaller unrelated question**
> We have like we have said before another client that want to connect with our system, do they need to ask you themself in a separate email for our integration in the AppConnector or should we send you the email in question ourself?
>
> Thank you for your help.

### Clock's reply (Lyubomir Yosifov, Fri 2 Oct 2026 09:53, to support@must.al)

Screenshot: [2026-10-02-clock-reply.png](correspondence/2026-10-02-clock-reply.png).

> Hello,
>
> 1. I have granted the rights to "Payments: Add negative payment to Open folio" and "Payments: Add negative payment to Closed folio" so you can cover both cases.
> 2. There is no way to automate this. The only option is for the hotel to manually convert the folios by closing them.
> 3. The "reference" field can't be used for filtering because it is not a field that can be edited through the UI and it's meant to be used by payment providers. The field "text", however, can be used for the same purpose, and it is available for filtering.
> 4. Regarding the option to activate the integration for another hotel, this will be made available after the pilot phase is completed. The pilot phase will end 30 days after the initial activation.
>
> Kind regards,

### What it means

1. Refund mirroring should now work on Empire for both open and converted deposit folios. Not yet verified with a real refund.
2. Clock offers no setting and named no API sequence; sub-questions (b) to (d) went unanswered. The hotel says it needs automatic conversion, so a follow-up asks for the exact calls and rights, or for the feature.
3. Matching by `text` is the supported filter. Current code already matches `reference` client-side, which works; switching is optional.
4. A second hotel can be connected only after Empire's 30-day pilot ends.

## 2026-10-06: follow-up on item 2 (ticket #277575)

MUST asked whether Clock had seen the 2026-10-01 email, "especially for the #2", because the client wants automatic conversion as a feature. Clock replied the same day that they had already answered on 2 October. MUST apologized: the 2 October reply had not reached us at first. No new information about automation. Any further follow-up should cite the 2 October answer and ask a narrower question (the exact call sequence and rights for option B in [Milestone 21 Task 26](../../roadmap/milestones/21-clock-certification-fixes.md)), not repeat the original question.

## Earlier (ticket #277575, summarized from the full thread export read 2026-10-09)

- **2026-07-01:** MUST reported the sandbox trial had expired (422 "The trial period has expired") and asked for an extension.
- **2026-07-17:** MUST asked for `pms_api_room_statuses_index` and the webhook-subscription show/create/delete rights on the demo account. Clock granted them the same day.
- **2026-08-04/05:** MUST asked for "Booking: Rate Availability Control Override" after a 400 on `POST /bookings/`. Clock refused by default: the right allows overbookings and bookings that break rate restrictions. They would grant it only with a written acknowledgement of the risks, and they would not investigate issues it causes.
- **2026-09-04:** MUST sent the integration summary and test evidence log and asked for the certification call. Clock's comments: the hotel never sees API credentials, which are emailed to the partner, so the partner owns that configuration. Rate plans are folders of rates (one rate per room type), so build a hotel-side rate mapping like the room mapping. Call `rates_availability` no more than once every 15 minutes and cache accordingly. Never update `lock_version` through the API. Clock sends no webhooks for price changes.
- **2026-09-08:** Clock: booking updates should send only the changed fields.
- **2026-09-10:** Clock: reservations were created without adults and children, which also matters for rate prices, restrictions, meals and packages. MUST implemented the deposit-folio close Clock required on the certification call; it failed for lack of "Folio: Close", which Clock then granted.
- **2026-09-11/14:** MUST also asked for "Folio: Close folio with outstanding balance", `base_api_document_types_index` and `pms_api_rate_plans_create`. Clock granted the close and document-type rights (14 Sep) and asked why rate-plan creation was needed. MUST withdrew that request: rates are managed only in Clock.
- **2026-09-16/17:** MUST reported all seven certification items done (including closing the deposit folio with the configured document type, verified on demo booking 38363610) and gave Clock the live booking engine link to test.
- **2026-09-18:** Clock tested the booking flow and said its earlier advice to close deposit folios was wrong: they must stay open so the hotel can process them. Special requests should go in the booking notes; MUST found `active_notes` rejects plain strings and used `booking[client_request]` instead. Recorded in [Milestone 21 Task 1](../../roadmap/milestones/21-clock-certification-fixes.md).
- **2026-09-21 to 26:** MUST sent the AppConnector form. Clock said the sandbox expires automatically and they extend it on request. On 26 Sep the AppConnector was updated so the pilot hotel could activate the integration.
- **2026-09-30:** On the live Empire account, Clock granted the webhook-subscription and deposit-folio-creation rights, and repeated that folios must not be closed (see the [runbook](runbook.md) permissions table).

## 2026-11-17: Stripe questions (ticket #277575)

MUST asked whether Clock's own Stripe integration avoids the manual "Convert to Advance" step, whether an external system can use the hotel's Clock Stripe connection, whether our payments can be posted so they behave like Clock-taken ones, and whether a second Stripe account is acceptable. Clock also extended the sandbox account. Clock's answers, summarised:

- Clock's Stripe integration works with the Clock Booking Engine, which can close fully paid folios as invoices. It does not create a deposit folio and consume it the way our flow does.
- If the hotel does not need a deposit invoice, payments may be posted on the main booking folios, where the room charges are created.
- Question 2 (using the hotel's Clock Stripe connection from outside) and the "Custom Payment API" were not answered directly. The answer on accounts implies it is not possible.
- A hotel must pick one Stripe account for back-office use (Clock's integration) or a separate one for a third-party booking engine, because payments taken on one account cannot be processed later by another. Clock's recommendation: keep the Clock Stripe integration for back-office payments, and let MUST take web payments on its own Stripe account, post them into Clock, and handle refunds on our side.

### What it means

1. Our Stripe design (separate account per hotel, refunds on our side, ADR-0042) matches Clock's recommendation.
2. Posting Stripe payments to the main folio instead of a deposit folio would remove the manual conversion for Stripe. Not built; needs the call sequence and rights confirmed first, and the effect on refund mirroring checked.
3. No external use of Clock's Stripe connection; do not plan for it.

### Sandbox test of Clock's suggestion, and what we built (2026-11-17)

Run against the Clock sandbox (subscription 16307, never Empire), on throwaway bookings that were cancelled afterwards:

1. A new booking has one open, non-deposit folio (the main folio) and no deposit folio.
2. A payment posted to the main folio (`POST /folios/{id}/credit_items`, `on-line`, sub type `Stripe`) was accepted. The booking balance went to 0 and the folio stayed open. Nothing needs converting.
3. A negative payment (a refund) posted to the same folio was accepted and the balance rose again. A real Stripe payment and two real Stripe refunds (100.00, then 150.00) behaved the same.

**Built:** `postDeposit` now posts a website payment to the booking's open main folio. The deposit folio is only the fallback: when the booking has no open main folio, or Clock answers 403 (the login has no right to post there). A payment already carrying the same reference on any folio is a replay and is never posted twice. A refund looks for the original payment on every folio of the booking and posts the negative payment there. One behaviour for every hotel, no setting (owner, 2026-11-17).

**Still to confirm before it goes live on Empire:** the Empire API user was only ever measured for deposit folios. If it may not post on the main folio, the fallback keeps today's behaviour (the payment goes to a deposit folio and reception converts it by hand) and the log says why. Ask Clock to confirm the rights for a payment and a negative payment on a main folio. Also, the hotel's accountant should confirm how a payment on the main folio appears in their invoicing: converting a deposit issues an advance invoice (a closed deposit folio with an invoice number, counted as revenue, read on Empire's June bookings); a payment on the main folio issues none until the final invoice.
