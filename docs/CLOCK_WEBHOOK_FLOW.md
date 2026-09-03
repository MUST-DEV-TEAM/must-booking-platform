# Clock PMS+ Webhook Flow

Milestone 11 deliverable (source brief section 37/Appendix B, sections 20-21). Describes what Task 11 actually built. `CLOCK_RECONCILIATION.md` is explicitly deferred (see the milestone's "Explicitly not included" section) — this document covers ingestion only, not the reconciliation loop.

## Flow as built

```
Clock / Amazon SNS
  │  POST https://<must-host>/clock-webhooks/:webhookPublicId
  ▼
ClockWebhookController.receive()          (@Public() — no session, no tenant-scope guard)
  │  1. body-size guard (256KB)
  │  2. parse SNS envelope (structural check only: required fields present as strings)
  ▼
ClockWebhookService.handle()
  │  3. look up the connection by webhookPublicId
  │     (TenantDatabaseService.withWebhookGatewayLookup — a dedicated read-only RLS
  │      carve-out, since the tenant isn't known until after this lookup)
  │     → 404 if no connection has this webhookPublicId
  │  4. ClockWebhookVerificationService.verify(envelope)
  │     a. reject if Timestamp is outside a 5-minute window (replay protection)
  │     b. reject if SigningCertURL isn't a real sns.*.amazonaws.com host over HTTPS (SSRF protection)
  │     c. fetch (or reuse a cached) cert PEM from SigningCertURL
  │     d. verify the RSA signature over AWS's documented canonical field string
  │        (RSA-SHA1 for SignatureVersion=1, RSA-SHA256 for =2)
  │     → 400 on any verification failure
  │  5. if Type is SubscriptionConfirmation/UnsubscribeConfirmation:
  │       fetch SubscribeURL (same SSRF host check) to complete it, then ack 200 — no storage
  │     if Type is anything other than Notification: ack 200, nothing stored
  │  6. resolve which property this connection is enabled on
  │     (exactly one enabled property expected — see "Known simplification" below)
  │  7. INSERT into provider_events, ON CONFLICT (connection_id, event_id) DO NOTHING
  │     (dedup — a genuine SNS retry of the same MessageId is a silent no-op, still 200s)
  │  8. if actually inserted (not a duplicate): enqueue a job onto the real clock.webhooks
  │     BullMQ queue (Task 9)
  ▼
200 OK, fast — steps 1-8 above complete before any response is sent (source brief's
"store and deduplicate, then return 2xx immediately" ordering is satisfied structurally:
storage happens before the HTTP response, not after)
```

## What happens to the queued job: nothing yet

`ClockWorkerService`'s `clock.webhooks` processor (Task 9's skeleton) picks up the job and **logs receipt only**. The source brief's full pipeline — `Queue event → Fetch full object → Normalize → Apply → Reconcile` — stops at "queue event" in this milestone. There is no code that fetches the full Clock object the event refers to, normalizes it, applies it to the local `bookings`/catalog tables, or runs a `check-after-job` reconciliation step (source brief section 21). This is explicit, documented scope (the milestone's Task 11 acceptance criteria: "Event hydration can be minimal/manually-triggered for this milestone, full automated reconciliation is Milestone 12+"), not an oversight.

## Clock's own event payload shape: confirmed 2026-09-03

A real Message Channels subscription was activated for Empire Beach Resort 2026-09-03 (see `docs/CLOCK_RUNBOOK.md`) and real events were captured by triggering a real booking creation and guest-count edit in Clock's demo account. **The real shape is not what the code originally guessed:**

- The event type is SNS's own `Subject` field (e.g. `booking_new`, `booking_guests_update`, `folio_update`) — not something inside `Message`.
- `Message` is a JSON object with exactly one key, named for the resource (`{"booking_id":38144004}`, `{"folio_id":76073379}`) — not a generic `{type, id}` shape.

`ClockWebhookService.eventTypeOf`/`objectIdOf` were updated to match: `eventTypeOf` prefers `Subject` (only ever present on real `Notification` envelopes, so it can't misfire on a confirmation); `objectIdOf` takes the lone value when `Message` parses to a single-key object. Both keep the old guessed-shape logic as a fallback for anything that doesn't match, so nothing is silently unlabeled. Locked in as a real regression test in `clock-webhook.e2e.spec.ts` using the actual captured `booking_new` payload.

**Not yet observed**: a rate/price change (the same session that captured the above also changed a room type's price in Clock) produced no event on this subscription at all. Either rate/pricing changes go through a different Message Channel/topic than PMS bookings (the source brief separately mentions a "Yield Management API" for availability/rate/restriction updates), or this account's subscription isn't scoped to catch it. Unresolved — don't assume rate-change events will arrive on this same webhook until checked.

## Known simplification: one property per connection

`ClockWebhookService.propertyForConnection` requires the connection to be enabled on **exactly one** property; 0 or >1 enabled properties means the event is acknowledged (200, so Clock doesn't retry forever) but dropped — logged as a warning, not stored, not queued. Same class of "basic milestone" simplification as the single-rate-plan assumption in `CLOCK_DATA_MAPPING.md`. A Clock account genuinely covering multiple MUST properties isn't handled.

## Security

- **Signature verification**: real, from AWS's own publicly documented algorithm — not a stub, not a custom HMAC (source brief section 27's explicit requirement). See `clock-webhook-signature.ts` for the pure crypto (unit-tested against a real generated RSA key pair, including tamper/wrong-key/malformed-signature rejection) and `clock-webhook-verification.service.ts` for the cert-fetch wrapper.
- **SSRF protection**: both `SigningCertURL` and `SubscribeURL` are checked against a real AWS host pattern (`^sns\.[a-z0-9-]+\.amazonaws\.com$`, HTTPS only) *before* any network fetch — an attacker-supplied envelope can't redirect the cert/confirmation fetch anywhere else.
- **Replay protection**: a `Timestamp` older than 5 minutes (or more than 60 seconds in the future, allowing for clock skew) is rejected before any cert fetch or signature check.
- **Random webhook installation id**: the callback path uses `webhookPublicId` (a random UUID, `IntegrationConnection.webhookPublicId`, distinct from the connection's internal `id`) — source brief section 27/29's explicit requirement. Returned from the connection create/list API so the tenant can actually configure it on Clock's side.
- **Body size limit**: 256KB, checked from the `Content-Length` header before any parsing.
- **Dedup**: a real unique constraint (`provider_events(connection_id, event_id)`), not an application-level check-then-insert race.

## What was verified for real vs. stubbed

A live Clock Message Channels subscription now exists for this account (activated 2026-09-03, see `docs/CLOCK_RUNBOOK.md`) and genuinely AWS-signed traffic has been captured and processed end to end against the real deployed webhook gateway — including the `SubscriptionConfirmation` handshake itself and real `Notification` events (see the payload-shape section above). `clock-webhook.e2e.spec.ts` still exercises the flow locally for CI, with only the literal "fetch cert bytes from AWS" network call replaced by a stub via dependency injection (`ClockWebhookVerificationService`'s `fetchCert` constructor param, the same testability pattern `ClockHttpClient`'s `protocol` override already established for testing against a local server instead of a live third party) — everything else, including the RSA signature verification itself, is real in the test too. The SSRF-protecting hostname check is not stubbed and was tested against both real and fake AWS host strings.
