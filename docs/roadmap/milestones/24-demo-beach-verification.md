# Milestone 24 — Demo Beach Hotel verification checklist

Purpose: after the redesign screens are built, prove they behave correctly for a **Clock hotel** before Milestone 25 starts. Run it **locally first** on "Demo Beach Hotel" (Clock PMS staging connection + PokPay staging connection, room-type mode), then a short smoke test of the deployed build on production **Must Hotel** (`MH-` booking references only; `EBR-` means Empire, never test on it). Nothing is "verified" until its row below has a date, a result and evidence.

## Setup

- Local: web :3001, API :3000, docker Postgres/Redis; sign in with the owner account from `.local/credentials.md` (never print it). Select the property **Demo Beach Hotel**; confirm Settings shows Clock PMS connected and Payments shows PokPay connected.
- PokPay staging card: Visa 4111 1111 1111 1111, any future expiry, CVC 123, normal-domain email. Locally the paid webhook cannot arrive; confirmation comes from the 60-second sweep or "Check payment now".
- Production smoke test: property Must Hotel only; stop and report if a booking reference starts with `EBR-`.

## Rules every row must also satisfy

- Inventory, Rates and Blocks read saved Clock projections; automatic background jobs perform supported provider GETs. Booking and payment commands retain their certified provider paths, and final booking eligibility uses the actual-stay provider check. Unsupported values remain explicit rather than invented.
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

### Owner-authorized usability and Clock read coverage follow-up (2026-10-21)

This follow-up implements the owner's 12 screenshot findings; it does not alter standalone hotel cancellation/refund policy. Earlier live results above remain historical. New evidence uses only the locally configured Demo Beach Clock sandbox, PokPay staging and the explicitly authorized Resend sender/inbox.

Root causes and fixes:

- Quick booking repeated per-room quote/conflict reads and discarded results while a room selection refreshed rules. One bounded batch now shares Clock pricing/conflict reads, caches by stay and selected type, and keeps the selected card visible. Individual-room choices belong to that type and only verified available rooms can be selected; final creation rechecks availability.
- Clock's index returns numeric booking IDs; review now fetches details and verifies exact MUST references, refusing ambiguous results. Failed unpaid attempts have an auditable close action and search-again shortcut; uncertain outcomes use the existing remote check rather than being silently dismissed.
- Missing local capacity was presented as blanket Unknown. Actual configured Clock rooms are now readable (81 on this sandbox), with read-only day availability/restriction snapshots and published rate lists. Complete occupancy/block history/tax catalogue is not invented.
- Bulk import hit actual HTTP 429 despite the local rate limiter. Bounded GET-only backoff fixed it; saved cursors resumed. Guest import completed 456 profiles (123 without email); booking import processed 104 records overlapping 2026-10-21 through 2027-04-19, including updates in overlapping windows. These are processed records, not a claim of 104 unique new bookings. No historical emails or provider writes were generated by import.
- A manual payment regression initially violated `payments_note_refund_only`; received-payment notes now live in the audit log, preserving the existing database constraint. Confirmed balance collection commits its intent before gateway access, verifies captures, prevents duplicate charges, and mirrors Clock deposits without recreating the reservation.
- The payment-return 404 was a stale local dev route manifest; restarting the task server restored HTTP 200. The return page notifies the original screen and closes its browser-opened tab, while the original screen independently verifies payment. Returning alone is not treated as proof of payment.
- The Resend sending-domain field contained an email and no sender was activated. Verified `mail.dejvis.dev`, activated `bookings@mail.dejvis.dev` through the hotel transport with encrypted credentials. Three labelled preview emails (confirmation, cancellation, refund) to the owner-designated inbox were accepted once by the application and independently reported delivered by Resend. Local log SENT is not relabelled DELIVERED without a webhook. No DNS change or secret is included in Git.

| Finding | Result | Evidence / screenshot |
| --- | --- | --- |
| 1 Overview unknown values | PASS | Empty desk queue says Nothing due today; configured room count from Clock. `overview-updated.jpg` |
| 2 Needs attention actions | PASS | Failed/unpaid close-with-note is audited and version scoped; uncertain/held-money entries remain review-only. Real DB regression. |
| 3 Quick booking speed/flicker/rooms | PASS (focused) | Batched reads; selected card retained; selected-type-only individual-room search. Final creation rechecks. |
| 4 Guests / arrival time | PASS | 456 Clock profiles imported incl. 123 without email; minimum arrival equals hotel check-in. `guests-updated.jpg` |
| 5 Payment tab | PASS (focused) | Return effect broadcasts booking identity and closes tab; no success claim before provider verification. |
| 6 Calendar | PASS | Actual 81 configured rooms; imported stays visible; no invented occupancy. `calendar-updated.jpg` |
| 7 Inventory | PASS / supported data only | Actual configured rooms and on-demand Clock day snapshot; writes remain disabled. `inventory-updated.jpg` |
| 8 Collect an unpaid confirmed balance | PASS | DBH-261021-2050-BNKX / Clock 38982086: EUR300 staging card settles the original confirmed booking; one ledger charge and Clock deposit; popup closed. `confirmed-balance-pokpay.jpg` |
| 9 Clock imports | PASS | Both bounded resumable imports completed; missing contacts retained without synthetic email. |
| 10 Suggested amenities | PASS | Selected and newly created options disappear from suggestions, case-insensitive. Focused UI regression. |
| 11 Rates | PASS / supported data only | Published rate catalogue by type/guest limits, actual-stay quote and read-only snapshot; no fabricated full tax/rule catalogue. `rates-pricing-updated.jpg` |
| 12 Hotel email | PASS | Resend API reports all 3 labelled previews delivered; confirmation/cancellation/refund use distinct rendered content. |

Live confirmed-balance evidence: DBH-261021-2050-BNKX remains CONFIRMED / PAY_AT_HOTEL, paid EUR300, outstanding EUR0. One charge references the existing collection order and one deposit audit points to Clock folio 78134419 / credit 65928160. Repeated verification did not add another charge, booking or deposit. Guest confirmation and separate payment receipt are SENT once each to the authorized inbox. The test booking remains as a clearly labelled future sandbox fixture. The first capture script reached popup close but its screenshot assertion used a corrupted euro selector; independent authoritative verification and the final paid screen passed.

Current limits: complete provider occupancy, full block history and full tax/fee definitions are not supported by the current certified reader. Previous uncertain-refund recovery and Clock UI-only Deposit Adjustment follow-ups remain open as recorded above. Imported records can change dashboard counts; ledger totals must be read afresh rather than reusing the earlier EUR1120 baseline.

Migrations: additive confirmed-collection candidate function (rollback references the prior definition), and forced-RLS Clock guest profile projection (nullable email, connection identity, composite tenant-scoped foreign keys; explicit owner-approved archival rollback). Applied only to localhost for verification. No production Clock/PokPay host was contacted and nothing was pushed. Resend delivery used only the explicitly authorized domain and test inbox.

Final focused checks for this follow-up: 13 API specs / 106 tests passed; 13 affected web specs / 69 tests passed across the focused run and corrected-spec reruns. API and web `tsc --noEmit` exited 0; Prisma schema validate passed. No full suites or production builds were run. Real updated Overview, Guests, Calendar, Inventory and Rates screens loaded with zero browser errors or application API failures. Screenshots are ignored, small JPEG artifacts under `output/playwright/beach-verification/`.

Additional import root cause: using the hydration time as booking chronology made imported historical records appear newly booked/cancelled today. Bulk import now preserves supplied Clock created/updated timestamps; the existing webhook behavior is unchanged. A real database regression repeats an old cancelled import and proves one row, original timestamps and zero historical mail. All 11 affected hydration tests pass. The test reservation's exact-email match changed the existing local contact display name; its original name was restored with a tenant/property/test-booking guard, without changing money or Clock records.

One real unpaid failed attempt (BeachVerify PokOne) was closed through Needs attention with an audit note; the queue dropped from seven to six with no booking state, payment or stock change (`attention-actions.jpg`). Both uncertain results remain review-only. A dedicated UI regression verifies required notes, submitted audit payload and queue removal. Read interruptions now retain the classified category in the audit and show a safe resume message instead of an unhelpful HTTP500. Replaying previously imported `CLOCK-` records also corrects their source creation timestamps; MUST-created booking creation timestamps stay unchanged.

Final live replay completed 105 processed booking records (including the new payment fixture) with no skipped mapping/status errors. The actual December Inventory snapshot loaded without JS/API errors: APP has 23 free rooms on 1 December and 22 on 31 December; Standard Rooms shows its actual one-unit capacity. Published Clock rates loaded for all four mapped room types with supplied guest limits (`clock-day-snapshot.jpg`, `rates-pricing-updated.jpg`). Capacity is a provider snapshot, not invented hotel occupancy. API/web final typechecks both exited 0; `git diff --check` passed. Only the two pre-existing unrelated next-env/domain-contract edits remain outside these commits.

### Owner-authorized automatic workflows correction (2026-10-22)

Plan approved by the owner: (1) repair real-schema availability search and unify imported guest visibility; (2) adults/children layout and end-to-end child ages; (3) fresh-evidence, capability-gated resolution of unknown bookings and truthful balance wording; (4) automatic durable Clock synchronization with initial history/catalog imports, incremental catch-up and locally stored availability/rates; (5) structured manual-payment evidence, copy/QR for the same PokPay order and payment-window handling; (6) persistent server media, retained-email modal and richer role-appropriate hotel-contact emails. Preserve standalone hotel pricing/cancellation/payment behavior. Use ADR-0034 for durable synchronization/storage choices. Run affected focused tests and app typechecks only; no push.

Confirmed root causes: staff room search queried nonexistent `rooms.status` instead of `is_active`; mocked query results hid this defect. Imported Clock profiles were stored separately and the directory panel was only rendered during loading. Main guest reads now include connection-scoped imported profiles, retaining missing email and deduplicating only explicit Clock guest mappings. A real-database regression verifies both schema-correct active-room selection and imported no-email profiles in the normal directory.


Final local evidence (2026-10-22): automatic initial history and subsequent catch-up completed. The scoped database contains **504 Clock-linked bookings**, including **378 past stays**, with arrival dates from **2026-05-19** and departures through **2030-01-11**, plus **456 imported Clock guest profiles**. These are stored records, not a claim that every provider field or historical financial entry is imported. All 19 durable jobs (catalog, rooms, rates, bookings, guests and 13 availability months) were SYNCED without an error at the final read. A zero processed count on a later delta means no new changes, not an empty directory.

Additional root causes fixed:

- Manual import/read panels had no durable automatic scheduler. Connection-scoped jobs now retain cursors, leased ownership, snapshots and error state; verified webhooks request refresh and periodic catch-up recovers missed events. Normal screens read the database rather than contacting Clock. Initial history does not send historical mail or recreate money.
- Hydration could overwrite a cancellation that changed during its outbound read. Comparing the locked database version with a database snapshot taken before that read fixes the race without relying on application/database clock agreement. Source timestamps reject older provider updates; an advisory lock serializes first insertion of one external identity.
- Imported bookings had a stay total but no imported financial history, which misleadingly appeared collectible. Their balance is now explicitly managed in Clock; both online and manual collection refuse unverified imported balances. Actual MUST ledger payments remain visible. Unknown-result bookings likewise do not count as confirmed debt.
- An older Payments row action bypassed the new evidence/confirmation form. It now opens the shared collection screen. New bank/POS records require date and reference, offer payer/terminal details and require confirmation; evidence is retained in the audit and displayed in payment activity. No card number/CVC is collected. Existing API callers without the new optional evidence remain compatible.
- Child-age array keys were already serialized with brackets by the Clock HTTP client. Passing bracketed keys again generated a wrong double-array key. Bare keys now produce one correct Rails array; both the HTTP regression and a real sandbox booking/read-back verify it.

| Owner finding | Result | Evidence / screenshot |
| --- | --- | --- |
| 1 Resolve uncertain bookings | PASS | Fresh exact-reference check, required reason and financial/permission/version safeguards. DBH-REVIEW-TEST closed as not created through the real screen; removed from queue, no money/provider write. `review-resolved-final.jpg` |
| 2 Adults/children and each child's age | PASS | Same-row controls and two independent age inputs on screen. Sandbox DBH-AGE-SYNC-20261022 (2027-01-20 to 22), Clock 38995173, retains age 2; actual Clock total EUR200 equals MUST. `child-ages-final.jpg` |
| 3 Search HTTP500 | PASS | Fixed nonexistent rooms.status query to is_active; real-database regression and live availability/creation succeed. |
| 4 Imported guest visibility | PASS | Main directory includes 456 Clock profiles, including missing-email contacts; only explicit identity mappings suppress a duplicate. `guests-automatic-final.jpg` |
| 5 Calendar automatic sync/availability | PASS for supported snapshot | Past/future stored bookings and actual configured 81 rooms; available tonight reads the saved day snapshot. No manual import/load panel. `calendar-automatic-final.jpg` |
| 6 Inventory synchronization | PASS for supported snapshot | Background day counts/restrictions; database-only screen reads and freshness. Full block history remains unsupported, clearly identified. `inventory-automatic-final.jpg` |
| 7 Uncertain bookings in Payments | PASS | Review actions link the exact existing Clock booking or close a verified absent unpaid attempt; unverified balances do not become confirmed debt. Real DB/UI tests. |
| 8 Bank/POS evidence | PASS (focused) | Required date/reference in new shared UI, optional payer/terminal, confirmation; immutable scoped audit/idempotency and ledger read regression. Old one-click bypass removed. |
| 9 Copy PokPay link / QR | PASS | Real staging checkout link copied and locally generated QR presented for the same reusable order. No new charge sent. Browser/API errors: zero. |
| 10 Close payment tab | PASS (focused; browser limitation) | Return effect broadcasts and immediately attempts close without redirect; original screen independently verifies payment. Browsers may refuse closure of a manually opened tab; close-tab fallback remains. |
| 11 Historical and ongoing imports | PASS for supported fields | 504 linked bookings / 378 past stays / 456 profiles; durable initial import and deltas complete. No historical mail or fabricated ledger payments. |
| 12 Server image storage | PASS locally | New library image authorized 201, PUT 204, confirmation 204 and public image GET 200. Decoding/re-encoding, namespace/RLS, expiry, traversal and restart tests pass. Existing remote images are retained. |
| 13 Synchronized Rates & Pricing | PASS for supported catalogue | Published rates and one-adult nightly reference prices load from saved snapshots; actual selected-stay quotes remain fresh. No manual sync/load prerequisite. `rates-pricing-automatic-final.jpg` |
| 14 Retained email popup | PASS (focused) | Retained preview opens a large accessible dialog with desktop/mobile/plain-text views; original frozen content retained. |
| 15 More useful emails and hotel contacts | PASS (focused); SENT locally | General settings expose hotel email/phone/address placeholders; email footer links contact/map. Guest/staff summary includes check-in, check-out and nights. New age-fixture confirmation SENT once and staff notifications SENT three times; latest extra summary rows verified by rendered HTML test, not a second live email. |

Checks: **16 affected API specs / 175 tests passed**, and **20 affected web specs / 182 tests passed**, using the final successful rerun for changed specs rather than adding repeated tests. The final API group covered hydration (14), collection (7), availability (37) and HTTP serialization (7); the final web payment group covered Payments (17), collection controls (8) and payment detail (8). Resend provider HTML rerun: 11 passed. Earlier failures were investigated and corrected (database/read race clock comparison, updated rate snapshot fixture and imported-balance expectations); no failing result is counted as a pass. No full suite or production build was run.

Final `pnpm.cmd --filter api exec tsc --noEmit`, `pnpm.cmd --filter web exec tsc --noEmit` and `pnpm.cmd --filter api exec prisma validate` each exited 0. `git diff --check` passed; scoped secret-pattern scan found zero matches, and relative links in changed canonical documents resolve. Screenshots are few, compressed, ignored local JPEGs in `output/playwright/beach-verification/`. Real Guests/Calendar/Inventory/Rates and control screens loaded with zero browser exceptions or application API errors. API :3000 and web :3001 use only the guarded Demo Beach Clock sandbox; collection uses the configured PokPay staging connection. No production deploy, DNS change, push or new card charge/refund was performed in this correction pass.

Remaining issues / verification limits, ranked:

1. **High ? financial import coverage:** historical Clock payments/folios are not a certified financial import. Collection of imported balances is deliberately blocked until their financial position is verified; do not recreate historical payments from booking totals. Earlier uncertain-refund recovery and Clock UI-only Deposit Adjustment follow-ups above remain open.
2. **Medium ? provider coverage:** complete block history, full occupancy and private/non-published rate/tax definitions are not certified readers. Supported room counts, day restrictions, published rates and reference prices are synchronized; unavailable fields stay explicit. No assumption is presented as ?everything from Clock.?
3. **Medium ? production operations NOT TESTABLE locally:** persistent-volume backup/restore and genuine external Clock webhook delivery were not certified against a production deployment. Local persistence/restart and signed webhook tests pass; scheduled catch-up works independently. Deployment enablement is separate and was not performed.
4. **Low ? child-age price-band fixture NOT TESTABLE:** age 2 round-trip and exact provider total are verified, but this sandbox fixture supplied equal quotes for the sampled ages; no distinct age-band discount is claimed. Clock's actual quote remains authoritative.
5. **Low ? browser/email presentation:** browsers control whether a manually opened payment tab can close itself. Existing retained emails preserve their original content; richer wording applies to newly prepared messages. Reusing the owner's test inbox for AgeSync Verification updates that shared local test contact name through existing exact-email matching; no guessed restoration was made.

Additive migrations: `20261022090000_clock_background_read_sync`, `20261022100000_server_media_uploads`, `20261022110000_booking_child_ages`, applied only to localhost. New API contracts are scoped Clock snapshot/status/recovery reads, guarded booking review resolution, optional child ages and optional structured manual-payment evidence; existing standalone flows retain their tests. ADR-0034 and the canonical Clock/operations documents own durable synchronization and storage details. This records implementation evidence without self-marking a milestone Done. No owner-level question remains for the approved local scope.


## Owner-authorized follow-up corrections (2026-10-22)

Scope: M24 S01/S02/S05, Calendar/Inventory, email presentation, My account and Settings integrations; owner approved the thirteen-area corrective plan. Implementation is ready for review, not marked Done.

| Reported problem | Result |
| --- | --- |
| Room search returns HTTP500 | Removed dummy room-type identity from batch validation; real scoped UUIDs and per-room eligibility reach the actual quote path. Exact 30-31 October search returned HTTP200 with four room-type offers and three sampled individual-room offers. |
| Duplicate Clock Calendar / empty Inventory | Clock Calendar links to one Inventory view. Inventory uses saved room counts, availability and day restrictions; unsupported local tabs are hidden. LOCAL controls are retained. |
| Payment records have no next action | Failed/closed attempts explain that no payment is due and offer a new search. Verified balances control collection; confirmed payment details expose cancellation next to refund. |
| Copy / QR / search / email layout | Copy uses only a toast; QR is centered; global search measured 672px; retained preview measured 760px with iframe/body height 556px and no iframe scrolling or scripts. |
| Imported money is unclear | Separate Clock payments, refunds, guest credit and folio entries are shown without adding them to the MUST ledger. See Clock architecture for reconciliation limits. |
| Cancellation and refund differ | Shared none/full/percentage/fixed chooser; combined cancel-and-refund entry; unchanged refund retries reuse their request key. No guessed Clock penalty. |
| Optional account information | Additive optional profile migration applied and recorded locally; omitted values survive partial updates. |
| Sparse emails | Richer uniform default event wording and common layout; compact language control. Existing published overrides and retained messages are preserved. No new email was sent in this pass. |
| Empty demo rooms / branding | Four room types, all 81 rooms and five library assets populated with clearly labelled sample content; branding uses a verified hotel-owned server-library image. Clock capacity, IDs and assignments were preserved. |
| Hidden integrations | Settings > Integrations exposes setup, test and safe credential replacement; account history blocks unsafe switching/deletion. No credential was replaced in this pass. |

Live screenshots reviewed under ignored `output/playwright/beach-correction/`: search, Inventory, Integrations, payment, exact CLOCK-396 credit, Accommodations, global search and retained email preview. Checked screens had no page exceptions, application API errors or horizontal overflow. These are local/sandbox observations, not a production deployment.

Open financial issues: CLOCK-396 shows EUR3400 paid for a EUR1700 booking (EUR1700 guest credit); no automatic refund or deletion was made. Some other Clock records contain contradictory ALL/EUR folio/payment currency labels; collection is blocked and checks retry automatically. Resolving provider financial history needs a reviewed money decision. Executable Clock cancellation policy terms remain unverified. Full block history/private rates and external webhook/deployment coverage remain as previously recorded. Localhost image URLs work locally but require a reachable HTTPS media base for external email images. No DNS, production, push or new card charge/refund was performed.


Follow-up verification results: API focused seven files **66/66 passed**, quote occupancy/controller two files **5/5 passed**; affected web components thirteen files **141/141 passed** with one worker. The first concurrent web run had one account-password test timeout; it passed alone and in the final complete affected run. Earlier stale cancellation-copy assertions and an incorrect new-test HTTP201 expectation were corrected to the intended controls/existing HTTP200 contract; money, permissions and idempotency assertions remain. API production build, Next production build, final web typecheck and Prisma validation each exited 0. Server-library ownership/foreign-property refusal is exercised by the real upload/database regression. Migration history records the optional account migration on localhost. Live recovery returned catalog SYNCED and zero FAILED jobs at the observation point; currency-inconsistent records remain blocked and automatically rechecked. No new deployment or provider financial write is claimed.


## Owner-authorized eight-area follow-up (2026-10-23)

M24 corrective scope: Clock search/synchronization, Inventory, refund/cancellation presentation, payment-link retrieval, global search, My account, integration discovery and guest email management. The owner explicitly selected hotel policy for new MUST bookings and staff review for imported terms; [ADR-0035](../../decisions/ADR-0035-booking-policy-snapshots-and-guest-requests.md) owns that decision. Implementation is for review, not self-marked Done.

Clock background reads now leave capacity for foreground searches; identical concurrent type searches share work. Booking webhooks wake relevant projections rather than all catalogue jobs, with periodic reconciliation retained. Catalogue temporary errors retain retry classification rather than becoming permanent configuration failures. New immutable terms and guest-origin requests use additive migrations `20261023010000_account_date_format` and `20261023020000_booking_terms_and_guest_requests`, applied and recorded only on localhost. Their ownership, access and rollback limits are documented in Data and access. No historical cancellation policy was backfilled.

Inventory has distinct Overview, Availability, Restrictions, Blocks and Sync health views. Search has a title and a 740px maximum width; cancellation is 600px with consistent spacing and a fixed action area. Account birthday entry follows the selected date format, defaults to DD/MM/YYYY, and personal timezone inherits hotel timezone until overridden. Marketplace cards use category filters and provider-specific credential forms; unavailable integrations and PokPay production are labelled unavailable. Clock disable with active future bookings is blocked rather than silently switching inventory ownership.

Payment link retrieval reuses a healthy existing checkout and prepared browser link; clipboard denial offers a selectable link. No new charge, refund or reservation cancellation was performed in the local browser pass. Guest management was visually checked with an explicitly mocked fixture, while real PostgreSQL/HTTP tests verify signed access, headers, request deduplication, original booking retention and refusal on uncertain money. Smaller email branding and Manage booking links apply to newly prepared messages, preserving retained content. Query strings are excluded from API request logs.

Verification: the combined eleven-file API run passed **81/81**; the subsequent four-file safety run passed **27/27**, including the actual PostgreSQL cancellation guard and private/no-store headers. Affected web components passed **59/59** in seven files. API production build, Next production build, scoped ESLint, Prisma validation and `git diff --check` exited 0. Earlier regression failures identified an outdated cancellation URL expectation, an account-access-session assumption, reuse of a previously cancelled payment fixture and a missing mail-queue wait; assertions now verify the intended behaviour without weakening money/idempotency checks.

Local browser observations: two simultaneous exact 30-31 October room-type searches returned HTTP200 and four offers each in a combined 779ms. All five Inventory tabs activated without horizontal overflow; the account field displayed DD/MM/YYYY and search/cancellation dialogs were reviewed. A one-time guarded catalogue re-read updated 85 existing mappings with zero new proposals; recovery of the historical parked catalogue job subsequently reported SYNCED and zero FAILED jobs at the observation point. This is local/sandbox evidence, not production certification or proof that throttling can never occur. Screenshots are ignored artifacts under `output/playwright/oct23/`.

Remaining limits: actual provider price/eligibility checks remain necessary before committing a booking; supported stored projections do not reproduce the full Clock pricing engine. Original imported cancellation terms, complete block history and production PokPay remain unverified/unavailable. Existing provider financial credit/currency inconsistencies were not altered. External webhook delivery, reachable production media URLs and production migration/deployment remain separate operational checks. The browser produced existing favicon404 and monitoring403 messages; no application error is inferred from those telemetry/static requests. No push, deployment, DNS change or credential replacement was performed.

Additional shared-order regression: `multi-room-booking.e2e.spec.ts` passed **2/2** after asserting guest Clock refusal before the existing reviewed staff cancellation and partial-provider-failure cases. Standalone group cancellation keeps its existing flow; newly saved terms are used instead of later property-policy edits.
