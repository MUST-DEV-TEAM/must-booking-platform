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
