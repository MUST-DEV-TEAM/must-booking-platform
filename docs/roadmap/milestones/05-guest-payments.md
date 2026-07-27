# Milestone 5: Guest Payments

Status: Not started
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

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
