# Clock setup and diagnosis

Status: **SOURCE-BACKED procedure; live setup must be verified on the target environment**. Updated 2026-09-19.

## Before operating

Use the active deployment record in [operations](../../operations/README.md), not retired homelab names. This document is guidance, not permission to probe a provider, change secrets or mutate reservations. Resolve the exact tenant/property/connection, environment and authorized operation before running it; never print decrypted credentials.

The platform owns encrypted tenant connections. Review `IntegrationConnectionsService`, `CredentialCipherService`, `clock-http-client.ts` and `clock-credentials.ts` before changing connection data. A connection test is a real outbound provider request.

## Connect and map

1. Configure a tenant-owned Clock PMS connection through the supported integration-management surface, using the target account's verified credentials and plan entitlement.
2. Test that connection, assign it to the intended property and verify it is enabled/CONNECTED. One enabled property per connection is required by the current webhook handler.
3. Run catalog synchronization, review proposals, confirm room types before physical rooms. Prices use published child rates and optional ranking; do not enter a parent rate-plan ID as a rate.
4. Check public catalog/quote/search behavior, then an explicitly authorized final booking/payment/cancel scenario. A successful ping is not integration acceptance.

## SNS setup

The callback is `/clock-webhooks/:webhookPublicId`, using the random installation ID, not the internal connection ID. Next's rewrite supports this path; verify actual proxy routing in the target environment instead of recreating the former homelab topology.

Historical setup used Clock's Digest-authenticated Base API `/webhook_subscription` GET/POST/DELETE. Contract details and rights must be checked against the [endpoint matrix](endpoint-matrix.md) before a new setup. The 2026-09-03 notes record POST with the same endpoint as recovery for missed confirmation; do not delete a subscription by default.

Pin the **topic ARN**, not the longer subscription ARN, in encrypted credentials as `snsTopicArn` before expecting messages to pass. The current structured UI does not expose this field; the create service accepts a string-valued credentials object, but there is no dedicated SNS onboarding or credential-update endpoint in the current connection service. Any administrative credential edit must retain tenant scoping, encryption and audit handling; do not paste a blanket SQL update from an old host.

Verify actual confirmed subscription state and a signed notification through ingestion, persistence, enqueue and hydration. A 200 for confirmation alone is insufficient: the current service ignores a failed confirmation callback's boolean result.

### Empire Beach Resort production: webhook re-enable (2026-09-30)

Why: live bookings were reaching Clock but no inbound Clock webhook had arrived (one rejected 400 in 72 h), and `ClockWebhookHealthService` logged "0 connection(s)" on every run, so nothing alerted.

Findings, all read-only:

- Clock granted `base_api_webhook_subscription_show` and `pms_api_booking_folios_create` to the API user. Clock confirmed folios must **stay open** for the hotel to take payment, so the `Folio: Close` and `Folio: Close folio with outstanding balance` rights are deliberately not granted; closing must not be attempted.
- `GET /webhook_subscription` moved from `403` to `400 webhook_subscription_not_found`: the right works, but **no subscription exists** for this account.
- The Clock connection (`8849c0b2-…`, webhook ID `ac27a3b1-b272-4bfa-a12a-b8ee6eab667a`) is `CONNECTED` with `host, accountId, subscriptionId, apiUser, apiKey` credentials and **no `snsTopicArn`**, so every signed message would be rejected as a topic mismatch until it is pinned.
- Public routing is correct: `GET https://booking.must.al/clock-webhooks/<uuid>` returns the API's JSON 404, and an empty POST returns `Malformed SNS envelope` (400).

Procedure (POST, pin, re-POST, then verify):

1. `POST /webhook_subscription` with `{"endpoint": "https://booking.must.al/clock-webhooks/ac27a3b1-b272-4bfa-a12a-b8ee6eab667a"}`.
2. `GET /webhook_subscription`, strip the trailing subscription ID from `subscription_arn` (keep the first six `:` parts) and store the result as `snsTopicArn` in the connection's encrypted credentials, keeping a backup of the prior encrypted blob.
3. Re-POST the same endpoint so AWS re-sends the `SubscriptionConfirmation` now that the topic is pinned.
4. Verify `pending_confirmation: false` on GET, a `provider_events` row for a real event, and its terminal status. Then trigger one harmless Clock action (open a folio) and record the real event name.

Open questions to settle from that capture: Clock's event name for folio create (the worker only applies `folio_update` and `folio_close`, see `FOLIO_EVENT_TYPES` in `clock-worker.service.ts`) and why the health check counts 0 connections for a `CONNECTED` connection.

Status, executed 2026-09-30 with the owner's explicit approval: steps 1-3 done. Clock returned subscription `PUSH_14688_EMPIRE_BEACH_RESORT` (account 14688), the bare topic ARN `arn:aws:sns:eu-west-1:006467213368:PUSH_14688_EMPIRE_BEACH_RESORT` was pinned in the connection's encrypted credentials (prior encrypted blob backed up inside the API container at `/tmp/cred-backup-<connectionId>.txt`, lost on rebuild), the re-POST was sent, and two signed deliveries to the webhook URL returned 200 with no "Rejected Clock webhook" warning. `GET /webhook_subscription` then showed `pending_confirmation: false`. Step 4 (a real folio/booking event reaching `provider_events` and being applied) is still to do. The one-off scripts were not committed, per the 2026-09-03 convention.

## Inspecting a live booking read-only (lessons from 2026-09-30)

Use this to compare a MUST booking with what the hotel sees in Clock. It performs GETs only.

1. **Pick the connection by `subscriptionId`, never "the first PMS connection".** The production database holds more than one enabled `integration_connections` row of kind `PMS`: the old demo account (subscription `16307`, account `172528`) and Empire Beach Resort (subscription `14688`, account `122536`). An unordered `LIMIT 1` returned different rows between runs and produced two false conclusions in one session (a test booking and booking #15688 were reported "deleted" because they were searched in the wrong account). The Clock error text shows `account_id = <n>`: check it matches the intended hotel before drawing conclusions.
2. A booking's human **number** (for example `#15688`) is the `number` field. Resolve it with `GET /bookings/?number=<n>`, which returns the numeric booking ID. MUST stores Clock-originated bookings locally as `CLOCK-<number>` with the Clock ID in `external_booking_id`.
3. Read the booking (`balance`, `total_booking_value`, `guarantee_policy_id`, `is_guaranteed`), `GET /bookings/{id}/folios/`, then for each folio `GET /folios/{id}` (`deposit`, `closed_at`, `balance`, `document_type_id`) and `GET /folios/{id}/credit_items`.
4. Do the work inside the API container with the compiled `ClockHttpClient` and `decryptCredentialPayload`, reading the encrypted blob with `psql`, and print only Clock's responses. Never print decrypted credentials, and delete the temporary script afterwards.
5. A hotel **cancelling** in Clock reaches MUST within seconds (`booking_update` + `booking_canceled`, verified 2026-09-30 for #15784). What happens when a booking is **deleted** in Clock has not been tested; do not assume either way.

## Quick guest test booking from the command line (2026-10-01)

`apps/api/scripts/agent-booking.ts` (`pnpm agent:booking`) drives the public guest API (catalog, quote, booking with PokPay) with no login and no browser, so a test booking takes a few seconds. It prints the PokPay staging `checkoutUrl`; paying on that page (test card) is the only step outside the script. `status` and `cancel` act on the last booking it made (guest self-cancel is refused near arrival with `CANCELLATION_WINDOW_CLOSED`; staff cancel from the dashboard instead). Usage is in the file header.

**Always name the target explicitly, and check it.** The database has two properties and the script deliberately has no defaults:

| Property | Tenant ID | Property ID | Clock account |
| --- | --- | --- | --- |
| **Empire Beach Resort** (real hotel, `EBR-…` references) | `458b66cd-6a04-4c4f-a0e3-1827937d24aa` | `3d680e29-8223-4d37-b0d2-b9f0db9400a9` | subscription `14688` |
| Must Hotel (old demo property, `MH-…` references) | `fdb9f701-510e-4deb-857b-08a87fcdfbcc` | `9231b946-f244-4a84-af54-0774710f3464` | demo subscription `16307` |

A first test on 2026-10-01 picked the first row of `properties` and booked into the demo Clock account by mistake (booking `MH-260930-2255-WWPC`, Clock `38620328`, PokPay staging, still CONFIRMED because the guest cancel window was closed; cancel it as staff). Confirm the `EBR-` reference and the Clock account after every test.

First live run on Empire (room 237, 3-4 Oct 2026): booking `EBR-260930-2258-9WDC`, Clock #15787, PokPay staging 250.00 EUR paid, `guarantee_policy_id` **17089 set automatically** (Milestone 21 Task 25 verified live), main folio +250.00 and open deposit folio -250.00 with the 250.00 payment, booking balance 0.00 (open deposit folios count in the balance, as documented in the booking lifecycle).

## API user permissions: sandbox versus Empire (measured 2026-10-01)

Measured by running the same call in both accounts: read calls on both, write calls in the sandbox only (Empire's write results come from earlier live attempts, so no further test data was written into the real hotel account). The sandbox is the demo account (subscription 16307); Empire is the real hotel (subscription 14688).

| Capability | Sandbox | Empire | How known |
| --- | --- | --- | --- |
| Read room types, rooms, rates | allowed | allowed | probe |
| Read bookings, search by reference, guest search | allowed | allowed | probe |
| Read booking folios, a folio, its credit items | allowed | allowed | probe |
| Read webhook subscription (`base_api_webhook_subscription_show`) | allowed | allowed (granted 2026-09-30) | probe |
| Create a booking | allowed | allowed | live bookings |
| Create a deposit folio (`pms_api_booking_folios_create`) | allowed | allowed (granted 2026-09-30) | live bookings |
| Post a payment on a deposit folio | allowed | allowed | live bookings |
| **Negative payment on an OPEN deposit folio** (refund mirror) | **allowed** | granted 2026-10-02 ("Payments: Add negative payment to Open folio"); denied before | sandbox test; Empire refund 2026-10-01; Clock's reply |
| Negative payment on a CLOSED deposit folio | allowed | granted 2026-10-02 ("Payments: Add negative payment to Closed folio"), not yet used | sandbox test; Clock's reply |
| List rate plans (`pms_api_rate_plans_index`) | allowed | **denied** (403) | probe |
| List fiscal document types (`base_api_document_types_index`) | allowed | **denied** (403) | probe |
| Close a folio (`base_api_folios_close`) | allowed | **denied** (403), withheld on purpose: Clock wants deposit folios left open | sandbox test; Empire probe 2026-10-01 |
| Close a folio with an outstanding balance | allowed | denied, withheld on purpose (reported by Clock) | sandbox test; Clock's message |

**What was asked of Clock (message drafted 2026-10-01, answered 2026-10-02; full text and reply in the [correspondence log](correspondence.md)).** Clock granted both negative-payment rights, said there is "no way to automate" converting deposits to advances, and pointed to `text` instead of `reference` for filtering. The original asks:

1. **Needed now:** "Payments: Add negative payment to Open folio", so a refund returned to the guest can be mirrored on the open deposit folio. Also ask whether a refund after the hotel converted the deposit (a closed folio) needs a separate right; the sandbox allows it, Empire is untested.
2. **The owner's goal: every online payment converted to an advance automatically** (the reception only wants the deposit converted; how the booking looks is irrelevant). Converting is a multi-step accounting operation, not a close (see the booking lifecycle): a pre-invoiced deposit charge per tax group on the deposit folio, then close with the advance document type. Ask Clock for the supported way to do it through the API. If it is done with ordinary calls, the rights involved would include creating charges on a folio, reading charge templates, reading document types (`base_api_document_types_index`) and closing (`base_api_folios_close`); the exact right names must come from Clock. This also conflicts with Clock's 2026-09-18 instruction to leave deposit folios open, so it is asked as a question first.
3. **Question:** does the hotel's own Clock have a setting or autopilot that converts deposits to advances automatically (for example when the payment arrives, or on arrival day)? That would need no rights and no code.

The rate-plan listing is not called by the integration today, so it is not worth asking for. The sandbox allows everything, so a green sandbox test says nothing about what Empire permits; check the right in Empire before relying on a feature.

## Diagnose by layer

| Symptom | Check |
| --- | --- |
| No delivery / HTML or proxy error | Public routing and API path; text/plain SNS parsing in `main.ts` |
| Topic mismatch | Bare topic ARN versus subscription ARN, correct connection/environment |
| Signature/freshness rejection | Timestamp, expected signing host/certificate and signature; do not disable verification |
| Accepted event, no booking change | Enabled-property count; persisted event; queue enqueue; recognized type; mapping; worker error/dead-letter |
| Event stored but no queued job | Known insert/enqueue gap; do not assume redelivery repairs it |
| Paid booking not confirmed | Booking state, payment/session record, integration operation and manual-review item; lookup vendor reference before considering any retry |
| Confirmed booking, no deposit | Original credit-item reference, deposit folio and manual-review/notification; do not create another charge blindly |
| Financial reconciliation fails | Check the known `reference.eq` contract mismatch before trusting its coverage |
| No operational alert | Reporting configuration and actual delivery, not merely Sentry call sites |

Manual-review resolution is not automatic recovery. No general queue replay/reconciliation-repair admin workflow is documented as implemented. Prepare a targeted, idempotent corrective plan before changing financial/provider state.

## Acceptance evidence

The [archived sandbox report](../../archive/clock-sandbox-validation-2026-08-05.md), [test log](../../archive/clock-test-evidence-2026-09-04.md) and [Milestone 21](../../roadmap/milestones/21-clock-certification-fixes.md) record past observations. They do not certify today's deployment. Current deposit behavior leaves folios open; old close instructions are superseded. Retain the distinction between local tests, sandbox observations and production verification in every new report.
