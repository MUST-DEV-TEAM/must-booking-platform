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

## Earlier

- **2026-09-18:** Clock said deposit folios must stay open and MUST must not close them. Recorded in [Milestone 21 Task 1](../../roadmap/milestones/21-clock-certification-fixes.md).
- **2026-09-30:** Clock granted the webhook-subscription and deposit-folio-creation rights on Empire (see the [runbook](runbook.md) permissions table).
