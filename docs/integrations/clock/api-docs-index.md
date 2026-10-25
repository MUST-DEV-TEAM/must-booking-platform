# Clock PMS+ API documentation index

Source: Clock's public Postman documentation, [api-docs.clock-software.com](https://api-docs.clock-software.com/) (collection "Clock PMS+ API Docs", Postman published id `SzKQzg2h`). Downloaded 2026-10-25 from `https://documenter.gw.postman.com/api/collections/8389346/SzKQzg2h?segregateAuth=true&versionTag=latest` (the page itself is rendered by JavaScript, so a plain page fetch shows nothing). The 2.4 MB collection JSON is kept locally under `.firecrawl/`, not committed. 231 requests in total. Paths below drop the host and the account/subscription ids.

## What the public documentation does and does not cover (verified by reading the collection)

- **No cancellation policy anywhere.** The words "cancellation policy" and "cancel policy" never appear. A booking carries only `guarantee_policy_id` (deposit), and rates carry `rate_restriction` (stay, advance and closure limits). So the hotel's cancellation terms are not exposed by the public API, and the MUST-side policy stays the source of truth unless Clock says otherwise.
- **`/products`** (the price search) returns, per room type and rate: `room_type_free_rooms`, `available`, `price` (cents and currency) and `errors`. It has **no original price and no discount field**.
- **`/rates/`** returns each rate with `rate_plan_id`, `name`, `wbe`, `bonus_codes`, `derived_rate_type`, `base_rate_id`, `currency`, `meals`, `rate_restriction` and `human`. "1 Rate belongs to 1 Room Type" (Data Mapping note).
- **`/rate_plans/`** lists plan **ids only**; `/rate_plans/:id` shows one plan and needs its own right. `/rate_packages/` also exists. `discount_rate` appears only on folio **charges** (standard discount charges), not on rates or offers.
- **Rights:** the documentation names rights only for closing folios ("Folio: Close", "Folio: Close folio with outstanding balance"). Right names are otherwise visible only in Clock's 403 errors (pattern `<api>_<resource>_<action>`, for example `pms_api_rate_plans_index`).
- **Rate and availability writes** (Yield Management API: `POST .../rates/:rate_id/rate_prices/`) exist for price and restriction updates; MUST does not use them.

## Endpoints

### >HOW TO< Integration Guides (38)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| GET | `/base_api/charge_templates` | 1.1. Charge template mappings | (POS) Transfer charges to booking / company / event folio / 1. GOOD PRACTICES |
| POST | `/base_api/folios/13184661/charges/` | 1.2. Tips transfer | (POS) Transfer charges to booking / company / event folio / 1. GOOD PRACTICES |
| POST | `/base_api/folios/13184661/charges/` | 1.3. Discounts transfer | (POS) Transfer charges to booking / company / event folio / 1. GOOD PRACTICES |
| POST | `/base_api/folios/13184661/charges/bulk` | 1.4. VOID / Refund of transfered charges | (POS) Transfer charges to booking / company / event folio / 1. GOOD PRACTICES |
| GET | `/pms_api/bookings/find_in_hotel` | 2.1. Find Booking | (POS) Transfer charges to booking / company / event folio / 2. CHARGE BOOKING |
| POST | `/pms_api/bookings/25334365/charges_by_source/bulk` | 2.2. Booking - charge create | (POS) Transfer charges to booking / company / event folio / 2. CHARGE BOOKING |
| GET | `/base_api/companies/chargeable_folios` | 3.1. Find Company | (POS) Transfer charges to booking / company / event folio / 3. CHARGE COMPANY |
| POST | `/base_api/folios/13184661/charges/bulk` | 3.2. Company - charge create | (POS) Transfer charges to booking / company / event folio / 3. CHARGE COMPANY |
| GET | `/pms_api/events/chargeable_folios` | 4.1. Find Event | (POS) Transfer charges to booking / company / event folio / 4. CHARGE EVENT |
| POST | `/base_api/folios/13184661/charges/bulk` | 4.2. Event - charge create | (POS) Transfer charges to booking / company / event folio / 4. CHARGE EVENT |
| POST | `/base_api/companies/:company_id/folios` | 5.1. Create folio for the End Of Day (EOD) transfer | (POS) Transfer charges to booking / company / event folio / 5. END OF DAY (EOD) |
| POST | `/base_api/folios/13184661/charges/bulk` | 5.2. End of day (EOD) revenue transfer | (POS) Transfer charges to booking / company / event folio / 5. END OF DAY (EOD) |
| POST | `/base_api/folios/13184661/credit_items/` | 5.3. End of day (EOD) payment transfer | (POS) Transfer charges to booking / company / event folio / 5. END OF DAY (EOD) |
| POST | `/base_api/folios/13184661/close` | 5.4. Close folio for the End Of Day (EOD) transfer | (POS) Transfer charges to booking / company / event folio / 5. END OF DAY (EOD) |
| POST | `/base_api/companies/:company_id/folios` | [DEPRECATED] 5.1. Create folio for the End Of Day (EOD) transfer | (POS) Transfer charges to booking / company / event folio / [DEPRECATED] 5. END OF DAY (EOD) |
| POST | `/base_api/folios/13184661/charges/bulk` | [DEPRECATED] 5.2. End of day (EOD) revenue transfer | (POS) Transfer charges to booking / company / event folio / [DEPRECATED] 5. END OF DAY (EOD) |
| POST | `/base_api/folios/13184661/credit_items/` | [DEPRECATED] 5.3. End of day (EOD) payment transfer | (POS) Transfer charges to booking / company / event folio / [DEPRECATED] 5. END OF DAY (EOD) |
| POST | `/base_api/folios/13184661/close` | [DEPRECATED] 5.4. Close folio for the End Of Day (EOD) transfer | (POS) Transfer charges to booking / company / event folio / [DEPRECATED] 5. END OF DAY (EOD) |
| | |  | 1. Embed Drop-in script and stylesheet into the check-out page | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| | |  | 2. Create a DOM element for Drop-in | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| POST | `https://sky-eu1.clock-software.com/rest_api/adyen_psp/80226/11919/dropin_token_sessions` | 3. Create payment session | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| | |  | 4. Fetch Session Details and Initialize Drop-in | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| | |  | 5. Redirect handling | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| | |  | 6. Create booking | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| | |  | 7. Assign created token to the booking | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| | |  | 8. Charge the created token [OPTIONAL] | How to Embed Clock PMS Payment Enablement Service in Third-Party Booking Engine Checkout Workflows |
| | |  | Clock PMS+ Activity provider configuration | Additional Activities |
| | |  | NEW Activity Process | Additional Activities |
| | |  | UPDATE Activity Process | Additional Activities |
| | |  | CANCEL Activity Process | Additional Activities |
| POST | `/base_api/credit_cards` | credit_card_token - CREATE | [DEPRECATED] Credit Card (Client Side Encryption) - Tokenization and Charge |
| POST | `/pms_api/bookings/25334365/booking_credit_cards` | booking_credit_cards - CREATE | [DEPRECATED] Credit Card (Client Side Encryption) - Tokenization and Charge |
| POST | `/pms_api/bookings/25334365/booking_credit_cards/:cc_token/charge_token` | booking_credit_cards - CHARGE | [DEPRECATED] Credit Card (Client Side Encryption) - Tokenization and Charge |
| | |  | How to Identify and Classify Accounts Receivable (AR) Changes via the API | Accounting |
| | |  | Booking Create – form example | - |
| | |  | Booking Update – form example | - |
| | |  | Payment Create – form example | - |
| | |  | Charge Create – form example | - |

### base_api (Financial Data) (54)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| POST | `/base_api/webhook_subscription` | webhook - CREATE | PUSH/Webhooks |
| GET | `/base_api/webhook_subscription` | webhook - VIEW | PUSH/Webhooks |
| DELETE | `/base_api/webhook_subscription` | webhook - DELETE | PUSH/Webhooks |
| GET | `/base_api/folios/13184661/credit_items` | credit_items (payments)  - VIEW LIST | Folios / Payments |
| GET | `/base_api/folios/13184661/credit_items/:credit_items_id` | credit_item (payment) - VIEW | Folios / Payments |
| POST | `/base_api/folios/13184661/credit_items` | credit_item (payment) - CREATE | Folios / Payments |
| GET | `/base_api/custom_payment_purchases/:cpp_id` | custom_payment_purchase - VIEW | Folios / Payments |
| PUT | `/base_api/custom_payment_purchases/:cpp_id` | custom_payment_purchase - UPDATE | Folios / Payments |
| GET | `/base_api/fiscalization/generic/13184661` | generic - VIEW | Folios / Fiscalization |
| PUT | `/base_api/fiscalization/generic/13184661` | generic - UPDATE | Folios / Fiscalization |
| GET | `/base_api/fiscalization/norwegian/13184661` | Norway KID - VIEW | Folios / Fiscal Policies / Norway |
| GET | `/base_api/folios` | folios - VIEW LIST | Folios |
| GET | `/base_api/folios/13184661` | folio - VIEW | Folios |
| DELETE | `/base_api/folios/13184661` | folio - DELETE | Folios |
| GET | `/base_api/folios/13184661/folio_taxes` | folio_taxes - VIEW LIST | Folios |
| GET | `/base_api/folios/13184661/folio_taxes/:folio_tax` | folio_tax - VIEW | Folios |
| POST | `/base_api/folios/13184661/set_billing_to_company/:company_id` | folio_set_billing_to_company | Folios |
| POST | `/base_api/folios/13184661/set_billing_to_person/:guest_id` | folio_set_billing_to_person | Folios |
| POST | `/base_api/folios/13184661/close` | folio_close | Folios |
| POST | `/base_api/folios/13184661/terminal_transactions` | folio_terminal_transaction - CREATE | Folios |
| GET | `/base_api/charge_templates` | charge_templates - VIEW LIST | Charges |
| GET | `/base_api/charge_templates/:ct_id` | charge_template - VIEW | Charges |
| GET | `/base_api/charge_template_availabilities` | charge_template_availabilities | Charges |
| GET | `/base_api/folios/13184661/charges` | charges - VIEW LIST | Charges |
| GET | `/base_api/folios/13184661/charges/110745318` | charge - VIEW | Charges |
| POST | `/base_api/folios/13184661/charges/` | charge - CREATE | Charges |
| POST | `/base_api/folios/13184661/charges/bulk` | charge - BULK CREATE | Charges |
| DELETE | `/base_api/folios/13184661/charges/110745318` | charge - DELETE | Charges |
| GET | `/base_api/users/` | users - VIEW LIST | Users |
| GET | `/base_api/users/:user_id` | user - VIEW | Users |
| GET | `/base_api/companies` | companies - VIEW LIST | Companies |
| GET | `/base_api/companies/:company_id` | company - VIEW | Companies |
| POST | `/base_api/companies` | companies - CREATE | Companies |
| PUT | `/base_api/companies/:company_id` | companies - UPDATE | Companies |
| PUT | `/base_api/companies/:company_id` | companies - ARCHIVE | Companies |
| GET | `/base_api/companies/:company_id/folios` | company_folios - VIEW | Companies |
| POST | `/base_api/companies/:company_id/folios` | companies_foios - CREATE | Companies |
| GET | `/base_api/companies/chargeable_folios` | chargeable_folios_companies - VIEW | Companies |
| GET | `/base_api/2020-08-05/charge_logs` | charges_log | Operation Log |
| GET | `/base_api/2021-03-31/credit_item_logs` | credit_item_logs (payments log) | Operation Log |
| GET | `/base_api/folio_ledger` | folio_ledger | Operation Log |
| GET | `/base_api` | root | - |
| GET | `/base_api/document_types` | document_types - VIEW | - |
| POST | `/base_api/elavon_token` | elavon_token - CREATE | - |
| GET | `/base_api/exchange_rates` | exchange_rates - VIEW | - |
| GET | `/base_api/revenue_categories` | revenue_categories - VIEW LIST | - |
| GET | `/base_api/revenue_categories/50771` | revenue_category - VIEW | - |
| GET | `/base_api/payment_sub_types` | payment_sub_types - VIEW | - |
| GET | `/base_api/revenue_categories/50771` | payment_sub_type - VIEW | - |
| GET | `/base_api/closures` | closures - VIEW LIST | - |
| POST | `/base_api/credit_cards` | credit_card_token - CREATE | - |
| GET | `/base_api/credit_card_transactions/cc_transaction_id` | credit_card_transaction - GET | - |
| POST | `/base_api/adyen_v2/token_import` | adyen_v2_token_import - CREATE | - |
| GET | `/base_api/payment_terminals` | payment_terminals - VIEW | - |

### pms_api (Hotel specific functions) (101)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| GET | `/pms_api/bookings/` | bookings - LIST VIEW | Bookings |
| GET | `/pms_api/bookings/25334365` | booking - VIEW | Bookings |
| POST | `/pms_api/bookings/` | booking - CREATE | Bookings |
| PUT | `/pms_api/bookings/25334365` | booking - UPDATE | Bookings |
| GET | `/pms_api/bookings/25334365/folios/default` | default_booking_folios - VIEW | Bookings |
| GET | `/pms_api/bookings/25334365/folios/` | booking_folios - LIST VIEW | Bookings |
| POST | `/pms_api/bookings/25334365/folios/` | booking_folio - CREATE | Bookings |
| GET | `/pms_api/rooms/:room_id/2020-10-21/bookings` | bookings_by_room - LIST VIEW | Bookings |
| GET | `/pms_api/bookings/25334365/booking_guests` | booking_guests - VIEW | Bookings |
| GET | `/pms_api/bookings/25334365/booking_guests/9750987` | booking_guest - VIEW | Bookings |
| POST | `/pms_api/bookings/25334365/booking_guests/` | booking_guest - CREATE | Bookings |
| PUT | `/pms_api/bookings/25334365/booking_guests/9956689` | booking_guest - UPDATE | Bookings |
| DELETE | `/pms_api/bookings/25334365/booking_guests/9956689` | booking_guest - DELETE | Bookings |
| GET | `/pms_api/bookings/25334365/booking_self_service_to_dos` | booking_to_dos - LIST VIEW | Bookings |
| GET | `/pms_api/bookings/25334365/booking_self_service_to_dos/:todo_id` | booking_to_do - VIEW | Bookings |
| POST | `/pms_api/bookings/25334365/booking_self_service_to_dos` | booking_to_do - CREATE | Bookings |
| PUT | `/pms_api/bookings/25334365/booking_self_service_to_dos/:todo_id` | booking_to_do - UPDATE | Bookings |
| GET | `/pms_api/bookings/25334365/registration_cards/` | registration_cards - VIEW LIST (deprecated) | Bookings |
| POST | `/pms_api/bookings/25334365/adyen_tokens` | [DEPRECATED] adyen_tokens - CREATE | Bookings |
| GET | `/pms_api/booking_offers/` | booking_offers - VIEW LIST | Bookings |
| GET | `/pms_api/booking_offers/21398` | booking_offer - VIEW | Bookings |
| GET | `/pms_api/bookings/25334365/charges_by_source` | booking_charges_by_source - VIEW | Bookings |
| POST | `/pms_api/bookings/25334365/charges_by_source/bulk` | booking_charges_by_source - BULK CREATE | Bookings |
| POST | `/pms_api/bookings/25334365/charges_by_source` | booking_charges_by_source - CREATE | Bookings |
| POST | `/pms_api/bookings/25334365/assign_identity_tag` | booking_identity_tag - ADD | Bookings |
| POST | `/pms_api/bookings/unassign_identity_tag` | booking_identity_tag - DELETE | Bookings |
| GET | `/pms_api/bookings/find_by_tag/` | booking_find_by_identity_tag - VIEW | Bookings |
| POST | `/pms_api/bookings/25334365/booking_credit_cards` | booking_credit_cards - CREATE | Bookings |
| POST | `/pms_api/bookings/25334365/booking_credit_cards/{base}/charge_credit_card` | booking_credit_cards - CHARGE | Bookings |
| GET | `/pms_api/bookings/find_in_hotel` | booking_find_in_hotel - VIEW | Bookings |
| GET | `/pms_api/guests` | guests - VIEW | Guests |
| GET | `/pms_api/guests/search` | guests - search | Guests |
| GET | `/pms_api/guests/26782582` | guest - VIEW | Guests |
| POST | `/pms_api/guests` | guest - CREATE | Guests |
| PUT | `/pms_api/guests/26782582` | guest - UPDATE | Guests |
| GET | `/pms_api/room_types/` | room_types - VIEW | Rooms |
| GET | `/pms_api/room_types/:room_type_id` | room_type - VIEW | Rooms |
| PUT | `/pms_api/room_types/:room_type_id` | room_type - UPDATE | Rooms |
| POST | `/pms_api/room_types` | room_type - CREATE | Rooms |
| GET | `/pms_api/rooms/` | rooms - VIEW | Rooms |
| GET | `/pms_api/rooms/:room_id` | room - VIEW | Rooms |
| PUT | `/pms_api/rooms/:room_id` | room - UPDATE | Rooms |
| PUT | `/pms_api/rooms/:room_id` | room (housekeeping) - UPDATE | Rooms |
| POST | `/pms_api/rooms` | room - CREATE | Rooms |
| GET | `/pms_api/room_statuses` | room_statuses - VIEW | Rooms |
| GET | `/pms_api/room_types/:room_type_id/availability_adjustments` | availability_adjustments - VIEW | Rooms |
| POST | `/pms_api/room_types/:room_type_id/availability_adjustments` | availability_adjustments - CREATE | Rooms |
| GET | `/pms_api/price_boundaries` | price_boundaries - VIEW | Rates |
| GET | `/pms_api/rate_plans/` | rate_plans - VIEW LIST | Rates |
| GET | `/pms_api/rate_plans/:rateplan_id` | rate_plan - VIEW | Rates |
| POST | `/pms_api/rate_plans/` | rate_plan - CREATE | Rates |
| GET | `/pms_api/rates/` | rates - VIEW LIST | Rates |
| GET | `/pms_api/rates/:rate_id` | rates - VIEW | Rates |
| GET | `/pms_api/rate_packages/` | rate_packages - VIEW LIST | Rates |
| GET | `/pms_api/rate_packages/:ratepackage_id` | rate_package - VIEW | Rates |
| POST | `/pms_api/rates/:rate_id/rate_prices/` | rate_prices - UPDATE | Rates |
| GET | `/pms_api/rates_availability/` | rates_availability - VIEW | Rates |
| GET | `/pms_api/events/` | events - VIEW LIST | MICE / EVENTS |
| GET | `/pms_api/events/286545` | event - VIEW | MICE / EVENTS |
| POST | `/pms_api/events/` | events - CREATE | MICE / EVENTS |
| PUT | `/pms_api/events/286545` | events - UPDATE | MICE / EVENTS |
| GET | `/pms_api/events/chargeable_folios` | chargeable_folios_events - VIEW | MICE / EVENTS |
| GET | `/pms_api/events/286545/folios` | event_folios - VIEW | MICE / EVENTS |
| GET | `/pms_api/meeting_room_availability` | meeting_room_availability - VIEW | MICE / MEETING ROOMS |
| GET | `/pms_api/meeting_rooms/` | meeting_rooms - VIEW LIST | MICE / MEETING ROOMS |
| GET | `/pms_api/meeting_room_bookings` | meeting_room_bookings - VIEW LIST | MICE / MEETING ROOMS |
| GET | `/pms_api/meeting_room_bookings/147042` | meeting_room_booking - VIEW | MICE / MEETING ROOMS |
| POST | `/pms_api/meeting_room_bookings` | meeting_room_booking - CREATE | MICE / MEETING ROOMS |
| PUT | `/pms_api/meeting_room_bookings/147042` | meeting_room_booking - UPDATE | MICE / MEETING ROOMS |
| POST | `/pms_api/meeting_room_bookings/147042/charge` | meeting_room_booking_charge - CREATE | MICE / MEETING ROOMS |
| GET | `/pms_api/caterings` | caterings - VIEW LIST | MICE / CATERINGS |
| GET | `/pms_api/caterings/:37260` | caterings - VIEW | MICE / CATERINGS |
| POST | `/pms_api/caterings/` | caterings - CREATE | MICE / CATERINGS |
| PUT | `/pms_api/caterings/:37260` | caterings - UPDATE | MICE / CATERINGS |
| DELETE | `/pms_api/caterings/:37260` | caterings - DELETE | MICE / CATERINGS |
| GET | `/pms_api/blocks/` | blocks - VIEW LIST | MICE / BLOCKS |
| GET | `/pms_api/blocks/390896` | block - VIEW | MICE / BLOCKS |
| POST | `/pms_api/blocks/` | block - CREATE | MICE / BLOCKS |
| PUT | `/pms_api/blocks/390896` | block - UPDATE | MICE / BLOCKS |
| GET | `/pms_api/blocks/390896/block_rooms` | block_rooms - VIEW | MICE / BLOCKS |
| POST | `/pms_api/blocks/390896/block_rooms` | block_rooms - CREATE (for period) | MICE / BLOCKS |
| POST | `/pms_api/blocks/390896/block_rooms` | block_rooms - CREATE (for dates) | MICE / BLOCKS |
| GET | `/pms_api/block_pickups` | block_pickups - VIEW | MICE / BLOCKS |
| GET | `/pms_api/block_prices` | block_prices - VIEW | MICE / BLOCKS |
| GET | `/pms_api/door_keys` | door_keys - VIEW LIST | Door Keys |
| GET | `/pms_api/door_keys/:doorkey_id` | door_key - VIEW | Door Keys |
| POST | `/pms_api/door_keys/` | door_key - CREATE | Door Keys |
| PUT | `/pms_api/door_keys/:doorkey_id` | door_key - unsucesfull - UPDATE | Door Keys |
| PUT | `/pms_api/door_keys/:doorkey_id` | door_key - sucesfull - UPDATE | Door Keys |
| GET | `/pms_api/activities/89999ad2-d164-40f8-ba81-a4f0367faa94` | activity_providers - VIEW | Activities |
| POST | `/pms_api/bookings/25334365/activities/` | booking_activity - CREATE | Activities |
| POST | `/pms_api/events/286545/activities/` | event_activity - CREATE | Activities |
| GET | `/pms_api/activities/89999ad2-d164-40f8-ba81-a4f0367faa94` | activity - VIEW | Activities |
| PUT | `/pms_api/activities/89999ad2-d164-40f8-ba81-a4f0367faa94` | activity - UPDATE | Activities |
| GET | `/pms_api` | root | - |
| GET | `/pms_api/occupancy_forecasts/` | occupancy_forecasts - VIEW | - |
| GET | `/pms_api/rates_availability/` | rates_availability - VIEW | - |
| GET | `/pms_api/products` | products - VIEW | - |
| GET | `/pms_api/meals` | meals - VIEW | - |
| GET | `/pms_api/wbe_config` | wbe_config - VIEW | - |
| POST | `/pms_api/phone_calls.json` | phone_calls - CREATE | - |

### pos_api (Restaurant specific functions) (4)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| GET | `https://sky-eu1.clock-software.com/pos_api/80226/:pos_id/orders` | orders - VIEW LIST | Orders |
| GET | `https://sky-eu1.clock-software.com/pos_api/80226/:pos_id/orders/:pos_order` | order - VIEW | Orders |
| GET | `https://sky-eu1.clock-software.com/pos_api/80226/:pos_id/orders/:pos_order/charges` | order_charges - VIEW | Orders |
| GET | `https://sky-eu1.clock-software.com/pos_api/80226/:pos_id` | root | - |

### [DEPRECATED] Payment API (2)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| GET | `/base_api/custom_payment_purchases/:cpp_id` | custom_payment_purchase - VIEW | - |
| PUT | `/base_api/custom_payment_purchases/:cpp_id` | custom_payment_purchase - UPDATE | - |

### Yield Management API (7)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| GET | `/pms_api/room_types/:room_type_id/availability_adjustments` | Availability Adjustment - VIEW | Availability Adjustment |
| POST | `/pms_api/room_types/:room_type_id/availability_adjustments` | Availability Adjustment - CREATE | Availability Adjustment |
| POST | `/pms_api/rates/:rate_id/rate_prices/` | One date and price | Rate Price Update |
| POST | `/pms_api/rates/:rate_id/rate_prices/` | Price for a period (from – to) | Rate Price Update |
| POST | `/pms_api/rates/:rate_id/rate_prices/` | Stop from sale restriction for a date | Rate Price Update |
| POST | `/pms_api/rates/:rate_id/rate_prices/` | Price and all restrictions for a date | Rate Price Update |
| POST | `/pms_api/rates/:rate_id/rate_prices/` | Remove price and all restrictions for a date | Rate Price Update |

### Phonecalls API (3)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| POST | `/pms_api/phone_calls.json` | Example Request (Hello) | - |
| POST | `/pms_api/phone_calls.json` | Example Request (one phone call) | - |
| POST | `/pms_api/phone_calls.json` | Example Request (multiple phone call) | - |

### OTA Channel Connect API (22)

| Method | Path | Name | Section |
| --- | --- | --- | --- |
| | |  | Communication | Introduction |
| | |  | URL endpoint | Introduction |
| | |  | Authentication and Addressing | Introduction |
| | |  | Request Messages Envelope | Introduction |
| | |  | Response Message Envelope | Introduction |
| | |  | Messaging | Introduction |
| | |  | Error Handling | Introduction |
| | |  | EchoToken | Introduction |
| | |  | Data Mapping and Room Type / Rate Structure | Introduction |
| | |  | Availability | Rate and Availability Massages / Availability, Restrictions and LOS |
| | |  | Restrictions (Closed, Closed for Arrival, Closed for Departure) | Rate and Availability Massages / Availability, Restrictions and LOS |
| | |  | Length of Stay ( MinLOS, MaxLOS) | Rate and Availability Massages / Availability, Restrictions and LOS |
| | |  | New booking and update request | Booking Messages |
| | |  | Booking Response | Booking Messages |
| | |  | Confirmation request | Booking Messages |
| | |  | Confirmation response | Booking Messages |
| | |  | All booking fields | Booking Messages |
| | |  | Modifications and Cancellations | Booking Messages |
| | |  | PCI DSS | Booking Messages |
| | |  | Clock PMS+ configurations | Testing&Certification |
| | |  | In-house testing | Testing&Certification |
| | |  | Certification testing | Testing&Certification |

## Other Clock collections found through Postman (2026-10-25)

The Postman connection (account `dejvis0001`) was authorised and checked. Its workspaces hold one Clock collection, a fork of Clock's public documentation made on 2026-09-10 (same content as above). A search of the public Postman network found two more collections published by "Clock PMS+ Integrations":

| Collection | What it is | Relevance |
| --- | --- | --- |
| **Clock PMS+ API Docs+** (restricted, last updated 2022) | The Payment API v2 protocol: requests to a payment provider (pay with card data, HPP, terminal or token; pre-authorisation, capture, release; refund; tokenisation) and the provider's responses. States that use is "only possible with a special permission from Clock Software". | Only if MUST ever uses Clock's Payment Enablement Service; not part of the current plan. |
| **Clock PMS+ API Docs WORKSHOP** (drafts, last updated 2025-06) | Draft guides: the Revenue Management Systems API (availability adjustment, rate price updates) and **"Custom Booking Engine"**, Clock's own best practices for direct booking. | The Custom Booking Engine guide is the closest thing to a specification for MUST. |

**What Clock's Custom Booking Engine guide says (read in full):**

- Availability and price come from two requests: `rates_availability` (calendar, per rate, per date) and `products` (the search; it "evaluates rate restrictions" and can show "N/A" when a requirement such as advance booking, party size or length of stay is not met).
- A rate's **"Publish in WRS" setting is the switch for the booking engine**: a published rate shows `"wbe": true` in `rates`. MUST already filters on `wbe`.
- A booking needs `arrival`, `departure`, `arrival_room_type_id` and either `main_booking_guest` or `source_of_business_company_id`. Statuses `canceled` and `no_show` are not counted in availability, and a status can be changed back.
- Returning guests are found with `guests/search` (free text on name, email, phone) and linked through `family_id` as `main_booking_guest`.
- Payments are recorded with `credit_item (payment) - CREATE` (`value`, `currency`, `payment_type`, `payment_sub_type`, optional `reference`, `text`). **A refund must be made at the payment provider; voiding a payment in Clock does not refund. It is then reflected in Clock with a payment of a negative amount.**
- The guide says **nothing** about cancellation policies, discounts, original prices or per-endpoint rights.

Outcome for Milestone 27: nothing in any Clock collection exposes a cancellation policy, an original price or a list of rights per endpoint, so those remain questions for Clock support (or the rights check in Task 5).
