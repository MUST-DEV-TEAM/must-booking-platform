# Settings S7b: making bookings use the Payment methods settings

Status: **plan, deferred by the owner on 2026-11-23** (the current work is the screens and their plans; this is the backend step that follows). Tracked as G-100 in [the gaps log](../audit/hardening-gaps-log.md). Part of [the settings redesign plan](settings-redesign-plan.md), step S7. Closes G-46 and G-51. Nothing here is built.

## What exists today (read in the code, 2026-11-23)

| Where | What it checks | File |
| --- | --- | --- |
| The list of methods a hotel website shows guests (`paymentMethods` in the public catalog) | The method is switched on **and** the hotel has an enabled connection for that provider with status CONNECTED. Pay at the hotel only needs its switch. Fixed order: Stripe, PokPay, pay at the hotel. | `public-catalog.service.ts:162-315` |
| Creating a booking | **Only the switch** (`stripe_enabled`, `pokpay_enabled`, `pay_at_hotel_enabled`). No connection check. | `local-pms.provider.ts:2331-2372` |
| Creating a multi-room order | Only the switch, in its own copy of the same check. | `multi-room-booking.service.ts:465-476` |
| The Settings page badge "Connected to this hotel" | The connections list of the settings query. | `settings.tsx` |
| Payment link life | A fixed 7 days in code. | `payment-collection.service.ts:36` (`BALANCE_LINK_VALID_MINUTES`) |
| First payment reminder | Hotel setting in Emails (`notification_topic_settings`, default day 3), read by a database function. No second reminder exists. | migration `20261027040000_payment_link_reminder_candidates` |

**Correction to G-46.** Guests are not shown a method that has no connected provider; the catalog already hides it. The hole is that a booking request that names Stripe directly (a custom site, an old page, a stale tab) is accepted when only the switch is on, then fails at the payment page and waits to expire. Three places each have their own rule. G-51 is real: no order or default is read anywhere.

S7a already stores the order, the default, what the reception accepts, link validity, a second reminder and the expiry action. S7b makes the booking system read them.

## What we build

1. **One shared "which methods are available" function.** A method is available when it is switched on and, for a payment provider, the hotel has an enabled connection with status CONNECTED; Pay at the hotel only needs its switch. It returns the methods in the hotel's order plus the default. The public catalog, booking creation, multi-room creation and the Settings page badge all use it, so they cannot disagree.
2. **Booking creation refuses an unavailable method** with a clear reason (`PAYMENT_METHOD_NOT_AVAILABLE`) before anything is created. Real-database tests for: switch on and no connection (refused), connected (accepted), switched off (refused), multi-room order (same answers).
3. **Order and default reach the websites.** `paymentMethods` keeps its meaning but is now in the hotel's order; a new additive field `defaultPaymentMethod` names the pre-selected one. The public guest API document is updated. Sites that ignore the new field keep working.
4. **What the reception accepts reaches guests.** Added to the hotel's public answer (`/public/property`, under the payment facts) and as one line in the booking confirmation email.
5. **Payment link timing.** The fixed 7 days becomes the hotel's setting. A second reminder is sent (once per link, own idempotency key) when the hotel set one. The database function that finds reminder candidates is extended in a new migration. **Expiry action:** "tell staff" is sent when a link expires unpaid; see decision 2 for "cancel and release".

## Build slices (each ends with tests and your check)

- **S7b-1, the shared check and refusing unavailable methods** (G-46). Before shipping: a read-only count on the live hotels of switches that are on without a connected provider (see risk).
- **S7b-2, order and default in the catalog and the public API document** (G-51).
- **S7b-3, accepted at the reception** in the public answer and the confirmation email.
- **S7b-4, link validity, second reminder, expiry action.**

## Risk to watch

S7b-1 changes behaviour: a hotel with a method switched on but no connected provider stops accepting bookings by that method. That is the intended fix, but before it ships I run a **read-only** check on the live hotels (SELECT only) and tell you which hotels it affects, so nobody is surprised. Live deploys only through the pipeline and only with your go. Empire and Luxury stay read-only; every test runs on Must Hotel.

## Decisions I need from you

1. **Methods switched on but not connected.** Refuse them at booking (my recommendation), after the read-only live check and a note in Needs attention for the hotels affected?
2. **"Cancel and release" on an expired link.** A payment link for a confirmed booking's balance lapsing is not a reason to cancel the booking and lose the guest. I recommend that S7b applies only "tell staff", and "cancel and release" is applied only to an unpaid online booking whose hold has run out (which already happens). Agreed?
3. **Confirmation email line** for what the reception accepts: yes (my recommendation), or only on the website?
4. **Public API:** the additive `defaultPaymentMethod` field and the ordered `paymentMethods` list. OK?

## Not in this plan

Bank transfer (G-48, its own step), the card guarantee and no-show charge (G-50), the "how much guests pay now" table (waits for the shelved prepayment rules, G-98), moving the first reminder's storage here (G-99).
