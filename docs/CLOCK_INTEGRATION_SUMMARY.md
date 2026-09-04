# MUST × Clock PMS+ — Integration Summary

This is for Clock's integration team ahead of the certification review. You asked for integration data and workflows so you can prepare test cases before the call — this covers what we've built and tested against the Clock PMS+ sandbox (HOTEL DEMO account, `sky-eu1.clock-software.com`).

## 1. What MUST is

MUST is a multi-tenant hotel booking platform. Each customer (an "organization") can connect one or more properties to their own Clock PMS+ account. We're built to work with different PMS providers behind a common internal interface — Clock is the first one we've integrated.

## 2. Connection & authentication

- Clock credentials (host, account ID, subscription ID, API user, API key) come to us by email from Clock and are entered once on the customer's behalf, then stored encrypted (AES-256-GCM), decrypted only when we need to make a call. We're the ones responsible for this configuration, not the hotel.
- We use RFC 7616 Digest Authentication, built fresh per request from Clock's challenge.
- Customers can test their connection at any time from their dashboard — this runs a real authenticated call against Clock.

## 3. Catalog sync (room types & rooms)

- We read `GET /room_types` and `GET /rooms` and stage anything we haven't seen before as a proposal.
- Someone at the property has to confirm each proposal before it goes live on our side — nothing is applied automatically. A room can't be confirmed until its parent room type is.
- One thing we haven't built yet: mapping individual rates. Right now we require a connected property to have exactly one rate plan and use whatever rate we find under it. Confirmed with Clock: a rate plan is really a folder that can hold many rates over time, one per room type, so the right long-term approach is a rate-mapping screen — same idea as our existing room type/room mapping, where the hotel picks which rates they actually sell. That's planned, not built yet.

## 4. Availability

- We call `GET /rates_availability` with `from`/`to`, the Rate id(s) from `GET /rates/` (not the parent Rate Plan id), and `room_types`/`rooms`.
- We cache results for 20 minutes for guest browsing, but the final check right before booking always skips the cache and hits Clock directly.

## 5. Booking lifecycle

| Operation | Clock call | Notes |
| --- | --- | --- |
| Create | `POST /bookings/` | `reference_number` carries our own idempotency reference. If the create call times out or fails, we don't blind-retry — we first check `GET /bookings/?reference_number=` to see if it already went through, and only create a new one if it genuinely didn't. |
| Update | `PUT /bookings/{id}` | Currently just date changes. We always re-fetch the current `lock_version` right before the `PUT`, never cache it. |
| Cancel | `PUT /bookings/{id}` with `status: "canceled"` | Same lock_version re-fetch. |

Our own version counter and Clock's `lock_version` are separate — we don't treat them as interchangeable.

**Guest matching**: we match or create a guest record by lowercased email. We don't create a separate Clock-side guest — guest details just go inline on the booking payload.

**Clock's own booking status** (`expected`/`checked_in`/`checked_out`/`canceled`/`no_show`) is fetched but we don't act on it yet. If a guest checks in or out through Clock's own front desk, nothing changes on our side. Known gap, on our list.

## 6. Financial flow

When a guest pays us directly (card payment at booking time) and the reservation is created in Clock, we post that payment into Clock as a real accounting entry:

1. We find or open an open deposit folio (`booking_folio.deposit: true`) — `GET /bookings/{id}/folios/`, then `GET /folios/{id}` for each, creating one via `POST /bookings/{id}/folios/` if none is open.
2. We post a `credit_item` to that folio (`POST /folios/{id}/credit_items`) with `payment_type: "on-line"`, the gateway name (e.g. "Stripe", "PokPay") in `payment_sub_type`, and our own booking reference in the `reference` field.
3. If the POST fails ambiguously (timeout, network, 5xx), we look the item up again by our own reference before retrying, so a guest never ends up double-charged in Clock's ledger from a retry.

**Reconciliation**: we run an automated daily check (03:00 UTC) over every online-paid, Clock-attached booking from the past month. For each, we re-read the deposit folio's credit_items, match them by reference back to the booking, and compare the total to what we actually charged. Any mismatch — missing folio, missing credit_item, or an amount/currency difference — raises an alert for someone on our side to look at. We never auto-correct anything or write back to Clock based on this.

We don't currently look at Clock's own aggregate booking balance or reconcile the general (non-deposit) folio — just the credit_items we posted ourselves.

## 7. Webhooks (Clock Message Channels)

- We have a real Message Channels subscription active for testing and have received and processed genuine AWS-signed SNS traffic end to end.
- Signature verification: real AWS SNS RSA-SHA1/RSA-SHA256 against a certificate fetched from `SigningCertURL`, restricted to `sns.*.amazonaws.com` hosts. Anything older than 5 minutes (or more than 60 seconds in the future) gets rejected before we even check the signature.
- Topic pinning: we reject anything whose `TopicArn` doesn't match what we have on file for that connection, so a leaked webhook URL can't be used to inject events from a different account.
- Dedup: every event goes through a unique `(connection, event id)` constraint before we return 200, so a genuine SNS retry is a no-op.
- Event types we apply: `booking_new`, `booking_guests_update`, `booking_update`, `booking_canceled` — each one makes us re-fetch the booking's current state and apply it locally. `folio_update` and `folio_close` update our own visibility layer (see §6) but don't change local booking state.
- Anything else Clock sends gets logged, not silently dropped, but we don't act on it yet.
- Confirmed with Clock: price changes don't have a webhook at all, so we won't expect one going forward.
- One simplification worth flagging: we assume a Clock connection is enabled on exactly one of our properties. An event for a connection enabled on zero or more than one property gets acknowledged (so you don't keep retrying) but isn't applied.

## 8. Error handling & retry

We classify every Clock response or failure into one of 14 categories (authentication, authorization, validation, not_found, conflict, rate_limited, timeout, network, provider_unavailable, waf_blocked, unknown_result, schema_mismatch, configuration, permanent), and only some are eligible for automatic retry (429, safe network interruptions, GET timeouts, provider-temporarily-unavailable). Booking creation never blind-retries — it goes through the reference-number lookup in §5 instead.

One thing worth calling out: an optimistic-concurrency conflict on `PUT /bookings/{id}` comes back as a plain HTTP 500 with `"Attempted to update a stale object: Booking"`, not a 409. We specifically check for that message and treat it as a retryable conflict rather than a generic server error.

## 9. Rate limiting

We throttle ourselves to 4 requests/second per API user, below your documented 5/s, across all our API instances. A request that would go over that never reaches you — it's held on our side.

## 10. Monitoring on our side

We alert our own team in real time on: a Clock job that exhausts its retries, a connection that's gone quiet (no webhook in 48+ hours), a circuit breaker opening after repeated failures, background-queue backlogs, bookings stuck mid-flow, and any of the reconciliation/mismatch findings from §5–6. None of this needs anything from you — just flagging that we have real visibility into how the integration is doing.

## 11. Known gaps

- Rate-level mapping isn't built yet — we still assume exactly one rate plan per property (§3).
- Clock's own booking status isn't read back into our side yet (§5).
- Guest matching is email-only — no Clock-side guest ID stored or reconciled (§5).
- No dedicated detector for a "suspicious 403 pattern" (WAF blocking) — our generic circuit breaker will still stop hammering you after repeated failures of any kind, but there's no alert specific to that pattern.

## Contact / sandbox reference

We've been testing against the HOTEL DEMO account (`support@must.al`) at `sky-eu1.clock-software.com`. Happy to walk through any of this live on the call, or beforehand if that's easier for your team.
