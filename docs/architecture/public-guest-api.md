# Public guest API (for non-WordPress websites)

> **2026-11-20:** our hotel websites are Astro sites (Empire Beach Resort moved to Astro and answers on `empirebeachresort.al`). The WordPress plugin in this repository is legacy and is not updated for new settings. New hotel settings reach websites through this API only.

Status: **IMPLEMENTED**. Written 2026-11-02 from the code and from live read-only calls against Empire Beach Resort. Audience: whoever builds a custom hotel website (for example Astro) that reads a hotel's data and takes bookings without the WordPress plugin. Milestone 26 ([API keys](../roadmap/milestones/26-public-api.md)) is not built; today these routes are open.

Working reference client: [MustApiClient.php](../../apps/wordpress-plugin/src/Core/MustApiClient.php) plus the checkout and confirmation pages in [apps/wordpress-plugin/src/Frontend/](../../apps/wordpress-plugin/src/Frontend/). Types: `@must/domain-contracts` ([index.ts](../../packages/domain-contracts/src/index.ts)) has `Booking`, `Money`, `BookingStatus`, `GuestPaymentMethod`, `NightlyRate`, `AvailabilityResult`. It has no HTTP client, and the catalog, quote, display-price and exchange-rate response types live unexported in `apps/api/src`.

## Base URL and scope

- Live API base: `https://booking.must.al/api` (the bare host serves the dashboard).
- Every path starts `/tenants/:tenantId/properties/:propertyId/...`. Get both IDs from the dashboard URL (`/dashboard/<tenantId>?propertyId=<propertyId>`).
- Hotels (live, 2026-11-02): Empire Beach Resort `458b66cd-6a04-4c4f-a0e3-1827937d24aa` / `3d680e29-8223-4d37-b0d2-b9f0db9400a9`; Luxury Premium Finese `f1dd7a05-14c8-40cd-8058-ac87752d30c1` / `bd725498-74d1-4828-9964-5306390276a0`.
- A wrong ID pair returns 403 `Invalid tenant scope.`. A suspended, cancelled or archived hotel returns 403 `{code:'HOTEL_UNAVAILABLE'}`.

## Sessions, cookies and keys

- First call to any public route sets `must_guest_session=<uuid>` (`HttpOnly; Secure; SameSite=None`). Replay it as `Cookie: must_guest_session=<uuid>` on every later call. WordPress copies it into its own first-party cookie; a custom server must do the same per visitor.
- Quotes are bound to that session and the booking re-checks it, so quote and booking must use the same value.
- `Idempotency-Key` header: required on POST/PATCH/DELETE of bookings. The client creates it (a fresh UUID per submit; reuse only to retry the same request). Reuse with a different body returns 409.
- No CORS handling exists in the API ([main.ts](../../apps/api/src/main.ts)); live responses carry no `Access-Control-*` headers. Call the API from the server (Astro server routes), never from the browser.

## Rate limits (per socket IP, per hotel, Redis fixed window)

| Group | Routes | Limit |
|---|---|---|
| read | branding, catalog, availability, availability-check, availability-calendar, rate-offers, exchange-rates, GET booking | 120 / min |
| quote | POST `/quotes`, `/quotes/display-prices` | 20 / min |
| alternative dates | POST `/quotes/alternative-dates` | 10 / min |
| booking mutation | POST/PATCH/DELETE bookings, `/bookings/orders`, manage page | 10 / min |

Over the limit: 429 `Too many requests. Please try again later.` with `Retry-After`. A server-side client behind one IP shares one bucket for all guests, so cache reads.

## Errors

- Validation: Nest flat `{"message": "...", "error": "Bad Request", "statusCode": 400}`.
- Booking-domain failures return **HTTP 200** with `{"ok":false,"error":{"code","message","retryable"}}`. Known codes: `QUOTE_REQUIRED`, `QUOTE_INVALID`, `QUOTE_EXPIRED`, `QUOTE_SESSION_INVALID`, `QUOTE_MISMATCH`, `PAYMENT_METHOD_NOT_ENABLED`, `PROMO_UNAVAILABLE`, `INVALID_BOOKING_COMMAND`. Check both shapes.

## Read endpoints (real examples from Empire)

Dates are `YYYY-MM-DD`; `endsOn` must be after `startsOn`. `adults` (>=1), `children` (>=0), `rooms` are plain integers in the query string.

**GET `/public/branding`** (name and logo only)
```json
{"name":"Empire Beach Resort","logoUrl":"https://new.empirebeachresort.al/wp-content/uploads/2026/03/Logo.png"}
```

**GET `/public/catalog`**. For `INDIVIDUAL_ROOM_ONLY` and `MIXED` hotels `startsOn` and `endsOn` are **required** (400 without them); for `ROOM_TYPE_ONLY` they are optional. Top level: `{ bookingMode?, pricingSource: "CLOCK_PMS"|"LOCAL", paymentMethods: ["stripe"|"pokpay"|"pay_at_hotel"], roomTypes: [...] }`. A room type (trimmed):
```json
{
  "id": "af7fa184-...", "name": "Deluxe Room - Jackuzzi: Garden Entrance",
  "description": "Room Size 45 m²\n...", "amenitiesIntro": "Free toiletries\n...",
  "rules": "No smoking\nNo pets", "rulesSource": "room-type", "maxOccupancy": 3, "category": null,
  "amenities": [{"id":"7000ff46-...","name":"Balcony","icon":"BALCONY"}],
  "ratePlans": [], "requiresRatePlanSelection": false,
  "mainImageUrl": "https://booking.must.al/photos/library/.../0b7b09d1-....webp",
  "galleryImageUrls": ["https://booking.must.al/photos/room-types/.../....webp"],
  "rooms": [{"id":"9178a01f-...","name":"DR","title":null,"roomSize":null,"description":"...","amenities":[],"floor":null,"viewType":null,"isAvailable":true,"images":[{"id":"","url":"","sortOrder":0,"isPrimary":true}],"photoSource":"room_type"}]
}
```
`rooms` appears only for individual-room and mixed hotels. `category` is `{id,name,description,sortOrder}` or null. Photos are ordered by sort order, primary first.

**GET `/public/availability?roomTypeId&startsOn&endsOn&adults&children`**
```json
{"roomTypeId":"af7fa184-...","startsOn":"2027-06-01","endsOn":"2027-06-02","isAvailable":true,"availableUnits":1}
```
Can also carry `restrictionErrors:[{code,message}]`.

**GET `/public/availability-check`** (same query plus optional `roomId`; fails open): `{"isAvailable":false,"checked":true}`. `checked:false` means unknown, assume available.

**GET `/public/availability-calendar?roomTypeId&month=YYYY-MM[&roomId&adults&children&rooms]`**
```json
{"days":[{"date":"2027-06-01","isAvailable":true,"status":"available","referencePrice":{"amount":"23500.00","currency":"ALL"},"availableUnits":1},
         {"date":"2027-06-02","isAvailable":false,"status":"sold_out"}]}
```
`status`: `available | sold_out | closed | unavailable`. Optional per day: `closedToArrival`, `closedToDeparture`, `minStay`.

**GET `/public/rate-offers?roomTypeId&startsOn&endsOn&adults[&children&code]`** (Clock hotels; the chosen `rateId` goes back as `clockRateId`):
```json
{"offers":[{"rateId":"546554","name":"BB","label":"Bed & breakfast","mealNames":["Breakfast"],"total":{"amount":"23500.00","currency":"ALL"}}]}
```
Empty list for hotels without Clock or when nothing is bookable.

**GET `/public/exchange-rates?currencies=EUR,USD`** (1 to 30 three-letter codes; ETag and 304 supported). Display only; bookings are always priced and charged in the hotel currency (ADR-0038).
```json
{"base":"ALL","date":"2026-10-28","rates":{"ALL":1,"EUR":0.0111,"USD":0.01228},"sources":{"EUR":"hotel","ALL":"feed"},"version":"10","displayCurrencies":["EUR","GBP","USD"],"approximate":true}
```
`rates[X]` is how many units of X one unit of `base` buys: multiply the hotel price by it.

## Quote endpoints

**POST `/quotes/display-prices`** body `{startsOn, endsOn, adults?, children?, childrenAges?, roomCount?, items:[{key, roomTypeId, roomId?, ratePlanId?, currency?}]}` (max 250 items; no session binding). Use it for room-list prices.
```json
{"prices":[{"key":"a","roomTypeId":"af7fa184-...","available":true,"total":{"amount":"23500.00","currency":"ALL"},"freeRooms":1}]}
```
Unavailable: `{"key":"a","roomTypeId":"...","available":false,"reason":"sold_out"}`. Reasons include `sold_out`, `min_stay`, `max_stay`, `capacity`, `same_day_closed`, `too_far_ahead`, `past_date`. Optional `originalTotal` for a crossed-out price.

**POST `/quotes/alternative-dates`** same body, returns `{"alternatives":[{startsOn,endsOn,shiftDays,availableRoomTypes,fromPrice}]}` (up to 3, within +/-3 days).

**POST `/quotes`** body: `roomTypeId`, `startsOn`, `endsOn` required; `ratePlanId` required for MUST-priced hotels (send `""` for Clock hotels); optional `roomId`, `clockRateId`, `promoCode`, `adults`, `children`, `childrenAges[]`, `guestCount`. Returns the signed payload; the token lives 15 minutes and is bound to the guest session.
```json
{"version":1,"tenantId":"...","propertyId":"...","roomTypeId":"af7fa184-...","ratePlanId":"","startsOn":"2027-06-01","endsOn":"2027-06-02",
 "adults":2,"children":0,"guestCount":2,"total":{"amount":"23500.00","currency":"ALL"},
 "nightlyRates":[{"date":"2027-06-01","amount":"23500.00"}],"expiresAt":"2026-11-02T10:57:01.845Z","sessionBinding":"<hash>","quoteToken":"<signed>"}
```
No price: 400 `Clock has no available price for the requested stay.` (or the local pricing/rule message).

## Booking endpoints

**POST `/bookings`** (header `Idempotency-Key` required, else 400 `Idempotency-Key header is required.`). Body:
```json
{
  "roomTypeId":"...", "roomId":"(optional)", "ratePlanId":"", "startsOn":"2027-06-01", "endsOn":"2027-06-02",
  "total":{"amount":"23500.00","currency":"ALL"}, "quoteToken":"<from quote>",
  "adults":2, "children":0, "paymentMethod":"pokpay",
  "clockRateId":"(optional)", "promoCode":"(optional)", "returnUrl":"https://site.example/booking/confirmation",
  "guest":{"firstName":"","lastName":"","email":"","countryCode":"AL","phone":null,
           "streetAddress":null,"addressLine2":null,"city":null,"county":null,"postcode":null,"specialRequests":null,
           "arrivalTime":null,"companyName":null,"taxNumber":null,"marketingConsent":false}
}
```
`guest.countryCode` must be an assigned ISO code (400 otherwise); `specialRequests` max 2000 characters. `arrivalTime` is `HH:MM` (24-hour); `companyName` max 160 and `taxNumber` max 40 characters; `marketingConsent` is only ever `true` when the guest ticked it (stored with the time it was given, never assumed). Booking form: when the hotel sets `form.address`, `form.arrivalTime`, `form.specialRequests` or `form.company` to `required`, a guest booking without it is refused with 400 and a message for the guest (address means street, city and postcode); phone and country are not enforced here (every website asks for them, and callers have always been able to omit them); marketing consent is never required; staff bookings are not held to the form; the multi-room order does not carry these fields yet. Success: `{"ok":true,"value":{...Booking, "cancellationToken":"...", "checkoutUrl":"...", "checkoutOrderId":"..."}}`. `checkoutUrl` is present only for card methods. Legacy fields `payAtHotel` and `guestCount` exist; send `paymentMethod`, `adults`, `children`.

**POST `/bookings/orders`** multi-room: `{startsOn, endsOn, paymentMethod, guest:{firstName,lastName,email,phone}, rooms:[{roomTypeId, roomId?, ratePlanId, total, guestCount, quoteToken, guest?}]}`. Not used by any website yet; see [multi-room-booking.md](../websites/multi-room-booking.md) for the flow and what is still missing (gap G-105, now closed in the API: form fields, terms, return address and bank transfer). Each room may also carry `adults`, `children`, `childrenAges`, `clockRateId`, `promoCode`. The guest manage page takes `scope: "room"` to cancel one room of an order.

**GET `/public/bookings/:bookingId[?cancellationToken=]`** returns the `Booking` object. It also carries `emailHint`, the address the booking's emails go to with most of it hidden (`a***@icloud.com`), so the confirmation page can say "we sent it to ..." (G-96).

**POST `/bookings/:bookingId/manage/resend-confirmation`** body `{token, email?}`: sends the confirmation again to the address on the booking, or to `email` when the guest typed another one. Needs the manage-link `token`. Answers `{sent:true, sentTo:"a***@icloud.com"}`; 400 for a bad address, 409 when the booking is not confirmed, 429 after 3 resends in a day for that booking. The manage preview (`GET .../manage?token=`) also returns `emailHint`. Staff have the same on the booking page (`POST /tenants/:t/properties/:p/bookings/:id/resend-confirmation`, `bookings.edit`). Needs the same guest session, or the token. Unknown or foreign ID returns 404 `Booking was not found.`.

**DELETE `/bookings/:bookingId[?cancellationToken=]`** body `{expectedVersion, reason, cancellationToken?}`, `Idempotency-Key` required. Uses the booking `version` from the GET.

**PATCH `/bookings/:bookingId`** body `{expectedVersion, total}`, `Idempotency-Key` required. The plugin never calls it.

**GET `/bookings/:bookingId/manage?token=`** (guest link from email; no-store):
`{reference, status, version, startsOn, endsOn, room, currency, cutoffAt, timezone, automaticAllowed, policyKnown, refundAmount, checkingMoney}`.

**POST `/bookings/:bookingId/manage`** body `{token, version, details (3-2000 chars), action:"cancel"|"request", requestRefund?}` plus `Idempotency-Key` (max 200). A stale `version` returns 409. Some cancellations become a staff review request instead.

## Booking and payment flow

1. Catalog (with dates) and prices (`display-prices` or availability) for the room list.
2. `POST /quotes` for the chosen room; keep `quoteToken` and the `total`.
3. Collect guest details. `POST /bookings` with the quote token, the exact `total`, `paymentMethod` and `returnUrl`.
4. Card methods (`pokpay`, `stripe`): the booking is `PAYMENT_PENDING` and the response has `checkoutUrl`; redirect the guest there. `pay_at_hotel`: no `checkoutUrl`; go straight to the site's own confirmation page.
5. The provider returns the guest to `returnUrl` with `?booking_id=<id>&outcome=success|cancel` appended. `outcome` is a hint only.
6. Poll `GET /public/bookings/:id` (same session or `cancellationToken`) until `status` is final. The return URL carries no token, so remember it from the `POST /bookings` response.
7. The API confirms the payment itself (PokPay webhook and a once-a-minute sweep, Stripe webhook). A website can never confirm a booking, set a price or mark anything paid.

Final or notable statuses ([index.ts](../../packages/domain-contracts/src/index.ts)): `CONFIRMED`, `PAYMENT_PENDING`, `PAYMENT_FAILED`, `PMS_CREATION_PENDING`, `PMS_CONFIRMATION_PENDING`, `PMS_UNKNOWN_RESULT`, `PMS_REJECTED`, `MANUAL_REVIEW`, `AVAILABILITY_FAILED`, `CANCELLED`, `EXPIRED`.

## Traps for a custom client

- **`returnUrl` origin check.** Its origin must exactly equal the property's `public_website_origin`, otherwise 400 `returnUrl must use the property public website origin.`. A hotel with none set cannot take a returnUrl. Set it in the dashboard or `PATCH /tenants/:t/properties/:p/public-website-origin` (staff). Only one origin is stored, so change it between local and live. Luxury Premium Finese has none set yet.
- Quotes expire after 15 minutes; a retry after expiry needs a new quote and a new idempotency key.
- Clock hotels (`pricingSource: "CLOCK_PMS"`): `ratePlans` is empty, `ratePlanId` is `""`, prices are live from Clock, and `rate-offers`/`clockRateId` apply. MUST-priced hotels (`LOCAL`): `ratePlanId` is mandatory.
- `availability-check` fails open; the real check runs again at booking.
- `Secure; SameSite=None` cookies do not persist on plain `http://localhost` in a browser; forward the cookie from the server instead.
- Photos are on `https://booking.must.al/photos/...` (local storage) or the object store, as given in the URLs. Use the URLs as returned.

## What the API does not provide

The staff property record holds address, phone, support email, check-in and check-out times, house rules, terms URL, brand colour and timezone ([properties.service.ts](../../apps/api/src/tenancy/properties.service.ts)), but no public route exposes them; branding returns only name and logo. A custom site must hard-code or source elsewhere: contact details and map, check-in/out times, hotel-level description and gallery, languages, terms and policy text, and the hotel currency (infer it from the exchange-rates `base`). The `GET /public/property` route described under "Custom-website additions" below closes most of this gap once deployed.

## Custom-website additions (2026-11-02, built, not yet deployed)

- **GET `/public/property`** (read group, 120/min): `{name, address, phone, supportEmail, checkInTime, checkOutTime, houseRules, termsUrl, freeCancellationDays, cancellationText, currency, timezone}`. Any field may be `null`. `currency` is the hotel's default currency, else its first rate plan's. `cancellationText` is generated from `freeCancellationDays`.
- **Manage link in the guest email.** When the property has a `public_website_origin` **and no WordPress plugin connected** (`wordpress_connected_at` is null), the link is `{origin}/booking/manage?tenant=<id>&property=<id>&booking=<id>&token=<token>` (a custom site can ignore `tenant` and `property`). Otherwise it stays the dashboard link `WEB_APP_URL/booking/manage?tenant&property&booking&token`, so WordPress hotels such as Empire are unchanged.
- **Sandbox (Must Hotel).** Its origin was set to `http://localhost:4321` on 2026-11-02 and its `wordpress_connected_at` cleared (it was `2026-09-10 22:24:34.226284+00`, origin was `https://new.empirebeachresort.al`). Undo with one `UPDATE properties` on property `9231b946-f244-4a84-af54-0774710f3464`.
- **Individual-room hotels need `roomId`** on `POST /bookings` (`local-pms.provider.ts` rejects a booking without it when `booking_mode = INDIVIDUAL_ROOM_ONLY`); `ROOM_TYPE_ONLY` rejects one that has it; `MIXED` accepts either.

## Booking rules for the website (`GET /public/property` → `profile.booking`)

Added 2026-11-20 with the Booking rules settings page. Read it with the rest of the property (cache it for a few minutes). All values are the hotel's own settings; the API still decides every booking.

| Field | Meaning for the website |
| --- | --- |
| `stay.minNights`, `stay.maxNights` | The hotel-wide stay limits (`null` = none). Dates can have their own limits: the calendar and the room list reasons are authoritative. |
| `stay.bookUpToDays`, `stay.minNoticeHours` | How far ahead guests can book, and how long before the arrival day booking closes. |
| `season.from`, `season.to` | The yearly season as `MM-DD` (both `null` = open all year). It may run over the new year. |
| `arrivalDays`, `departureDays` | Allowed weekdays, ISO 1 (Monday) to 7 (Sunday). |
| `sameDay.allowed`, `sameDay.cutoffTime` | Same-day bookings. |
| `group.maxGuests`, `group.maxRooms`, `group.requestForm` | Limits for one booking. With `requestForm` true the site shows a group request form instead of a dead end and sends it to `POST /group-requests` (below). The request address is never published. |
| `ages.minimumToBook`, `ages.childrenUpTo`, `ages.infantsUpTo`, `ages.askChildrenAges` | Guest age rules. Prices by age always come from the API. |
| `confirmation.mode`, `confirmation.answerWithinHours` | `instant` or `on_request` (not built yet: sites must treat anything but `instant` as instant until the on-request flow exists). |
| `form.*` | `required`, `optional` or `hidden` for phone, country, address, arrivalTime, specialRequests, guestNamePerRoom, company, marketing. Email and the main guest name are always asked. |
| `fillGapNights` | A shorter stay that exactly fills a gap is allowed (not built yet). |

**Enforced today (the server refuses and the site shows the reason):** stay limits, notice, how far ahead, season, arrival and departure days, same-day cutoff, group size (guests and rooms). **Works today:** the group request form (`POST /group-requests`). **Saved but not applied yet:** ages, confirmation mode, gap filling. **Booking form fields:** the server enforces `required` for address, arrival time, special requests and company (see `POST /bookings`); a hotel website must ask for a field before the hotel marks it required. A site that follows `form.*` or `ages.*` before the server applies them must still accept what the server accepts.

**Reasons for refused stays** (display prices `reason`): `min_stay`, `max_stay`, `no_arrival`, `no_departure`, `capacity`, `same_day_closed`, `too_far_ahead`, `past_date`, plus new in 2026-11-20: `too_short_notice` (booking closed this close to arrival), `outside_season` (the hotel is closed for the season), `too_many_rooms` (more rooms than one booking allows). A site that does not know a reason shows the neutral "not available" text; the playbook table lists the messages.

### Group requests (`POST /tenants/:tenantId/properties/:propertyId/group-requests`)

Added 2026-11-22. A guest whose party is bigger than the booking limits asks the hotel for a quote. Show the form only when `profile.booking.group.requestForm` is true; a hotel that has not switched it on answers 404.

- **Body (JSON):** `startsOn`, `endsOn` (YYYY-MM-DD, arrival not in the past, 1 to 60 nights), `adults` (1 to 500), `children` (0 to 500, optional), `rooms` (1 to 200), `name`, `email`, and optional `phone` (international, `+355...`), `organisation`, `message` (up to 2,000 characters, at most two links), `language` (`en`, `sq`, `it`).
- **Answer:** `201 {"ok": true, "id": "..."}`. A bad value answers 400 with a plain message to show the guest. It is a public mutation: rate limited like booking creation, no session cookie needed.
- **What happens:** the request is stored, the hotel gets a notice in its dashboard and an email (to its group request address, else its reservations address, else its support address) that it can reply to, and the guest gets a fixed acknowledgement that repeats nothing they typed (only dates and counts), because the address is not verified. One email address can send at most three requests per hotel per day (the fourth answers 429). A request is not a booking: the hotel answers with a quote by email.
- Add a honeypot and a timing check on the site, as for the booking form.
