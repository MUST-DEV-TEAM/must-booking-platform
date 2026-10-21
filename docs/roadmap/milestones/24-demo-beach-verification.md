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
| 1 | Overview | Tiles and lists load; arrivals/departures match Bookings; no MUST-only metrics shown for Clock | 2026-10-21: PASS - all four roles load permitted tabs/widgets; finance shortcuts hidden and denied routes recover. `finance-access-fixed.jpg`. |
| 2 | Bookings list | Search, tabs, filters, paging; Clock-synced and sync-problem bookings are labelled | 2026-10-21: PASS - search/filter/sort/single-page controls verified; 13 records do not supply a multi-page fixture. `booking-list.jpg` (initial pass), payment search rechecked below. |
| 3 | Booking detail | Guest, stay, nightly rates, payment, Clock reservation id and sync state; cancel and resend payment link work | 2026-10-21: NOT TESTABLE in full - real detail, Clock IDs, payment history, edit/date refusal and cancellation PASS; resend-payment-link delivery cannot be proven with the unconfigured sender. `clock-readonly.jpg`. |
| 4 | Add reservation | Availability and price come from Clock for the dates; capacity, minimum stay and closed-to-arrival from Clock are enforced; booking is created in Clock and shows its id | 2026-10-21: PASS - four EUR 220 Clock-priced card bookings confirmed, plus Pay at hotel; real one-unit race admits one booking. Restriction boundaries also covered by focused Clock tests. `pokpay-confirmed.jpg`, `pay-at-hotel-manual.jpg`. |
| 5 | Add reservation, card | Pay by card with PokPay staging: payment pending, then confirmed; Clock booking confirmed once, no duplicate | 2026-10-21: PASS - four documented-card staging charges; one Clock creation/deposit each; sweeps confirm, no duplicate. `pokpay-confirmed.jpg`, `pokpay-cancel-refund-final.jpg`. |
| 6 | Add reservation, pay at hotel | Booking created; payment shown as due at the hotel | 2026-10-21: PASS - DBH-261021-1423-ZTTT initially due at hotel, then EUR 240 cash recorded and zero outstanding. `pay-at-hotel-manual.jpg`. |
| 7 | Cancellation | Cancel a paid booking: Clock cancellation, refund rules, ledger entries consistent | 2026-10-21: PASS for supported automated path - fresh paid cancellation + EUR 220 refund succeeds without repair; approval/reject/retry pass. Clock UI-only Deposit Adjustment remains a manual follow-up. `pokpay-cancel-refund-final.jpg`, `clock-approval-decisions.jpg`. |
| 8 | Refund | Partial and full refund via PokPay staging; amounts, status and ledger match | 2026-10-21: PASS - EUR 22 Booking / EUR 33 Payments partials, standalone full and cancellation full refunds; actual Clock credit items and PokPay refundable=0 reconcile. `pokpay-partials-payments.jpg`, `pokpay-full-refund.jpg`. |
| 9 | Calendar | Closed (stop-sale) days look different from sold-out; minimum-stay shown; block from the chart is refused or read-only for Clock | 2026-10-21: PASS - future winner/cancelled bookings shown, capacity Unknown, no block controls/wizard; Closed vs Sold out focused cases preserved. No controlled live stop-sale fixture. `calendar.jpg`. |
| 10 | Payments | Ledger totals equal the sum of the bookings tested above | 2026-10-21: PASS - EUR 1120 collected / EUR 880 refunded / EUR 240 net matches scoped ledger sums. `reports.jpg`. |
| 11 | Guests | Directory and profile show the guests created above; duplicates logic unaffected | 2026-10-21: PASS - guest directory/profile and suspected-duplicate behavior checked; new booking guest/contact details match. `clock-readonly.jpg`. |
| 12 | Accommodations | Room types mapped to Clock; import-from-Clock path; editing local-only fields does not alter Clock; read-only labels where Clock owns data | 2026-10-21: PASS for requested edit scope - synced name/occupancy disabled, local description saves/restores; existing mapped catalog retained. Import not repeated on this property. `accommodation-edit.jpg`. |
| 13 | Inventory: Overview/Stock | Stock grid shows "Managed in Clock", no edit controls enabled | 2026-10-21: PASS - stock remains Unknown / Managed in Clock, editing unavailable. `inventory.jpg`. |
| 14 | Inventory: Restrictions/Blocks | Create/validate refused with the read-only message; lists show Unknown for provider data; Conflict Review explains it is unavailable | 2026-10-21: PASS - restrictions/blocks/conflict review read-only or unavailable with no provider writes. `inventory.jpg`. |
| 15 | Rates & Pricing | Prices shown are Clock's, read-only; no MUST-computed price presented as Clock's | 2026-10-21: PASS - real Clock quotes feed bookings; no local replacement price. `clock-availability.jpg`, `pokpay-confirmed.jpg`. |
| 16 | Reports | Figures reconcile with Bookings/Payments for the same dates; unavailable measures are hidden, not zero | 2026-10-21: PASS - Reports agrees with ledger on collected EUR 1120 and refunded EUR 880 (net EUR 240); Clock stock measures labelled managed. `reports.jpg`. |
| 17 | Staff & permissions | A staff user with only some capabilities sees only permitted pages and actions (fail closed) | 2026-10-21: PASS - four-role widgets/search filter correctly; finance Calendar/Settings/Emails show access panel and back link. `finance-access-fixed.jpg`. |
| 18 | Settings, Emails | Booking rules and email settings save; test email is blocked from real recipients | 2026-10-21: NOT TESTABLE - no configured sender/credential or saved logo; same-day is allowed and limits unset, so prohibitions were not invented or policies changed. PokPay connected/Test connection PASS. `email-config.jpg`, `payments-staging.jpg`. |
| 19 | Provider outage | Stop or break the Clock staging call (mock or bad credential locally): screens show Unknown / sync-problem states, no crash, no data loss | 2026-10-21: PASS - initial browser-only Clock pricing 503 shows Unknown/reference and recovers; credentials unchanged, not a live-provider outage. `clock-outage.jpg`. |
| 20 | Concurrency | Two staff book the last room at once: exactly one succeeds | 2026-10-21: PASS - Clock Standard Rooms had one free unit on both nights; manager/owner race yields one Clock booking, then unavailable. Loser classification corrected in fe691c3; historical attempt retained for review. `pay-at-hotel-manual.jpg`. |
| 21 | Production smoke (Must Hotel) | Items 4, 5, 7 on the deployed build with `MH-` references; Empire untouched | 2026-10-21: NOT TESTABLE - outside local sandbox/staging authorization; no production host/account contacted; no screenshot. |

Record defects as gap rows in `24-dashboard-redesign.md` with the check number; do not start Milestone 25 until every row is passed or its deferral is written down.

## Local verification - 2026-10-21

Owner scope: local web :3001/API :3000, **Demo Beach Hotel only**. Worktree `design-dashboard/Must-Booking`, branch `codex/design-dashboard-latest`, after layout commit `0f39847`. In-memory comparison confirmed the assigned Clock credentials match the local `CLOCK_SANDBOX_*` configuration; PokPay uses staging only. Credentials were not printed. The initial pass did not reach checkout; the corrective continuation below records four successful staging payments.

The owner authorized enabling PokPay and Pay at hotel; both are now enabled on this local property. Other booking policies and credentials were not changed. Four failed attempts remain for review; the pre-existing `DBH-REVIEW-TEST` unknown-result booking was not retried or cancelled. No production smoke test was run.

Screenshots below are small local JPEGs under `output/playwright/beach-verification/`, not committed. U numbers match the owner's 13-check prompt; the original plan rows above retain their own numbers.

| U | Check | Result | Evidence / screenshot |
| --- | --- | --- | --- |
| 1 | Overview, Needs attention, Approvals, System health by role | PASS | All four roles: permitted panels loaded, Approvals/Quick booking correctly hidden, zero JS/API errors; denied finance URLs recover. `finance-access-fixed.jpg`. |
| 2 | Global search by name/email/phone/reference/payment | PASS | Initial name/email/phone/reference checks plus positive payment search for owner/manager/finance; front desk gets no payment result. `finance-access-fixed.jpg`; local role evidence retained. |
| 3 | Clock Quick booking -> reference/synced | PASS | Four PokPay bookings and two Pay-at-hotel flows across this pass/history; real quotes, Clock IDs and synced badges. `pokpay-confirmed.jpg`, `pay-at-hotel-manual.jpg`. |
| 4 | PokPay card -> sweep -> confirmation/ledger/email | PASS | Four EUR 220 staging card charges; sweeps confirm once, four Clock creations/deposits, correct guest confirmation logs. Delivery is separately unconfigured. `pokpay-confirmed.jpg`. |
| 5 | Pay at hotel -> manual payment | PASS | Real one-unit winner starts due at hotel; EUR 240 manual cash settles it. `pay-at-hotel-manual.jpg`. |
| 6 | Edit details read-only | PASS | Confirmed Clock booking Edit details: Managed in Clock, zero editable inputs. `clock-readonly.jpg`. |
| 7 | Change dates refused | PASS | Confirmed Clock booking Change dates refused with Clock ownership message; no write. `clock-readonly.jpg`. |
| 8 | Cancel/refund; approval/approve/retry/reject | PASS | Fresh post-fix paid cancellation/refund succeeds; manager rejection preserves booking, later approval cancels with explicit zero refund; duplicate clicks/retries do not add refunds. Manual Clock document deferred. `pokpay-cancel-refund-final.jpg`, `clock-approval-decisions.jpg`. |
| 9 | Partial refund from Booking and Payments + email | PASS | Booking partial EUR 22, Payments partial EUR 33, standalone/full cancellation refunds and six correct guest refund logs. `pokpay-partials-payments.jpg`, `pokpay-full-refund.jpg`. |
| 10 | Calendar/Inventory and stop-sale semantics | PASS | Timeline shows held winner and four cancelled stays with Unknown capacity/occupancy, Stored bookings and no block controls; Inventory remains read-only. `calendar.jpg`, `inventory.jpg`. No controlled live stop-sale fixture. |
| 11 | Payments/branding/rule enforcement settings | NOT TESTABLE | PokPay connected/Test connection and four real staging payments PASS; branding image/sent-email proof unavailable without a logo/sender. Same-day allowed, limits unset; no policy changes invented. `payments-staging.jpg`, `email-config.jpg`. |
| 12 | Reports versus two ledger numbers | PASS | Reports/Payments cash totals match scoped ledger: collected EUR 1120, refunded EUR 880, net EUR 240. `reports.jpg`. |
| 13 | Bell, new items, Resolved | PASS | New booking/refund/approval alerts appear. Resolve with note and Reopen verified; Clock document action left open. `notifications.jpg`. |

### Attempt evidence and limits

| Local reference | Method / room / adults | Stay | Result |
| --- | --- | --- | --- |
| DBH-261021-1055-ZEBU | Pay at hotel / DBL / 2 | 2026-12-28 to 2026-12-30 (68 days ahead) | AVAILABILITY_FAILED; quoted EUR 220 |
| DBH-261021-1056-QB8C | PokPay / APP / 2 | Same stay | AVAILABILITY_FAILED; quoted EUR 300 |
| DBH-261021-1059-HAS9 | PokPay / FAM / 1 | 2027-01-25 to 2027-01-27 (96 days ahead) | AVAILABILITY_FAILED; quoted EUR 240 |
| DBH-261021-1100-65PJ | Pay at hotel / Standard Rooms / 1 | Same January stay | AVAILABILITY_FAILED; quoted EUR 240 |

Before the corrective pass, a read-only audit of the original failed attempts found **0 payments, 0 checkout sessions, 0 Clock folios, 0 Clock-linked test bookings and 0 emails linked to those four attempts**. No unknown-result booking was blind-retried. Booking-list search, status filter, tabs and sorting were exercised on the failed records; there are too few rows for multi-page traversal. Resend-payment-link and accommodation import/local-save checks remain untested.

Initial full-page navigation hit transient Next dev chunk-load exceptions; reload recovered. The final four-role tab/search passes recorded zero JS errors and zero failing application API responses. The pricing outage check was an explicitly intercepted browser response, not a changed provider credential. That initial pass changed documentation only. The corrective code, focused checks and live results are recorded below; no schema or permission changes were made.

Open issues are recorded as verification gap rows in `24-dashboard-redesign.md`. The initial blockers are superseded by the corrective results below; milestone status is left for owner review.


## Corrective verification continuation - 2026-10-21

Scope remains Demo Beach locally, Clock sandbox and PokPay staging only. This continuation supersedes the earlier blocked payment evidence as new checks complete. No production host/account was contacted. Test stays use 2026-12-28 to 2026-12-30 (68 days ahead); the sandbox regression derives its stay from `test/helpers/future-stay.ts` (60 days ahead).

### Root causes and corrections

- **Stock boundary (2a2889d, regression 19d955e):** a Clock property without local inventory rows was rejected by the local reserve/release step. Five focused stock-boundary cases preserve local/Clock-with-stock behavior; real sandbox creation and cancellation now run without seeded inventory rows.
- **Sandbox test setup (19d955e):** the obsolete null-dated local pricing rule was unnecessary for Clock pricing and failed the pricing-v2 contract; hard-coded August dates had become past dates. The test now uses Clock quotes, relative stays, realistic provider timeouts and failure cleanup. A stale EUR 500 payment fixture was also replaced by the actual Clock quote. Final real-sandbox result: 5/5 passed.
- **Unknown Clock cancellation policy (50f7bc3):** absent Clock cancellation terms were treated as an expired MUST policy, sending even privileged staff to approval. Clock previews now explicitly say terms are managed in Clock, default to zero/no automatic refund and require acknowledgement plus an explicit refund choice. Both cancel/refund capabilities permit direct cancellation; other staff request review. MUST behavior stays unchanged. Focused B1 API tests: 17/17; cancellation UI: 8/8.
- **Calendar:** local physical-room counts were presented as provider availability. Both calendar views now label Clock capacity Unknown, remove free-capacity styling and refuse local blocks before a wizard opens. A known Closed day stays Closed; unknown capacity is never labelled Sold out.
- **Denied sections:** finance shortcuts linked to sections whose conditional content rendered nothing. Shortcuts now check section access; a shared denied-section panel provides a dashboard link. Focused cases cover Calendar, Settings and Emails.
- **Accommodation ownership:** editors enabled synced name/occupancy inputs. Clock room-type name/maximum occupancy and physical-room name are read-only with Managed in Clock wording; local presentation fields remain editable. No catalog, provider or permission rules changed.
- **Balance display:** failed booking statuses fell through to Pay at hotel/unpaid amounts. Shared views now say `No balance - booking was not created`. Live partial-refund verification also exposed Booking detail recreating a debt from refunded money while Payments showed zero outstanding; the display now follows Payments' existing gross-paid balance calculation.
- **Refund follow-up copy:** successful Clock negative payments intentionally create a manual Deposit Adjustment follow-up, but the generic review category described it as a payment mismatch. Only the known successful-posting message is translated to the required document action; accounting and refund behavior are unchanged.
- **Local runtime:** Windows commit pressure caused Node allocation failures and Docker's internal engine became unreachable. Docker logged `paging file is too small` and `no route to host`; recovery preserves volumes and runs focused checks sequentially. A forwarded test separator accidentally began full web collection once; it was interrupted. No full suite completed or is claimed.

### New payment evidence

| Reference | Result | Monetary / provider evidence | Screenshot |
| --- | --- | --- | --- |
| DBH-261021-1320-VZ6V | PASS - PokPay payment, confirmed once | EUR 220 charge; Clock reservation 38975248; deposit folio 78120269, credit item 65916663; one creation/deposit audit event. | `pokpay-confirmed.jpg` |
| Same booking, Booking refund | PASS - EUR 22 partial refund | PokPay REFUNDED ledger entry and Clock negative payment posted; guest `booking.refund_processed` email logged. | `pokpay-partial-booking.jpg` |
| Same booking, Payments refund | PASS - EUR 33 partial refund | Total refunded EUR 55, remaining refundable EUR 165, Payments outstanding EUR 0; second Clock refund posting. | `pokpay-partials-payments.jpg` |
| Confirmation/refund email delivery | NOT TESTABLE - credential/configuration | Confirmation and refund events are logged to the correct guest; delivery fails because local RESEND_API_KEY / sender configuration is absent. No credentials were invented and no external mail account was contacted. | `pokpay-confirmed.jpg` (booking evidence); scoped email-log read |

Clock refund posting is certified and succeeded; its Deposit Adjustment document remains a Clock UI-only manual follow-up. This is not a failed PokPay refund. No unsupported Clock document endpoint was invented.


### Cancellation refund timeout and approved reconciliation

The first paid cancellation exposed a **financial consistency defect**: `PaymentRefundService.manualRefund` used Prisma's default 5,000 ms transaction timeout while calling PokPay and then reading/posting Clock folios. Clock completed its negative credit item after about 6.5 seconds; the transaction expired and rolled back the EUR 165 local refund/idempotency record. This was not a failed card refund: read-only provider evidence confirmed PokPay refundableAmount=0/isRefunded=true and Clock reservation 38975248 cancelled, with EUR +220/-22/-33/-165 credit items (net zero). No second refund was sent.

Commit `2d49a5c` explicitly gives this existing provider-backed refund transaction 90 seconds. A real-DB focused regression waits 5.5 seconds in Clock posting, commits one refund and replays its operation without a second refund. B1 now passes 18/18. This corrects the observed timeout; it does not claim external HTTP effects and a database transaction are crash-atomic.

The owner explicitly approved restoring the missing local financial record. A guarded tenant/property/booking-scoped transaction restored only EUR 165 under the original external refund reference and `b1-direct:<booking>:1:refund` operation, plus refund audit/notification evidence. It asserted the existing EUR 220 charge, EUR 55 prior refunds, cancelled Clock ID and independently read provider evidence; **zero provider calls** were made by the repair. The audit marks reconciliation and owner approval. The resulting ledger is EUR 220 charged / EUR 220 refunded / zero refundable. One UI double-click emitted one cancellation request; two identical subsequent cancellation retries both returned 409 and left exactly three refund rows (22, 33, 165). `clock-cancel-confirm.jpg`, `pokpay-cancelled-refunded.jpg`.

Remaining risk: PokPay's adapter does not send a provider idempotency key for refunds; the local operation is committed in the same transaction as the ledger. Process failure after an external refund but before commit can still require evidence-based reconciliation. Do not blind-retry such an uncertain refund. Durable external-effect recovery is a separate payment orchestration change, beyond this component/verification scope.


Additional live results: DBH-261021-1413-NZCR (Clock 38976484) and DBH-261021-1416-4WEG (Clock 38976550) each charged EUR 220 through the documented PokPay staging card and confirmed once. The second booking's full EUR 220 refund passed with the timeout fix running: one UI double-click request, two concurrent same-key retries returned the same refund, one refund ledger row, one Clock refund posting (`pokpay-full-refund.jpg`). On the third booking, a front-desk request was rejected by the manager with a note; the booking remained Confirmed, paid EUR 220, refunded EUR 0. A new front-desk request was approved with a note and explicit no refund: booking Cancelled, refunded EUR 0 (`clock-approval-decisions.jpg`).

Three positively identified `must-payment-gated-*` fixtures left by earlier failed/timed-out sandbox assertions (38972710, 38972746, 38974875) were cancelled through the existing documented GET-lock-version/PUT-cancel flow after checking their references, exact future stay, test guest and creation date. No other Clock record was changed by this cleanup.


The real one-unit concurrency fixture was available: Standard Rooms / Clock room type 42023 reported exactly one free room on both 2026-12-28 and 2026-12-29. Separate manager and owner sessions submitted simultaneously. DBH-261021-1423-ZTTT (Clock 38976672, EUR 240) confirmed; the other attempt was refused, and Clock subsequently reported no available unit. The successful Pay at hotel booking was settled through Payments -> Ledger -> Cash (EUR 240 succeeded, zero outstanding; `pay-at-hotel-manual.jpg`).

The race exposed an additional condition defect: a definitive no-product result before any booking POST was classified as configuration/unknown external result. Commit `fe691c3` gives that response the explicit `clock_rate_unavailable` validation code and transitions the attempt to `AVAILABILITY_FAILED`; actual uncertain transport/create outcomes retain their conservative handling. The affected Clock specs pass 41/41. The first race loser DBH-261021-1423-QNPX retains its historical unknown-result record for review; it was not blindly retried or cancelled.

Four-role recheck passed with zero JS/application API errors. All permitted Overview/Needs attention/Approvals/System health panels loaded; Approvals stayed hidden for front desk/finance and Quick booking stayed hidden for finance. Payment-reference search returned the charge and three refunds for owner/manager/finance and no payment result for front desk. Finance Calendar/Settings/Emails direct URLs each rendered the shared access panel and dashboard link (`finance-access-fixed.jpg`). On the tested future dates, Calendar showed the paid winner and all three cancelled PokPay bookings, Stored bookings, Unknown capacity/occupancy and zero block controls (`calendar.jpg`). A real confirmed Clock booking's Edit details had zero editable inputs; Change dates was refused (`clock-readonly.jpg`).

Reports and independent scoped ledger sums agreed on EUR 900 collected / EUR 660 refunded / EUR 240 net at this point (`reports.jpg`). The missing EUR 165 refund receipt log was restored through the existing mail notification path using the original refund idempotency reference; it records the correct guest and fails delivery for the same absent local mail credential. No new refund or external mail account was contacted.


Accommodation ownership was verified on the real APP editor: Name and Maximum occupancy disabled, Managed in Clock visible, Description enabled (`accommodation-edit.jpg`). A local-only description marker saved with HTTP 200, then the exact original description was restored with HTTP 200; APP and occupancy 2 were unchanged. The room-type update path contains no Clock transport call. Focused editor tests also cover the physical room name versus editable local title.


### Final live result and remaining limits

The clean post-fix end-to-end check used DBH-261021-1454-XNHM / Clock 38977268: EUR 220 paid, one confirmation, explicit full refund with Clock cancellation, successful refund outcome, one refund row, retry 409, **no repair** (`pokpay-cancel-refund-final.jpg`). Final scoped totals are **EUR 1120 collected (EUR 880 PokPay + EUR 240 manual cash), EUR 880 refunded, EUR 240 net**; Reports matches (`reports.jpg`).

A final read-only audit fetched each actual Clock booking, actual folio list and deposit credit items, and re-read each PokPay staging order. All four card bookings are cancelled in MUST and Clock, each has one creation/deposit event, EUR 220 charged/refunded, PokPay refundableAmount 0/isRefunded true, and EUR +220/-220 in its actual deposit folio (net zero). Folios: 78120269, 78122391, 78122497, 78123795. Clock booking balances still show EUR 220 each because the UI-only Deposit Adjustment correction document has not been issued; a zero deposit-payment net is not a zero final booking balance.

Guest email logs contain 4 confirmations, 4 cancellations and 6 refund receipts for these card bookings, all to the correct guest; transport status is FAILED for missing local sending credentials. The new fourth-booking alert's Resolve/Reopen round trip was verified and its outstanding document follow-up remains open (`notifications.jpg`).

Ranked follow-up / NOT TESTABLE:

1. **High - durable uncertain-refund recovery:** the observed five-second timeout is fixed and live retested. A process crash or provider effect beyond the extended transaction can still precede a local commit; PokPay refunds have no outgoing provider idempotency key in this adapter. Requires a separate durable payment-operation/reconciliation change, outside the minimal component/verification scope. Never blind-retry an uncertain refund.
2. **Medium - Clock correction documents:** all four refunds posted correctly, but Deposit Adjustments are Clock UI-only/manual in the certified integration. No unsupported endpoint was invented; completing those financial documents needs the authorized Clock operator/UI flow. Review alerts stay open.
3. **Medium - mail/branding/configured policy boundaries:** sending credentials/sender and logo are absent. Actual delivery/logo-in-sent-email and resend-payment-link delivery cannot be certified. Same-day is allowed and limits unset, so no prohibited-policy boundary was invented. These need owner configuration/fixtures; email event logging passed.
4. **Low - historical test disposition:** DBH-261021-1423-QNPX retains the pre-fix unknown-result classification for the last-room loser. Future definitive no-offer attempts now fail availability before any booking POST. The unrelated pre-existing DBH-REVIEW-TEST was untouched. The exact three leaked sandbox unit-test fixtures were cleaned up as described above.
5. **Verification limits:** no controlled live stop-sale fixture or multi-page Bookings fixture; relevant Closed/Sold-out cases are covered by focused tests. Catalog import was not repeated on Demo Beach. Production smoke is outside authorization.

No pending owner approval remains: the sole financial-data repair was explicitly approved and audited. Owner actions for complete operational close-out are configuring the test sender/brand and completing the manual Clock correction documents. No production host was contacted and nothing was pushed.


Focused checks: the affected API specs passed 72 tests in total (stock boundary 5, B1 cancellation/refund 18, live Clock gated-booking 5, booking-review copy 3, Clock availability 37, Clock pre-POST failure handling 4). The 12 affected web specs passed 99 tests; the final two changed specs were rerun (4/4) after the detail/timeline wording adjustments. Web typecheck passed after those adjustments. No full suite completed. API typecheck passed after the final no-offer change. `git diff --check` and explicit-path commits preserve unrelated next-env/domain-contract changes.

### Changed files / reproducible checks

No migrations or permission grants changed. Cancellation previews expose `policySource`; Clock cancellation submissions require `clockTermsConfirmed: true` and an explicit no-refund/custom choice. Definitive pre-POST no-offer results use `clock_rate_unavailable`. MUST-source cancellation policy is unchanged.

- `apps/api/src/booking/booking-requests.service.ts`
- `apps/api/src/booking/booking-review.service.ts`
- `apps/api/src/integrations/clock/clock-availability.service.spec.ts`
- `apps/api/src/integrations/clock/clock-availability.service.ts`
- `apps/api/src/integrations/clock/clock-booking-task14.spec.ts`
- `apps/api/src/integrations/clock/clock-booking.service.ts`
- `apps/api/src/payments/payment-refund.service.ts`
- `apps/api/src/tenancy/availability-stock-boundary.spec.ts`
- `apps/api/test/booking-requests.e2e.spec.ts`
- `apps/api/test/booking-review.e2e.spec.ts`
- `apps/api/test/clock-payment-gated-booking.e2e.spec.ts`
- `apps/web/app/dashboard/[tenantId]/room-management-dialogs.tsx`
- `apps/web/app/dashboard/[tenantId]/room-management-types.ts`
- `apps/web/app/dashboard/[tenantId]/room-management.test.tsx`
- `apps/web/app/dashboard/[tenantId]/room-management.tsx`
- `apps/web/app/dashboard/calendar-board.test.tsx`
- `apps/web/app/dashboard/calendar-board.tsx`
- `apps/web/app/dashboard/calendar.test.tsx`
- `apps/web/app/dashboard/calendar.tsx`
- `apps/web/app/dashboard/cancellation-approvals.test.tsx`
- `apps/web/app/dashboard/cancellation-dialog.tsx`
- `apps/web/app/dashboard/dashboard-shell.tsx`
- `apps/web/app/dashboard/needs-attention.tsx`
- `apps/web/app/dashboard/overview.test.tsx`
- `apps/web/app/dashboard/overview.tsx`
- `apps/web/app/dashboard/payment-status.test.ts`
- `apps/web/app/dashboard/payment-status.ts`
- `apps/web/app/dashboard/reservation-detail.test.tsx`
- `apps/web/app/dashboard/reservation-detail.tsx`
- `apps/web/app/dashboard/reservations-page.tsx`
- `apps/web/app/dashboard/section-access.test.tsx`
- `apps/web/app/dashboard/system-health.test.tsx`
- `apps/web/app/dashboard/system-health.tsx`
- `apps/web/app/dashboard/use-pms-source.ts`
- `apps/web/components/ui/cancellation-preview.tsx`
- `apps/web/components/ui/state-panel.tsx`
- `apps/web/lib/reservation-display.test.ts`
- `apps/web/lib/reservation-display.ts`
- `docs/architecture/booking-and-payments.md`
- `docs/roadmap/milestones/24-demo-beach-verification.md`

Checks run (focused groups/individual specs, not a full suite):

| API spec | Final result |
| --- | --- |
| `src/tenancy/availability-stock-boundary.spec.ts` | 5 passed |
| `test/booking-requests.e2e.spec.ts` | 18 passed, including the real 5.5-second Clock-post delay |
| `test/clock-payment-gated-booking.e2e.spec.ts` | 5 passed against Clock sandbox |
| `test/booking-review.e2e.spec.ts` | 3 passed |
| `src/integrations/clock/clock-availability.service.spec.ts` | 37 passed |
| `src/integrations/clock/clock-booking-task14.spec.ts` | 4 passed |

Web: twelve affected specs / 99 passed; final `calendar-board.test.tsx` + `reservation-detail.test.tsx` rerun / 4 passed (not added to the unique-test total). Both `pnpm.cmd --filter api exec tsc --noEmit` and `pnpm.cmd --filter web exec tsc --noEmit` exited 0. `git diff --check` passed. No full build/full suite was run; an accidental full web collection was interrupted as recorded above.

Temporary local compiler memory tuning was removed from `next.config.ts`; it is not part of the committed changes. Screenshots remain small ignored local artifacts under `output/playwright/beach-verification/`.

Credential-handling incident: inspection of a pre-existing ignored local helper exposed its hard-coded local test login password in tool output. The value is not repeated here or added to tracked changes; provider/production credentials were not exposed. Credential rotation is an owner-level action and was not performed.
