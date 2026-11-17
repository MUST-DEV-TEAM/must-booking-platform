# Stripe integration: state and handoff for analysis (2026-11-17)

Written for Fable, to analyse the Stripe work end to end. Everything here was verified in this session unless it says "not verified". Gap numbers refer to [hardening-gaps-log.md](hardening-gaps-log.md).

## Where it stands

Stripe is built, merged to main and deployed, as a second payment method next to PokPay. It is not live for any real hotel: live Stripe keys are still refused on purpose (ADR-0041), and only the sandbox hotel "Must Hotel" has a Stripe connection.

| Piece | Where | State |
| --- | --- | --- |
| Stripe as a payment method, webhook per hotel, account recorded on each payment, test and live keys, settings card, in-page popup code, refunds through the account that took the payment, TEST labels | PR #516, [ADR-0041](../decisions/ADR-0041-payment-accounts-test-and-live.md), milestones [36](../roadmap/milestones/36-multiple-payment-methods.md) and [37](../roadmap/milestones/37-stripe-payments.md) | Merged and deployed 2026-11-17 |
| Hotel's own currency, closing ended checkouts, fee kept on a guest's cancellation | [ADR-0042](../decisions/ADR-0042-stripe-payments-currency-closing-and-refund-fee.md) | Merged |
| Staff "keep the payment fee" tickbox, each currency's own decimals, Stripe's refusal reason logged and shown | PR #516 (last commits) | Merged |
| Clock hotel choice "Where Clock records a website payment" (deposit folio default, or the booking's own folio) | PR #525, migration `20261117120000_clock_payment_folio` | Merged and deployed |

## How it behaves (the rules)

- Guest cancels inside the free period: automatic refund to the same card. After the free period: the request goes to staff, who choose the amount.
- Fee: on a guest-decided cancellation the provider's fee is kept back (hotel setting, on by default, each hotel can turn it off). When the hotel cancels, the guest is refunded in full. A staff refund from Payments refunds exactly what is entered, unless staff tick "Keep the payment fee". The hotel's booking terms must say so (the owner writes the wording).
- A staff percentage means a share of what can still be refunded, not of the original payment (25% after a 100 refund of 400 is 75).
- Several refunds on one payment work. Not run: a refund larger than the payment (the code checks it; there is no live proof).
- Clock hotels: a website payment goes on a deposit folio (reception converts it to an advance invoice) or, if the hotel chooses, on the booking's own folio (nothing to convert, but no advance invoice). Empire needs the deposit way. A 403 on the main folio falls back to the deposit folio. A replay is found on any folio.

## Evidence

- CI: green on the merged code of #516 and #525 (API shards, browser, web, Clock staging tests, build and lint). The Clock staging tests run against the real Clock sandbox, including a Stripe-labelled payment on each folio choice.
- Local, real Stripe sandbox plus real Clock sandbox: a real card payment, the webhook through the Stripe CLI, booking confirmed, Clock deposit, refunds of 100.00, 75.00 (25% of the rest), 200.00, 1.00 mirrored in Clock; and on the main folio, a 400.00 payment with refunds of 100.00 and 150.00.
- Live server, Must Hotel (the sandbox hotel; tenant `fdb9f701-510e-4deb-857b-08a87fcdfbcc`): a guest booking paid with a Stripe test card, booking CONFIRMED by the real webhook, Clock reservation `39436270`, payment on an open deposit folio labelled "Stripe" with the note "TEST PAYMENT, not real money", confirmation email received. A staff refund of 100.00 with the fee kept refunded 96.77 (fee share 3.23), recorded in the audit log, posted as a negative payment in Clock, and succeeded in Stripe.
- Read-only look at Empire's Clock folios (June bookings): a converted deposit is a closed deposit folio with an invoice number, a net and VAT split, counted as revenue. A payment on the main folio issues none.

## Changes made outside the app's audit log (owner's explicit say-so)

- On the live server, over SSH: a Stripe connection for Must Hotel, switched on for that property, its test status set after a real balance check; a named test staff user "Claude Test staff (AI)" (admin of that tenant only). A matching webhook endpoint was created in the "MUST sandbox" Stripe account through Stripe's API.
- On the developer PC (not in the repo): protected files for the Clock sandbox login, the local encryption key and the test staff login, under `C:/Users/devim/.config/must/secrets/`.

## Still open

1. Go-live: no real hotel has a Stripe connection. Each hotel needs its own keys and its own webhook, and the signing secret is pasted by hand in a second step with nothing to warn a hotel that forgets it (G-36). Live keys stay refused until Stripe is opened for real hotels.
2. Booking terms wording about cancellation and the fee: the owner's.
3. Not tested: the in-page popup (the sandbox has no publishable key; G-37), Stripe and PokPay switched on together for one hotel (G-34, the Clock-through-Stripe half is now done), a lek payment (G-32), a refund larger than the payment.
4. A paid event for an unknown booking answers 500 and Stripe retries for days (G-30). A fee that cannot be read gives a full refund and the hotel absorbs it silently (G-33). A Stripe account approval rule can hold every refund until an administrator approves it (G-40).
5. Main-folio choice: that hotel's Clock login must be allowed to post to the main folio (G-41); the accountant must accept no advance invoice (G-42); a refund on an already closed main folio is untested (G-43).
6. A flaky web test, `settings.test.tsx` on the developer PC (G-38).
7. The first refund attempts in the sandbox were blocked by a Stripe account approval rule that the owner then deactivated (G-40).

## Idea for later (not built)

An "AI assistant" account per property, like staff: scoped to one property, with the rights of a normal staff role plus a few AI-only rules, its own access token, an audit label, human approval above a refund limit, one switch to revoke. Owner's refinement 2026-11-17: per property (the sandbox hotel, or only Empire if Empire wants one), human-like permissions, plus special AI-only permissions.
