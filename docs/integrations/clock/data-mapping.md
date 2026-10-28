# Clock data mapping

Status: **IMPLEMENTED mappings with partial normalization**. Code inspected 2026-09-19. Vendor evidence belongs in the [endpoint matrix](endpoint-matrix.md).

## Catalog and rates

`clock_catalog_mappings` carries tenant/property/connection, entity type, external ID/parent/name, optional local ID and sync status. Types are ROOM_TYPE and ROOM only. `ClockCatalogSyncService` stages PROPOSED records; confirmation creates/links local records, and a room requires its parent type to be confirmed. Rejected proposals remain distinguishable.

There is no RATE_PLAN catalog mapping. This does **not** mean the property must have one rate: `ClockAvailabilityService.selectRateForStay` supports multiple published child rates and `clock_rate_rankings` stores staff order per room type. Shadow `rate_plans.clock_shadow_room_type_id` links the local schema to a Clock room type; it is not a local price mirror. Rate-plan IDs and child rate IDs are different concepts.

## Rates sold on the website (2026-10-27)

Every Clock rate with `wbe: true` is sold on the hotel's website by default. Staff can switch an individual rate off for the website in Rates & Pricing (Rates by room type). A switched-off rate has a row in `clock_website_hidden_rates` (tenant, property, Clock rate id, who switched it off); a rate with no row is on, so a new rate published in Clock is sold at once. Clock stays the source of the rate and its price; every change is written to the audit log (`rates.website_visibility_changed`).

- **Who honours it.** Only guest-facing paths pass `channel: 'website'`: the room-card price search (`getStaySearch`), the rate offers at checkout (`listOffersForStay`) and the final quote (`getQuoteWithNightlyRates`). A guest who names a switched-off rate gets `clock_rate_unavailable`. Staff paths (staff availability search, staff quotes, staff bookings, amendments) see every rate. The booking itself trusts the quote token, which can only name a rate the website quote allowed.
- **Caches.** The room-card price memory and the availability and calendar caches include the switched-off rate ids in their keys, so switching a rate is felt at once without waiting for a cache to expire. The list of switched-off rates is read from the database at most every 30 seconds.
- **Known gap.** The advisory availability check and the date-picker calendar do not yet filter switched-off rates, so a date can look free when the only free rate is switched off; the quote step then says the rate is unavailable. Fix this together with the public calendar if a hotel starts switching rates off.
- **Rates that need a promo code (2026-10-28).** A Clock rate with `bonus_codes` is meant to be hidden from everyone without the code, but the price search returns it whenever its id is listed (verified in the sandbox: "Standard - Members" with code TESTCODE was priced without any code). The website therefore leaves out every published rate that has bonus codes (`codeProtected` in `RoomTypeRates`), and a guest who names such a rate is refused. Staff still see and can book it. Letting a guest unlock it by entering the code is a separate step (send `product_search[bonus_code]`).
- **All rates off.** A room type whose every rate is off is not bookable on the website; the staff screen says so.

## Setting up promotional rates in Clock (verified in the sandbox, 2026-10-28)

How a hotel makes a discount that MUST can sell and show. Verified with real price searches, not assumed.

1. **The discount lives in the rate.** Create a separate rate for the room type, derived from the regular rate with the percentage set so the price is lower (88% of Normal for 12% off; a +10 instead of -10 makes it dearer). Tick "Publish in WBE". Fill in **Included Discount %** with the same percentage: it changes no price, it only says how much of the price is a discount, which is what a crossed-out price is drawn from (original = price / (1 - rate)).
2. **When guests can book it** (a booking window): the rate's "Active from date" / "Active to date" on its Restrictions tab. These are **booking dates, not stay dates**. A rate active 1 Oct 2026 to 31 Dec 2027 sells stays in any month, including after 2027.
3. **Which stay dates it covers:** a stay is offered only if every night is open. To open the rate only for some months, stop it on the other days in **Rates Management / Rate Plan Restrictions** (daily STOP per rate). Do **not** use season STOPs: a STOP in a season carries forward to every later season and the STOP switch has no explicit "open". Do not rely on the Days view alone: a rate can show no STOP there while the API still reports `stop_from_sale: true` from the Rate Plan Restrictions level. A stay that crosses into a stopped day is not offered; a stay whose departure day is stopped is.
4. **A code-only rate:** put the code in the rate's WBE tab ("Book with Bonus Code"). Clock's own booking page hides it; the price search returns it anyway when its id is listed, so MUST hides it from guests (see "Rates that need a promo code").
5. **Check with the API:** `/rates/` shows the rate's `bonus_codes`, `included_discount_rate`, `rate_restriction` (`active_from_date`, `active_to_date`, `min_days_before_arrival`) and `/rates_availability` shows `stop_from_sale` per day.

## Booking fields

| MUST | Clock | Current handling |
| --- | --- | --- |
| `bookings.id` | n/a | Internal UUID |
| `external_booking_id` | `id` | External identity, unique per tenant/property |
| `external_reference` | `reference_number` | Sent on MUST creation; Clock-only imports receive a CLOCK-prefixed reference |
| `starts_on`, `ends_on` | `arrival`, `departure` | Local stay dates |
| `room_type_id` | `arrival_room_type_id` | Confirmed mapping |
| `room_id` | `arrival_room_id` | Optional confirmed mapping; hydration prefers `current_room_id` when supplied |
| `rate_plan_id` | `rate_id` | Selected child rate, not the local shadow ID |
| `adults`, `children` | Same names on create | Normalized integer occupancy; quote uses product-search adult/child count fields |
| `guest_count` | n/a | Compatibility total = adults + children |
| `special_requests` | `client_request` | Singular write field; not `active_notes` or plural `client_requests` |
| `version` | n/a | MUST concurrency counter |
| n/a | `lock_version` | Fresh vendor version used for updates/cancellation, not MUST's counter |
| `total_amount`, `nightly_rates` | `total_booking_value`, `rate_calculation` | Hydration can overwrite local values from Clock; no immutable-price guarantee on this path |
| `status` | `status` | Hydration: canceled -> CANCELLED; every other string -> CONFIRMED |

No distinct check-in/out/no-show enum or complete unknown-status normalizer exists. [Hydration gaps](architecture.md#known-gaps-and-deviations) must be considered when changing reports or local inventory.

## Guests

Local creation uses shared email-first matching with a phone duplicate signal; see [data/access](../../architecture/data-and-access.md). `clock_guest_mappings` stores the external guest identity per tenant/property/local guest, with uniqueness for the external identity too.

Both Clock create paths first read the stored mapping. On a miss, one fuzzy email search is filtered client-side for exact email; a matching `family_id` is sent as `main_booking_guest`. If no match exists, inline guest fields let Clock create the profile, and a returned `main_booking_guest.guest_id` is remembered. There is no required second phone search in the current implementation. ADR-0030's earlier fresh-search-only wording predates the persistent mapping task.

The webhook hydrator has its own guest resolver; do not assume it runs the same duplicate-review algorithm. Clock-imported rows may have no local guest.

## Folios and payment identity

`clock_folios` stores one row per tenant/property/external folio with booking linkage, deposit flag, balance/currency and closed timestamp. This replaces the old single `bookings.clock_folio_*` visibility columns, so deposit and general folios no longer overwrite each other.

MUST's guest-payment ledger is independent. Deposit credit items match a MUST payment/booking reference. Manual refunds use stable `must-refund:{refundId}` references and a negative vendor amount, while the local REFUND ledger amount is positive. Compare the credit item's currency/value, not the folio's default currency.

## Validation and uncertainty

Response validation is selective: booking-create and hydration have type guards, several other paths rely on inline TypeScript types or narrow structural checks. There is no general validated DTO-to-normalizer-to-canonical-model pipeline for every Clock resource.

The reference lookup implementation and payment-reconciliation filter have specific evidence concerns in the [matrix](endpoint-matrix.md) and [architecture gaps](architecture.md#known-gaps-and-deviations). Preserve uncertainty instead of describing these paths as certified.

## Shadow rate plans and cancellation terms: audit of Empire (2026-10-24)

Read-only check of the live Empire account (subscription 14688) plus the code. Verified facts only.

- **Design (owner's call, see `ClockAvailabilityService.getQuote`):** no local mirror of Clock rates. Prices come live from Clock. Confirming a Clock room type creates one hidden "shadow" `rate_plans` row (`Clock: <room type>`, currency hard-coded `EUR`, `clock_shadow_room_type_id`) because `bookings.rate_plan_id` is NOT NULL and the rate plan carries the local cancellation policy.
- **Clock side:** 78 rates = 13 room types x 6 rates (BB and FB for each of the Website, Reception and BCOM/Expedia channels). Per room type only the 2 Website rates (BB, FB) have `wbe = true`. Currencies are EUR (Website, BCOM) and ALL (Reception, none published to the web). So the hard-coded EUR is correct for today's published rates, but would be wrong if an ALL rate were ever published.
- **Cancellation terms are not available from Clock with current access:** the `/rates/` objects carry no cancellation or guarantee fields, `/cancellation_policies` and `/guarantee_policies` return 404, and `/rate_plans` returns 403 (`pms_api_rate_plans_index` right missing for the API user). Local cancellation is therefore evaluated only from the MUST-side policy on the shadow plan (`LocalPmsProvider.cancellationPolicy`).
- **Live state:** Empire's property-level rule is `free_cancellation_days_before_arrival = 21`. It gates guest self-service cancellation (inside 21 days the guest is told to contact the hotel, which is the hotel's stated policy: full refund outside 21 days, case by case inside). Separately, the automatic refund on a guest cancellation is decided by `LocalPmsProvider.cancellationPolicy`, which reads only the shadow plan's assigned policy or `free_cancellation_until_hours` and does **not** fall back to the property 21 days. Empire has no `cancellation_policies` rows, no plan hours and none of the 13 shadow plans has a policy, so by code reading a guest cancellation outside 21 days cancels the booking in Clock and locally but does **not** trigger the automatic refund. Not live-tested: the only 3 paid cancelled Empire bookings are 2026-09/10 test bookings with staff-side partial/full refunds.
- **Rate choice:** with several published rates per room type (Empire: BB and FB), `selectRateForStay` applies wbe, occupancy, cheapest, then staff ranking (`clock_rate_rankings`, empty for Empire), so the guest is quoted one price, normally BB.
- **Retired room types:** Clock keeps returning room types with a past `operational_until` (Empire's "Standard Double room", ID 36758, retired 2024-04-23, 0 rooms). Removed locally on 2026-10-24 and the mapping rejected; the catalog sync now skips them.

**Open decision for the owner:** keep shadow plans (add a real per-property cancellation policy and a currency taken from the Clock rate), or mirror Clock rate plans properly once the API user is granted the rate-plans right.

### Empire API-user permission map (read-only probe, 2026-10-24)

`GET` results for the API user on subscription 14688. Granted: `/rates/{id}` and `/room_types/{id}` (200). Missing rights (403, named by Clock): `pms_api_rate_plans_index`, `pms_api_rate_plans_show`, `pms_api_rate_packages_index`. 404 for guessed names (not endpoints we know exist): `/rate_restrictions`, `/charge_templates`, `/guarantee_policies`, `/cancellation_policies`, `/cancellation_schemes`, `/policies`, `/meal_plans`, `/bonus_codes`, `/discounts`, `/promotions`. No endpoint or rate field exposing a cancellation policy was found; only `rate_restriction.guarantee_policy_id` (17089 on the Website BB rate). The probe's `/products` call returned 500 (bad parameters from the probe) and then 429 (Clock rate limit), so the shape of a `/products` offer was not captured.

Rate fields relevant to discounts (rate 546549, Website BB): `derived_rate_type: DerivedAmountPrice` with `base_rate_id` (derived from the Reception BB rate), `included_discount_rate`, `bonus_codes`, and `rate_restriction` with `active_from_date`/`active_to_date`, `min_days_before_arrival`, `max_days_before_arrival`, `last_minute_days`. All null on Empire's published rates today, i.e. no time-limited discount is configured on them.

### Sandbox comparison (read-only, 2026-10-24, account 172528 / subscription 16307)

- The sandbox API user **has** the rate-plans right (`GET /rate_plans` returns `[70813, 69242]`, ids only) but still lacks `pms_api_rate_packages_index`. Live Empire lacks the rate-plans rights.
- A `/products` offer carries only `available`, `price.cents`, `price.currency`, `room_type_free_rooms` and `errors`. It has **no original/"was" price and no discount field**. A struck-through price therefore has to be computed by also pricing the derived rate's `base_rate_id` for the same stay (sandbox example: "Normal" 784161 = 1050.00 EUR against derived "FAM - Summer" rates; derived types seen: `DerivedAmountPrice`, `DerivedPercentPrice`, `Pms::RateCalculation::DerivedPrice`).
- Occupancy is enforced per rate (`errors` text "Maximum adults allowed - 1" makes `available: false`), so a multi-rate picker must hide or disable unavailable offers.

## Currency of Clock reservations (finding and fix, 2026-10-26/27)

Verified against the live Empire data (read-only) and the code.

- **What went wrong:** a booking has no currency of its own; it was taken from its rate plan, and every Clock reservation was filed under the hidden per-room-type shadow plan, whose currency is `EUR`. Clock bills some reservations in another currency (Reception rates are in `ALL`, lek). Those reservations were stored with their lek totals but shown as euros: 70 reservations, among them the 69 guest-less one-per-room bookings of 19-22 May 2027 (48,500-102,000 shown as euros; as lek they are about EUR 178-375 per night per room type, the same as the hotel's normal euro prices). The "Expected on arrival" figure was inflated by them.
- **Fix:** the hydration step reads `total_booking_value.currency` and files a reservation under a plan in that currency (`Clock reservations billed in <CUR>`, inactive, not bookable) whenever it differs from the room type's shadow plan. A re-read of every reservation (`BOOKINGS_IMPORT_VERSION = 3`) corrects the stored ones; it only starts after the fix is deployed.
- **Safeguards so it cannot happen silently again:**
  1. A total with no valid ISO currency is never assumed to be euro: the reservation is not imported and a review item is raised (`UNKNOWN_RESULT`).
  2. `bookings.currency` now stores the currency on the booking. Clock reservations take Clock's own value; for every other writer a database trigger fills it from the rate plan and follows the plan if it changes.
  3. Every refresh of a Clock bill compares the bill's currency with the booking's. A difference raises a `CURRENCY_MISMATCH` review item (shown under Needs attention on the reservation) and is closed again automatically when the two agree.
  4. Reports keep one line per currency and never add amounts of different currencies.
  5. Currency codes are checked against the real ISO 4217 list (`money/iso-currency.ts`), not just "three letters", at the Clock import and when a rate plan is saved.
  6. The database enforces that a booking's currency equals its rate plan's currency (checked at commit), and refuses to change the currency of a rate plan that already has bookings.
  7. A payment recorded in a different currency than its booking is never refused (money really received must not be lost): it is kept and a `CURRENCY_MISMATCH` review item is raised. On the live data on 2026-10-27 no payment differed from its booking's currency (38 payments).
- **How staff see money in another currency (2026-10-27):** an amount is shown in its own currency (for example lek), and when another currency is worth showing, an approximate amount follows in brackets (`components/ui/money.tsx`, `approximate-money.tsx`). Amounts in different currencies are never added together; a guest's totals stay one per currency. For a payment or refund in another currency than its booking, the database stores the exchange rate of the day it was recorded (`payments.fx_rate_to_booking`, `fx_rate_date`, filled by the `payments_set_fx_rate` trigger from the daily euro-based `exchange_rates`); the bracket uses it. Older payments have no stored rate, so the bracket uses today's rate and says "estimate". Where no rate is known the bracket is left out. Applied to the reservation page, the payment page, the Clock balance on the payments list and the guest page. Other screens still format money themselves and move over the same way. The guest website was not changed.
- **Outstanding and Expected on arrival:** where Clock holds the bill, the Clock balance is what is owed. Only stays that have started count as Outstanding. Stays that have not started are Expected on arrival, shown with how much of it is for stays with no guest name (often room blocks or tests made in Clock).
- **Not yet confirmed:** what the 69 + 42 guest-less reservations are (a block of every room, an import, or a test). The hotel has to say.
