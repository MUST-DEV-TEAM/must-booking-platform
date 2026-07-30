# Milestone 5: Guest Payments

Status: In progress
Depends on: Milestone 4

## Goal

Guests can pay for a local booking via Stripe Checkout, with server-side verified payment status, a payment ledger, and refund support — kept structurally and physically separate from platform billing (Milestone 8), per `docs/PROJECT_CONTEXT.md`'s domain-separation rule. Done means: a real (test-mode) Stripe payment can move a booking from payment-pending to confirmed, verified server-side, not by trusting the browser return.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. `PaymentProvider` interface (distinct from `BillingProvider`, per `docs/ARCHITECTURE.md`).
2. `StripePaymentProvider`: Checkout session creation for a booking.
3. Stripe webhook handling: signature verification, idempotent event processing, server-side payment confirmation (never trust browser return, per the source brief's booking/payment integrity principle).
4. Payment ledger schema (`payments` table), immutable/append-only for verified events, NUMERIC/minor-units for money (source brief section 34).
5. Linking payment confirmation to the booking state machine (Milestone 4) — payment-pending → confirmed transition.
6. Refund flow: staff-initiated refund, Stripe refund API call, ledger update.
7. Pay-at-hotel opt-in flow (offline payment, explicit opt-in, per source brief section 2/19 pattern) as a second payment mode.
8. Payment/refund confirmation emails to guests.
9. Idempotency tests: duplicate webhook delivery, retried payment confirmation — must not double-confirm or double-refund.
10. Security review pass on the payment flow specifically (server-side verification, webhook signature checks, no secrets in frontend).

## Explicitly not included

- PokPay guest-payment integration (can be added later as a second `PaymentProvider` implementation, not scheduled in this milestone unless the owner requests it here).
- Platform/subscription billing (Milestone 8) — must not share code, tables, or ledger with this milestone's work.

## Kickoff decisions

Resolved at kickoff on 2026-07-30, before writing the task table below:

- **Refund policy**: [ADR-0018](../../decisions/ADR-0018-refund-policy-from-cancellation-snapshot.md) — `cancellation_is_free: true` (Milestone 4's Task 9 snapshot) triggers an automatic full refund; `false` triggers none automatically, with staff able to override manually either way.
- **Reservation timing vs. payment**: [ADR-0019](../../decisions/ADR-0019-reserve-then-expire-payment-pending.md) — inventory reserves immediately when a booking enters `PAYMENT_PENDING`; an expiry sweep releases abandoned `PAYMENT_PENDING` bookings into `EXPIRED` after a timeout.
- **Money representation**: the `payments` ledger uses `NUMERIC(12,2)` decimal-string amounts, matching `bookings.total_amount`/`rate_rules.amount` already established in Milestones 3–4, not integer minor-units — for consistency across the schema (the source brief's section 34 explicitly allows either).
- **Ledger shape**: append-only per the source brief's "immutable payment ledger" (section 34) — each event (charge succeeded, refund issued) is its own row, not a single mutable status field updated in place.

## Tasks

| # | Task | Acceptance criteria | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | `PaymentProvider` interface in `packages/domain-contracts` | New interface distinct from `PmsProvider`/`BillingProvider`: `createCheckoutSession(context, command)`, `verifyWebhookEvent(context, rawBody, signature)`, `refund(context, command)`, `getPayment(context, paymentId)`. Reuses the existing `Money` type (`amount: string`, `currency`) for consistency with `Booking.total`. Types only for this task — no runtime implementation yet, matching how Task 1 of Milestone 4 was scoped. | Not started | |
| 2 | `payments` ledger table | Tenant/property/booking-scoped, append-only: `id`, `booking_id`, `kind` (`CHARGE`/`REFUND`), `provider` (`stripe`), `external_payment_id` (Stripe session/payment-intent/refund ID, unique per tenant for webhook dedup), `status`, `amount` `NUMERIC(12,2)`, `currency`, `created_at`. No `updated_at`/mutable status column — a correction is a new row, not an edit. RLS per the established tenant/property pattern. | Not started | |
| 3 | `StripePaymentProvider.createCheckoutSession`, wired into `createBooking` per ADR-0019 | `createBooking` (`apps/api/src/booking/local-pms.provider.ts`) reserves inventory and transitions to `PAYMENT_PENDING` (replacing Milestone 4's synchronous `PAYMENT_NOT_REQUIRED` shortcut whenever payment is actually required), creates a Stripe test-mode Checkout session for the booking's total, and returns the booking plus a checkout URL. Booking creation no longer continues straight through to `CONFIRMED` in one call when payment is required. | Not started | |
| 4 | Stripe webhook endpoint | Public (unauthenticated, signature-verified — not `@PublicTenantScoped`'s guest-session model, since Stripe itself is the caller), verifies the `Stripe-Signature` header against the raw request body, never trusts the browser return. On `checkout.session.completed`/equivalent payment-succeeded event: records a `CHARGE` row in `payments`, then continues the booking through `PMS_CREATION_PENDING → PMS_CONFIRMATION_PENDING → CONFIRMED` using Task 4 of Milestone 4's existing transition helper. Deduplicates by Stripe event ID so redelivery doesn't double-process. | Not started | |
| 5 | `PAYMENT_PENDING` expiry sweep (ADR-0019) | A scheduled job (BullMQ, per `docs/ARCHITECTURE.md`) finds bookings still in `PAYMENT_PENDING` past a timeout (e.g. 30 minutes), transitions them to `EXPIRED`, and releases their reservation via Milestone 4's existing `releaseBookedUnits` path. Also handles the edge case ADR-0019 flags: a late webhook arriving for an already-expired booking must not silently double-process — decide and implement a specific resolution (e.g. reject and refund, or re-attempt reservation) rather than ignoring it. | Not started | |
| 6 | Refund flow: automatic (ADR-0018) + staff-initiated | `cancelBooking` checks for an associated `CHARGE` payment and, when `cancellation_is_free` is true, automatically calls `PaymentProvider.refund` and records a `REFUND` row in the same transaction/idempotency pattern as the rest of cancellation. A separate staff-only endpoint allows a manual refund (full or partial) regardless of policy, for exceptions. Both paths are idempotent — retrying a refund request must not double-refund. | Not started | |
| 7 | Pay-at-hotel opt-in | A second payment mode: guest explicitly opts in at booking time (no Stripe Checkout), booking transitions through `PAYMENT_NOT_REQUIRED` (Milestone 4's existing state) rather than `PAYMENT_PENDING`, and the booking/projection is tagged so staff can see payment is still owed in person. No new state — reuses `PAYMENT_NOT_REQUIRED`, just tagged with a payment-method marker. | Not started | |
| 8 | Payment/refund confirmation emails | Reuses the existing `MailProvider`/Resend integration (Milestones 2–3) to send a payment-confirmation email on `CONFIRMED` and a refund-confirmation email on a processed refund. Failure to send must not fail the underlying payment/refund operation (same safe-wrapper pattern Milestone 2 established for verification/welcome emails). | Not started | |
| 9 | Idempotency tests: duplicate webhooks, retried confirmation | Tests proving a duplicate Stripe webhook delivery (same event ID) does not double-confirm a booking or double-insert a `CHARGE` row, and a retried refund request (same idempotency key) does not double-refund. Run against real Postgres/Redis. | Not started | |
| 10 | Security review pass on the payment flow | Dedicated review of: webhook signature verification (valid, missing, and tampered-signature cases all tested), no Stripe secret key or webhook secret ever reachable from the frontend/WordPress, no raw card data touches MUST's backend (Stripe Checkout's hosted page handles it), and the guest-facing payment endpoints are correctly scoped by `@PublicTenantScoped`/the public webhook route, not accidentally staff-gated or accidentally open to cross-tenant access. | Not started | |
