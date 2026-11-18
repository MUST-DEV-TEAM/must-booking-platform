# Stripe hardening plan (2026-11-17)

Review of the merged Stripe integration (PR #516, #525, ADR-0041, ADR-0042) against Stripe's documented practice. Gap numbers refer to [hardening-gaps-log.md](../audit/hardening-gaps-log.md); background in [stripe-handoff-2026-11-17.md](../audit/stripe-handoff-2026-11-17.md).

Main files: `apps/api/src/payments/stripe-payment.provider.ts`, `stripe-webhook.controller.ts`, `stripe-webhook.service.ts`, `stripe-checkout-closer.service.ts`, `stripe-connection-tester.ts`, `payment-refund.service.ts`, `payment-expiry.service.ts`.

## What is already right

Checkout Sessions (Stripe's recommended API) with dynamic payment methods, a signature check on every webhook, fulfilment on both `checkout.session.completed` and `checkout.session.async_payment_succeeded` gated on `payment_status`, one webhook secret per hotel, the tenant taken from the verifying connection (not from metadata), idempotency keys on session create and refunds, refunds through the account that took the payment, each currency's own decimals, local-currency conversion off, live keys refused until go-live, a late payment for an ended booking refunded in full.

## Owner decision first (blocks S12 only)

**D1. Stripe Connect or pasted hotel keys, before any real hotel goes live.** Today each hotel pastes its secret key and webhook secret into MUST. For a SaaS platform whose customers run their own businesses, Stripe recommends Connect: Accounts v2, `dashboard: "full"`, `fees_collector: "stripe"`, `losses_collector: "stripe"`, direct charges (the hotel stays merchant of record and pays its own Stripe fees). Gains: MUST stores no hotel secret keys, one platform webhook endpoint for all hotels (G-36 disappears), Stripe-hosted onboarding, Stripe owns dispute and negative-balance liability on these accounts, an optional platform fee later. Cost: a MUST platform Stripe account, an onboarding screen, moving the Must Hotel test connection. Guest money still goes to the hotel's account, so billing separation (AGENTS.md) holds.
**Recommendation: Connect.** S1 to S11 are needed either way and should go first. If the owner keeps pasted keys, S12 becomes "accept only restricted keys (`rk_`) for live, with the permission list shown in the form".

## Findings, ranked

| ID | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| S1 | High | No Stripe reconciliation. If the webhook never arrives (secret not pasted, endpoint down, wrong secret), the guest is charged, the booking expires after the hold, and the closer then "closes" the paid session (Stripe answers 400, read as closed). Money taken, no booking, nobody told. PokPay has a poll sweep; Stripe has none. | `payment-expiry.service.ts` calls `pokpay.pollPendingOrders()` only; `expireCheckout` treats 400 as closed |
| S2 | High | Refund lifecycle is not followed. A refund Stripe returns as `pending` (or held by an approval rule, G-40) is saved as `REFUND_PENDING` and never moved on. A refund that later fails, or one made in the Stripe dashboard, never reaches the ledger or Clock. | `payment-refund.service.ts:577`; no `refund.*` or `charge.refunded` handling anywhere |
| S3 | High | Disputes (chargebacks) are not handled. The hotel is not told, the booking shows nothing, and the response deadline passes unseen. | no `charge.dispute.*` handling |
| S4 | High | The charged amount is never checked. The webhook writes the booking's total, not what Stripe charged (`amount_total`, `currency`). A price change between session and payment, or a currency mismatch, goes into the ledger silently wrong. | `stripe-webhook.service.ts` inserts `booking.totalAmount` |
| S5 | High | The webhook does slow work inside Stripe's request: a 45-second database transaction with Clock calls, holding row locks. Stripe expects a fast 2xx and retries on timeout. An unknown booking answers 500 and Stripe retries for days (G-30). | `timeoutMs: 45_000`; controller throws `InternalServerErrorException` |
| S6 | Medium | Webhook setup is manual (G-36). A hotel that forgets the signing secret takes payments that never confirm, and the connection still shows as enabled. | handoff, "Still open" 1 |
| S7 | Medium | The Stripe page stays open 24 hours (Stripe's default) while the room is held 30 minutes. Only the one-minute closer prevents paying a dead booking. | no `expires_at` in `checkout.sessions.create` |
| S8 | Medium | Delayed payment methods are not excluded. If a hotel turns on SEPA Direct Debit or similar in its Stripe dashboard, the session completes `unpaid`, the hold expires, and days later the money arrives and is auto-refunded. `async_payment_failed` and `checkout.session.expired` are ignored. | event filter in `verifyWebhookEvent` |
| S9 | Medium | Stripe client set-up: API version not pinned, no network retries, no timeout, no app info, SDK 22.x (23.0.0 is current), a new client on every call. | `new Stripe(secretKey)` throughout |
| S10 | Medium | The fee conversion uses floating point (AGENTS.md: never floats for money), and a fee that is not ready yet gives a silent full refund (G-33). | `getPaymentFee`: `settlement.fee / 10 ** ...`, `/ exchange_rate` |
| S11 | Low | What the guest sees is weak: product "Hotel booking <uuid>", no email prefill, no locale, no statement descriptor; the card statement does not name the hotel stay. | `product_data: { name: \`Hotel booking ${bookingId}\` }` |
| S12 | Low now, High at go-live | Keys: full secret keys (`sk_`) accepted; Stripe recommends restricted keys. Superseded by D1 if Connect is chosen. | `isStripeTestKey` allows `sk_test_` and `rk_test_` |
| S13 | Low | Webhook hygiene: `event.livemode` is not compared with the connection's mode; the controller fakes a property id; a platform-wide `STRIPE_SECRET_KEY` health check is left over. | `stripe-webhook.controller.ts`, `checkHealth()` |

## Tasks for Sonnet (in this order, one PR each)

Rules for every task: follow AGENTS.md; no live Stripe calls, only the sandbox ("MUST sandbox", `C:/Users/devim/.config/must/secrets/stripe-sandbox.env`) and `stripe listen`; tests on the Must Hotel tenant only; run `pnpm -w lint`, `pnpm --filter api test` (full, not a subset), `tsc -p tsconfig.build.json`; update the gaps log line the task closes.

### T1 (S5, G-30). Webhook inbox: verify, store, answer 200, process in the background
- New table `stripe_webhook_events` (tenant_id, connection_id, event_id unique per tenant, type, livemode, payload jsonb, status `RECEIVED|PROCESSED|IGNORED|FAILED`, attempts, last_error, timestamps), RLS on, additive migration.
- Controller: verify signature, insert with `ON CONFLICT DO NOTHING`, return 200. No Clock or booking work in the request.
- Worker: reuse the existing sweep pattern (the payment expiry sweep runs every minute); process `RECEIVED` rows with backoff; `processPaymentSucceeded` keeps its own transaction.
- Unknown booking or tenant mismatch: `IGNORED` with a reason and an operator alert, never 500.
- Done when: a signed event for an unknown booking returns 200 and is stored as IGNORED; a duplicate event id is stored once; payment confirmation still works end to end with `stripe listen`.

### T2 (S1). Stripe reconciliation sweep
- Before a Stripe `PAYMENT_PENDING` booking expires, and for every open Stripe session past half its hold, retrieve the Checkout Session. `payment_status = paid`: run the same path as the webhook (through the T1 inbox, event id `reconcile:<session id>`). `expired` or `open` past the hold: expire as today.
- In `expireCheckout`, a 400 on a session that is `complete` must not count as closed without first recording the payment.
- Done when: with the webhook switched off in the sandbox, a paid booking is confirmed by the sweep within two minutes and never expired.

### T3 (S2, G-40). Follow every refund to its end
- Handle `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded` through the inbox.
- `REFUND_PENDING` moves to `REFUNDED` or `REFUND_FAILED`; Clock is posted only when the refund succeeds; a failed refund raises a review item and tells staff.
- A refund made directly in the Stripe dashboard (no MUST refund record) is recorded as a refund with source `stripe_dashboard` and a review item; Clock posting for it is a staff action, not automatic.
- Safety sweep: `REFUND_PENDING` older than 15 minutes is re-read from Stripe.
- Done when: a sandbox refund under an approval rule shows "pending approval", then becomes refunded after approval in the dashboard, with Clock posted once.

### T4 (S3). Disputes
- Handle `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`. Store each dispute (amount, reason, status, `evidence_details.due_by`) against the payment; show it on the booking and on the Payments page; email the hotel's payment recipients; review item with the deadline.
- The hotel answers in its own Stripe dashboard (link to it); MUST does not submit evidence in this version.
- Done when: a sandbox dispute (test card for disputes, `stripe:test-cards`) appears on the booking and in the notification, and closing it updates the status.

### T5 (S4). Check the amount Stripe actually charged
- Add `amountTotal` (minor units) and `currency` to the verified event. Compare with the expected booking total in minor units.
- Equal: as today. Different: record the payment at the charged amount, do not auto-confirm silently, raise a review item "charged amount differs from booking total".
- Done when: a unit test with a mismatched `amount_total` records the charged amount and creates the review item.

### T6 (S7, S8). Session lifetime and payment methods
- `expires_at`: now + max(property hold minutes, 30) minutes (Stripe's minimum is 30 minutes, maximum 24 hours).
- Exclude delayed-notification methods with `excluded_payment_method_types` (never `payment_method_types`). Check Stripe's current docs for the exact list before coding and write it in a code comment with the doc link.
- Handle `checkout.session.expired` (release the hold early) and `checkout.session.async_payment_failed` (fail the booking, release the hold).
- Done when: a sandbox session shows the shorter expiry; an expired event releases the hold before the sweep.

### T7 (S9). One Stripe client factory and SDK upgrade
- `stripe-client.ts`: `new Stripe(key, { apiVersion: <pinned>, maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: 'MUST Booking' } })`. Every call goes through it. Retries are safe only with idempotency keys: add keys to `expire` and to webhook endpoint creation.
- Upgrade the SDK to 23.x and pin the API version in the same PR, following Stripe's upgrade notes (`stripe:upgrade-stripe`). Check `ui_mode` values and `unit_amount_decimal` against the new types.
- Done when: all Stripe specs pass, and one sandbox payment plus one refund work on the pinned version.

### T8 (S10, G-33). Fee in exact arithmetic
- Rewrite `getPaymentFee` with decimal strings or integer minor units (use the repo's existing decimal helper; no `/` on numbers).
- Fee not available yet: retry once at refund time; still missing, refund in full and write a visible note on the refund ("fee could not be read, refunded in full") plus an audit entry.
- Done when: unit tests cover same-currency, cross-currency, zero-decimal and missing-fee cases with exact strings.

### T9 (S6, G-36). Automatic webhook set-up (skip if D1 = Connect; T12 replaces it)
- When a Stripe connection is saved, create the endpoint with the hotel's key (`webhookEndpoints.create`, url `/webhooks/stripe/<webhookPublicId>`, the event list from T1 to T6) and store the returned secret. Delete it when the connection is removed.
- A Stripe connection without a webhook secret is "Incomplete" and cannot be enabled for guests.
- Done when: a new sandbox connection receives events without pasting anything.

### T10 (S11). What the guest sees
- Product name `<hotel name> · <check-in> to <check-out>`; `customer_email`; `locale` from the booking language (else `auto`); `payment_intent_data.description` with the MUST booking reference; optional `statement_descriptor_suffix` from a new hotel setting (max 22 characters, validated).
- Done when: the sandbox Checkout page and the test receipt show the hotel and dates.

### T11 (S13). Webhook hygiene
- Refuse an event whose `livemode` differs from the connection's mode (store as IGNORED).
- Give `verifyWebhookEvent` an explicit Stripe context type; remove the fake property id.
- Remove or rewrite the platform `STRIPE_SECRET_KEY` health check (per-connection health already exists in the tester).

### T12 (D1). Only after the owner chooses
- Connect chosen: write the ADR, then build Accounts v2 onboarding (Stripe-hosted), direct charges with the `Stripe-Account` header, one platform webhook for connected-account events, capability check (`configuration.merchant.capabilities.card_payments.status === 'active'`) before showing Stripe to guests, migration of Must Hotel.
- Keys kept: accept `rk_` only for live; show the minimum permissions in the form (Checkout Sessions write, Refunds write, Webhook Endpoints write, Charges and Payment Intents read, Balance and Balance Transactions read; check names against Stripe's key permission list).

## Before the first real hotel (checklist, not code)
- Owner's booking terms wording on cancellation and the fee (consumer-law check, see the refund-net-of-commission note).
- Not yet tested: the in-page popup with a publishable key (G-37), Stripe and PokPay on one hotel (G-34), a payment in lek (G-32), an over-refund attempt.
- Stripe's go-live checklist: https://docs.stripe.com/get-started/checklist/go-live
- Content-Security-Policy on the WordPress plugin pages that load Stripe's popup includes `https://*.stripe.com` in `script-src`, `frame-src`, `connect-src`.
