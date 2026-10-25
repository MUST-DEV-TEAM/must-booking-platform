# Milestone 29: Hotel currency and display conversion

Status: **Planned — opened 2026-10-25.** Nothing below is built. **Gates the cutover (owner decision 2026-10-25): it must be ready on the day the redesign goes live, because Empire's client needs the website currency converter from day one.**

## Goal

Each hotel has one **money currency**: bookings, payments and refunds always use it. Other currencies are **display only**: the same price shown as an approximate conversion, labelled as such, never charged.

## Decisions (owner, 2026-10-25)

- The property owner selects the hotel's default currency in the property settings. A hotel connected to a PMS takes the currency from the PMS rate it books (Clock reports a currency per rate: EUR for Website rates, ALL for Reception on Empire; no account-wide currency field is known), and the property setting is the fallback and the value shown to staff.
- The guest pays in the hotel's currency. Display currencies are chosen per property (for example EUR, USD, GBP, ALL).
- Conversion is automatic from a daily rate feed that is cached, with the last known rate used if the feed is down; every converted price is labelled approximate. The hotel can switch display currencies on or off.

- Empire: guests on the website see ALL, EUR, GBP and USD. The converter is an **Elementor widget** placed in the site header on the right side, to the left of the header button widget (element f01df27), so the owner can choose the display currencies and the default in Elementor.
- Empire: money currency EUR; the WordPress website gets a currency converter (display only) for guests.
- The rate feed is fetched once a day and cached; the source must be free and include the lek.

## Findings

- The ECB euro reference rates cover 29 currencies and **do not include the Albanian lek (ALL)** (checked 2026-10-25 on the ECB page).
- The Bank of Albania publishes the official lek fixing on its own site; no official machine-readable feed was found. A third party (AllRatesToday) resells it as JSON with an API key. Choice of source is open (see Task 1).

## Tasks

| # | Task | Notes | Status |
| --- | --- | --- | --- |
| 1 | **Rate source decision** | Needs a feed that includes ALL, EUR, USD and GBP. Options: Bank of Albania fixing (official, needs a scraper or a reseller), a commercial feed (Open Exchange Rates and similar), or ECB for the euro-based pairs plus a second source for the lek. Check licensing for showing rates to guests. | Planned, decision needed |
| 2 | **Property currency setting** | Property settings field, validated list; Clock hotels default to the booked rate's currency; stop hard-coding EUR in shadow rate plans (also M27 Task 3). | Planned |
| 3 | **Rate storage and refresh** | Daily job, one row per currency pair and date, last-known fallback, staleness shown. | Planned |
| 4 | **Public API: display prices** | Quotes and offers carry the money amount and an optional display conversion with rate date; the API never accepts a display currency for payment. | Planned |
| 5 | **Screens** | Dashboard shows the money currency; the WordPress plugin gets a currency switcher with an "approximate" label for Empire. Widget and API follow [Milestone 26](26-public-api.md). | Planned |
