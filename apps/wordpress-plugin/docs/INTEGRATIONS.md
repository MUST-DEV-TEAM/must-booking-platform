# Integrations

This reference describes the `0.4.92` release-candidate working tree based on commit `b0380ad`. It names configuration fields but never their values. The Clock transport contract was refreshed from the official documentation on 2026-07-17; production configuration remains unverified.

## Ownership summary

| Integration | Owns or supplies | Does not prove |
|---|---|---|
| Stripe | Checkout Session/PaymentIntent and Stripe refund outcomes | Local reservation commit or Clock fulfillment |
| PokPay | SDK-order and PokPay refund outcomes | Local reservation commit or Clock fulfillment |
| Clock PMS | Provider IDs, live availability/restrictions, provider reservation state, supported PMS amendments | Stripe/PokPay payment or refund truth |
| WordPress/plugin | Local mirror, presentation, workflow metadata, payment/refund/accounting evidence | Provider success without an authenticated/reread result |
| AWS SNS transport | Authenticated delivery envelope for Clock PUSH events | Correct application of the enclosed provider change |
| Elementor | Optional booking and room-list entry widgets | Availability, pricing, reservation, or payment policy |
| WordPress email | Message handoff through `wp_mail()` | Final delivery to the recipient |
| GitHub updater | Release discovery and package delivery | Successful production deployment or rollback readiness |

All external HTTP traffic uses the WordPress HTTP API. Do not log or document credentials, authorization headers, full personal-data payloads, cancellation tokens, or unmasked provider responses. `ProviderDataSanitizer` and provider request logging are security boundaries.

## Shared callback and environment rules

`MustBookingConfig` stores plugin configuration in WordPress options and provides normalized helpers. Relevant non-secret logical keys include `provider_mode`, `clock_enabled`, `public_callback_base_url`, payment-method enablement, active site/payment environment, and per-provider environment credentials.

- Test and production credentials are separate. Environment, merchant/account, currency, and transaction identity are part of payment binding.
- Online initiation requires an explicitly saved `local`, `staging`, or `production` site environment. The server derives provider mode and a salted credential fingerprint; browser-supplied environment/account identity is never accepted.
- Clock-backed payment requires the corresponding `sandbox` or `production` Clock environment and an administrator-approved fingerprint of the configured region/subscription/account/property target. Changing site, gateway credentials, Clock environment, or Clock target invalidates pending reuse and blocks Clock creation until compatibility is re-established.
- `public_callback_base_url` may override generated return/webhook URLs only with a verified HTTPS staging/tunnel/public origin.
- A browser return is transport state, not payment proof.
- Public confirmation/cancellation links carry opaque expiring grants for one exact reservation set; URL tokens are exchanged for per-tab cookie-bound contexts before details are rendered.
- Localhost callbacks are not provider-reachable without an explicitly approved tunnel.
- No live credential probe, provider write, booking, payment, refund, cancellation, webhook replay, or reconciliation is allowed during routine local work.

## Public REST endpoints

The route permission callbacks are public because providers cannot use WordPress sessions. Each callback must therefore enforce its own authentication and binding.

| Method and route | Owner | Internal verification |
|---|---|---|
| `POST /wp-json/must-hotel-booking/v1/stripe/webhook` | `PaymentEngine` | Stripe signature, event parsing, provider/local binding |
| `POST /wp-json/must-hotel-booking/v1/pokpay/finalize` | `PaymentEngine` | WordPress REST nonce, authorized per-tab confirmation context, exact stored order/reservation-set binding, and authoritative PokPay order reread |
| `POST /wp-json/must-hotel-booking/v1/pokpay/error` | `PaymentEngine` | Diagnostic input sanitization; not a success signal |
| `POST /wp-json/must-hotel-booking/v1/pokpay/webhook` | `PaymentEngine` | Known order lookup, local binding, authoritative provider reread |
| `POST /wp-json/must-hotel-booking/v1/clock/webhook` | `ClockInboundSyncController` | SNS signature/certificate rules or configured legacy authentication |
| `GET /wp-json/must-support/v1/health` | `SupportDiagnosticsEndpoint` | Feature enabled plus constant-time token comparison; returns 404 on failure |

## Stripe

### Purpose and source owners

Stripe provides hosted card checkout, server-side payment verification, fee capture support, and refunds. Primary owners are:

- `src/Engine/PaymentEngine.php`
- `src/Engine/Payment/StripePayment.php`
- `src/Engine/PaymentRefundService.php`

### Authentication and configuration

Logical settings include Stripe enablement; test/live publishable keys, secret keys, and webhook secrets; active environment; currency; and callback base. Never expose their values. Outbound API calls use Bearer authentication to `https://api.stripe.com/v1/`.

### Identifiers and verification

- Local reservation/payment IDs are bound to the Checkout Session metadata and pending payment transaction reference.
- Pending rows retain the Checkout Session attempt reference after the paid row moves to the PaymentIntent transaction reference, allowing exact attempt-time allocation and credential checks on every replay.
- Completion rereads the session and requires `payment_status=paid`, session `status=complete`, the same reservation set, expected amount, expected currency, and matching local session reference.
- The PaymentIntent ID becomes the paid transaction reference when present.
- The configured credential path supplies a non-secret account fingerprint and provider mode; both are part of immutable ownership together with the Checkout Session attempt reference.
- Stripe webhook payloads require a valid `Stripe-Signature` under the configured tolerance.
- Current handlers cover Checkout Session completion/expiration and refund/charge refund events.

### Retry and idempotency

- Outbound responses mark network failures, HTTP 429, and 5xx as retryable; general API calls do not blindly retry.
- Refund creation transmits a stable Stripe `Idempotency-Key`.
- A unique verification group owns the PaymentIntent for one provider mode/account and exact Session-bound reservation allocation. Replays must match every field and per-reservation amount.
- Paid rows and ownership commit before Clock fulfillment without success hooks; centralized confirmation and hooks occur only after Clock fulfillment succeeds when Clock is required.
- Clock-backed completion persists verified-payment evidence before fulfillment and uses an exclusive owner-token lease. Runtime concurrency behavior remains to be certified.

### Error handling and reconciliation

Failed or expired sessions move pending reservations through the explicit failure/expiry lifecycle. A successful browser return still triggers a provider reread. Provider request logs store sanitized summaries, status, duration, correlation, and error data. Fee snapshot capture and refund reconciliation remain separate from reservation confirmation.

### Unknowns

Production keys, selected webhook events, account/currency configuration, callback reachability, provider fee availability, and current production acceptance were not inspected.

## PokPay

### Purpose and source owners

PokPay provides SDK-order checkout, provider-hosted confirmation URLs, server-side order verification, credential diagnostics, and refunds. Primary owners are the same payment engine/gateway/refund services as Stripe.

### Authentication and configuration

Logical settings include PokPay enablement; environment-specific merchant ID, key ID, key secret, API base; checkout mode; fee defaults; active environment; currency; and callback base.

The plugin authenticates through the provider SDK login, caches the bearer token, and can refresh once after an authentication failure. Populated credential fields are `unverified` until an authenticated, environment-specific check succeeds.

### Identifiers and verification

- The SDK-order ID is saved as the pending transaction/provider reference.
- Each SDK order is durably bound to one exact payment-row allocation, checkout mode, expiry, versioned booking snapshot, explicit site environment, credential fingerprint, and Clock target when required. For Clock-backed exact-room attempts, the snapshot includes the local type/physical allocation, stay, guests, amount, rate plan, and normalized physical-room, accommodation/type, and rate external IDs.
- The order is also bound to the configured PokPay environment and merchant/key fingerprint used for the authoritative reread.
- Finalization rereads the order and accepts captured/paid/completed provider state only when order, local reservation allocation, amount, and currency match.
- Redirect/fail/webhook URLs are generated server-side.
- Checkout URLs are restricted to approved HTTPS PokPay/RPay host families.
- Refunds use the merchant SDK-order refund path and require completed provider evidence; ambiguous results become manual review.

### Retry and idempotency

- Token authentication may retry once after refreshing credentials.
- A webhook does not trust its body as paid evidence; it locates the known order and rereads the provider.
- Immutable ownership rejects reuse of the order/payment for another reservation set, amount, currency, environment, account, or allocation.
- SDK-order creation and refund requests store local correlation/idempotency data but do not transmit a provider idempotency key in current code.

### Current risks and unknowns

- `PokPayPayment::validatePayment()` can run an external authentication probe when credential state is unverified. Because gateway validation is reachable while rendering a public checkout/confirmation flow, a public request can trigger an external credential probe. Credential verification should be an explicit administrative/operational action.
- The webhook has no separately verified local shared secret; safety depends on provider reread and binding.
- Current provider contract, webhook authenticity features, rate limits, production account behavior, and refund idempotency support are unverified.
- Confirmation return parameters are transport hints only. Success/finalize mutation requires the authorized reservation set plus stored-order binding; failure/cancel hints do not mutate local state.

## Clock PMS

### Purpose and source owners

Clock supplies live catalog/availability/rate/reservation data in Clock mode, accepts supported booking/cancellation/amendment writes, sends reservation events, and holds downstream folio accounting. Code is isolated primarily under `src/Provider/Clock/`, with provider interfaces/selection under `src/Provider/`.

### Provider selection and fallback

`ProviderManager` registers `local` and `clock` modes. When Clock is configured but not booking-ready and local fallback is disabled, the Clock mode remains visible as unavailable rather than silently changing ownership. Enabling `fallback_to_local_when_clock_unavailable` can use local data during provider failure and creates a split-brain inventory risk.

### Authentication and configuration

Clock uses configured API type, regional/subscription/account identifiers, endpoint templates/base URLs, API user/key, inbound path/auth values, room/rate mappings, sync toggles/intervals, timeout/cache/rate-limit values, and accounting mode. Secret values must remain in WordPress settings only.

For payment fulfilment, the stable configured target fingerprint uses the finite Clock environment, API type and resolved base endpoint plus region, subscription, account, property and WBE hotel identifiers; it deliberately excludes API secrets. An administrator must approve the current target separately for each site environment, and any target change blocks new/replayed Clock-backed payment completion until re-approved.

Outbound API calls use an HTTP Digest challenge flow with one safe nonce refresh after an authenticated `401`. `ClockEndpointResolver` constructs regional/account URLs or validates configured base/template paths. Bases and absolute overrides must use HTTPS and stay inside the configured API-type base; redirects are disabled.

### Outbound behavior

- `ClockApiClient` sends a correlation header and records sanitized request/response summaries.
- Safe GET operations can retry once after HTTP 429 and can use bounded request/transient caches.
- The client serializes shared WordPress worker slots and throttles below Clock's documented limit of five calls per second per API user. Without `Retry-After`, a 429 waits `retry counter × 500ms`; retries remain bounded.
- Clock documents automatic retry only for `429`. Other 4xx/5xx responses are not auto-retried, and timeout-after-write is ambiguous.
- Final availability/quote/guarantee checks explicitly bypass caches.
- `rates_availability` is queried with sorted `rates[]`, sorted parent `room_types[]`, and `adults`; it establishes only type/rate sellability. Missing occupied dates, non-Boolean or false `free`, errors, stop-sale, or contradictory arrival/departure restrictions do not pass.
- `room_statuses` is queried from check-in through checkout-minus-one-day, both inclusive. A single-type/final check supplies the singular `room_type_id`; a mixed-type search makes one unfiltered request and discards non-candidate groups locally. The exact physical mapping must have a Boolean `available=true` row under its mapped parent type.
- Intermediate rate availability can cache for 45 seconds and room status for 15 seconds. Final checkout and paid fulfilment bypass both layers. Missing rows, malformed/conflicting responses, transport failures, and incomplete mappings are provider-unconfirmed; explicit `free=false` or `available=false` is confirmed unavailable.
- The disabled-date calendar remains advisory type/rate data plus local exact-room conflicts. It does not issue a 180-day physical-room status scan, and an apparently open range cannot continue without a selected-range `room_statuses` check.
- Exact-room creation requires room-type, physical-room, and rate mapping. Fulfilment requires all three current external IDs to match the saved attempt-time snapshots, then sends the type as `arrival_room_type_id` and the physical room as `arrival_room_id`; a different returned room is not accepted as substitution.
- Cancellation and amendment paths verify provider state after writes. Only a `429` is queued automatically; network/5xx ambiguity is reread immediately and otherwise requires manual review.
- Local idempotency keys are logged, but a general provider idempotency header is not transmitted.

### Inbound Clock and AWS SNS

`POST /clock/webhook` supports official AWS SNS delivery:

- restrict certificate URLs to safe Amazon SNS hosts/schemes;
- verify the SNS signature and signed fields;
- require either an exact configured SNS `TopicArn` match or complete HTTP Basic authentication, preventing another valid AWS SNS topic from becoming a trusted Clock sender;
- handle subscription confirmation through a safe URL request;
- use `MessageId`/body keys, locks, and request logs for deduplication;
- return retryable failure when provider fetch or durable local mirror application fails.

Complete Basic credentials can bind the endpoint when the Clock topic ARN is unavailable; otherwise the exact SNS topic must be pinned. Legacy Bearer/HMAC header verification remains for configured non-SNS senders. Missing mappings enqueue a booking-upsert job; they must not invent provider identity.

### Scheduling and rate limits

| Work | Hook | Current purpose |
|---|---|---|
| Full catalog | `must_hotel_booking_clock_full_catalog_sync` | Daily provider catalog refresh while preserving local presentation |
| Availability/rates | `must_hotel_booking_clock_availability_rate_sync` | Frequent display/cache refresh; never final booking authority |
| Reservation fallback | `must_hotel_booking_clock_reservation_fallback_sync` | Bounded polling when webhook convergence needs repair |
| Provider job runner | `must_hotel_booking_process_provider_sync_jobs` | Bounded retry/reconciliation/accounting/amendment work |

Defaults evidenced in code/settings are daily catalog, 15-minute availability/rate, and five-minute reservation fallback with small batches, but saved installations can retain different values. All schedules depend on functional WP-Cron or an external system trigger.

### Folio accounting

Website gateway money is synchronized separately from provider reservation creation. Eligible future payments use an open deposit folio; the standard folio must remain unchanged. Payment/refund accounting uses local accounting rows and provider jobs to correlate folio and credit-item operations.

Missing rights, ambiguous folio/item identity, transferred/applied/closed folios, accommodation-charge cleanup, cancellation-fee posting, and uncertain balance evidence remain manual-review boundaries. Clock booking-header balance is never gateway payment proof. See [ADR-0003](decisions/ADR-0003-clock-deposit-and-manual-accounting-boundaries.md).

### Current risks and unknowns

- Verified-payment evidence is durably stored before the Clock write, then an owner-token lease serializes fulfillment.
- Active claims return `in_progress`; expired claims, ambiguous responses, and Clock-success/local-persistence failures require Clock reread and manual review before any new create.
- Multi-room fulfillment can partially succeed, but completed reservation IDs are retained and the group is not presented as complete success.
- Current authoritative endpoints/rights, provider idempotency support, rate limits, production mappings, and webhook reachability were not externally verified.
- Historical Postman and sandbox evidence is dated evidence, not a current production contract.

## Elementor

The plugin registers Booking Search, Rooms List, and Rooms Text Grid widgets through Elementor hooks. Uppercase class files and lowercase registration/asset files are complementary and must not be classified as duplicates without a call/registration analysis.

Widgets check Elementor availability before registration and reuse plugin-managed booking routes and assets. Elementor may supply global colors/typography when enabled, but it does not own lifecycle rules. Active Elementor/theme versions, production widget usage, and rendered compatibility were not verified.

## Email

`EmailEngine` builds configured guest/admin lifecycle messages and passes them to `wp_mail()`. Automated confirmation email listens only to the committed confirmation hook and rechecks durable confirmation eligibility; reservation creation and paid evidence are not email authority. Logical settings include sender name/address, reply-to, layout, logo, colors, footer, template enablement, and content. A successful `wp_mail()` call is only handoff evidence. Failures are logged through activity/diagnostic paths; no durable outbound email retry queue was found.

## GitHub updater

`src/Core/Updater.php` wraps the bundled Plugin Update Checker. Repository/branch/slug/optional token/enablement and release-asset rules are constants in `must-hotel-booking.php`.

- Plugin header/version constant and `readme.txt` stable tag must match.
- Release assets use `must-hotel-booking-X.Y.Z.zip`.
- Public release discovery needs no token; private access requires a protected token.
- The current Linux-compatible package workflow is part of the updater contract.

Repository inspection does not prove package provenance, production reachability, successful installation, or rollback readiness.

## Logging, redaction, and retention

Provider request logs record provider, operation, direction, correlation/idempotency keys, target IDs, sanitized summaries, status, duration, and sanitized errors. Preserve recursive redaction when adding fields. Never store raw authorization material, secret settings, complete guest payloads, or unmasked provider bodies.

A clear retention/pruning policy for provider and activity logs was not found. Establish one before assuming long-term audit evidence or storage bounds.

## Production safety gate

External verification requires explicit approval, a named non-production or production target, backup/rollback readiness, masked evidence collection, known expected records, and a stop condition. Do not infer authorization from the existence of configured credentials.

Payment, email, and portal paths use PHP 7.4-compatible string checks. The declared PHP 7.4 baseline is now covered by source lint; the production runtime should still be tested during deployment.
