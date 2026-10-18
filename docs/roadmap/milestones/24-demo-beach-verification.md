# Milestone 24 — Demo Beach Hotel verification checklist

Purpose: after the redesign screens are built, prove they behave correctly for a **Clock hotel** before Milestone 25 starts. Run it **locally first** on "Demo Beach Hotel" (Clock PMS staging connection + PokPay staging connection, room-type mode), then a short smoke test of the deployed build on production **Must Hotel** (`MH-` booking references only; `EBR-` means Empire, never test on it). Nothing is "verified" until its row below has a date, a result and evidence.

## Setup

- Local: web :3001, API :3000, docker Postgres/Redis; sign in with the owner account from `.local/credentials.md` (never print it). Select the property **Demo Beach Hotel**; confirm Settings shows Clock PMS connected and Payments shows PokPay connected.
- PokPay staging card: Visa 4111 1111 1111 1111, any future expiry, CVC 123, normal-domain email. Locally the paid webhook cannot arrive; confirmation comes from the 60-second sweep or "Check payment now".
- Production smoke test: property Must Hotel only; stop and report if a booking reference starts with `EBR-`.

## Rules every row must also satisfy

- No MUST screen writes to Clock except the already-certified booking create/update/cancel paths; Inventory, Rates, Stock and Blocks make **no** Clock call and show "managed in Clock" / Unknown, never invented numbers.
- No raw error text or stack traces; failures show a reference.
- Clock data that cannot be loaded is labelled Unknown, never "0" or "sold out".

## Checklist

| # | Area | Check | Result / date / evidence |
| --- | --- | --- | --- |
| 1 | Overview | Tiles and lists load; arrivals/departures match Bookings; no MUST-only metrics shown for Clock | |
| 2 | Bookings list | Search, tabs, filters, paging; Clock-synced and sync-problem bookings are labelled | |
| 3 | Booking detail | Guest, stay, nightly rates, payment, Clock reservation id and sync state; cancel and resend payment link work | |
| 4 | Add reservation | Availability and price come from Clock for the dates; capacity, minimum stay and closed-to-arrival from Clock are enforced; booking is created in Clock and shows its id | |
| 5 | Add reservation, card | Pay by card with PokPay staging: payment pending, then confirmed; Clock booking confirmed once, no duplicate | |
| 6 | Add reservation, pay at hotel | Booking created; payment shown as due at the hotel | |
| 7 | Cancellation | Cancel a paid booking: Clock cancellation, refund rules, ledger entries consistent | |
| 8 | Refund | Partial and full refund via PokPay staging; amounts, status and ledger match | |
| 9 | Calendar | Closed (stop-sale) days look different from sold-out; minimum-stay shown; block from the chart is refused or read-only for Clock | |
| 10 | Payments | Ledger totals equal the sum of the bookings tested above | |
| 11 | Guests | Directory and profile show the guests created above; duplicates logic unaffected | |
| 12 | Accommodations | Room types mapped to Clock; import-from-Clock path; editing local-only fields does not alter Clock; read-only labels where Clock owns data | |
| 13 | Inventory: Overview/Stock | Stock grid shows "Managed in Clock", no edit controls enabled | |
| 14 | Inventory: Restrictions/Blocks | Create/validate refused with the read-only message; lists show Unknown for provider data; Conflict Review explains it is unavailable | |
| 15 | Rates & Pricing | Prices shown are Clock's, read-only; no MUST-computed price presented as Clock's | |
| 16 | Reports | Figures reconcile with Bookings/Payments for the same dates; unavailable measures are hidden, not zero | |
| 17 | Staff & permissions | A staff user with only some capabilities sees only permitted pages and actions (fail closed) | |
| 18 | Settings, Emails | Booking rules and email settings save; test email is blocked from real recipients | |
| 19 | Provider outage | Stop or break the Clock staging call (mock or bad credential locally): screens show Unknown / sync-problem states, no crash, no data loss | |
| 20 | Concurrency | Two staff book the last room at once: exactly one succeeds | |
| 21 | Production smoke (Must Hotel) | Items 4, 5, 7 on the deployed build with `MH-` references; Empire untouched | |

Record defects as gap rows in `24-dashboard-redesign.md` with the check number; do not start Milestone 25 until every row is passed or its deferral is written down.
