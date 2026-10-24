# Clock data mapping

Status: **IMPLEMENTED mappings with partial normalization**. Code inspected 2026-09-19. Vendor evidence belongs in the [endpoint matrix](endpoint-matrix.md).

## Catalog and rates

`clock_catalog_mappings` carries tenant/property/connection, entity type, external ID/parent/name, optional local ID and sync status. Types are ROOM_TYPE and ROOM only. `ClockCatalogSyncService` stages PROPOSED records; confirmation creates/links local records, and a room requires its parent type to be confirmed. Rejected proposals remain distinguishable.

There is no RATE_PLAN catalog mapping. This does **not** mean the property must have one rate: `ClockAvailabilityService.selectRateForStay` supports multiple published child rates and `clock_rate_rankings` stores staff order per room type. Shadow `rate_plans.clock_shadow_room_type_id` links the local schema to a Clock room type; it is not a local price mirror. Rate-plan IDs and child rate IDs are different concepts.

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
