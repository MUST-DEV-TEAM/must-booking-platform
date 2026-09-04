# MUST × Clock PMS+ — Test Evidence Log

A dated log of testing we've done against the Clock PMS+ sandbox (HOTEL DEMO account, `sky-eu1.clock-software.com`) while building this integration. Included as backup alongside our integration summary.

## 2026-08-04 — Connectivity & catalog

- Digest authentication (RFC 7616) worked end to end against the sandbox.
- `GET /room_types` and `GET /rooms` came back with the data already configured on the account (room type "Standard Rooms", room "Direct Pool").

## 2026-08-05 — Full booking lifecycle

- Found and fixed the cause of an earlier rejected booking: we were using a Rate Plan id where the API wants the room-type-scoped Rate id from `GET /rates/`.
- Availability: `GET /rates_availability` returned a populated `free: true` result for room type DBL once we used the right Rate id.
- Booking creation: `POST /bookings/` succeeded — got back a real booking id and `lock_version: 0`, no rejection.
- Cancellation: cancelled the same booking — fetched the current `lock_version` via `GET /bookings/{id}`, then `PUT /bookings/{id}` with `status: "canceled"`.
- Ran the whole chain in one go: connect, sync catalog, check availability, create, cancel. No failures at any step.

## 2026-08-17 — Reconciliation against live account data

- Ran a read-only consistency check against Empire Beach Resort's production account, 2026-08-01 through 2026-08-31.
- `GET /bookings/` with date filters returned a bare numeric-ID array as expected. Followed up with `GET /bookings/{id}` for all 219 results, staying within our rate limit throughout.
- Compared against our own 4 confirmed/cancelled bookings for the same window: zero mismatches.

## 2026-09-03 — Webhook subscription activated

- Activated a real Message Channels (SNS) subscription for Empire Beach Resort — first time we'd exchanged genuinely AWS-signed traffic (earlier testing used a locally generated key pair for the same code paths).
- Got the real `SubscriptionConfirmation`, verified its signature, and confirmed it back to AWS.
- Triggered a real booking creation and a guest-count edit in the sandbox — `booking_new`, `booking_guests_update`, and `folio_update` events came through, got verified, deduplicated, and processed.
- One thing we noticed: a room-type price change made during the same session produced no event on this subscription. Still not sure if rate/price changes go through a different channel.

## 2026-09-03/04 — Financial flow

- Pulled the credit_items for an already-paid booking from an earlier payment (2026-08-17): `GET /folios/{id}/credit_items` gave back the posted payment, and the amount (`value_cents: 25000`, €250.00), currency, and reference all matched what we'd actually charged.
- Confirmed a booking can have two folios at once — a deposit folio for the payment, a general folio for the outstanding room charge — and that a folio's own `currency` field isn't reliable (it reflects the property's base currency, not what was posted). We use the credit_item's own currency instead.
- Built and tested the daily reconciliation against three scenarios: a match (no alert), a deliberate amount mismatch (alert raised correctly), and a missing deposit folio (alert raised correctly).

## 2026-09-04 — Fresh run: create, pay, update, cancel, close

- Created a real booking through MUST (POKPAY, €500.00). Clock confirmed the reservation, but our attempt to post the deposit hit Clock's own rate limit ("Too many Clock requests right now — try again in 1s") and correctly raised an alert instead of failing silently or double-posting. Good example of the error handling working under an actual failure, not a staged one.
- Created a second booking a bit later (POKPAY, €1,000.00) — this one went through cleanly end to end: reservation, open deposit folio, credit_item posted.
- Changed the date on a live booking — got a real `booking_update` webhook.
- Cancelled a booking — got a real `booking_canceled` webhook.
- Closed a folio — got a real `folio_close` webhook, the one event type we hadn't seen live before.

Between this and 2026-09-03, we've now seen every event type we apply — `booking_new`, `booking_guests_update`, `booking_update`, `booking_canceled`, `folio_update`, `folio_close` — live at least once.

## 2026-09-04 — Availability on a fully-booked room

- Found a room type with exactly one unit and a real booking against it. Querying availability for that date range returned `isAvailable: false, availableUnits: 0`.
- As a check, the same room type for an open date range returned `isAvailable: true, availableUnits: 1` — so the false result above is real, not a default.

## What we haven't covered

- No live event for a rate/price change — open question for the call.
- A stale-`lock_version` conflict and the creation-timeout/reference-lookup recovery path are both built against your documented contract and covered by our own tests, but we didn't force either one against the live sandbox. Didn't think it was worth manufacturing either condition against a shared account.

## Appendix: sample request/response payloads

Requests below are exactly what we send. For booking creation and the credit_item, the response fields shown are what we actually observed and checked — not necessarily every field Clock returned. The webhook events are different: those are complete, real envelopes pulled straight from our event log, with only the long `Signature` value shortened for readability.

**Booking creation — request** (`POST /bookings/`):
```json
{
  "booking": {
    "arrival": "2026-08-10",
    "departure": "2026-08-12",
    "status": "expected",
    "arrival_room_type_id": 41994,
    "rate_id": 784160,
    "reference_number": "MUST-<our-booking-reference>",
    "guest_e_mail": "guest@example.com",
    "guest_first_name": "Jane",
    "guest_last_name": "Doe"
  }
}
```
**Response fields we saw** (2026-08-05, room type DBL / id `41994`, rate id `784160`):
```json
{
  "id": "<real Clock booking id returned>",
  "lock_version": 0,
  "status": "expected"
}
```

**Credit item posting — request** (`POST /folios/{folio_id}/credit_items`):
```json
{
  "credit_item": {
    "payment_type": "on-line",
    "payment_sub_type": "PokPay",
    "text": "Website booking payment via PokPay",
    "value": "250.00",
    "currency": "EUR",
    "reference": "must-order-c8d26ef9-...-room1"
  }
}
```
**Response fields we saw** (2026-09-04, the €1,000.00 booking from the run above):
```json
{
  "id": 64156693,
  "reference": "EBR-260904-0745-8T",
  "value_cents": 100000,
  "currency": "EUR"
}
```
The €1,000.00 we actually charged matched what Clock had posted, matched on our own reference field. Same result independently on 2026-09-03 against an older €250.00 payment from 2026-08-17.

**Folio detail** (`GET /folios/{id}`, 2026-09-04):
```json
{
  "id": 76104577,
  "deposit": true,
  "balance": { "cents": -100000, "currency": "EUR" },
  "closed_at": null
}
```

**Webhook events — complete real envelopes**, captured live against Empire Beach Resort. `Signature` is a real RSA signature, unique per message and pretty long, so we've shown its length instead of the full value — happy to share the raw value if useful.

`booking_new` (2026-09-03):
```json
{
  "Type": "Notification",
  "Subject": "booking_new",
  "MessageId": "4cf5ac5b-9173-51e8-aea3-cf4851d2517b",
  "TopicArn": "arn:aws:sns:eu-west-1:006467213368:PUSH_16307_HOTEL_DEMO",
  "Message": "{\"booking_id\":38149736}",
  "Timestamp": "2026-09-03T18:37:21.968Z",
  "SignatureVersion": "1",
  "Signature": "<RSA-SHA1 signature, 344 chars, verified>",
  "SigningCertURL": "https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-1e59c4574facfe41babdb2d652f8ebef.pem"
}
```

`booking_guests_update` (2026-09-03):
```json
{ "Type": "Notification", "Subject": "booking_guests_update", "Message": "{\"booking_id\":38149736}",
  "MessageId": "7ee6c3f8-1ca5-5b67-bab6-a0ebdb46331e", "Timestamp": "2026-09-03T19:08:19.618Z" }
```

`booking_update` (2026-09-04, the date change above):
```json
{ "Type": "Notification", "Subject": "booking_update", "Message": "{\"booking_id\":38149735}",
  "MessageId": "9286a531-3c7c-5e78-8af4-c625494dc3ce", "Timestamp": "2026-09-04T07:27:45.224Z" }
```

`booking_canceled` (2026-09-04, the cancellation above):
```json
{ "Type": "Notification", "Subject": "booking_canceled", "Message": "{\"booking_id\":38149735}",
  "MessageId": "52b83188-b9b9-5bd5-b020-529ccc86c80c", "Timestamp": "2026-09-04T07:27:59.021Z" }
```

`folio_update` (2026-09-04):
```json
{ "Type": "Notification", "Subject": "folio_update", "Message": "{\"folio_id\":76073379}",
  "MessageId": "cfa211be-9909-5c14-a8ed-72aaec76e3e2", "Timestamp": "2026-09-04T07:29:03.087Z" }
```

`folio_close` (2026-09-04, the folio close above):
```json
{ "Type": "Notification", "Subject": "folio_close", "Message": "{\"folio_id\":76073379}",
  "MessageId": "045cdba1-4cea-56c7-8f80-b8b53995d931", "Timestamp": "2026-09-04T07:29:03.127Z" }
```

Across all six, the event type is in `Subject`, and `Message` is a single-key JSON object naming the resource — not the generic `{type, id}` shape we'd originally assumed before seeing these.

## Appendix: raw log for the 2026-09-04 run

Exact timestamps (UTC) pulled straight from our own event and payment records for the run described above, in order. This is the underlying log behind that section, not a re-description of it.

**Booking 1 — create, pay, cancel** (MUST booking `5b96908e`, Clock booking `38155339`, POKPAY €500.00):
```
07:42:04.174  Booking created in MUST
07:43:00.052  Payment recorded (CHARGE, PAID, €500.00)
07:43:00.052  Deposit posting failed — Clock rate limit ("Too many Clock requests right now — try again in 1s")
07:43:00.052  PAYMENT_BOOKING_MISMATCH alert raised
07:43:01.841  Webhook received: booking_new
07:43:03.475  Webhook received: booking_guests_update
07:43:48.561  Webhook received: booking_update
07:43:48.683  Webhook received: booking_canceled
07:43:49.450  Booking marked CANCELLED in MUST
```

**Booking 2 — create, pay successfully** (MUST booking `b76f097f`, Clock booking `38155403`, POKPAY €1,000.00):
```
07:45:07.671  Booking created in MUST
07:46:00.101  Payment recorded (CHARGE, PAID, €1,000.00)
07:46:00.101  Clock reservation created (external booking 38155403)
07:46:00.101  Deposit posted: folio 76104577, credit_item 64156693, €1,000.00, reference EBR-260904-0745-8T
07:46:02.672  Webhook received: booking_new
07:46:04.519  Webhook received: booking_guests_update
```

**Booking 3 — date change, cancel** (Clock booking `38149735`):
```
07:27:45.224  Webhook received: booking_update (date change)
07:27:59.021  Webhook received: booking_canceled
```

**Folio close** (Clock folio `76073379`):
```
07:29:03.087  Webhook received: folio_update
07:29:03.127  Webhook received: folio_close
```

**Availability check** (room type with 1 unit):
```
Query: roomTypeId=<Standard Rooms>, startsOn=2026-08-12, endsOn=2026-08-14 (a real booked window)
Result: { "isAvailable": false, "availableUnits": 0 }

Query: roomTypeId=<Standard Rooms>, startsOn=2026-11-01, endsOn=2026-11-03 (an open window)
Result: { "isAvailable": true, "availableUnits": 1 }
```

## Sandbox reference

HOTEL DEMO account (`support@must.al`), `sky-eu1.clock-software.com`.
