# Draft: request to Clock for API rights and answers

**Status: DRAFT, not sent.** Prepared 2026-10-26 during Milestone 27 (see [the milestone](../../roadmap/milestones/27-clock-rates-cancellation-permissions.md), Task 7), reworked the same day to separate the sandbox from Empire and to say honestly what is needed. It is sent once, after the owner has reviewed it and after the permissions panel has been run on Empire's real connection, so the Empire lines are checked against what Empire actually lacks. Rewrite the greeting and the account details before sending.

Everything here was found by testing on Clock's sandbox account (account 172528, subscription 16307) through the read-only permissions check in the dashboard (System health, Clock permissions), and by reading Clock's public API documentation. Clock names a missing right in its 403 reply (pattern `<api>_<resource>_<action>`); the one exception is a right Clock names in words ("Booking: Set manual price").

## Do we need these rights? (for the owner, not part of the email)

**Nothing below is needed to run the business today.** Every feature MUST uses works on the sandbox: room import, rates, availability and live prices, creating, reading, changing and cancelling reservations, live updates (webhook), guest search, recording payments, and the read of rate plans. Empire is verified only partly: the check of 2026-10-24 showed the rate-plan reads missing; the full check on Empire's real connection is scheduled right after the switch to the new version.

| Right | Needed? | Why, in plain words |
| --- | --- | --- |
| Booking: Set manual price | **Wanted, not required.** | Without it a promo-code booking is correct for the guest but Clock's reports show the full price and a "payment" credit for the discount (our workaround). With it, Clock shows what the guest really pays and taxes follow the discounted price. It only matters once hotels use promo codes. |
| `base_api_charges_create` / `base_api_charges_destroy` | **Only if manual price is refused.** | A second way to post a discount on the bill, as a charge in a "Discounts" category instead of a payment. |
| `pms_api_rate_plans_index` / `_show` | **Optional, planned.** | We keep one hidden rate plan per room type today. Reading Clock's real plans would remove that duplication. The hotel loses nothing without it. |
| `pms_api_rate_packages_index` | **Optional, planned.** | Lets us show what a package rate includes. Rates already carry their meals. |
| `pms_api_booking_offers_index`, `pms_api_wbe_config_show`, `pms_api_meals_index`, `base_api_exchange_rates_index`, `pms_api_accounts_show` | **Optional.** | Convenience reads (offers, the hotel's online-booking settings, meal list, the hotel's own exchange rates, a check of which hotel a connection belongs to). We work without them. |

Recommendation: send a short request with the first row (manual price) for both accounts, the rate plans and packages as "planned", and the questions in section B. Do not ask for the optional reads yet; add them only if a hotel needs the feature.

## What to send

> Hello Clock support,
>
> We run MUST, a booking platform that connects hotels to Clock PMS+ through the PMS API and the Base API. Our first live hotel is Empire Beach Resort (account 122536, subscription 14688); we test on the sandbox account 172528 / 16307. Our integration works for everything we need today. We would like to ask you to enable the rights below for our integration API user, on the accounts listed, and to answer the questions at the end. For each right we say what we use it for and what happens without it.

## A. Rights we ask for

| Right | Sandbox 172528 / 16307 | Empire 122536 / 14688 | What it lets us do | Why |
| --- | --- | --- | --- | --- |
| `Booking: Set manual price` (used with `manual_prices_as_text` and `manual_currency` when creating a reservation, one price per line) | Yes (to build and test it) | Yes (to use it live) | Create a reservation with the nightly prices the guest was actually quoted | A guest using a hotel promo code pays less than the rate price. Today we can only post the discount as a credit on the bill, which counts as a payment in Clock's cash reports and leaves room revenue and taxes at the full price. With manual prices the reservation, its tax and its reports show what the guest really pays. |
| `base_api_charges_create` (and `base_api_charges_destroy` to correct a mistake) | Yes | Only if manual prices are not possible | Add (or remove) a discount line on a guest's bill | The alternative for a discount added after booking, posted in a "Discounts" category rather than as a payment. |
| `pms_api_rate_plans_index`, `pms_api_rate_plans_show` | Already allowed | Yes (missing on 2026-10-24) | List and read the hotel's rate plans | We keep a hidden plan per room type to hold the booking's rate. We want to link bookings to the real plans and read each plan's name and currency. Without it we keep the hidden plans; nothing breaks. |
| `pms_api_rate_packages_index` | Please check | Please check | List rate packages | Some rates belong to a package; we want to show guests what a rate includes. Optional. |

The exact Empire column is confirmed by running our permissions check on Empire after the switch; edit this table with the result before sending.

### Not requested

We deliberately do not ask for rights to create rooms, room types, rates, rate prices, events, caterings, door keys or users, or to delete bills. The integration does not need them. Our permissions panel lists all 155 requests of the public documentation with this status for each hotel.

## B. Questions we ask Clock

1. **Cancellation policy.** Is a rate's or reservation's cancellation policy readable through the API (a field or an endpoint), and which right does it need? We found none in the public documentation; hotels tell guests their policy in other ways.
2. **Original price.** Can a `/products` offer carry the price before a discount (or the discount itself) so that we can show a crossed-out price without computing it ourselves? We compute it from the base rate for the same stay today.
3. **Bonus codes.** When we send `product_search[bonus_code]`: (a) must the code-unlocked rates also be in the `rates` list we send, even when they are not published for online booking? (b) is there a way to tell that a code was invalid? An unknown code currently returns the normal prices with no error.
4. **List of our rights.** Is there an endpoint that returns the rights granted to an API user? We test each endpoint to find out; a list would be exact and faster.
5. **Manual prices.** Are tax and city tax calculated on the manual price? Is the format one number per night, one per line, in the order of the nights?
6. **Webhooks.** Can a hotel have more than one webhook subscription, and what happens to events while a subscription is replaced?
7. **Request limits.** Is the limit of five requests per second per account the same on production accounts? We retry after a refusal with growing waits.

## C. What we already confirmed (for your reference)

- Sandbox: 44 of the 155 documented requests are allowed to our user, 104 distinct rights are missing (we do not ask for most of them).
- Every feature we use today works on the sandbox: room import, rates, availability and live prices, reservations (create, read, change, cancel), live updates, guest search, recording payments and the rate plans read.
- A reservation made with a hotel promo code on the sandbox shows: the note "MUST promo code WELCOME10: ...", marketing source "MUST promo WELCOME10", and, because manual prices are not allowed, a labelled credit on the bill so the balance equals what the guest owes.

## D. After you grant the rights

We re-run the permissions check on each account (a read-only check; for rights that change data we aim at a record that cannot exist, so nothing is changed) and switch the matching features on: manual prices for promo codes, the real rate plans and the package information. We will tell you if anything is still refused.

## Before sending (checklist for the owner)

- [ ] Run the permissions panel on Empire's real connection and replace the Empire column of section A with the exact missing rights.
- [ ] Decide whether to ask for the optional reads now or keep the request short (recommended: keep it short).
- [ ] Confirm the account and subscription numbers and who signs the message.
