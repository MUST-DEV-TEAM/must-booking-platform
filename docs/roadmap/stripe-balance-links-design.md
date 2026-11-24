# Stripe balance links (G-44) and multi-room payment links (G-47): design

Status: **G-44 built 2026-11-24** (first version, below); **G-47 built 2026-11-24** (second PR, on top of G-44). Owner chose to build both (popup 2026-11-24).

## The problem

Staff "pay your balance" links, their reminders and their completion work only with PokPay (`payment-collection.service.ts`). A hotel that takes cards through Stripe cannot send one. Worse, today a paid Stripe event for a booking that is already `CONFIRMED` is treated as a late or duplicate payment and **refunded automatically**, so a Stripe balance payment would be paid and then given back.

Multi-room orders (G-47) have no balance link at all: `start()` refuses a booking that belongs to an order ("Collect shared-order payments through the original order checkout").

## What exists and is reused

- `integration_operations` row of kind `balance_collection` with stages `PREPARING`, `READY`, `UNCERTAIN`, `EXPIRED`, created under a booking lock; the provider call happens outside the lock.
- The signed durable link and `openRequestLink` used for accepted on-request bookings (PR #588): a link on the hotel's own site that creates a fresh provider session on click, so the emailed link does not die when the provider session does. Stripe sessions live at most 24 hours; the balance link is valid 7 days.
- `PaymentProviderRegistry.forBookingMethod`, the Stripe provider (`createCheckoutSession`, `expireCheckout`), `payment_provider_sessions`.
- The Clock financial verification (`financial.refresh`) that gates a balance on a Clock-managed booking.

## Design

### Slice 1: pick the provider and create the link (G-44)
1. `options()` reports `stripe` and `pokpay` separately: each needs its switch on, an enabled connected PAYMENT connection (same rule as `payment-method-availability.ts`), and the existing financial readiness.
2. `start()` takes the provider (`stripe` or `pokpay`); default is the hotel's default card method (S7b order setting). The operation result stores `provider`.
3. The staff link is the durable site link, not the raw provider URL. Clicking it runs the same code as `openRequestLink` for a balance operation: reserve a provider session for the **current** balance, close the previous Stripe session, return the checkout URL. PokPay links keep working as today (7 days) until the same path is proven, then can move to it.
4. Amount, currency and the "balance changed, needs review" refusal stay exactly as they are.

### Slice 2: completion (the part that is easy to get wrong)
1. Stripe `checkout.session.completed` looks up `payment_provider_sessions`; when the session belongs to a `balance_collection` operation it **records a CHARGE** against the confirmed booking (as `process()` does for PokPay), marks the operation done, posts to Clock through the existing financial sync, and sends the receipt. It must never reach the "late payment, refund it" branch.
2. Idempotency key: the Stripe event id plus the session id; a replay is a no-op.
3. A balance session that completes after the booking was cancelled follows the existing late-payment flow (refund), as for PokPay.

### Slice 3: reminders
`sendDueReminders` reads the stored URL for PokPay. For Stripe the reminder carries the durable site link, so it is valid whenever clicked. Same idempotency keys.

### G-47: multi-room orders
The order's balance is the sum over its rooms. One operation per **order** (aggregate id = the anchor booking), one provider session for the order total; on completion the CHARGE is recorded on the anchor booking (same convention as the order's original checkout, `payment_provider_sessions` already points at the anchor), and refunds keep using the existing order refund path. Per-room partial balances are out of scope.

## Tests needed before merge
- Stripe balance link: create, open twice (second open closes the first session), pay, replay of the webhook, pay after cancellation (refund), amount changed since the link was sent (refused).
- No regression for PokPay links and for the on-request flow (shared durable-link code).
- Order link: two rooms, one session, one CHARGE on the anchor, partial refund afterwards.
- A **live Stripe test-mode run** on the Must Hotel sandbox (Stripe CLI webhook), because mocks cannot show Stripe's real expiry and event order. Needs the owner's `stripe login` once for local webhooks.

## Risks
- Money moves on a confirmed booking: the completion branch is the highest-risk code and gets its own review.
- Clock-managed bookings: the amount comes from the verified Clock balance; Clock sandbox is expired, so that path cannot be proven end to end yet.

## Open decisions for the owner
1. Should PokPay balance links also move to the durable site link (one code path), or stay as they are? Recommended: move later, after Stripe is proven.
2. A balance link for a booking that is still `PAYMENT_PENDING`: out of scope (only confirmed bookings), as today.

## What was built for G-44 (first version)

- `stripe-balance-collection.service.ts` sits **beside** the PokPay flow and shares none of its saved attempts (its own operation kind `balance_collection_stripe`), so PokPay behaves exactly as before.
- API: `POST .../bookings/:id/collect-stripe`, `POST .../send-stripe-link`; `collection-options` also answers `stripe`; `check-collection` reads a Stripe attempt's saved state.
- The Stripe webhook calls `complete()` first: a paid session of a **confirmed** booking's Stripe balance link is recorded as a CHARGE (once), the attempt is closed, Clock gets the deposit when the balance came from a verified Clock bill, and the receipt emails go out. Anything else (a booking no longer confirmed) falls through to the existing late-payment refund.
- Dashboard: a hotel with only Stripe connected gets the same buttons for Stripe; a hotel with both keeps PokPay (unchanged).
- **Known limits of this version:** the link lasts the hotel's days but never more than 24 hours (Stripe's limit), so reminders and the staff expiry notice (S7b-4) do not cover Stripe links yet; the durable site link (slice 1.3 above) is the next step. Stripe is test-mode only in this system today (`isStripeTestKey`), so nothing here moves real money until that changes.
- **Not run live:** tests use a fake Stripe provider; a Stripe test-mode run with the Stripe CLI is still needed.

## What was built for G-47

- A room of a multi-room order is paid **as one order, through Stripe**, from either room: `anchorOf()` sends the request to the order's first room (where the order's payment lives), the amount is the sum of every room's total minus what the order has paid, and the payment is recorded on the first room. One saved attempt and one Stripe session per order; asking again from the other room returns the same open link.
- Allowed only when **every room is confirmed and none is held in Clock** (each Clock reservation has its own bill); otherwise the API refuses with that reason and the dashboard shows nothing.
- `collection-options` answers `orderBalance` for a room of an order; the dashboard shows "Balance to collect for the whole order" and the Stripe buttons, and hides PokPay for orders.
- **Not built:** PokPay links for orders, per-room partial balances, Clock-held orders.
