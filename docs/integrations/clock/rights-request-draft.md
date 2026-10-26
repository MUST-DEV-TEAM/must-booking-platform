# Draft: request to Clock for API rights and answers

**Status: DRAFT, not sent.** Prepared 2026-10-26 during Milestone 27 (see [the milestone](../../roadmap/milestones/27-clock-rates-cancellation-permissions.md), Task 7). It is sent once, after the owner has reviewed it and after the permissions panel has been run on Empire's real connection, so the list below is checked against what Empire actually lacks. Rewrite the greeting and the account details before sending.

Everything here was found by testing on Clock's sandbox account (account 172528, subscription 16307) through the read-only permissions check in the dashboard (System health, Clock permissions), and by reading Clock's public API documentation. Clock names a missing right in its 403 reply (pattern `<api>_<resource>_<action>`); the one exception is a right Clock names in words ("Booking: Set manual price").

## What to send, in plain words

> Hello Clock support,
>
> We run MUST, a booking platform that connects hotels to Clock PMS+ through the PMS API and the Base API. Our first live hotel is Empire Beach Resort (account 122536, subscription 14688). We test on the sandbox account 172528 / 16307. We would like to ask you to enable the rights below for our integration API user on both, and to answer the questions at the end. For each right we say what we use it for.

## A. Rights we ask for

### Needed so that promo codes show the correct price in Clock (priority 1)

| Right | What it lets us do | Why we need it |
| --- | --- | --- |
| `Booking: Set manual price` (Clock names it in words; used with `manual_prices_as_text` and `manual_currency` on the reservation, one price per line) | Create a reservation with the nightly prices the guest was actually quoted | A guest who uses a hotel promo code pays less than the rate price. Today we can only post the discount on the bill as a credit, which counts as a payment in Clock's cash reports and leaves room revenue and taxes at the full price. With the manual price right the reservation, its tax and its reports show what the guest really pays. |
| `base_api_charges_create` (and `base_api_charges_destroy` to correct a mistake) | Add (or remove) a discount line on a guest's bill | The alternative to manual prices for a discount added after booking, posted in a "Discounts" category rather than as a payment. We only need it if manual prices are not possible for this hotel. |

### Needed for the rates the hotels already use (priority 2)

| Right | What it lets us do | Why we need it |
| --- | --- | --- |
| `pms_api_rate_plans_index`, `pms_api_rate_plans_show` | List and read the hotel's rate plans (allowed on the sandbox; the Empire check on 2026-10-24 showed it missing) | We currently keep a hidden plan per room type to hold the booking's rate. We want to link bookings to the real Clock rate plans and read each plan's name and currency. |
| `pms_api_rate_packages_index` | List rate packages | Some rates belong to a package; we need to show guests what a rate includes. |
| `pms_api_booking_offers_index` | List booking offers | To show offers the hotel has set up, if Clock exposes them there. Optional. |
| `pms_api_wbe_config_show` | Read the hotel's web booking settings | To follow the hotel's own online booking rules (for example which rates are published) instead of copying them by hand. Optional. |
| `pms_api_meals_index` | List meal plans | To show a meal plan by name on a rate. Rates already carry their meals; this only gives the full list. Optional. |
| `base_api_exchange_rates_index` | Read the hotel's exchange rates | We show approximate prices in other currencies from a public feed; the hotel's own rates would be better for hotels that bill in two currencies. Optional. |
| `pms_api_accounts_show` | Read basic account details | A simple way to confirm which hotel a connection belongs to. Optional. |

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

We re-run the permissions check on the hotel (a read-only check; for rights that change data we aim at a record that cannot exist, so nothing is changed) and switch the matching features on: manual prices for promo codes, the real rate plans and the package information. We will tell you if anything is still refused.

## Before sending (checklist for the owner)

- [ ] Run the permissions panel on Empire's real connection and replace the Empire lines in section A with the exact missing rights.
- [ ] Decide whether to ask for the optional rights now or keep the request short.
- [ ] Confirm the account and subscription numbers and who signs the message.
