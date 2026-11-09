# Milestone 36: Several payment methods per hotel, starting with Paysera (planning, not scheduled)

Status: **Brainstorming started 2026-11-09. Nothing is built. Items marked "suggestion" are not yet approved by the owner.**

## Why

Today a hotel can take card payments through one provider only: PokPay. The owner wants a hotel to offer **several payment methods at the same time** (like large booking sites do), because different methods suit different guests. Paysera is next; Stripe follows later ([Milestone 37](37-stripe-payments.md), recorded only).

## What the owner decided

1. A hotel can have **more than one payment method switched on at once** (for example PokPay and Paysera).
2. For each method, a hotel is on **either its test setup or its live setup, never both at once**.
3. **Switching test to live**, and **changing the credentials** of a method, must follow industry standard and good practice (safe, recorded, no lost payment history).
4. Stripe is planned as its own later milestone.
5. The branch `feat/pokpay-go-live-switch` (test-to-live switch for PokPay, no more leftover duplicate cards) is pushed only after this brainstorming is done, in case the owner wants small changes.

## What we found out (2026-11-09)

Source files are saved in [docs/integrations/paysera/](../../integrations/paysera/README.md).

- **Paysera Albania offers online card, bank and SMS payments for web shops** ([paysera.al payment gateway](https://www.paysera.al/v2/en-AL/payment-gateway-checkout)).
- Paysera has **two integration versions**. The newer one (OAuth2, "Checkout Modern") is the recommended one, but its documentation says it **currently covers Lithuania, Latvia, Estonia, Bulgaria, Kosovo and North Macedonia only**. **Albania is not on that list.** The older "Checkout Classic" (project id and password, signed links, callbacks) is the other path. **We must ask Paysera Albania which one an Albanian hotel gets before any design.**
- **Paysera and Stripe are not connected as far as we could find.** The owner's assumption was that they are; searches found no partnership, and Paysera's card rules do not name Stripe. This does not block anything: Stripe is a separate provider with its own account.
- The sandbox (test) setup of the modern version is mentioned by one source but is not in the pages we saved; the Classic version's test mode is also unconfirmed. To check with Paysera.

## Suggestions (not yet approved)

- **One connection per method per hotel**, each marked test or live. Moving from test to live is one confirmed, recorded step. Test never holds real money, so it needs no history check; live does.
- **A retired live method stays usable for refunds** on payments already taken, but not for new payments. This is what makes a later move from PokPay to Paysera safe.
- **Changing credentials** on the same account is its own action, verified before it replaces the old ones, with the old ones kept until the new ones pass.
- **Guests see only the methods the hotel turned on**; the hotel picks the order and which is the default.
- Build Paysera as a second provider next to PokPay, using the same shape (create payment, confirm by Paysera's own callback and a re-check, refund), so Stripe can be added the same way.

## Open questions

- Which Paysera integration (Modern or Classic) does Paysera Albania give us, and is there a test environment?
- Does Paysera Albania settle in lek (ALL) or euro, and how does that fit the hotel currency rules in [Milestone 29](29-currency.md)?
- Does Paysera refund through the API or only in its dashboard?
- Which hotels use Paysera first, and who opens the Paysera merchant account?

## Not in this milestone

Stripe (Milestone 37), the payment-method picker design on the public booking page (needs a design pass), per-guest method choice rules.
