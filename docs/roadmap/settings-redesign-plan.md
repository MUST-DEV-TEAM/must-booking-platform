# Settings redesign plan

Status: **design complete, waiting for owner approval** (reviewed tab by tab with the owner on 2026-11-17 and 2026-11-18). Nothing here is built yet unless it says "exists".

The property Settings area (`?section=settings`) reviewed end to end: structure, content, fields and their rules, frontend and backend. Goal: one obvious place for each setting, nothing duplicated, nothing dead, the same components everywhere, industry-standard fields with proper inputs and server-side rules, and every screen working for Clock hotels, native-PMS hotels and future integrations.

Main files today: `apps/web/app/dashboard/settings.tsx`, `settings-hub.tsx`, `settings-areas.ts`, `settings-forms.tsx`, `settings-connection-forms.tsx`, `hotel-settings-fields.tsx`, `display-currencies-settings.tsx`, `integration-settings.tsx`, `email-settings.tsx`, `emails.tsx`, `email-configuration.tsx`, `staff.tsx`, `activity-audit.tsx`, `[tenantId]/integrations-management.tsx`, `dashboard-shell.tsx`; API `apps/api/src/tenancy/properties.service.ts`, `properties.controller.ts`, `hotel-settings.ts`, `apps/api/src/integrations/`, `apps/api/src/mail/`.

Related: [Stripe hardening plan](stripe-hardening-plan.md), [gaps log](../audit/hardening-gaps-log.md) (G-44 to G-94 come from this review), GitHub issue #543 (plans and billing, Denis Zoi).

## What is wrong today (evidence, 2026-11-17)

| ID | Problem | Evidence |
| --- | --- | --- |
| P1 | Emails has two homes: the sidebar "Emails" and Settings → Emails render the same 5,700-line workspace. | `email-settings.tsx` only wraps `EmailsWorkspace`; `dashboard-shell.tsx` renders both |
| P2 | Payment providers are switched on in two places with two different switches: Integrations ("Enable for this hotel") and Payments (the Stripe/PokPay toggles). G-35 was a bug born from this. PokPay is labelled "Pay online in full", Stripe is labelled "Stripe". | `integration-settings.tsx`, `PaymentSettings` |
| P3 | The same field is edited on two pages under different names: `supportEmail` is "Guest contact email" (General) and "Support email" (Branding); `phone` is "Guest contact phone" and "Hotel phone". A third address, "Reservations email", sits next to them. The hold minutes are editable in Payments and repeated as read-only text in Booking rules. | `hotel-settings-fields.tsx:30-45`, `settings-connection-forms.tsx:107-113`, `settings-forms.tsx` |
| P4 | The cancellation policy is spread over three pages: free-cancellation days in Booking rules; automatic refund, payment fee and Clock cancellation rule in Payments; the terms link in Branding. Children, pets, quiet hours and ID live in Check-in & check-out; house rules in Booking rules. | the forms above |
| P5 | Check-in & check-out is a whole area for two times plus policy fields that belong with the other policies. | `CheckInOutSettings` |
| P6 | Integrations mixes scopes and clutter: account-wide connections shown inside one hotel's settings ("Applies to every hotel using this connection"), four "Coming soon" cards (PayPal, Booking.com, Airbnb, SMTP), category tabs for three real items, a hard-coded dark colour for PokPay, the Clock sync status shown twice (inline and in a dialog), the restaurant card wedged in. | `integration-settings.tsx:245-470`, `INTEGRATIONS` list |
| P7 | Activating a connection is run from the browser: create, test, link, and on failure a client-side delete. A closed tab leaves half-made connections; nothing is atomic. | `integration-settings.tsx` `save` mutation |
| P8 | Billing account shows a disabled button "Platform billing is not available yet". | `settings.tsx` billing panel |
| P9 | Two UI kits on one page: `@must/ui` (`Card`, `Heading`, `Stack`, `Text`, `must-button`) in `settings.tsx` for the loading, error and billing states, `components/ui` everywhere else. The loading state is plain text while the hub uses a skeleton. | `settings.tsx` imports |
| P10 | Navigation: each area is a separate page reached from a card grid, with a "← Back to Settings overview" link. No settings side menu, so moving between areas takes two clicks and the reader loses their place. The hub's card grid repeats the readiness checklist above it. | `settings-hub.tsx`, `settings.tsx` |
| P11 | Mixed save models on one page: General uses a save bar, while Display currencies on the same page saves instantly on each click. | `display-currencies-settings.tsx:215,291` |
| P12 | Dead code: `IntegrationsManagement` (869 lines) is never rendered; only its `credentialFieldsByProvider` map is imported. | `grep IntegrationsManagement` |
| P13 | Backend: one wide `PATCH /properties/:id` for about 60 columns, and the same column list copied into 6 SELECTs in `properties.service.ts`. Area health ("Ready", "Needs attention") is computed in the browser, and the hub, the settings page and the Hotels directory each make 4 requests for it. | `properties.service.ts`, `settings-areas.ts` `areaHealth` |
| P14 | Missing against industry practice (Mews, Cloudbeds, SiteMinder, Little Hotelier): a Taxes and fees area (prices shown with or without VAT, city or tourist tax per person per night). EU price-display rules expect the total with mandatory taxes. | no tax settings in web or API |
| P15 | Wording is staff-unfriendly in places: "Inventory mode", "Public website origin", "Deposit folio (advance invoice)", area key `managed-pages` for "Website connection". | the forms above |


## Rules for the whole redesign

### R-A. Every setting has exactly one owner (owner, 2026-11-17)

Data is split into domains, and each domain has one owner at a time:

| Domain | Possible owners |
| --- | --- |
| Rooms and room types | MUST or the connected PMS |
| Rates and prices | MUST or the PMS |
| Per-date restrictions and availability | MUST or the PMS |
| Reservations | MUST or the PMS; MUST always keeps its own copy |
| Hotel content: profile, photos, amenities, policies | MUST |
| Booking engine: booking form, confirmation, branding, payment methods | MUST |

- Each integration declares a **role**: PMS (Clock now, others later; can own rooms, rates, restrictions, reservations; one per hotel), Channel (Booking.com, Expedia, Airbnb, Google; never owns anything), Payments (owns nothing), Email (owns nothing), Website (displays only).
- Ownership is worked out at runtime: an active PMS integration owns its domains, otherwise MUST does. Screens never say "Clock"; they say "From {owner} · synced 2 min ago" and "Change it in {owner}".
- Each setting has one of three types, kept in one shared **settings registry** (API and dashboard): its home tab, its domain and its type. The registry also drives Find a setting, the at-a-glance cards and the readiness checks.

| Type | With a PMS connected | Native hotel |
| --- | --- | --- |
| 1. Property system data | read-only with a source badge and a "Change it in {owner}" link; the server refuses edits | editable |
| 2. Booking engine settings | editable (the PMS does not know them) | editable |
| 3. Extra limits on top | off by default ("Follow {owner}", its value shown read-only); a stricter MUST limit can be switched on, and the stricter one always wins | editable, the main rule |

- **Channel manager later:** MUST becomes the hub (PMS → MUST → channels; bookings back the same way). Channel-specific settings (mapping, price adjustment, channel stop-sell, content sync) live on each channel's integration card. One distributor per channel: on activating a channel the hotel confirms no other system is connected to it. Changing an owner is always an explicit confirmation, never a side effect; deactivating keeps the last synced values.
- Conflicts (currency mismatch, a MUST limit stricter than every PMS rate, a missing channel mapping, rate parity) go to Overview → Needs attention.

### R-B. One home per setting
Any other page that needs a setting shows it read-only with a link, never a second input. Booking rules holds hotel-wide defaults; Rates & Pricing holds per-date and per-rate exceptions, and Booking rules shows "3 date exceptions in Rates & Pricing" with a link.

### R-C. Fields (owner, 2026-11-17)
- Industry-standard fields even when MUST does not use them yet; every field says what it is "Used for".
- Proper inputs, never the simplest: dates open the calendar picker, year-only fields open a year picker, times use the time picker, languages, countries and currencies use searchable full-list selects (names, no codes), money uses the money input, phones use the international phone input.
- Number fields accept digits only (numeric keypad on phones), with minimum and maximum enforced. Text is trimmed, with a live counter wherever there is a limit. Errors appear when a field is left, in plain words. Required fields are marked; Save says which field needs fixing.
- **The server checks exactly the same rules**, from one shared rule set used by the browser and the API.
- Leaving with unsaved changes asks first. Every change is written to the audit log with old and new value.
- One form and one save bar per page; instant save only for clear on/off actions, the same way everywhere.

### R-D. Components only
Check `apps/web/components/ui` first; build anything missing there as a shared component; pages only compose. Existing and reused: `phone-input`, `colour-field`, `country-select`, `multi-select`, `combobox`, `calendar-picker`, `date-field`, `time-field`, `number-stepper`, `money-input`, `option-card`, `rating-input`, `save-bar`, `unsaved-changes`, `setting-toggle`, `segmented-control`, `hotel-logo-picker`, `email-branding-preview`. New shared components: settings layout with side menu, managed (owned) field, year picker, language multi-select, currency select, map pin picker, image upload with crop, setup guide, at-a-glance card, live preview panel.

## Menu

A settings layout with a grouped left side menu (a select on phones) and the current tab highlighted. Labels say "applies to all your hotels" for the Account group.

| Group | Tab | Notes |
| --- | --- | --- |
| Start | Overview | |
| Hotel | Profile · Contact and brand | |
| Booking | Booking rules · Policies · Taxes and fees | |
| Payments | Payment methods | |
| Connections | Integrations | Clock options, website and restaurants are cards inside it |
| Communication | Emails | moved in from the sidebar |
| Account | Team and roles · Plan and usage · Audit log | Staff and Audit log move in from the sidebar |

- The main sidebar keeps Dashboard, Bookings, Calendar, Payments, Guests, Accommodations, Rates & Pricing, Reports, plus Hotels, Inventory and Restaurants for multi-hotel and restaurant users. Emails, Staff and Audit log leave it.
- Old `settingsArea` keys and sidebar links redirect to their new tab (`general`→`profile`, `branding`→`contact-brand`, `check-in-out`→`policies`, `managed-pages`→Integrations website card, `email`→`emails`, `billing`→`plan-usage`, `integrations`→`integrations`).
- Later, not now: "Security" (beyond two-step sign-in) and "Data and privacy" (retention, export, deletion). No empty pages.

## Tab by tab (all decisions are the owner's unless marked otherwise)

### 1. Overview
1. **Setup guide**, only while setup is unfinished: progress ("4 of 6 done"), each step opens the right page, "Hide for now" per person (a small "Setup: 4 of 6" link brings it back). When all steps are done it shows a one-time "Your hotel is ready to take bookings" and disappears for good. Setup is one-time; later problems show in Needs attention, not here. "Connect your email provider" is one of the steps.
2. **Needs attention**, only when something is wrong: failing integration or missing webhook, payments still in Test without production keys, refunds waiting for approval, ownership conflicts, email delivery problems. Each with a fix button.
3. **Settings at a glance**, always shown: one read-only card per tab with its key values, a status and Edit (no Edit for view-only staff).
4. **Find a setting** search: typing "check-in", "NUIS" or "folio" opens the right tab and field (from the registry).

### 2. Profile
**Hotel identity**
| Field | Input | Rules |
| --- | --- | --- |
| Hotel name | text | required, 2–120, trimmed, no `< > \` or line breaks |
| Chain or brand | text | optional, max 120 |
| Property type | select: Hotel, Resort, Boutique hotel, Apartment hotel, Apartments, Guesthouse/B&B, Hostel, Villa, Motel, Campsite/Glamping | required |
| Star rating | 1–5 or "Not rated" | optional |
| Official rating | toggle "Issued by the national tourism authority" | only when a rating is set |
| Year opened | year picker | 1800 to the current year |
| Last renovated | year picker | year opened to the current year |
| Number of rooms | read-only | counted from Accommodations or the PMS |
| Short summary | text | optional, max 160, counter |
| Description | multi-line | optional, 50–1000, plain text, counter; one description (no per-language copies) |

**Location**
| Field | Input | Rules |
| --- | --- | --- |
| Street address, address line 2 | text with Google address search filling street, city, postal code and pin | street required, max 200 each |
| City | text | required, max 100 |
| Region | select of the country's regions (Albania: 12 qarqe) | optional |
| Postal code | text | per-country format (Albania: 4 digits) |
| Country | searchable country select | required, default Albania |
| Map pin | Google map, "Find from address", draggable pin | latitude −90..90, longitude −180..180, 6 decimals |
| Directions | text | optional, max 300; confirmation email |
| Nearest airport | IATA code plus distance | code 3 uppercase letters; 0–500 km, 1 decimal |
| Time zone | searchable select, suggested from the country | required; warns when bookings exist |

Maps: **Google Maps Platform** (address search and draggable pin in Settings only; guests get the free embed or an "Open in Google Maps" link). Owner step: create a Google Cloud project with billing and an API key restricted to our domains and localhost.

**Legal and tax** (legal name and NUIS appear in the payment and refund email footer; owner, 2026-11-17)
| Field | Input | Rules |
| --- | --- | --- |
| Legal business name | text | optional, max 200 |
| Tax number (NUIS) | text, uppercased | Albania: letter, 8 digits, letter (`L12345678A`); other countries 3–30 letters/digits |
| VAT registered | toggle | read by Taxes and fees |
| Tourism licence number | text | optional, max 50 |
| Registered address | "Same as hotel address" or the address fields | same rules as Location |

**Languages spoken at the hotel:** searchable multi-select of about 180 world languages shown by name ("Albanian · Shqip"), the country's common languages first, at least 1; shown to guests. The API accepts the full ISO 639-1 list (G-59).

**Currency:** hotel currency (searchable select; locked once bookings exist, enforced on the server, G-57; with a PMS it comes from the PMS and a mismatch warns); "Also show prices in" (max 5, never the hotel currency) with an exchange rate each (above 0, up to 6 decimals, "updated on"), on the page's save bar.

**Formats:** date format (DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD), time format (24 h, 12 h), first day of the week (Monday, Sunday), number format (1,234.56 or 1.234,56).

Contact fields leave Profile for Contact and brand.

### 3. Contact and brand
**Guest contact** (each field on this page only)
| Field | Input | Rules | Used for |
| --- | --- | --- | --- |
| Guest contact email | email | required, valid, max 254 | booking page, guest emails, default reply-to |
| Reservations email | email | optional, valid | default recipient of New booking, Changed and Cancelled staff emails, shown in Staff notifications as "Reservations email (from Contact and brand)" |
| Phone | international phone input | stored as E.164, validated on the server with `libphonenumber-js` (G-61) | booking page, emails |
| WhatsApp | "Same as phone" or its own number | same rules | "Message us on WhatsApp" in emails and on the booking page |
| After-hours phone | phone | optional, same rules | pre-arrival and check-in day emails |
| Reception hours | "Open 24 hours" or from–to time pickers | end may be after midnight | booking page, pre-arrival email |
| Website address | URL | `https://`, valid domain, max 500; replaces "public website origin", read by the website connection | emails, booking page |

**Online profiles and review links** (review links move here from Emails): Google Business Profile, Tripadvisor, Booking.com, Facebook, Instagram, TikTok, YouTube; `https://` only and the domain must match the site. "Ask for reviews here" tickbox on Google, Tripadvisor, Booking.com, Facebook plus "Private feedback"; at most 3 in the after-stay email, in dragged order. Social icons in the email footer and on the booking page.

**Brand assets** (uploads to MUST's own storage like room photos, G-94; SVGs cleaned of scripts)
| Asset | Rules | Used for |
| --- | --- | --- |
| Main logo | SVG or PNG, transparent, at least 400 px wide, max 2 MB | email header, booking page, receipts |
| Logo for dark backgrounds | same; falls back to the main logo on a white strip | dark email headers and website sections |
| Square icon | crop to square, at least 512×512, PNG or SVG | hotel switcher and hotel spots in the system, social sharing |
| Favicon | generated from the square icon in every size; replaceable (ICO or PNG) | booking page and website tab |
| Brand colour, accent colour | colour field with hex `#RRGGBB`; contrast warning with a darker suggestion | buttons, email header, links |
| Cover photo | picked from the photo library, landscape, at least 1600 px wide | booking page and email top |

The MUST logo in the staff system stays MUST's.

**Email footer:** built from saved data (name, address, contact, social icons, legal name and NUIS); plus an optional 300-character plain-text note. Links are added by the system.

**Live preview:** email header and footer, booking page header, browser tab with favicon, sidebar hotel switcher; updates as you type.

The terms and privacy links live in Policies.

### 4. Booking rules
Hotel-wide defaults; per-date exceptions stay in Rates & Pricing. With a PMS, stay limits, booking window, cutoff, season and arrival days are type 3; the rest is type 2.

| Section | Fields and rules |
| --- | --- |
| Length of stay | minimum 1–30 nights; maximum 1–365, not below the minimum (checked on the server, G-62) |
| Booking window and season | book at least 0–720 hours or 0–30 days before arrival; book up to 1–730 days ahead; "Open all year" or a yearly date range (to after from; outside it the booking page says "Closed for the season, opens …") |
| Same-day bookings | toggle; cutoff time (hotel time zone) |
| Arrival and departure days | 7 weekday chips each, at least 1 |
| Group size | max guests per booking 1–50 (warns below the biggest room's capacity); max rooms 1–20; "Show a group request form" plus its email (default the reservations email) |
| Guest ages | minimum age to book 16–25 (default 18); children from 0 up to 1–17; infants up to 0–5, below the child limit; "Ask children's ages" (required when a rate prices by age) |
| How guests choose rooms | option cards: By room type / A specific room / Both; changing asks for confirmation; existing bookings unchanged |
| Confirmation | Instant (default) or **On request** (staff accept or decline within 1–48 hours, otherwise declined, room released, guest told; after acceptance the guest pays by payment link) |
| Booking form | per field Required / Optional / Hidden: phone, country, address, arrival time, special requests, guest name per room, company name and tax number, marketing consent. Email and main guest name always required; marketing consent never pre-ticked |
| Advanced | Fill gap nights (allow a shorter stay that exactly fills a gap) |

Every rule is enforced in the server's booking check (`inventory-restriction-rules.ts`), "stricter wins" for type 3.

### 5. Policies
| Section | Fields and rules |
| --- | --- |
| Check-in and check-out | check-in from / until (or "Any time"), check-out from / until, until after from; late arrival instructions max 500; early check-in and late check-out each Not offered / On request / Free until [time] / Paid [money] |
| Cancellation and prepayment policies | **a policy library replaces the hotel-wide "free cancellation days"**: name (required, unique, max 80), refundable, free until 0–365 days or 0–72 hours before arrival (from check-in time, hotel time zone), then First night / % (1–100) / Full stay / Fixed amount, no-show charge (same choices, replaces the unused no-show field), prepayment None / Deposit % / First night / Full stay at booking / Full stay N (1–60) days before, and a generated "Guests will read" sentence. Rate plans pick a policy in Rates & Pricing; a default covers the rest. A migration turns today's hotel-wide days into a default policy "Standard", so nothing changes for guests on the day it ships |
| Refunds | "Refund automatically inside the free period"; "Guest pays the card fee when they cancel" (moved from Payments) |
| Children, cots, extra beds | children toggle (ages come from Booking rules, linked); cots and extra beds Not available / Free / Paid per night, max 0–3 per room |
| Pets | Allowed / On request / Not allowed; fee free, per night or per stay; max 1–5 per room; note max 300; fixed line "Assistance animals are always welcome" |
| House rules | smoking, parties, quiet hours (both or none), ID at arrival (all adults / main guest / not required plus accepted documents, at least 1 when required), damage deposit (amount, cash or card, refunded within 1–30 days), other rules max 1000 |
| Terms and privacy | booking terms written in MUST (rich text) **or** a link; privacy policy (link or text) **required** to take bookings; version history; each booking records the version the guest accepted (G-56) |
| Guests will read | live preview of the full policy text, English / Albanian |

Accepted payment methods at the hotel go to Payment methods.

### 6. Taxes and fees
The existing charges engine (Rates & Pricing → Charges) **moves here**; no second tax system. Rates & Pricing keeps rate plans and price rules.

| Section | Fields and rules |
| --- | --- |
| How you enter prices | "Your rates include VAT" (confirm with an example on change); VAT registered read-only from Profile |
| Taxes and fees (existing engine) | name (required, max 80, unique among active), type (VAT, tourist/city tax, service charge, resort fee, cleaning fee, other), calculated as % of room price / % of subtotal / per person per night / per adult per night / per room per night / per stay, amount (0–100 % with 2 decimals, or money, never negative), shown as included / added at checkout / paid at the hotel, **children exempt under 0–17 years** (new), **charged for at most 1–60 nights** (new), applies to room types / rate plans / channels (empty = all), valid date range, "confirmed with the hotel's accountant" before activating (exists) |
| What guests see | **default: total including all mandatory taxes and fees** (EU expectation); the alternative shows a warning; breakdown at checkout toggle; booking page note max 200 |
| Example price | live preview: 2 adults, 1 child, 2 nights, each line, paid now vs at the hotel, total |

With a PMS that calculates taxes (Clock): the calculation is type 1 ("Calculated by Clock PMS+"); "What guests see" stays MUST's. **Not verified:** what Clock's price quotes return about taxes (G-63). One read-only check on the Clock sandbox comes before building this part.

### 7. Payment methods
An online method is offered only when its integration is active and verified (the switch lives in Integrations). This page decides order, defaults and everything that is not an integration.

| Section | Fields and rules |
| --- | --- |
| Checkout methods | one row per method with a drag handle (order) and "Default": Card (from the active payment integration, e.g. "Stripe · Test", card logos, Apple Pay and Google Pay note), PokPay, Pay at the hotel (on/off), **Bank transfer (new, owner yes)** with account holder (max 140), bank name, IBAN (checksum and per-country length), SWIFT/BIC (8 or 11), pay within 1–14 days, and "if not received: notify staff / cancel the booking". At least one method stays on. Badges come from one shared "is this method available" check (method on + integration active + credentials verified, G-46) |
| How much guests pay now | read-only table per rate plan from the Policies prepayment rules; rate plans that require payment at booking hide Pay at the hotel |
| Accepted at the hotel | chips: Cash, Visa, Mastercard, Maestro, American Express, Diners, Bank transfer, PokPay; at least 1 when Pay at the hotel is on; shown on the booking page and in the confirmation |
| Timing | room hold while paying online **30–1440 minutes** (minimum raised from 10, owner yes, G-49); payment links valid 1–14 days; first reminder after 1 to (validity − 1) days (default 3); optional second reminder; when a link expires unpaid: notify staff / cancel and release. **Reminder timing lives here** (decided 2026-11-18 in the Emails review, G-84; replaces the 2026-11-17 note that kept it in Emails) and Emails shows it read-only |
| Card guarantee for pay-at-hotel | shaped now, **built after the Stripe hardening plan**: ask for a card (saved by Stripe, never MUST) and charge no-shows automatically or after staff confirm, amount from the policy's no-show charge |
| Currency | read-only: guests pay in the hotel currency |

### 8. Integrations
A marketplace of cards. Stripe: each hotel enters its own keys per mode and MUST creates the webhook automatically (no Stripe Connect; see the Stripe plan T9).

- **Cards:** role badge (PMS, Payments, Email, Website, Channel, Restaurants), "Owns: …" line, health dot (healthy / failing / not checked), mode (Test / Production), Active switch. Categories and search: All, Property system, Payments, Email, Website, Channels, Restaurants. Coming-soon cards small at the bottom plus "Request an integration".
- **Adding:** a step-by-step setup: what it does and owns (confirm) → credentials checked by the server in **one call that creates, tests and links**, nothing half-made left behind (G-67) → automatic webhook or an address to copy → a test (payment, email or sync) → active in Test. **Go live** is its own checklist (production credentials verified, webhook live, one test done, for payments the terms updated).
- **Integration page tabs:** Overview (what it does and owns, health: last success, failures in 7 days, last error in plain words with a fix hint), Credentials (per mode, "verified at", replace only, expiry reminders), Webhook / Connection (automatic or copy, signing status, last events, resend a failed event), Options (e.g. Clock: where a website payment is recorded and what happens when the hotel cancels in Clock), Activity, Remove (what happens to history, then confirm).
- **Per hotel by default** (G-66): sharing an account with other hotels is an explicit choice, and the page lists them.
- **Own permission** `integrations.manage` (G-68), owners and admins by default.
- **Test mode per category:** payments use sandbox keys, PMS its sandbox account, email sends every message to one test address marked TEST (G-69), channels their test property.
- Failures go to Overview → Needs attention and the "Integration problem" staff email.
- Cards today: Clock PMS+ (with its sync table once and its permissions panel), Stripe, PokPay, Website (connection code; the address comes from Contact and brand), Restaurants (restaurants will become a property and plan of their own, issue #543).

**Email providers** (owner, 2026-11-17): guest emails go through the hotel's own provider; system and staff email (invites, resets, verification codes, staff alerts) stays on MUST's platform email.
| Card | State |
| --- | --- |
| Resend (hotel's own key) | exists, moves here |
| Brevo | API and SMTP both work (PR #539, fix #541); the setup shows MUST's outgoing IP for Brevo's Authorised IPs (`MUST_OUTBOUND_IP`, optional server setting); the delivery webhook (bounces, blocks, spam into the delivery log) is still to build (G-72) |
| Other SMTP | exists; presets for Microsoft 365, Google Workspace, cPanel mail |
| Later | Postmark, SendGrid, Amazon SES, Mailgun, Mailchimp Transactional |

- The domain check (SPF, DKIM, DMARC) is a tab on the email card; activation is blocked or clearly warned until the provider reports the domain authenticated (G-74).
- **Emergency fallback:** when a hotel's provider fails, critical guest emails (confirmation, payment receipt, cancellation, refund) go out once through the platform from a neutral address, replies to the hotel, with a daily cap per hotel.
- **Existing hotels on the platform default:** a read-only check of who uses it, then a banner and a deadline to connect their own provider, then the default is switched off for guest emails, only with the owner's go.

### 9. Emails (Communication)
Four tabs.

1. **Guest emails**, grouped by journey; columns Email · Sent when (with timing) · Languages · Status.
   - Booking: confirmation (paid online / pay at hotel), booking changed, cancelled, cancellation request received.
   - Payments: payment link, reminder, link expiring, payment received, payment not completed, refund.
   - Stay: pre-arrival, check-in day, after stay (review links), no-show.
   - **Booking and payment emails are always sent** (lock icon; "booking changed" may be switched off); only stay emails have a switch, on by default (D9). G-77.
   - Editor (exists: subject, preview text, message, safe variables, language tabs, live preview, revisions, restore) plus send a test to me, desktop and phone preview, and on stay emails their timing and a **send time** (15-minute steps, hotel time; defaults 09:00 pre-arrival, 10:00 after stay; G-81). Rules: subject required, max 150, no line breaks; preview text max 140; message max 10,000; unknown `{variable}` refused on save; the confirmation must keep `{booking_reference}`; pre-arrival 1–30 days, after stay 0–14 days. Payment reminder timing is shown read-only with a link to Payment methods.
   - Removed: the unused `payment_failed` template (G-79); staff invitation and account emails, which are platform emails (G-80).
2. **Staff notifications:** per notification on/off, recipients (roles, staff, extra addresses, To/CC/BCC as today); at least one recipient for Problem alerts (always on); extra addresses valid, max 20; daily and weekly summary with send time. "Mute my non-urgent emails" moves to each person's profile.
3. **Sending:** summary ("Sending with Brevo from bookings@… · domain verified · Change in Integrations"), sender display name (max 70, no line breaks) and reply-to. The hotel-wide wording language goes away.
4. **Delivery log:** today's Delivery tab with the health card on top, filters, resend, CSV export; blocked addresses (suppression list) as a filter; problems also in Overview → Needs attention.

Decisions:
- **Guests get emails in the language they booked in** (stored on the booking), falling back to the hotel's default; languages come from Profile (G-78).
- **Only bookings made in MUST** (website or staff) get guest emails; PMS-imported bookings get none (G-82).
- An "Add to calendar" (.ics) file on the confirmation and on changes (G-83).
- Custom automated emails (conditions on rate plan, room type, channel): shaped now, **built in a later phase**. Online check-in and paid extras in pre-arrival, and invoice PDFs, come later. Newsletters are out of scope.

### 10. Team and roles (Account)
- **People:** name and email, account role (Owner, Admin, Staff), role per hotel, status (Active, Invited with expiry, Suspended), last sign-in (flag after 90 days, G-88); filters by status, hotel, role, extra permissions. CSV export stays off until the audited export exists.
- **Adding people:** **"Send invitation" and "Create account" with a password both stay** (owner, 2026-11-18; G-86 closed). Fields: work email (valid, unique in the account), first name (required, max 100), last name (max 100), account role Admin or Staff (Owner only by transfer), access as hotel → role rows (at least one hotel for Staff; Admin covers all), restaurant access per venue, dashboard home (Automatic default, Owner, Front desk, Finance, Reservations, Minimal). **Invitations are saved in the database** and listed (pending, expired, accepted), with resend and withdraw, valid 7 days (G-85).
- **Person page:** access per hotel with extra permissions shown as differences from the role ("Front Desk + Refund"); granting a sensitive permission (refund, late refund, integrations, staff permissions) asks for confirmation; Activity links to the Audit log filtered to the person; Suspend (instant, reversible) and Remove (history kept).
- **Roles stay per hotel**, as today (owner, 2026-11-18). Built-in: Property Manager, Front Desk, Finance, plus **Reservations**. Custom roles: name (max 60, unique), description (max 200), permission grid by group with "copy from role".
- **New permissions:** `integrations.manage` (G-68), `emails.manage` (G-90), `audit.view`, `reports.export`.
- **Ownership transfer** (G-87): exactly one owner; the owner picks an admin, the admin accepts by email, both notified and audited, the old owner becomes Admin.
- **Two-step sign-in** (G-89): built now (authenticator app). An **account setting "Require two-step sign-in"**, off by default; when on, every staff member sets it up at the next sign-in. Sign out of all devices (by the person, or by an admin when suspending). Session timeout later.
- **AI assistant as a team member**, later phase: per hotel with its own role, never Owner or Admin, every action audited "AI assistant (on behalf of …)", no refunds or integration keys unless granted, one switch turns it off.
- PMS staff accounts (Clock) are separate and not synced; the Clock permissions panel stays on the Clock card.

### 11. Plan and usage (Account)
- **Plan:** name, short "what's included", status in plain words (Trial, Active, Past due, Read-only, Suspended). **"Ask to change plan"** sends a request to the MUST platform admin (plan wanted and a note); the owner is emailed when it is done. No disabled buttons.
- **Usage meters:** hotels, staff seats (owner counts), PMS, restaurants; amber at 80 %; at 100 % it says what is blocked and that nothing is deleted.
- **Who:** Owner and Admins see it; only the Owner asks for changes; other staff do not see the tab.
- **For now one plan, unlimited in everything**, no free trial or lock; restaurants become a property and plan of their own; real plans and billing (Milestone 15) are Denis Zoi's, **issue #543** (also G-91, G-92). The Billing section (billing company, tax number with VIES, billing email, address, Stripe-hosted card, invoices, cancellation) appears only once billing exists.

### 12. Audit log (Account)
- Columns: When (hotel time), Who (person, "MUST support", "System", "Clock", later "AI assistant (on behalf of …)"), What (one plain sentence), Where (hotel and area), Result (done or refused with the reason). Event detail panel with **before → after per field**, link to the record, request reference. Hotel filter ("All hotels" or one; account events under "Account"); today's filters; calendar date range with Today / 7 / 30 days; CSV export, itself recorded.
- Linked from the app: "History" on a booking, "Activity" on a person, "Changes" on each settings page. The sidebar item goes. Viewing needs `audit.view`, Owner and Admins by default.
- **Part of the postponed audit expansion joins the redesign:** entries cannot be edited or deleted (enforced in the database), a test that every write endpoint records an event, before and after detail. IP and device stay for later (agreed design of 2026-10-20). G-93.
- **MUST support actions are always visible to the hotel**; the hidden direct sessions of 2026-10-20 end, at the latest before a new hotel comes on board.
- Entries are kept indefinitely for now; a period is decided with the future "Data and privacy" page.

## Build plan

Built by Claude directly, on one branch, **one tab at a time on the local setup** (Docker Desktop Postgres and Redis, local API and dashboard), tested on the sandbox hotel Must Hotel only. The owner checks each tab on localhost; it is adjusted until approved, then goes to a PR and CI; live only with the owner's go for that deploy. No more mockups (owner, 2026-11-17); the mockup link stays as a reference.

Each step includes its backend: additive, re-runnable migrations with rollback notes, server-side rules from the shared rule set, per-area update endpoints, audit entries with before and after. Each step: `pnpm -w lint`, the full web tests, API tests when the API changes (isolated Docker replica), typecheck of specs, `pnpm -w build`, before and after screenshots compared.

| Step | Content | Gaps it closes as part of the design |
| --- | --- | --- |
| S0 | Foundations: settings registry (R-A), settings layout and side menu, redirect map, shared rule set (browser and API), per-area update endpoints with one shared column list (P13), settings summary endpoint replacing the browser `areaHealth` (G-65), managed field component, clean-up (`IntegrationsManagement`, `@must/ui` in Settings; P9, P12, G-71) | G-64 (server checks verified email for settings), G-65, G-71 |
| S1 | Overview: setup guide, needs attention, at a glance, find a setting. **S1b (2026-11-18, catch-up after the owner's review):** live problems in Needs attention (failing integration, no Clock updates for 48 h, payments in Test mode, waiting cancellation requests and refunds, currency conflict, undelivered or stuck emails), Contact details and the recommended email provider step in the setup guide, Hide for now and the one-time ready notice saved per person (`settings_overview_dismissals`), count next to Overview in the menu | |
| S2 | Profile, with year picker, language multi-select, currency select, map pin (needs the Google key). **S2d (2026-11-19, owner-checked on localhost):** the planned layout and the map pin without any key (Leaflet and OpenStreetMap, search by the free Nominatim service); registered address; read-only room count; languages are the 77 CLDR "modern" languages with native names stored in `@must/domain-contracts` (older codes stay valid on the server); the currency card is one rate table typed as "1 EUR equals 100.50 ALL" (the server still stores hotel-units-per-unit, converted at the edges); the hotel's date, time and number formats apply on every dashboard screen through `lib/hotel-format` and in email dates (day order); legal name and NUIS print in payment and refund emails, directions text and the map pin in the stay-confirmed email; the public `/public/property` answer gains a `profile` section (never the legal name or tax number); the server refuses to blank property type, city and country; a time zone change asks for confirmation only when the hotel has bookings | G-57, G-58 (fields wired up), G-59 |
| S3 | Contact and brand, with image upload and crop, live preview, online profiles | G-60, G-61, G-94 |
| S4 | Booking rules, enforced in the booking check. **S4a (2026-11-19, built, not yet owner-checked):** notice hours, season, arrival and departure days, enforced. **S4b-1 (2026-11-20, built, saved and checked only, not yet enforced or shown to guests):** group request form and its email, minimum booking age, children and infants age limits, ask children's ages, fill gap nights. **S4c (2026-11-20, built, saved and checked only):** how guests choose rooms as option cards, instant or on-request confirmation with the answer time, booking form field table (Required / Optional / Hidden, eight columns `form_*`). **S4d (2026-11-20):** the page reordered as planned with an even two-column layout; the public hotel answer (`/public/property`, `profile.booking`) publishes all Booking rules for websites (the group request address stays private). **S4e (2026-11-20):** the page opens with the rules in plain words and a try-a-booking box; every section says who decides it (set in MUST, website rule, or an extra limit on top of a connected PMS); with a connected PMS the child and infant ages and confirmation are locked, gap filling is hidden and the server refuses on-request and gap filling. **S4f (2026-11-20):** staff override for new staff bookings: reception can skip the hotel's own limits (stay length, notice, window, season, arrival and departure days, same-day, group size) by typing a reason of 5 to 300 characters; the skipped rules and the reason are saved in the audit log (`booking.rules_overridden`). Availability, room capacity, past dates, overlaps and per-date restrictions from Rates & Pricing are never overridden, and guests never can. **S4g (2026-11-23, built, on a branch):** the booking check holds a guest booking to the Required address (street, city, postcode), arrival time, special requests and company name; company name, tax number and marketing consent (with the time it was given, never assumed, never required) are stored on the booking (migration `20261123100000_booking_form_fields`); the arrival time uses the existing `estimated_arrival_time`. Phone and country are deliberately not enforced (every website asks for them and many API callers omit them; owner decision if strict enforcement is wanted). The multi-room order does not carry these fields. The Booking form section is labelled "Required fields are enforced by the booking system · your website must ask for them": the Astro starter and each site still have to ask for address, arrival time, company and marketing consent before a hotel marks them Required. **Websites (decided 2026-11-20): our hotel websites are Astro sites, not the WordPress plugin.** They read the Booking rules from `/public/property` (`profile.booking`, see the public guest API doc) and explain refusals with the reasons the API returns. **2026-11-22:** the playbook starter (0.4.3, branch `feat/booking-rules` in `must-web-playbook`) and the Must Hotel demo (branch `feat/booking-rules` in `Must-Hotel-Demo-Astro`) read `profile.booking`: guest form fields Required, Optional or Hidden (phone, country, special requests) and plain refusal reasons, with the old behaviour as the fallback. The other Astro sites (Empire, Luxury, TIA and so on) pick it up through the playbook's update-site command. **2026-11-22: the group request form works end to end** (`POST /group-requests`, stored in `group_requests`, hotel notified in the dashboard and by email, guest acknowledged; sites show the form when `profile.booking.group.requestForm` is true). Guest ages, on-request confirmation, address, arrival time, company, room guest names and marketing consent are not read by any site yet, so those sections stay marked "not applied to bookings yet". **Still to build:** the same override when changing an existing booking (amend, room move); the booking pages and the booking check using these new settings (group request form, ages in pricing, gap filling, the on-request flow with payment link after acceptance, the form field table in the booking form of the Astro hotel sites) **Deferred by the owner (2026-11-23), not a priority now; tracked in the gaps log (G-97):** on-request confirmation end to end (staff accept or decline, deadline, automatic decline, payment link after acceptance), the same staff override when amending a booking or moving a room, gap filling in the booking check, and children's ages priced by age in quotes. **Guest ages (2026-11-23):** with "Ask children's ages" on, the server now refuses a guest booking with children that does not carry one age per child (staff bookings are exempt). | G-62 (done) |
| S5 | Policies: policy library and "Standard" migration, terms versions and acceptance. **S5a (2026-11-23, built, saved and checked only, not shown to guests yet):** check-in until and check-out from, late-arrival instructions, cots and extra beds (not available / free / paid, price per night, 0-3 per room), pet fee and maximum, smoking, parties, ID at arrival as a choice (not required / main guest / all adults) with accepted documents, damage deposit (amount, cash or card, refunded within 1-30 days), other house rules, and a \"Guests will read\" preview in English and Albanian (migration `20261123140000_policies_house_rules`; rules in `packages/domain-contracts/src/policy-rules.ts`, shared by the form and the API; values that stop applying are cleared on save). The old \"ID required\" switch became \"all adults\" with passport and national ID. Every time field in Settings now uses the designed wheel time picker. **Still to build:** the cancellation and prepayment policy library (G-52, G-53, G-54; **shelved by the owner 2026-11-23, see G-98 and `settings-s5b-cancellation-policies-plan.md`**), terms and privacy versions (G-56), and showing these policies on the booking pages and in emails (G-55) | G-52, G-53, G-54, G-55, G-56 |
| S6 | Taxes and fees: Clock quote check first, move Charges, two new fields, display rule | G-63 |
| S7 | Payment methods: availability check, order and default, bank transfer, hold minimum, link timing | G-46, G-48, G-49, G-51 |
| S8 | Integrations: marketplace, step setup, server-side activation, per-hotel connections, permission, test mode, email cards, health | G-66, G-67, G-68, G-69, G-70, G-73, G-74 |
| S9 | Emails: four tabs, required emails, guest language, send times, .ics, template clean-up | G-77, G-78, G-79, G-80, G-81, G-82, G-83, G-84 |
| S10 | Team and roles: saved invitations, Reservations role, new permissions, last sign-in, ownership transfer, two-step sign-in with the account setting | G-85, G-87, G-88, G-89, G-90 |
| S11 | Plan and usage (works with the single unlimited plan of #543) | |
| S12 | Audit log: Account tab, links, append-only, coverage test, before and after, support visibility | G-93 |
| S13 | Wording pass (the `design:ux-copy` checklist), sidebar clean-up, old links verified | |

Gaps not listed above (G-44, G-45, G-47, G-50, G-72, G-75, G-76 and the rest) are fixed one by one **after the redesign is live**, the High ones first (G-46, G-44, G-45, G-52), per the owner's decision of 2026-11-17.

## Owner steps and open items
- Approve this plan (AGENTS.md).
- Google Cloud project with billing and a Maps API key restricted to our domains and localhost (before S2's map pin).
- Optional: `MUST_OUTBOUND_IP=139.162.153.25` on the server, so the Brevo setup shows MUST's outgoing address.
- PR #541 (Brevo verification code fix) is green and waits for the go to merge.
- Issue #543 (Denis Zoi): one unlimited plan; Plan and usage reads whatever it sets.
- Proposed on 2026-11-17 and not confirmed: an accounting email and a "main contact for MUST" (name, role, phone, email) under internal contacts in Contact and brand.
