# Connecting a website to MUST: what the system does and what the website must do

Status: written 2026-11-09 from the public guest API ([API reference](../architecture/public-guest-api.md)), the Luxury Premium Finese website code (the working reference client), its [booking rules test plan](luxury-booking-tests.md) and the WordPress plugin. Where a statement is not verified in code, it says so.

**Two parts.** Part 1 is for people (owner, developers, designers): what each side is responsible for and what a good website does on every screen. Part 2 is written for AI assistants (Codex, ChatGPT, Claude): short rules, tables and pseudo-code that can be followed without reading anything else. Both say the same thing; if they ever disagree, the API reference wins, then tell the owner.

Related: [API reference](../architecture/public-guest-api.md) (every endpoint and field), [Astro website playbook](astro-playbook-checklist.md) (how to build the site itself), [Milestone 26](../roadmap/milestones/26-public-api.md) (API keys, not built yet).

---

# Part 1: For people

## 1. Who does what

MUST is the system of record. The website is a shop window and a guest-friendly form in front of it.

| MUST (the system) is responsible for | The website is responsible for |
| --- | --- |
| Rooms, photos and descriptions | Showing them well, in the site's own design and language |
| Which dates are free, closed or sold out | Showing that honestly (crossed-out days, clear messages) |
| Every price, tax and discount | Printing the number MUST gives, never calculating one |
| Rules: minimum stay, closed to arrival, capacity, how far ahead | Explaining a refusal in plain words and offering other dates |
| Taking the booking, holding the room, payment, refunds | Collecting the guest's details and sending the guest to pay |
| Confirming a payment | Waiting for MUST to confirm; never confirming anything itself |
| Cancellation rules and refund amounts | Showing what MUST says; never deciding a refund |
| Emails to the guest and the hotel | Its own contact-form emails only |
| Talking to the hotel's PMS (for example Clock) | Knowing nothing about the PMS |

Golden rule: **if the website has to guess, it is doing MUST's job.** Stop and ask.

## 2. Three ways to connect

| Way | Used by | Notes |
| --- | --- | --- |
| WordPress plugin | Empire Beach Resort today | The plugin talks to the API for the site. It has no look of its own. |
| Custom website (Astro or any code) through the public guest API | Luxury Premium Finese; Empire after the Astro rebuild; future hotels we build | The site's own server calls the API. This guide is mainly about this way. |
| API keys per hotel | Not built yet ([Milestone 26](../roadmap/milestones/26-public-api.md)) | Today the routes are open and limited per IP address. |

Hotel kinds that change what the API returns:

- **Clock hotel** (`pricingSource: CLOCK_PMS`, for example Empire): prices come live from Clock; a room can have several rates (bed and breakfast, full board); the discount shows as a crossed-out original price.
- **MUST-priced hotel** (`LOCAL`): rate plans are defined in MUST; the booking must name a rate plan.
- **Booking mode:** `ROOM_TYPE_ONLY` (guest picks a type), `INDIVIDUAL_ROOM_ONLY` (guest picks a numbered room) or `MIXED`. The mode decides whether the booking carries a room id.

## 3. Before you start

1. **Get the two ids** (tenant and property) of the hotel from the dashboard. Local work uses the **"Must Hotel" sandbox hotel**, never the client's real hotel. Real ids go only into the production settings file.
2. **Call the API from the website's server, never from the browser.** The API sends no CORS permission, so a browser call fails by design.
3. **Remember the guest's session cookie** (`must_guest_session`) and send it back on every call for that visitor. Quotes belong to that session.
4. **Set the hotel's public website address** in the dashboard before testing payment. The guest returns from the payment page to that exact address; any other address is refused.
5. **Share one limit for all guests:** the API limits requests per IP address, and a website server is one IP. Cache everything you can (see section 9).
6. If the site sits behind Cloudflare or similar protection, make sure it does **not** block the site server's calls to the API (a bot-protection rule once silently blocked all WordPress-to-API traffic).

## 4. The guest's journey

1. **Search:** the guest picks dates and guests. The calendar already shows what is closed.
2. **Rooms:** the list shows each room with a price for those dates, or the reason it cannot be booked.
3. **Room page:** details, photos, the rates (for Clock hotels) and a Book button.
4. **Details:** the guest enters their data and chooses how to pay.
5. **Payment:** a card payment happens on the payment provider's page. Pay-at-hotel skips it.
6. **Confirmation:** the site shows the result only after MUST has confirmed it.
7. **Manage:** a link in the guest's email lets them view or cancel the booking.

## 5. What the website must take care of, screen by screen

### 5.1 The date calendar (the one people notice first)

Load the room's calendar from MUST for the month shown (and the next month on wide screens), for the chosen number of adults and children. Each day arrives with a status. The calendar must:

- **Cross out and disable** every day that is sold out, closed or unavailable. They cannot be chosen as the first night.
- **Mark days that are closed to arrival** ("No check-in"): not selectable as the arrival day, but a guest may stay through that night.
- **Let the guest leave on the first blocked night.** A check-out day is not a night stayed, so check-out on the morning of a closed night is fine, unless that day is closed to departure.
- **Block any range that would include a blocked night.** If the guest picks an arrival and then a departure past a blocked night, the departure day is disabled.
- **Disable past dates.** Respect the longest stay the site supports (Luxury: 30 nights) and tell the guest in words when it is exceeded.
- **Never rely on colour alone:** give each crossed-out day a text hint (a tooltip and an accessible label such as "Closed / unavailable" or "No check-in").
- **Show states:** while a month is loading ("Checking dates…") and if it fails ("Dates could not be checked, please check rates"). If the calendar cannot load, the guest can still search; MUST re-checks everything at the end.
- **Refresh the calendar** when the number of guests changes (capacity can change availability).
- **Do not hide minimum stay.** A day may carry a minimum stay. The calendar may show it, and the room list must explain a refusal for it (section 5.2).

### 5.2 The room list

- Prices for the whole list come from one call (the display-price call), not one call per room.
- Show the total for the stay as MUST gives it, with its currency. Show a "from" price only if the API returned one.
- **When a room cannot be booked, say why, in plain words,** using the reason MUST returns (table in Part 2, section 6). Never write "fully booked" for a minimum-stay refusal.
- **When every room is refused for the same reason,** say that reason once above the list ("These dates need a longer stay").
- **Offer nearby dates** when MUST returns alternatives (up to three, within three days either way) and the reason is one where moving the dates helps.
- **Crossed-out price:** if MUST returns an original (higher) price, show it crossed out beside the new price, with the percentage if the site wants. Never show a crossed-out price MUST did not send.
- If prices cannot be loaded, show the rooms without prices and the message "Price unavailable, contact us or try again", never an invented price, and never a Book button that would book without a quote.

### 5.3 The room page

- Name, size, beds, guests, amenities, description, house rules and photos are shown as MUST returns them. Use the photo addresses exactly as given.
- For Clock hotels show **every rate** MUST returns as a choice (name, meals, total) and book the one the guest picks. The first one may be preselected; the guest must see the others.
- Gate the Book button: if the stay is refused, there is no Book button, only the reason.

### 5.4 The booking form

- Take the price from the quote MUST just issued and show it exactly. A quote lasts 15 minutes. If it expired, get a new quote and tell the guest the price was refreshed.
- Required guest data: first name, last name, email, country (a real country code from a fixed list), phone. Special requests: at most 2,000 characters.
- Offer only the payment methods MUST lists for the hotel (card providers and/or pay at hotel).
- **Stop double submits** (disable the button, one idempotency key per attempt). Retrying the same attempt reuses the same key; a changed form uses a new key.
- The hotel's terms and the privacy text belong to the website: link them and ask for acceptance.

### 5.5 After payment

- The payment provider sends the guest back to the site with the booking id and a hint (`outcome`). The hint is not proof.
- The site then asks MUST for the booking's status again and again (every few seconds) until it is final, and only then shows success or failure.
- Show one of four outcomes: **confirmed**, **still waiting** (keep polling, show a calm message), **failed** (payment failed, cancelled, expired, rejected, no longer available: offer to try again or contact), **under review** (MUST is checking: tell the guest the hotel will contact them; never say "failed").
- Remember the booking id and its cancellation token for the guest (a cookie) so the confirmation page still works when the return address carries no token.

### 5.6 Manage booking (from the guest's email)

- The email contains a link with a token. The page shows the booking and what cancelling means: whether it is automatic, the cut-off time, whether a refund applies and how much, or that the hotel will review the request.
- Always send the booking's current version with a cancel; if MUST says the version is stale, reload and show the new state.
- A cancellation is an action on MUST's rules; the site never promises a refund the API did not state.

### 5.7 Errors, slowness and outages

- A request can fail in two ways: a normal error code, or a "200 OK" answer with `ok: false` and an error object (booking problems). Handle both.
- Too many requests (429): wait for the time the answer says, show "Please try again in a moment", do not retry in a loop.
- A call takes longer than about 8 seconds (15 for booking creation): stop waiting, show a friendly message, keep the guest's data.
- If MUST is unreachable: rooms still appear without prices; booking is disabled with "Online booking is temporarily unavailable, please contact us" and the hotel's phone and email.
- Never show raw error text, ids or stack traces to guests. Log them on the server without personal data.

### 5.8 Information MUST does not provide

Some things stay on the website: the hotel's story, hero photos, offers and packages, contact page text, map, events, SPA, restaurant pages and legal texts. There is a property information call (address, phone, check-in and check-out times, house rules, cancellation text, currency, time zone). Any field can be empty; if it is, use the website's own approved text or leave the item out, never invent it.

### 5.9 Money and currency

- The hotel has **one money currency**: bookings, payments and refunds always use it.
- Other currencies are **display only**: an approximate conversion, clearly labelled as approximate, never charged. Conversion rates come from MUST's exchange-rate call (the hotel may have set its own).
- Format money with the guest's language, but never change the amount.

### 5.10 Privacy and consent

- Send guest data only to MUST (and your own mail server for forms). Do not put names, emails or phone numbers into analytics, logs or URLs.
- No third-party requests (maps, video, analytics, fonts, chat) before the guest consents. The booking itself needs no consent because it is the service the guest asked for.
- Describe in the privacy text what is stored and by whom.

## 6. Testing a connection

1. **Level 1, rules in a pretend system.** Use the Luxury scripts (`scripts/mock-must.mjs` and `scripts/test-booking-rules.mjs`) to try every refusal reason on the room list, the room page and by forcing the booking call directly. A refused stay must (a) not offer a Book button, (b) say why in words, (c) be refused by MUST even when forced.
2. **Level 2, the real sandbox ("Must Hotel").** Same cases against the real system. Then a full booking with the sandbox card, a pay-at-hotel booking, the manage link, a cancellation, and an expired quote.
3. **Level 3, a real booking on the live hotel,** only with the owner present, and cancelled afterwards, with the hotel told.

The full list of rules and the order of the tests are in [luxury-booking-tests.md](luxury-booking-tests.md).

## 7. Going live

- [ ] Real tenant and property ids in the production settings (never in Git).
- [ ] The hotel's public website address set to the live address, exactly (https, with or without www as the site uses).
- [ ] The WordPress plugin disconnected for hotels that leave WordPress (the guest email's manage link depends on it; ask the MUST team to confirm).
- [ ] Sandbox payment cards are not accepted on live; a real card test is done with the owner and refunded.
- [ ] Bot protection does not block the site server's calls to the API.
- [ ] Forms send to the right mailbox; booking emails come from MUST and are checked.
- [ ] Monitoring: a daily check that the rooms page shows prices; someone is told when it does not.

## 8. Glossary

Tenant: the hotel company's account. Property: one hotel inside it. Room type: a kind of room. Quote: MUST's signed price offer for one stay, valid 15 minutes. Idempotency key: a unique code for one submit so a retry cannot book twice. Return address: where the payment page sends the guest back to. PMS: the hotel's own management software (for example Clock). Sandbox: the test hotel and test payments.

## 9. Caching and limits (what Luxury does)

| Data | Kept for | Why |
| --- | --- | --- |
| Catalog (rooms, photos, texts) | 5 minutes | Rarely changes; large |
| Calendar month, display prices, rate offers, alternative dates | 60 seconds | Changes with bookings; limits are per IP |
| Quote, booking, manage | Never cached | Must be fresh and tied to the guest |

API limits per IP and hotel: reads 120/min, quotes 20/min, alternative dates 10/min, booking changes 10/min. One website server is one IP for all guests.

---

# Part 2: For AI assistants (self-contained rules)

You are building or changing a website that talks to MUST (the Must-Booking public guest API). Follow this part exactly. The endpoint details are in `docs/reference/must-booking-public-guest-api.md` (a copy of `docs/architecture/public-guest-api.md`). If this part and the API reference disagree, the API reference wins; report the difference to the owner.

## 1. Non-negotiable rules

1. NEVER calculate, round, discount or convert a price that is charged. Print `total.amount` and `total.currency` exactly as returned. Display-only conversions use `GET /public/exchange-rates` and are labelled approximate.
2. NEVER mark a booking confirmed or paid. Only `status === 'CONFIRMED'` read from `GET /public/bookings/:id` means confirmed.
3. NEVER call the API from browser code. Use server routes. The API has no CORS.
4. ALWAYS send the guest's `must_guest_session` cookie value on every API call for that visitor, and store it first-party (httpOnly) per visitor.
5. ALWAYS send a fresh `Idempotency-Key` (UUID) per booking, cancel or manage submit. Reuse the same key only to retry the identical request.
6. ALWAYS treat two error shapes: a non-2xx status, and HTTP 200 with `{ ok: false, error: { code, message, retryable } }`.
7. NEVER invent content (text, prices, photos, legal text). If a field is null, omit it or use approved site text; add a question to `docs/TODO.md`.
8. NEVER show raw error messages, ids or stack traces to guests; log them server-side without personal data.
9. Use the "Must Hotel" sandbox ids for development. Real ids only in `.env.production`. Never create a booking on a real hotel without the owner.
10. Cache reads as in section 8. A website server is one IP shared by all guests.

## 2. Setup values

| Name | Meaning |
| --- | --- |
| `MUST_API_BASE` | `https://booking.must.al/api` |
| `MUST_TENANT_ID`, `MUST_PROPERTY_ID` | Hotel scope. Every path is `${BASE}/tenants/${T}/properties/${P}/...` |
| Wrong pair | 403 `Invalid tenant scope.` |
| Suspended hotel | 403 `{ code: 'HOTEL_UNAVAILABLE' }` |
| Timeouts | 8 s for reads, 15 s for booking creation |

## 3. Which fields change behaviour

| Field (from `GET /public/catalog`) | Meaning | What you do |
| --- | --- | --- |
| `pricingSource: 'CLOCK_PMS'` | Prices live from the PMS | `ratePlanId` is `""`; read `GET /public/rate-offers`; send `clockRateId` |
| `pricingSource: 'LOCAL'` | Prices from MUST rate plans | `ratePlanId` is required in quote and booking |
| `bookingMode: 'ROOM_TYPE_ONLY'` | Guest picks a type | Do not send `roomId`; catalog dates optional |
| `bookingMode: 'INDIVIDUAL_ROOM_ONLY'` | Guest picks a numbered room | `roomId` required; catalog needs `startsOn` and `endsOn` |
| `bookingMode: 'MIXED'` | Either | `roomId` optional |
| `paymentMethods` | Allowed methods: `stripe`, `pokpay`, `pay_at_hotel` | Offer only these |

## 4. Endpoint cheat sheet

| Purpose | Call | Group | Cache |
| --- | --- | --- | --- |
| Rooms, photos, texts | `GET /public/catalog` | read | 5 min |
| One month of day statuses | `GET /public/availability-calendar?roomTypeId&month=YYYY-MM&adults&children[&roomId&rooms]` | read | 60 s |
| Room-list prices | `POST /quotes/display-prices` | quote | 60 s |
| One room available? | `GET /public/availability?...` | read | 60 s |
| Fail-open recheck | `GET /public/availability-check?...` | read | none |
| Rates of a room (Clock) | `GET /public/rate-offers?roomTypeId&startsOn&endsOn&adults[&children&code]` | read | 60 s |
| Other dates | `POST /quotes/alternative-dates` | alt (10/min) | 60 s |
| Binding price | `POST /quotes` | quote | never |
| Create booking | `POST /bookings` (+ `Idempotency-Key`) | booking | never |
| Read booking | `GET /public/bookings/:id[?cancellationToken=]` | read | never |
| Guest manage page data | `GET /bookings/:id/manage?token=` | booking | never (no-store) |
| Guest cancel or request | `POST /bookings/:id/manage` | booking | never |
| Hotel info | `GET /public/property` | read | 5 min |
| Display currencies | `GET /public/exchange-rates?currencies=EUR,USD` | read | ETag/304 |

Limits per IP and hotel per minute: read 120, quote 20, alternative dates 10, booking 10. On 429 honour `Retry-After`.

## 5. Calendar algorithm

Input: `days[]` from `availability-calendar` with `{ date, isAvailable, status, closedToArrival?, closedToDeparture?, minStay? }`. Today = local date.

```
unavailable(day) = day && (!day.isAvailable || status in {closed, sold_out, unavailable})
noArrival(day)   = day && day.closedToArrival === true

canPick(date, start, end):
  if date < today: return false
  if monthNotLoaded(date): return false            // while loading, nothing is pickable
  day = dayOf(date)
  if start && !end && date > start:                // choosing the check-out day
      if day.closedToDeparture: return false
      for d in [start, date): if unavailable(dayOf(d)): return false   // every night stayed must be free
      return true                                  // the check-out day itself may be an unavailable night
  return !unavailable(day) && !noArrival(day)      // choosing the check-in day
```

Rendering: `unavailable` or `noArrival` days get a "crossed out" style AND a text hint (`title` and `aria-label`: "Closed / unavailable" or "No check-in"). Disabled days are real `disabled` buttons. Load the visible month (and the next on desktop widths); reload when adults or children change. States: `loading` ("Checking dates…"), `failed` (message, do not block searching). Maximum stay offered by the UI: 30 nights, with a text message above the dates when exceeded. Past dates are always disabled.

## 6. Reason codes (room list and room page)

Returned as `reason` (display prices) or in `restrictionErrors[].code` (availability). Show the message; offer alternatives where the table says yes.

| Code | Message to show | Alternatives? |
| --- | --- | --- |
| `sold_out` | This room is sold out for your dates. | yes |
| `min_stay` | This room needs a longer stay for these dates. | no |
| `max_stay` | This room needs a shorter stay for these dates. | no |
| `no_arrival` | This room cannot be booked to arrive on your check-in day. | yes |
| `no_departure` | This room cannot be booked to leave on your check-out day. | yes |
| `closed` | This room is closed on some of these dates. | yes |
| `capacity` | This room is too small for your group. | no |
| `same_day_closed` | This room is closed for same-day booking. | yes |
| `too_far_ahead` | These dates are not open for booking yet. | yes |
| `past_date` | Check-in is in the past. | no |
| (website) check-out not after check-in, more than 30 nights | Message above the dates | no |

If every room has the same reason, show it once above the list instead of "fully booked". A refused room has no Book button. Unknown reason code: show a neutral "These dates are not available for this room." and log the code.

## 7. Booking sequence and status mapping

```
1. catalog (cached) + display-prices for the list
2. user picks room (+ rate for CLOCK_PMS from rate-offers)
3. POST /quotes {roomTypeId, startsOn, endsOn, ratePlanId ("" for Clock), clockRateId?, promoCode?, adults, children}
      -> keep quoteToken + total (valid 15 min, bound to session)
4. POST /bookings (Idempotency-Key) {..., total: quote.total, quoteToken, paymentMethod, returnUrl, guest{...}}
      -> ok:true: value.id, value.cancellationToken, value.checkoutUrl?
5. checkoutUrl present (card): store booking id + cancellationToken in a cookie, redirect guest to checkoutUrl
   no checkoutUrl (pay_at_hotel): go to the site's confirmation page
6. confirmation page: poll GET /public/bookings/:id every ~3 s until the outcome is not 'pending'
```

`returnUrl` origin must equal the property's public website origin exactly, else 400. The provider adds `?booking_id=<id>&outcome=success|cancel` (a hint only). Quote expired (`QUOTE_EXPIRED`, `QUOTE_INVALID`, `QUOTE_SESSION_INVALID`): get a new quote and a new idempotency key, tell the guest the price was refreshed.

| Booking `status` | Outcome | Show |
| --- | --- | --- |
| `CONFIRMED` | confirmed | Success, reference, manage link |
| `PAYMENT_PENDING`, `PMS_CREATION_PENDING`, `PMS_CONFIRMATION_PENDING` | pending | "We are confirming your booking", keep polling |
| `PAYMENT_FAILED`, `CANCELLED`, `EXPIRED`, `PMS_REJECTED`, `AVAILABILITY_FAILED` | failed | Failure text, offer retry or contact |
| `MANUAL_REVIEW`, `PMS_UNKNOWN_RESULT` | review | "The hotel is checking your booking and will contact you" (never "failed") |
| anything else | pending | Keep polling, stop after a sensible limit and show contact details |

## 8. Errors and caching decision table

| Situation | Action |
| --- | --- |
| 400 validation (`message`, `statusCode`) | Show a field-level or general message; do not retry unchanged |
| 200 with `ok:false` (`QUOTE_*`, `PAYMENT_METHOD_NOT_ENABLED`, `PROMO_UNAVAILABLE`, `INVALID_BOOKING_COMMAND`) | Map to a guest message; `retryable:true` allows one retry with a fresh key |
| 403 `Invalid tenant scope.` | Configuration error: stop and tell the owner |
| 403 `HOTEL_UNAVAILABLE` | Show "Online booking is not available now" and contact details |
| 404 booking not found | "We could not open this booking. Use the link in your email or contact us." |
| 409 version or idempotency conflict | Reload the booking, show the new state; for idempotency conflict build a new submit |
| 429 | Wait `Retry-After`, show "try again in a moment", no retry loop |
| Timeout or 5xx | Friendly message, keep the guest's input, rooms without prices, booking disabled |
| `availability-check` returns `checked:false` | Treat as available; the booking call re-checks |

## 9. Money, currency, privacy

Charged currency = hotel currency from the quote. Show approximate conversions only if requested, labelled "approximate", from `exchange-rates` (`rates[X]` multiplies the hotel price). Never place guest data in URLs, analytics or logs. Load no third-party resource before consent.

## 10. Acceptance tests (the site is not done until all pass)

1. Given a room with a sold-out day, when the calendar opens, then that day is disabled, crossed out and has a text hint.
2. Given a day closed to arrival, then it cannot be the first night but a stay may pass through it.
3. Given a closed night after the chosen arrival, then departure days beyond it are disabled and the day of that night itself is allowed as the departure.
4. Given each reason code in section 6, the room list and room page show the table message, no Book button, and a forced `POST /bookings` is refused.
5. Given all rooms refused for one reason, the list shows that reason once.
6. Given the API is down, rooms show without prices and booking is disabled with contact details.
7. Given a quote older than 15 minutes, submit shows a refreshed price with a new quote, no double booking.
8. Given a double click on Pay, only one booking is created.
9. Given the guest returns from payment with `outcome=success` but the status is `PAYMENT_PENDING`, the page keeps waiting and does not say confirmed.
10. Given status `MANUAL_REVIEW`, the page says the hotel is checking, not "failed".
11. Given a cancellation with a stale `version`, the page reloads the booking and shows the new state.
12. No browser network request goes to `booking.must.al/api` (only to the site's own routes).
13. No third-party request happens before consent.

## 11. Where the working code is

Reference client (Luxury Premium Finese): `src/lib/must.ts` (API client, caching, error handling), `src/pages/api/*.ts` (server routes), `src/scripts/ui.ts` (calendar), `src/scripts/book.ts` and `booking-poll.ts` and `booking-return.ts` (checkout and polling), `src/lib/booking-status.ts` (status mapping), `scripts/mock-must.mjs` and `scripts/test-booking-rules.mjs` (tests). Copy the patterns; never copy the hotel's words, photos or colours.
