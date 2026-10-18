# Reports — Milestone 24, Pages 19 and 19a

Owner-authorized scope: Reports dispatch of 2026-10-18, extending B08/S11 and S143–S155. Implementation is split into R1–R5 below; implementation evidence does not mark the milestone Done. No provider calls, production actions, payment mutations, booking repricing or WordPress changes are authorized.

## Build order and acceptance

| Part | Deliverable | Verification |
| --- | --- | --- |
| R1 | Written catalog, definitions, pure shared metrics kernel, scoped Definitions API and shared read-only Definitions panel | Formula/date/money boundary tests, real HTTP isolation and capability tests, API build/Prisma, web checks and panel browser states |
| R2 | Scoped live-table report projections, comparisons, filters, pagination, audit-safe CSV and print export contracts, short permission-aware cache | Real data fixtures, both property sources, export audit, query limits and indexes measured before adding summaries |
| R3 | Private/team saved view configurations, additive forced-RLS migration, versioned/idempotent CRUD and audit | Concurrent edits, retry, privacy and tenant/property isolation |
| R4 | All supported report screens, Definitions, custom view editor, shared chart/table/export/print components | Component behavior tests, full web suite, browser captures of each report/source/empty/error state |
| R5 | Existing Overview/Payments/Bookings consume the same metrics; full reconciliation and cross-screen regression pass | Same-range consistency tests, complete sequential verification, browser evidence and gap reconciliation |

Each part is committed with explicit pathspecs and reported separately. No push. `apps/web/next-env.d.ts` is preserved. R1 introduces definitions and calculation primitives; existing legacy endpoints are migrated in R2/R5, not silently redefined before their callers change.

## Catalog and source classification

Real means stored evidence; Derivable means reproducible from stored evidence; Missing-data means unavailable, hidden or Unknown, never zero-filled. Partial evidence must carry coverage and basis. Classification is per measure, not a promise that an entire report is already implemented.

| Report | Measures | Class and source |
| --- | --- | --- |
| A Manager's flash | Created bookings, current confirmed/cancelled/pending/expired counts | Derivable: bookings status and property-local created date |
| A | Room revenue, collected, refunded, net, occupancy, ADR, RevPAR, comparison and sparklines | Derivable with qualifying nightly snapshots/payment rows/local supply; Unknown for missing snapshots or Clock supply |
| A | Arrivals/departures/in-house; OTB 7/14/30/60/90 | Derivable: current confirmed stay intervals, end-exclusive; operational stay evidence separately labeled |
| B Reservations | Created/status counts, LOS/lead distributions, adults/children, same-day/advance | Derivable: booking dates, counts and status |
| B | Room type, assigned room, rate plan, source DIRECT/WEBSITE, payment-method mix | Real/Derivable: existing booking fields; null source stays Unknown, no backfill |
| B | Meal-plan/derived-plan mix | Partial: current rate-plan metadata exists, historical plan/meal snapshot does not; current-metadata label required |
| B | Cancellation count, lead, room/plan breakdown, policy window | Partial: cancelled state and audit evidence, snapshotted cutoff/free rule; actual cancellation timestamp only where booking.cancelled audit exists; otherwise Unknown |
| B | No-show | Partial: pms_stay_status when present; no local normalized no-show event; hide absent evidence |
| B | Funnel created/payment-started/paid/confirmed | Partial: payment_provider_sessions and successful ledger evidence; current status is not historical transition history; no search/visit conversion |
| B | Clock sync statuses, paged reservation drill-through | Derivable: locally stored statuses/manual review; not a live provider-health assertion |
| C Revenue/payments | Accrual room revenue, nightly mandatory charges, totals by currency/type/plan/weekday/month | Derivable: confirmed booking nightly_rates amount/components; legacy snapshots without components are tax-exclusive room amounts; absent/malformed snapshots produce missing-data coverage |
| C | Collected/refunded/net, method mix, refund count/amount/timing, failed payments | Derivable: payments kind/status/created_at, currency, method; created_at is local successful ledger posting time, not asserted provider settlement time |
| C | Outstanding, ageing, collection rate, pay-at-hotel receivables, reconciliation | Derivable: booking total less successful charges plus processed refund ledger; positive balance only, ageing from arrival; currency mismatches excluded and listed |
| C | Abandoned checkouts | Partial: expired bookings/provider sessions; no proof of customer intent; label expired unpaid checkout |
| C | Refund reasons | Missing-data: no normalized immutable refund reason; note is not a classification |
| C | VAT vs tourist tax vs extras | Partial: v2 components preserve charge name/id/amount but no immutable tax category; show mandatory charges by recorded name, never label arbitrary charge VAT or room revenue |
| D Occupancy/stay | Sold/available nights, occupancy, arrivals/departures, LOS, forward OTB/revenue, sold-out/low-stock dates | Derivable: confirmed stays and supported local capacity; Clock supply Unknown; historic physical capacity cannot be reconstructed from current room count |
| D | Blocked nights, stop-sell/min-stay days | Derivable for current saved local rules/blocks with distinct capacity-night union; not provable lost demand or historical rule state |
| D | Pickup 1/7/14/30, historical pace | Partial: created_at can reconstruct surviving reservations, not status/date amendments at past cutoffs; exact pickup/pace hidden until immutable reservation snapshots/events exist |
| E Accommodation | Type/unit nights, ADR, revenue, cancellation, ranking, readiness link | Derivable with assigned room and valid snapshots; no unit allocation invented for pool bookings; missing denominator yields Unknown occupancy/RevPAR |
| E | Underperformers | Derivable: transparent ranking against selected period/property peers only; no invented score, rating or generated insight |
| F Guests | New/returning, repeat ranking, booking frequency, spend | Derivable: guest_id and prior property bookings; unmatched guests excluded with coverage; spend per currency from known confirmed snapshots |
| F | Origin/country | Missing-data: Guest has address/city but no country; do not infer nationality |
| G Pricing/inventory | Coverage/issues, rule/block summaries, plan performance, derived/base mix | Derivable: existing Rates health engine, Inventory reads and current plan metadata; no duplicate pricing evaluator or live Clock coverage |
| H Operations | Staff vs website | Real/Derivable: existing nullable booking.source; DIRECT means staff flow, not a provable named creator |
| H | Staff activity by actor/action/day | Derivable: property-scoped audit_logs; requires staff.view in addition to reports.view; actor details never leak without gate |
| H | Payment-link sent/expiry, email delivery | Partial: existing email_messages sent_at/delivered_at/status and payment session/expiry evidence; no click/open statistics or assumed delivery |
| I Data quality | Missing payments, orphan payments, currency mismatches, missing/invalid nights, sync failures, orphan holds | Derivable: scoped joins and stored statuses; pay-at-hotel/free without online payment is not automatically an error; holds only where ownership/expiry evidence exists |
| J Custom view | Private/team known-report configuration, duplicate/rename/delete, filters/grouping/metrics/chart/table | Missing-data until R3 migration: bounded saved configuration, no SQL or arbitrary AND/OR builder; report execution rechecks permissions |
| All | Date/comparison/group/filter/paged drill-down, CSV, last updated | Derivable in R2/R4; currency never aggregated; missing comparison evidence remains no data |
| All | PDF/print | Browser print stylesheet in R4, usable with Save as PDF; no server PDF renderer or scheduled delivery |
| All | Scheduled email | Deferred: scoped saved view + recipient authorization checked at execution + immutable export audit/job; no scheduler implemented in this task |

## Metric definitions and assumptions

The executable definition catalog in `report-metrics.ts` is the source used by the Definitions API and future screen panel. Dates below are property-local calendar dates; API ranges are inclusive `from`/`to`, stays are arrival-inclusive/departure-exclusive. Maximum 366 report days. Grouping week starts Monday. A year comparison clamps Feb 29 to Feb 28 and is explicitly labeled.

- Sold room night: one current CONFIRMED booking-room on each stay night. Pending commitments are separate, not sold. Multi-room bookings count each room record; booking counts count reservation-room records, not orders. No checked-in/out facts are invented from date alone.
- Available denominator: local configured pooled stock; individual-mode capacity only where date-specific supply is known. MIXED uses the documented local minimum of pool and physical limits when both are known. Current room supply is not historical supply. Clock denominator is Unknown. Manual blocks remain in gross capacity: no authoritative out-of-order/out-of-service category or historical room lifecycle exists. Report blocked nights separately, do not subtract restrictions or pretend all maintenance is USALI out-of-order. Occupancy may exceed 100% if data is inconsistent; flag rather than clamp.
- Occupancy = sold / available × 100. ADR = tax-exclusive room revenue / matching-currency sold nights. RevPAR = currency room revenue / available nights. For a multi-currency property, the Occupancy × ADR identity uses that currency's sold-night share of occupancy, not total occupancy across currencies. TRevPAR only when genuinely classified total revenue exists; unclassified mandatory charges do not establish ancillary revenue.
- Booked room revenue: immutable confirmed nightly snapshot amounts minus all `kind=charge` components, recognized on each stay night. All v2 mandatory charges are excluded from room KPIs because immutable tax categories do not exist. Display them separately by recorded name. Legacy valid amount-only nightly snapshots are tax-exclusive room revenue under the system's entry convention; disclose legacy coverage. Missing snapshots are not prorated from booking totals or recalculated with today's Rates rules.
- Collected: successful CHARGE ledger rows (`PAID`, `succeeded`); refunded: successfully posted REFUND rows (`REFUNDED`, `succeeded`, `PAID`) only. Ledger created_at supplies local posting/processed-date proxy; failed/pending rows excluded. No modification of payment execution. Net collected = collected − refunded, may be negative. One currency per number.
- Outstanding = max(booking gross − matching-currency net collected, 0). Ageing days = max(property date − arrival, 0), buckets 0–7/8–30/31+. Collection rate = matching net collected / gross booking value ×100 for the same booking cohort; label cohort and do not divide period cash by unrelated period accrual.
- ALOS = total full stay nights / reservation-room records for the stated cohort. Lead time = arrival date − property-local created date, may be negative (flag); cancellation lead = arrival − actual property-local cancellation audit date. Cancellation rate = currently cancelled / all bookings created in selected window. No-show rate only for stored explicit no-show over eligible arrival cohort. Cancellation within free window uses snapshotted cutoff, not today's policy; missing timestamp/cutoff yields Unknown.
- Pickup = current eligible OTB − eligible OTB at cutoff, only with complete immutable snapshots; pace is same lead-time OTB versus comparable prior period. Kernel accepts explicit snapshots, never fabricates them from current state. Negative pickup allowed.
- Half away from zero to the nearest cent for divided monetary KPIs; sums use BigInt cents and serialize decimal strings. Counts/percentages use numeric division only for non-money ratios. Zero/Unknown denominators return null. Never aggregate currencies or represent absent evidence as zero. In R2 a known empty complete series can show zero; unknown coverage cannot.
- No historical backfills or new capture fields in R1. Existing booking.source already enables DIRECT/WEBSITE reporting. Clock evidence is labeled “Synced from Clock — locally stored records”; coverage/freshness is not implied. No Clock API requests.

## API contract

All routes below are relative to `/tenants/:tenantId/properties/:propertyId/reports`, session-scoped, role checked and `reports.view` gated. Money additionally requires `payments.view` at execution, including saved views/exports. Operational actor data also requires `staff.view`. Never trust client flags to grant money access.

### R1 implemented contract

`GET /definitions`: property existence checked in a tenant/property transaction. Returns `{ timezone, source: 'LOCAL'|'CLOCK', basis, definitions: [{ key, label, formula, dateBasis, currencyBasis, money, source, limitations }] }`. Non-money users receive only non-money definitions. No metric data, secrets, provider calls or arbitrary SQL. Missing property returns 404 behind normal scope guards. Source is based on enabled Clock assignment regardless of connection health. Reports > Definitions lazily loads this contract in a shared dialog; unknown/empty/error/denied states never substitute figures.

### R2–R5 planned contract (not implemented by R1)

- `GET /workspace?report=&from=&to=&comparison=none|previous|year&group=day|week|month&roomTypeId=&ratePlanId=&status=&paymentMethod=&source=&bookingMode=&currency=&page=&pageSize=`. Allowlisted report/filter/group values; cap 366 days, page size 100. Response metadata includes basis/timezone/asOf/coverage/definitions references, summary, series, paged drill-through rows, comparison or explicit no-data. Monetary fields omitted without permission. Filters apply to numerator and denominator where meaningful; otherwise definition states cohort.
- `POST /exports` with allowlisted workspace query, selected visible columns/rows and `format: csv|print`, audited before complete output is offered. CSV UTF-8 BOM, formula-injection escaping, exact same query/permission projection as screen; audit records actor/time/filters/date basis/timezone/row count. No partial file on failure. Recheck permission, do not accept client supplied metric values.
- `GET /views`; `POST /views`; `PATCH /views/:id`; `POST /views/:id/duplicate`; `DELETE /views/:id` with bounded configuration and private/team visibility. Writes require Idempotency-Key, updates/deletes expected version. Only owner edits/deletes their view; team can execute shared views under their own permissions. No role defaults in first release. Forced tenant/property RLS, locked transaction, idempotent result and audit atomically. Exact migration and response shapes recorded in R3 before use.

## Gaps tracked in the dashboard milestone

Existing G134–G142 remain open until the relevant parts are verified. G197–G199 record missing evidence and deferred delivery/capture. Exact pickup/pace needs immutable booking state/date snapshots; historical capacity needs date-effective room supply and block lifecycle history; classified VAT/tourist tax needs immutable charge category; provider-processed time needs immutable ledger effective_at. Print-to-PDF is not an automated server renderer. R1 adds only the Definitions panel; report workspaces and existing-screen metric reconciliation remain R2–R5.

## R1 verification evidence

- API: `NODE_OPTIONS=--max-old-space-size=768 node node_modules/vitest/vitest.mjs run --pool=forks --poolOptions.forks.singleFork src/tenancy/report-metrics.test.ts test/report-definitions.e2e.spec.ts`: 36 passed (30 pure formula/date/money/snapshot tests, six real database/HTTP authorization tests). Covers Tirane DST transitions, month/year/leap edges, one-night and departure boundaries, missing evidence, currency separation, large exact sums, rounding, null denominators, cancellation cutoff, grant/revoke/suspension and cross-property/tenant access. Enabled failed Clock assignment stays Clock; no provider request is made.
- `npm run build` in API and `npx prisma validate`: passed. No schema changes in R1.
- Web handoff type-check (3500MB): passed. Focused Reports/Definitions/shared component tests: 7 passed. Full single-fork 3000MB web suite: 443 passed across 90 files. Existing ECharts DOM-size/React act warnings, no failed tests.
- Browser: `.local/reports-r1-browser.mjs`, seven inspected `.local/shots/reports-r1-*.png` captures. Real MUST Local Demo and Demo Beach Clock definitions, money formulas, mobile, plus mocked empty/500-with-reference/403 states; zero page errors. No existing room, booking or price changed.
- Transient verification failures were resolved: Windows memory caused an esbuild spawn failure; recycled only the task's local web dev server, then reran. Fixed a loading-component name and reran type-check. One command used the wrong cwd; corrected. First browser Clock text regex suffered shell encoding substitution; reran with stable text and animation settling. Full final checks passed.
- Legacy Reports, Overview, Payments and Bookings continue their existing metric calculations until R2/R5. Cross-screen consistency and export audit tests are required at those parts; they are not claimed by R1. R1 is implemented awaiting review, not a completed Reports milestone.
