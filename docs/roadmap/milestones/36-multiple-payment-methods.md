# Milestone 36: Several payment methods per hotel (PokPay finished first, then Stripe, then Paysera)

Status: **In progress. Order changed by the owner on 2026-11-12: finish PokPay to industry standard first, then Stripe; Paysera later (waiting on Paysera Albania's documents, asked 2026-11-10).** Step 1 (switch freely between PokPay test and live) is prepared on `release/pokpay-free-switch`. Step 2 (payment labels, Clock note and report line) is preserved separately on `feat/pokpay-test-labels`, pending validation. The earlier one-way go-live switch (PR #447) is live since 2026-11-09.

## PokPay first (owner, 2026-11-12)

1. **Switch freely between test and live (built, step 1).** Both PokPay accounts stay saved; one is in use at a time and the hotel switches either way with a confirmation. Every payment remembers the account that took it, and checks and refunds use that account. TEST or LIVE label on each account, a warning bar across the dashboard while on test, and every switch recorded. See [ADR-0041](../../decisions/ADR-0041-payment-accounts-test-and-live.md).
2. **Test labels (built, step 2).** Test payments act exactly like real ones (booking, balance, Clock) but carry a TEST label: on the booking and payments list and in the note sent to Clock with the payment. Money reports show test payments as their own line, not in the real totals (owner, 2026-11-12). The guest website shows no test-mode note (owner, 2026-11-12). The platform admin sees test or live per hotel.
4. **After it is live:** Empire Beach Resort gets a PokPay staging account and is switched to it, with its production account kept saved; a database backup is taken first and the owner gives a final yes, because Empire's guests cannot really pay by card while it is on staging.
3. **Clock:** a booking paid with test money at a hotel with its real Clock goes to Clock like any booking, labelled TEST (owner chose option B on 2026-11-12). Testing happens on the Must Hotel test property with the PokPay staging account.

## Why

Today a hotel can take card payments through one provider only: PokPay. The owner wants a hotel to offer **several payment methods at the same time** (like large booking sites do), because different methods suit different guests. The system is built for hotels in several countries (Albania now; for example Italy and Greece later), so Stripe, which does not serve Albanian businesses, is still needed. Stripe is built first as the second method because its test mode and documents are available now; Paysera follows when Paysera Albania sends its documents.

## What the owner decided

1. A hotel can have **more than one payment method switched on at once** (for example PokPay and Paysera).
2. For each method, a hotel is on **either its test setup or its live setup, never both at once**.
3. **Switching test to live**, and **changing the credentials** of a method, must follow industry standard and good practice (safe, recorded, no lost payment history).
4. Stripe is planned as its own later milestone.
5. The test-to-live switch for PokPay (branch `feat/pokpay-go-live-switch`) was merged as PR #447 and is live since 2026-11-09; switching back from live to test is step 1 above.

## What we found out (2026-11-09)

Source files are saved in [docs/integrations/paysera/](../../integrations/paysera/README.md).

- **Paysera Albania offers online card, bank and SMS payments for web shops** ([paysera.al payment gateway](https://www.paysera.al/v2/en-AL/payment-gateway-checkout)).
- Paysera has **two integration versions**. The newer one (OAuth2, "Checkout Modern") is the recommended one, but its documentation says it **currently covers Lithuania, Latvia, Estonia, Bulgaria, Kosovo and North Macedonia only**. **Albania is not on that list.** The older "Checkout Classic" (project id and password, signed links, callbacks) is the other path. **We must ask Paysera Albania which one an Albanian hotel gets before any design.**
- **Paysera and Stripe: the Paysera Albania representative told the owner (verbally, 2026-11-09) that they are connected.** Our web searches could not confirm it. The details (what it means for accounts or fees) are to be asked of Paysera. For design purposes Stripe stays a separate provider with its own account.
- The sandbox (test) setup of the modern version is mentioned by one source but is not in the pages we saved; the Classic version's test mode is also unconfirmed. To check with Paysera.

## Approved design (owner, 2026-11-09)

- **One connection per method per hotel**, each marked test or live. Moving from test to live is one confirmed, recorded step. Test never holds real money, so it needs no history check; live does.
- **A retired live method stays usable for refunds** on payments already taken, but not for new payments. This is what makes a later move from PokPay to Paysera safe.
- **Changing credentials** on the same account is its own action, verified before it replaces the old ones, with the old ones kept until the new ones pass.
- **Guests see only the methods the hotel turned on. All methods are equals: no primary or secondary method and no built-in default.** The hotel owner configures which ones are on.
- Build Paysera as a second provider next to PokPay, using the same shape (create payment, confirm by Paysera's own callback and a re-check, refund), so Stripe can be added the same way.

## Open questions

- **Owner asks Paysera Albania on 2026-11-10 for all information:** which integration version (Modern or Classic), the full documents, test environment and test credentials, how callbacks are verified, how refunds work (API or dashboard only), and what the Stripe connection means.
- Currency: the owner thinks euro; decided later, not part of the first integration. See [Milestone 29](29-currency.md).
- Which hotel uses Paysera first, and who opens the Paysera merchant account?

## Build order (owner, 2026-11-12)

1. **PokPay finished to industry standard** (the steps above): free test/live switching, each payment on its own account, retired accounts still refunding their payments, test labels.
2. **Stripe next,** on the same pattern (test and live keys both kept, free switching, refunds through the account that took the payment), plus several methods switched on at once so the guest picks. Stripe's go-live for real hotels is [Milestone 37](37-stripe-payments.md); Stripe does not serve Albanian businesses.
3. **Paysera later,** once Paysera's documents, test credentials and the answers above are in.

## Not in this milestone

Stripe going live for a real hotel (Milestone 37), the payment-method picker design on the public booking page (needs a design pass), per-guest method choice rules.
