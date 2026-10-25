# Milestone 27: Clock rates, cancellation and permissions

Status: **Planned — opened 2026-10-25.** Nothing below is built unless a row says so. It must be finished, together with [Milestone 28](28-release-and-cutover.md), before the redesign branch is merged into `main`.
Work happens on the redesign branch and is tested against the Clock **sandbox** account (account 172528, subscription 16307). Live Empire (subscription 14688) is **read only** for this milestone.
Replaces the open rows of [Milestone 21](21-clock-certification-fixes.md) (Tasks 23, 24, 26 and 32) and holds the findings of the 2026-10-24 audit in [data mapping](../../integrations/clock/data-mapping.md#shadow-rate-plans-and-cancellation-terms-audit-of-empire-2026-10-24).

## Goal

A Clock hotel's guests see the hotel's real rates (not only the cheapest), cancellation and refunds follow the hotel's real rule, and the integration knows and reports which Clock rights it has, so the one request to Clock for missing rights is complete.

## Verified starting point (read-only, 2026-10-24)

- Prices come live from Clock `/products`; there is no local rate mirror (owner's decision). Each booking still needs a local `rate_plan_id`, so confirming a Clock room type creates a hidden "shadow" plan `Clock: <room type>` with currency hard-coded to EUR.
- Empire: 13 room types, 78 rates (13 x 6). Two Website rates per room type are published for online booking (breakfast `BB`, full board `FB`); the guest flow quotes only the cheapest (`selectRateForStay`, with staff ranking `clock_rate_rankings`, empty for Empire). Currencies in Clock: EUR (Website, Booking.com), ALL (Reception, not published online).
- Cancellation: the hotel's rule is a free full refund more than 21 days before arrival, and the hotel handles inside-21-days cases one by one. `properties.free_cancellation_days_before_arrival = 21` gates guest self-service cancellation. The automatic refund after a guest cancels reads only the shadow plan's policy or `free_cancellation_until_hours` and does **not** fall back to the property's 21 days, so by code reading no automatic refund happens. Not live-tested.
- Clock exposes no cancellation-policy field on rates, and the API user lacks `pms_api_rate_plans_index`, `pms_api_rate_plans_show` and `pms_api_rate_packages_index` on Empire (the sandbox user has rate-plans). A `/products` offer carries only availability, price, currency and errors: no original price and no discount field.

## Tasks

| # | Task | Notes | Status |
| --- | --- | --- | --- |
| 1 | **Refund fallback to the property's free-cancellation days** | In `LocalPmsProvider.cancellationPolicy`, when neither the plan's policy nor its hours is set, use the property's days. Outside the window: automatic refund; inside: the existing "contact the hotel" gate. Behavioural tests on both sides of the window. | Planned |
| 2 | **Rate choice for the guest** | Return every available published offer for a room type, with friendly names from the rate's `meals` (for example "Bed & breakfast", "Full board"), hide offers with occupancy errors, book the chosen rate; staff ranking becomes display order. Touches quote, booking creation and the guest booking page. Sandbox first. | Planned |
| 3 | **Real rate plans instead of shadow plans** | Mirror Clock rate plans (id, name, currency, policy where available), link bookings to them, take currency from the Clock rate. Depends on the rate-plans right and on how Clock exposes cancellation terms. | Planned, blocked by the rights request |
| 4 | **Discount display** | Original price crossed out, discounted price and percentage, only when a real reference price exists. For derived rates the reference is the `base_rate_id` priced for the same stay. Needs the owner's decision on the legal rule for the original price before building. | Planned, decision needed |
| 5 | **Clock rights errors and permissions check** (was Milestone 21 Tasks 23 and 24) | Recognise "The User doesn't have right X" as its own failure kind carrying the right name, de-duplicated; a read-only check of the endpoints the integration uses, recorded per right, shown in a panel that can be pasted to Clock support. | Planned |
| 6 | **Retry on Clock rate limits** | The sandbox allows 5 requests per second per account. Booking and cancel paths have no automatic retry on `clock_rate_limited` (only the sandbox tests got one). Add bounded retry with backoff for requests Clock rejects without processing. | Planned |
| 7 | **Rights request to Clock** | One complete message, sent only after Tasks 2 to 6 show which rights are really needed. Draft: rate-plans index/show and rate-packages index for the Empire API user; where a rate's or booking's Cancellation Policy is exposed and which right it needs; whether offers can carry the original price; rights for discounts and promo-code (`bonus_codes`) data. | Drafted 2026-10-24, **held** until Tasks 2 to 6 are done |
| 8 | **Clock documentation review** | Public Clock API documentation was not reachable and the Postman connection is not authorised. Obtain Clock's API reference through the owner's Postman access or from Clock, and record what each right and endpoint offers. | Planned |
| 9 | **Rest of Milestone 21** | Task 22 (durable webhooks) still needs live verification; Task 26 (who converts the deposit folio) waits for Clock's written answer; Task 32 (paced first import) is partly built on this branch (resumable batches, 366-day window) and needs the automatic start on connect and the count/ETA display. | Carried over |

## Done when

Tasks 1 to 6 verified on the sandbox with behavioural tests, the rights request sent with the answers to Task 7, and Empire read-only checks show the behaviour matches the hotel's real rule.
