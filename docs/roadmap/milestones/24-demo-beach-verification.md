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
| 1 | Overview | Tiles and lists load; arrivals/departures match Bookings; no MUST-only metrics shown for Clock | 2026-10-21: FAIL - U1; tabs loaded for all roles, but finance shortcuts lead to empty unauthorized sections. `finance-health.jpg`. |
| 2 | Bookings list | Search, tabs, filters, paging; Clock-synced and sync-problem bookings are labelled | 2026-10-21: PASS - name search 1 row; Upcoming 1, Cancelled empty; Result unknown filter 1 row; sorting and single-page controls work. Multi-page traversal unavailable with five records. `booking-list.jpg`. |
| 3 | Booking detail | Guest, stay, nightly rates, payment, Clock reservation id and sync state; cancel and resend payment link work | 2026-10-21: NOT TESTABLE - failed-booking detail loads; U6/U7 read-only checks pass, but no Clock ID/payment link exists. `clock-readonly.jpg`. |
| 4 | Add reservation | Availability and price come from Clock for the dates; capacity, minimum stay and closed-to-arrival from Clock are enforced; booking is created in Clock and shows its id | 2026-10-21: FAIL - U3; four priced matches led to four definitive availability failures. `clock-availability.jpg`. |
| 5 | Add reservation, card | Pay by card with PokPay staging: payment pending, then confirmed; Clock booking confirmed once, no duplicate | 2026-10-21: NOT TESTABLE - U4; neither PokPay attempt reached checkout. `pokpay-create-blocked.jpg`. |
| 6 | Add reservation, pay at hotel | Booking created; payment shown as due at the hotel | 2026-10-21: FAIL - U5; both Pay at hotel attempts failed before Clock creation. `pokpay-create-blocked.jpg`. |
| 7 | Cancellation | Cancel a paid booking: Clock cancellation, refund rules, ledger entries consistent | 2026-10-21: NOT TESTABLE - U8; no confirmed/paid booking to cancel. `pokpay-create-blocked.jpg`. |
| 8 | Refund | Partial and full refund via PokPay staging; amounts, status and ledger match | 2026-10-21: NOT TESTABLE - U9; no successful payment to refund. `pokpay-create-blocked.jpg`. |
| 9 | Calendar | Closed (stop-sale) days look different from sold-out; minimum-stay shown; block from the chart is refused or read-only for Clock | 2026-10-21: FAIL - U10; reservation timeline invents free capacity; block wizard lacks early Clock ownership messaging; submit is refused with 403/read-only. `calendar.jpg`, `calendar-block.jpg`. |
| 10 | Payments | Ledger totals equal the sum of the bookings tested above | 2026-10-21: NOT TESTABLE - U12; all four ledgers empty, zero successful charges/refunds. `reports.jpg`. |
| 11 | Guests | Directory and profile show the guests created above; duplicates logic unaffected | 2026-10-21: PASS - four guests and DeskTwo profile load; same-phone suspected-duplicate flags shown; no merge performed. `clock-readonly.jpg` identifies the linked test guest. |
| 12 | Accommodations | Room types mapped to Clock; import-from-Clock path; editing local-only fields does not alter Clock; read-only labels where Clock owns data | 2026-10-21: FAIL - APP edit exposes enabled Name/Maximum occupancy/Save without a Managed in Clock boundary; not saved. Import/local-write behavior not exercised. `accommodation-edit.jpg`. |
| 13 | Inventory: Overview/Stock | Stock grid shows "Managed in Clock", no edit controls enabled | 2026-10-21: PASS - stock remains Unknown/Managed in Clock; no enabled editing. `inventory.jpg` (same workspace). |
| 14 | Inventory: Restrictions/Blocks | Create/validate refused with the read-only message; lists show Unknown for provider data; Conflict Review explains it is unavailable | 2026-10-21: PASS - Restrictions/Manual Blocks/Conflict Review show Unknown/unavailable; no create/validate controls or mutation requests. `inventory.jpg`. |
| 15 | Rates & Pricing | Prices shown are Clock's, read-only; no MUST-computed price presented as Clock's | 2026-10-21: PASS - real APP quote EUR 300, two EUR 150 nights; read-only rates and no local substitute. `clock-outage.jpg` shows the same reader after the controlled failure. |
| 16 | Reports | Figures reconcile with Bookings/Payments for the same dates; unavailable measures are hidden, not zero | 2026-10-21: NOT TESTABLE - U12; zero-activity agreement only, no paid-booking reconciliation. `reports.jpg`. |
| 17 | Staff & permissions | A staff user with only some capabilities sees only permitted pages and actions (fail closed) | 2026-10-21: FAIL - record search groups respect capabilities, but finance Calendar/Settings/Emails shortcuts open blank sections. `finance-health.jpg`. |
| 18 | Settings, Emails | Booking rules and email settings save; test email is blocked from real recipients | 2026-10-21: NOT TESTABLE - U11; no logo or configured sender; same-day allowed and limits unset, so prohibitions cannot be proven without policy changes. `email-config.jpg`. |
| 19 | Provider outage | Stop or break the Clock staging call (mock or bad credential locally): screens show Unknown / sync-problem states, no crash, no data loss | 2026-10-21: PASS - browser-only pricing/preview 503 mock clears the price to Unknown, shows a reference, then real EUR 300 recovers after unroute; credentials untouched. `clock-outage.jpg`. Not a live provider outage. |
| 20 | Concurrency | Two staff book the last room at once: exactly one succeeds | 2026-10-21: NOT TESTABLE - no bookable last-room fixture; four ordinary creates already refused. `pokpay-create-blocked.jpg`. |
| 21 | Production smoke (Must Hotel) | Items 4, 5, 7 on the deployed build with `MH-` references; Empire untouched | 2026-10-21: NOT TESTABLE - explicitly outside this local-only authorization; no production host/account contacted; no screenshot. |

Record defects as gap rows in `24-dashboard-redesign.md` with the check number; do not start Milestone 25 until every row is passed or its deferral is written down.

## Local verification - 2026-10-21

Owner scope: local web :3001/API :3000, **Demo Beach Hotel only**. Worktree `design-dashboard/Must-Booking`, branch `codex/design-dashboard-latest`, after layout commit `0f39847`. In-memory comparison confirmed the assigned Clock credentials match the local `CLOCK_SANDBOX_*` configuration; PokPay uses staging only. Credentials were not printed. The documented test card was available, but no checkout was reached.

The owner authorized enabling PokPay and Pay at hotel; both are now enabled on this local property. Other booking policies and credentials were not changed. Four failed attempts remain for review; the pre-existing `DBH-REVIEW-TEST` unknown-result booking was not retried or cancelled. No production smoke test was run.

Screenshots below are small local JPEGs under `output/playwright/beach-verification/`, not committed. U numbers match the owner's 13-check prompt; the original plan rows above retain their own numbers.

| U | Check | Result | Evidence / screenshot |
| --- | --- | --- | --- |
| 1 | Overview, Needs attention, Approvals, System health by role | FAIL | All permitted tabs loaded for owner/manager/front desk/finance without JS/API errors on the final pass; Approvals hidden for front desk/finance and Quick booking hidden for finance. Finance Overview's Open calendar and System health's Settings/Emails shortcuts open empty unauthorized sections. `finance-health.jpg`. |
| 2 | Global search by name/email/phone/reference/payment | NOT TESTABLE | First four inputs passed for all roles. Finance gets reservation results without guest-profile results; front desk gets no Payments destination; only owner gets Payment settings. No payment record exists to prove positive payment-reference search. `finance-health.jpg` identifies the tested role; search evidence retained locally. |
| 3 | Clock Quick booking -> reference/synced | FAIL | Two stays, four room types and two occupancies: quotes/matches displayed, then every create returned `AVAILABILITY_FAILED`; no Clock reservation ID or synced badge. `clock-availability.jpg`, `pokpay-create-blocked.jpg`. |
| 4 | PokPay card -> sweep -> confirmation/ledger/email | NOT TESTABLE | Both PokPay attempts stopped before checkout; no card submitted, provider session, charge or confirmation email. `pokpay-create-blocked.jpg`. |
| 5 | Pay at hotel -> manual payment | FAIL | Both creates failed; no confirmed booking on which to record manual payment. `pokpay-create-blocked.jpg` shows the common gate. |
| 6 | Edit details read-only | PASS | Clock-property failed booking shows Managed in Clock, zero enabled form inputs, only Close; zero mutation requests. No synced-booking fixture available. `clock-readonly.jpg`. |
| 7 | Change dates refused | PASS | Same booking shows `Managed in Clock. Change dates there.`; date/reason controls disabled, no submit or mutation request. `clock-readonly.jpg` identifies the tested booking. |
| 8 | Cancel/refund; approval/approve/retry/reject | NOT TESTABLE | No confirmed or paid test booking; no eligible cancellation request/approval/refund executed. Free-window, out-of-window, rejection and double-refund safety remain unverified. `pokpay-create-blocked.jpg`. |
| 9 | Partial refund from Booking and Payments + email | NOT TESTABLE | No charge exists. Neither refund entry point, refund amount nor guest email could be exercised. `reports.jpg`. |
| 10 | Calendar/Inventory and stop-sale semantics | FAIL | Timeline says Live, 81 rooms free and 0% occupancy from local records; availability calendar labels future cells Sold out. No controlled stop-sale fixture establishes Closed vs Sold out. Inventory's five tabs correctly show read-only/Unknown. Calendar block wizard opens without early Managed in Clock wording, but submit returns 403 / Clock inventory is read-only; no block created. `calendar.jpg`, `calendar-block.jpg`, `inventory.jpg`. |
| 11 | Payments/branding/rule enforcement settings | NOT TESTABLE | PokPay connected in Test mode and Test connection succeeds. No saved logo; sender is unconfigured and prior emails failed. Same-day is allowed with no cutoff; stay/window/guest limits unset, so their blocking boundaries were not changed or invented for this run. `payments-staging.jpg`, `email-config.jpg`. |
| 12 | Reports versus two ledger numbers | NOT TESTABLE | All four ledger endpoints return 200 with no entries: charges 0, refunds 0, matching Reports' no financial activity/refund count 0. Positive monetary reconciliation remains blocked. `reports.jpg`. |
| 13 | Bell, new items, Resolved | PASS | Eight new alerts (created + needs attention per attempt) appear in bell/inbox. Mark as resolved saves the verification note; Reopen restores Needs action, leaving the booking issue open. `notifications.jpg`. |

### Attempt evidence and limits

| Local reference | Method / room / adults | Stay | Result |
| --- | --- | --- | --- |
| DBH-261021-1055-ZEBU | Pay at hotel / DBL / 2 | 2026-12-28 to 2026-12-30 (68 days ahead) | AVAILABILITY_FAILED; quoted EUR 220 |
| DBH-261021-1056-QB8C | PokPay / APP / 2 | Same stay | AVAILABILITY_FAILED; quoted EUR 300 |
| DBH-261021-1059-HAS9 | PokPay / FAM / 1 | 2027-01-25 to 2027-01-27 (96 days ahead) | AVAILABILITY_FAILED; quoted EUR 240 |
| DBH-261021-1100-65PJ | Pay at hotel / Standard Rooms / 1 | Same January stay | AVAILABILITY_FAILED; quoted EUR 240 |

A read-only audit scoped to this tenant/property found **0 payments, 0 checkout sessions, 0 Clock folios, 0 Clock-linked test bookings and 0 emails linked to these four attempts**. No unknown-result booking was blind-retried. Booking-list search, status filter, tabs and sorting were exercised on the failed records; there are too few rows for multi-page traversal. Resend-payment-link and accommodation import/local-save checks remain untested.

Initial full-page navigation hit transient Next dev chunk-load exceptions; reload recovered. The final four-role tab/search passes recorded zero JS errors and zero failing application API responses. The pricing outage check was an explicitly intercepted browser response, not a changed provider credential. No product code, schema, API contract or permission changes were made. No isolated copy/layout fix was made because the observed functional findings concern Clock/payment or ownership/access behavior. No app tests/typechecks were needed for these documentation-only tracked changes; no full suite was run.

Open issues are recorded as verification gap rows in `24-dashboard-redesign.md`. This run does not close the milestone or certify the payment/cancellation chain.
