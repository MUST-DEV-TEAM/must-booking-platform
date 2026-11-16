# ADR-0042: Stripe payments: the hotel's own currency, closing ended checkouts, and who pays the fee on a guest's cancellation

Status: Accepted by the owner on 2026-11-16.

## Context

Stripe was added as a second payment method next to PokPay (Milestone 36). Tests against the owner's Stripe sandbox with real test payments showed three things that needed a decision:

- Stripe's page offered the guest to pay in a local currency (Albanian lek) with a 4% conversion fee. Our ledger, refunds and reports count the hotel's own currency, so a payment in another currency could be refunded with the wrong amount.
- A booking cancelled or expired before payment left Stripe's payment page open. A guest who still paid it was charged, and the webhook answered an error that Stripe retries for days while the money sat uncredited and unrefunded.
- Stripe keeps its processing fee when a payment is refunded. On a 400 euro payment the fee was 12.85 euro, so every refund cost the hotel that fee.

## Decision

- **The guest pays in the hotel's own currency.** Every Stripe checkout is created with Stripe's local-currency offer (adaptive pricing) switched off. The guest sees, pays and is refunded the same amount the ledger holds.
- **An ended booking closes its Stripe page.** The minute sweep expires the open Stripe session of every booking that is cancelled or expired (`payment_provider_sessions.checkout_closed_at` marks the ones done). If a guest still pays in the minute before that, the webhook records the payment and refunds it in full: a paid event the booking can no longer accept (expired, cancelled, already paid another way) is never left as an error.
- **A guest who decides to cancel bears the payment fee.** A hotel setting, "A guest who cancels pays the payment fee" (`properties.deduct_payment_fee_on_guest_refund`, off until the hotel turns it on), keeps back the provider's fee from a refund the guest asked for. It applies to: the automatic refund when the guest cancels inside the free window, a cancellation staff record as a guest request with the policy refund, and a guest's own request. It never applies when the hotel cancels: the guest is then refunded in full. The fee is shared by the part of the payment refunded (refunding all keeps the whole fee) and is read once from the provider per payment (`payment_provider_sessions.provider_fee_*`). If the fee cannot be read, the guest is refunded in full. Each time a fee is kept it is recorded in the audit log (`payment.refund_fee_kept`), and the guest's cancellation page shows the fee before they confirm.

## Consequences

- The setting is off by default because the hotel's booking terms must tell the guest before it is turned on (consumer-protection rules); the dashboard says so next to the switch. Turning it on in production is the hotel's decision.
- Stripe fees are in the account's settlement currency; for a payment in another currency the fee is converted back with Stripe's own exchange rate.
- Zero-decimal currencies (such as yen) are not handled by the refund code: amounts are assumed to have two decimals. A hotel in such a currency needs that fixed first.
- Disabling the local-currency offer removes a convenience for guests who would rather pay in lek; it can be revisited with the currency milestone.

## Alternatives considered

- Keep the local-currency offer and convert refunds: more moving parts and a 4% fee for the guest; rejected for now.
- Close the Stripe page inside every cancel and expiry code path: several places, easy to miss one; a sweep covers all of them.
- Always keep the fee back, for every refund: rejected; a hotel-initiated cancellation is not the guest's decision.
