# Findings

Investigation in progress. This is the canonical finding register. IDs are stable; absence of a finding is not a certification. Source findings describe the 2026-09-26 working tree, including pre-existing uncommitted changes. No provider requests or production mutations were made.

## Register and review state

Updated 2026-09-27. The 19 detailed root records below plus 24 linked worker records form the current **43-record register**. Linked reports retain the full requested fields. Do not duplicate those records when incorporating later reviews.

Root source assertions have been inspected, but their runtime effects/exploitability and proposed severity are not automatically accepted. Worker VERIFIED_SOURCE labels are preserved claims pending Astra adjudication. Use VERIFIED FINDING / LIKELY FINDING / NEEDS VERIFICATION / QUESTION / RECOMMENDATION separately from severity. Challenges 003–008 adjudicated MBA-001/003/004/005/011/012/014/016; 013 adjudicated MBA-101/102/107. Unit 014 accepts MBA-104's bounded source defects and qualifies MBA-100/103 against unresolved policy. Unit 016 accepts MBA-106's migration-chain finding at MEDIUM, with deployed schema and exploitability unverified. Other records retain their stated evidence limits pending assigned reviews.

| ID | Title | Provisional severity | Detailed evidence | Final-review state |
| --- | --- | --- | --- | --- |
| MBA-100 | Tenant suspension does not enforce an access boundary | HIGH conditional | [Record](SECURITY_DATABASE_AUDIT.md#mba-100--tenant-suspension-does-not-enforce-an-access-boundary) | QUESTION — intended suspension contract; guard behavior verified, runtime unverified; unit 014 |
| MBA-101 | Login and recovery endpoints have no application abuse limiter | HIGH | [Record](SECURITY_DATABASE_AUDIT.md#mba-101--login-and-recovery-endpoints-have-no-application-abuse-limiter) | VERIFIED FINDING — bounded app controls; edge/abuse outcomes unverified; unit 013 |
| MBA-102 | Password reset leaves old sessions and other reset tokens valid | HIGH | [Record](SECURITY_DATABASE_AUDIT.md#mba-102--password-reset-leaves-old-sessions-and-other-reset-tokens-valid) | VERIFIED FINDING — source revocation lifecycle; runtime/races unverified; unit 013 |
| MBA-103 | Property-scoped guest permissions authorize tenant-wide merge and dismissal | HIGH conditional | [Record](SECURITY_DATABASE_AUDIT.md#mba-103--property-scoped-guest-permissions-authorize-tenant-wide-merge-and-dismissal) | LIKELY FINDING — scope verified; excessive authority depends on reviewer policy; unit 014 |
| MBA-104 | Guest merge rejects one canonical choice and leaves Clock identities behind | HIGH | [Record](SECURITY_DATABASE_AUDIT.md#mba-104--guest-merge-rejects-one-canonical-choice-and-leaves-clock-identities-behind) | VERIFIED FINDING — canonical choice/mapping preservation; SQL/provider outcomes unverified; unit 014 |
| MBA-105 | Tenant-supplied Clock host can direct server requests to arbitrary HTTPS targets | HIGH | [Record](SECURITY_DATABASE_AUDIT.md#mba-105--tenant-supplied-clock-host-can-direct-server-requests-to-arbitrary-https-targets) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-106 | Schema repair leaves eleven foreign keys unrestored in the migration chain | MEDIUM | [Record](SECURITY_DATABASE_AUDIT.md#mba-106--schema-repair-leaves-eleven-foreign-keys-unrestored-in-the-migration-chain) | VERIFIED FINDING — source integrity losses; RLS persists, deployed schema/exploit unverified; unit 016 |
| MBA-107 | Invitation activation can create a verified user for an unrelated email | HIGH | [Record](SECURITY_DATABASE_AUDIT.md#mba-107--invitation-activation-can-create-a-verified-user-for-an-unrelated-email) | VERIFIED FINDING — source identity binding; no existing-account/mailbox takeover proven; unit 013 |
| MBA-200 | Payment-return route asserts an outcome from the URL | HIGH | [Record](UI_UX_AUDIT.md#mba-200--payment-return-route-asserts-an-outcome-from-the-url) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-201 | Guest cancellation promises a refund it has not calculated | HIGH | [Record](UI_UX_AUDIT.md#mba-201--guest-cancellation-promises-a-refund-it-has-not-calculated) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-202 | Guest status UI cannot resolve the full booking lifecycle | HIGH | [Record](UI_UX_AUDIT.md#mba-202--guest-status-ui-cannot-resolve-the-full-booking-lifecycle) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-203 | Staff date labels disagree with the submitted stay | HIGH | [Record](UI_UX_AUDIT.md#mba-203--staff-date-labels-disagree-with-the-submitted-stay) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-204 | Client retries create new booking intent keys | HIGH | [Record](UI_UX_AUDIT.md#mba-204--client-retries-create-new-booking-intent-keys) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-205 | Calendar performs one request per room type per day | MEDIUM | [Record](UI_UX_AUDIT.md#mba-205--calendar-performs-one-request-per-room-type-per-day) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-206 | Newly created blocks do not refresh the visible block list | MEDIUM | [Record](UI_UX_AUDIT.md#mba-206--newly-created-blocks-do-not-refresh-the-visible-block-list) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-207 | Plugin advertises PHP 7.4 while unconditionally loading PHP 8 syntax | HIGH | [Record](UI_UX_AUDIT.md#mba-207--plugin-advertises-php-74-while-unconditionally-loading-php-8-syntax) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-208 | Entry and authorization failures masquerade as empty or blank screens | MEDIUM | [Record](UI_UX_AUDIT.md#mba-208--entry-and-authorization-failures-masquerade-as-empty-or-blank-screens) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-209 | Modal semantics are declared without modal keyboard behavior | MEDIUM | [Record](UI_UX_AUDIT.md#mba-209--modal-semantics-are-declared-without-modal-keyboard-behavior) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-210 | Notification badge labels total history as unread count | MEDIUM | [Record](UI_UX_AUDIT.md#mba-210--notification-badge-labels-total-history-as-unread-count) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-300 | Recoverability has no repository-backed backup or restore proof | HIGH | [Record](OPERATIONS_AUDIT.md#mba-300--recoverability-has-no-repository-backed-backup-or-restore-proof) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-301 | Health and alerting can report success while critical dependencies fail | HIGH | [Record](OPERATIONS_AUDIT.md#mba-301--health-and-alerting-can-report-success-while-critical-dependencies-fail) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-302 | Deploy drift compares the checkout, not the code actually serving users | HIGH | [Record](OPERATIONS_AUDIT.md#mba-302--deploy-drift-compares-the-checkout-not-the-code-actually-serving-users) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-303 | Browser and WordPress behavior are outside CI and plugin publication is independent of verification | HIGH | [Record](OPERATIONS_AUDIT.md#mba-303--browser-and-wordpress-behavior-are-outside-ci-and-plugin-publication-is-independent-of-verification) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |
| MBA-304 | Full test commands can target ordinary local resources and implicitly enable real-provider tests | MEDIUM | [Record](OPERATIONS_AUDIT.md#mba-304--full-test-commands-can-target-ordinary-local-resources-and-implicitly-enable-real-provider-tests) | NEEDS VERIFICATION — worker evidence retained; Astra review pending |


## Interrupted leads preserved for bounded verification

These are **NEEDS VERIFICATION**, not new accepted defects. Existing source paths and worker messages are leads to recover, not runtime evidence. Reserved numbers mentioned below must not be reused accidentally.

- **MBA-AUDIT-017:** Raw request.url in Pino/AppModule and Sentry operation tags may include bearer cancellation tokens. Check redaction and actual route/query handling. No logs containing real tokens were collected.
- **MBA-AUDIT-012:** Integration connection DELETE may cascade assignment/mapping/provider-event history, trigger local-provider fallback, or fail when composite ON DELETE SET NULL meets non-null tenant_id. Confirm each branch and migration before claiming data loss.
- **MBA-AUDIT-015:** Connection kind and provider allegedly validated independently; PAYMENT + CLOCK_PMS may bypass the PMS entitlement gate and still dispatch Clock test traffic. Narrowly verify; no SSRF network probe.
- **MBA-AUDIT-019:** Worker reported dependency advisories; **MBA-305 reserved**, details in CHECK_EVIDENCE. Do not publish advisory severity/patch claims until official evidence and installed-path applicability are recovered.
- **MBA-AUDIT-020:** **MBA-306–308 reserved** for reported missing enableShutdownHooks, stale/global-env provider-health reporting and owner migration credentials in runtime Compose. Check deployment applicability; these files may describe retired infrastructure.
- **MBA-AUDIT-010/020:** Clock failed-job callback uses unawaited deadLetter/mark-failed operations and worker error-handler coverage may be incomplete. Verify rejection behavior without connecting to Redis/providers.
- **MBA-AUDIT-033:** UI inventory mentions MBA-212 for non-actionable attention/notification items, but no full record was persisted; MBA-211/212 are reserved unreviewed leads, not established findings.
- **MBA-AUDIT-038:** UI inventory cites MBA-217 for placeholder privacy/terms pages without a full record. Reserve 217 as a NEEDS VERIFICATION lead; inspect the pages and intended rollout scope before accepting a finding or drawing any legal conclusion.

## MBA-001 — Single-booking Stripe callback rolls back payment and Clock failure evidence

- **Category:** Payments / Reliability
- **Severity:** CRITICAL — architectural release gate before real-money use; no demonstrated real-money production exposure.
- **Affected area:** Verified Stripe callback → single-booking Clock attachment.
- **Evidence:** apps/api/src/payments/stripe-webhook.service.ts:50,128,142; apps/api/src/booking/local-pms.provider.ts:790,829; apps/api/src/integrations/clock/clock-booking.service.ts:619,643,1721; apps/api/src/tenancy/tenant-database.service.ts:19. Focused challenge and counterevidence: [MBA-AUDIT-003](investigations/MBA-AUDIT-003.md).
- **Current behavior:** The charge INSERT, continuation state changes and Clock attachment failure/review writes share one database transaction. For a single booking, an attachment failure returned as ok:false causes StripeWebhookProcessingError to escape and abort that transaction. The pre-existing booking remains PAYMENT_PENDING.
- **Problem:** SQL rollback cannot reverse the authenticated gateway capture. Local charge and recovery evidence disappear. A retried callback can re-enter attachment; reference lookup is performed after timeout/network create failure rather than before every new create attempt.
- **Impact:** Missing durable receipt/recovery state is source-verified. Conditional expiry and another outbound create after an ambiguous previous outcome are supported risks. Actual duplicate reservations depend on Clock behavior and have not been reproduced. A failure before the first create POST cannot itself create a duplicate.
- **Counterevidence:** Multi-room child failures are retained while continuation returns success. Deposit-posting failure after successful attachment can commit its review. Successful timeout reference recovery also commits. This finding does not apply identically to every Clock failure.
- **Recommendation:** Commit authenticated payment receipt independently with a durable fulfillment attempt. Preserve unknown-result/review state and reconcile the external reference before considering another create. Test single-booking rollback and commit ambiguity independently of group/deposit behavior.
- **Effort:** L
- **Timing:** NOW — before real-money activation.
- **Dependencies:** Payment/fulfillment transaction design; controlled isolated transaction tests; approved provider evidence for duplicate-reference behavior.
- **Status:** Open. **VERIFIED FINDING** for source/control-flow rollback, accepted by Astra 2026-09-27 after Sol challenge. **LIKELY FINDING** for conditional retry/expiry consequences; **NEEDS VERIFICATION** for actual external duplication. Application-created Stripe checkout and refund paths enforce test-mode keys (stripe-payment.provider.ts:48); this is not a webhook environment guard, as MBA-011 records. Deployed exposure and runtime failure reproduction remain unverified.


## MBA-002 — Late or second PokPay capture can be rejected without a financial record

- **Category:** Payments
- **Severity:** HIGH
- **Affected area:** PokPay callback and checkout replacement
- **Evidence:** apps/api/src/payments/pokpay-payment.service.ts:70,92; apps/api/src/booking/local-pms.provider.ts:717; apps/api/src/payments/stripe-webhook.service.ts:73
- **Current behavior:** After authoritative PAID/CAPTURED verification, non-PAYMENT_PENDING bookings accept only an already recorded external ID. A new paid order ID on an EXPIRED, CANCELLED or already confirmed booking returns INVALID_BOOKING_STATE.
- **Problem:** There is no late-payment ledger/refund/manual-review path analogous to Stripe expiry. Multiple persisted payment sessions make a second paid order a reachable case.
- **Impact:** Money can be captured without appearing in the ledger or actionable reconciliation; retrying the callback repeats rejection.
- **Recommendation:** Record every authenticated capture once regardless of booking state. Separate excess/late receipt classification from reservation fulfillment; route refund/review and reconcile all issued sessions.
- **Effort:** M
- **Timing:** NOW
- **Dependencies:** Provider account binding; financial state model
- **Status:** Open — VERIFIED source; late capture outcome not exercised against provider.


## MBA-003 — Multi-room quote validation drops occupancy while persistence accepts it

- **Category:** Booking / Pricing
- **Severity:** HIGH
- **Affected area:** POST bookings/orders
- **Evidence:** apps/api/src/booking/multi-room-booking.service.ts:95,135,257,372; apps/api/src/booking/quote.service.ts:329; apps/api/src/booking/booking-occupancy.ts:17; apps/api/src/booking/booking.controller.ts:100,215. Focused challenge and counterevidence: [MBA-AUDIT-005](investigations/MBA-AUDIT-005.md).
- **Current behavior:** Order creation passes no adults, children or guestCount into QuoteService.validate, whose default expected occupancy is one adult. The controller drops adults/children; the later INSERT independently normalizes room.guestCount as adults/guest_count with zero children.
- **Problem:** Valid multi-person quotes mismatch the assumed one-person occupancy. A signed one-person quote may pass while a different positive guestCount reaches persistence. The inspected group validation/catalog path does not recheck room capacity; this is not a system-wide capacity conclusion.
- **Impact:** Valid family/group checkout can be rejected. Divergent quoted/stored occupancy is a supported source-path risk; an inconsistent committed row or actual Clock over-occupancy has not been demonstrated.
- **Counterevidence:** Quotes sign occupancy; single-booking passes normalized occupancy correctly. The retained real QuoteService probe verifies one-adult acceptance versus two-adult mismatch, but its guestCount-eight annotation is not an inserted booking.
- **Recommendation:** Use one normalized occupancy contract in quote, single and group checkout; bind and validate adults/children/capacity for every child. Preserve child ages if the chosen provider pricing contract requires them.
- **Effort:** M
- **Timing:** NOW
- **Dependencies:** Shared checkout validation; occupancy regression tests
- **Status:** Open. **VERIFIED FINDING** for group occupancy contract divergence and the retained validator counterexample, accepted by Astra 2026-09-27 after Sol challenge. **NEEDS VERIFICATION** for full order persistence/provider consequences. No probe was repeated in unit 005.


## MBA-004 — Multi-room checkout omits single-booking safety and recovery behavior

- **Category:** Booking / Integration
- **Severity:** HIGH
- **Affected area:** MultiRoomBookingService
- **Evidence:** apps/api/src/booking/multi-room-booking.service.ts:127,161,189,257,372,427; apps/api/src/booking/local-pms.provider.ts:524,933,1525; apps/api/src/tenancy/tenant-database.service.ts:19; apps/api/src/payments/payment-expiry.service.ts:63. Focused challenge: [MBA-AUDIT-005](investigations/MBA-AUDIT-005.md).
- **Current behavior:** Group checkout omits the single-booking final Clock availability and property-mode/MIXED auto-assignment guards. A zero-total FREE group inserts CONFIRMED children and bypasses Clock attachment. Gateway credential readiness is checked inside the provider after local holds/inserts; an absent provider or returned checkout error Result is saved as FAILED and returned normally from the transaction.
- **Problem:** Group and single-booking invariants diverge. If that failed-Result transaction completes, it commits PAYMENT_PENDING children/holds and a failed idempotency record while the response omits their IDs. Reusing the key returns the same error. Single-booking throws to roll back an equivalent returned checkout error.
- **Impact:** Guard omissions can admit inappropriate stock/mode selections; a FREE Clock group can be locally confirmed without this path creating external reservations. Failed checkout can leave holds needing expiry or staff recovery. Real sold-out payment, inconsistent committed rows and provider outcomes remain unverified.
- **Counterevidence:** Group locks and local reservation failures are atomic; a thrown provider/SQL/timeout error also rolls back. Nonzero pay-at-hotel and paid groups do attach Clock through their respective paths. Staff may reach pending children; the 30-minute expiry path can release pooled or physical holds if it runs successfully. These holds are not categorically inaccessible or permanent.
- **Recommendation:** Define shared validation/fulfillment invariants for every payment method and booking mode; add final provider checks, free fulfillment and explicit rollback/recoverable checkout failure semantics. Limit order size/provider work budget.
- **Effort:** L
- **Timing:** NOW
- **Dependencies:** MBA-003; multi-room lifecycle acceptance tests
- **Status:** Open. **VERIFIED FINDING** for the bounded guard/branch differences and failed-Result transaction semantics, accepted by Astra 2026-09-27 after Sol challenge. **NEEDS VERIFICATION** for database/provider/expiry runtime consequences; relevant existing stubbed integration tests were inspected, not rerun.


## MBA-005 — Cancelling a room-type booking in PMS recovery states leaks reserved inventory

- **Category:** Inventory
- **Severity:** HIGH
- **Affected area:** Single and group cancellation
- **Evidence:** apps/api/src/booking/local-pms.provider.ts:574,1033,1082,1290; apps/api/src/booking/booking-state-machine.ts:30,48; apps/api/src/tenancy/availability.service.ts:543; apps/api/src/booking/multi-room-booking.service.ts:122. Reachability, ownership map and counterevidence: [MBA-AUDIT-006](investigations/MBA-AUDIT-006.md).
- **Current behavior:** A pooled hold can survive a returned Clock attachment failure in a committed pay-at-hotel single/group path, leaving PMS_CREATION_PENDING or PMS_UNKNOWN_RESULT. Single/group cancellation releases counters only for PAYMENT_PENDING, PMS_CONFIRMATION_PENDING or CONFIRMED before writing CANCELLED.
- **Problem:** An otherwise permitted cancellation from either reachable held recovery state skips the decrement. PMS_REJECTED and booking-status MANUAL_REVIEW also lack a release branch, but their hold ownership must be proven separately; their status names alone do not establish this defect.
- **Impact:** If cancellation commits, booked_units continues suppressing sellable pooled stock until separately corrected. Ordinary cancellation replay and payment expiry do not repair an already CANCELLED counter. This source result was not reproduced against PostgreSQL and is not a claim of permanent or deployed stock loss.
- **Counterevidence:** Physical-room stock uses active overlap predicates, so CANCELLED removes occupancy without a counter decrement. A cancellation rejected by identity/version/window/state or Clock guards does not demonstrate this effect; a thrown/aborted transaction does not commit it. Normal PAYMENT_PENDING expiry releases its own holds, while the paid Stripe rollback branch can erase a newly attempted recovery transition instead of committing it.
- **Recommendation:** Represent inventory ownership explicitly or use a complete invariant-driven release transition. Release exactly once for every state that owns a hold and reconcile counters from durable claims.
- **Effort:** M
- **Timing:** NOW
- **Dependencies:** Inventory ownership design; isolated single/group pooled/physical transaction, replay and provider-failure tests.
- **Status:** Open. **VERIFIED FINDING** for owned pooled holds and the cancellation control-flow omission, accepted by Astra 2026-09-27 after Sol challenge. **NEEDS VERIFICATION** for committed database counters and deployed consequences; rejected/manual-review status cases remain conditional on hold ownership.


## MBA-006 — Cancellation terms are captured at cancellation, not when the guest accepts them

- **Category:** Product / Pricing
- **Severity:** HIGH
- **Affected area:** Cancellation and refund policy
- **Evidence:** apps/api/src/booking/local-pms.provider.ts:1047,1099,1604; apps/api/prisma/schema.prisma:555; docs/decisions/ADR-0018-refund-policy-from-cancellation-snapshot.md
- **Current behavior:** cancellationPolicy reads current rate plan, managed cancellation policy and property timezone. Guest self-service also reads the current property window. The three booking cancellation fields are written only when cancellation occurs.
- **Problem:** Editing a policy or timezone after sale changes eligibility for an existing booking. ADR-0018's snapshot is explicitly a cancellation-time result, so this is a product-design gap rather than an incorrectly implemented ADR.
- **Impact:** Guests can receive different refund/cancellation treatment than the terms shown at purchase; support cannot reconstruct the accepted policy from the booking alone.
- **Recommendation:** Version and snapshot accepted rate/cancellation/payment/tax terms at quote/booking; evaluate later commands against that immutable snapshot. Specify how policy changes affect existing reservations and have counsel review the terms.
- **Effort:** M
- **Timing:** BEFORE PILOT
- **Dependencies:** Owner decision on effective dates and historical bookings
- **Status:** Open — VERIFIED design gap; no legal conclusion.


## MBA-007 — Unknown Clock reservation statuses are treated as confirmed

- **Category:** Integration / Domain
- **Severity:** HIGH
- **Affected area:** Clock booking hydration
- **Evidence:** apps/api/src/integrations/clock/clock-booking-hydration.service.ts:60,188; packages/domain-contracts/src/index.ts:159
- **Current behavior:** Hydration maps the cancellation set to CANCELLED and all other status strings to CONFIRMED.
- **Problem:** Unknown/new provider states fail open. Arrival, departure and no-show facts are also not modeled separately from sales confirmation.
- **Impact:** Unsupported or unexpected states can appear as valid confirmed reservations; hotel operations and analytics lose provider lifecycle meaning.
- **Recommendation:** Use an explicit documented mapping, retain the raw provider status and quarantine unknown values. Model operational stay status separately if MUST is intended to support front-desk workflows.
- **Effort:** M
- **Timing:** NOW
- **Dependencies:** Confirmed Clock status contract; state ownership decision
- **Status:** Open — VERIFIED source; specific live unknown values UNVERIFIED.

## MBA-008 — Clock hydration overwrites commercial records without inventory and refund effects

- **Category:** Integration / Data integrity
- **Severity:** HIGH
- **Affected area:** Booking projection versus booking aggregate
- **Evidence:** apps/api/src/integrations/clock/clock-booking-hydration.service.ts:188,207; apps/api/src/booking/local-pms.provider.ts:998
- **Current behavior:** Hydration upserts status, room, dates, total and nightly_rates directly on bookings. It neither adjusts inventory_units nor runs cancellation/refund orchestration; it increments the local version on every update.
- **Problem:** The same row is a mutable PMS projection and MUST's guest contract. A provider cancellation cannot subsequently enter the normal cancellation path because the booking is already CANCELLED; a date/type move leaves old local counters behind.
- **Impact:** Availability, refunds, accepted prices and dashboard history can disagree. Imported external bookings also do not consume room-type counters; physical-room overlap behavior differs.
- **Recommendation:** Separate immutable commercial snapshots from provider projections. Apply explicit source-owned operational changes with inventory deltas and policy-driven review/refund commands; do not automatically refund every imported cancellation.
- **Effort:** L
- **Timing:** NOW
- **Dependencies:** Inventory ownership and PMS authority decisions
- **Status:** Open — VERIFIED direct writes and missing effects; downstream incident RISK.


## MBA-009 — Event ownership fencing does not order different events for the same resource

- **Category:** Integration / Concurrency
- **Severity:** HIGH
- **Affected area:** Clock webhook hydration across API replicas
- **Evidence:** apps/api/src/integrations/clock/clock-booking-hydration.service.ts:125,143,216; apps/api/src/integrations/clock/clock-folio-hydration.service.ts:110,160; apps/api/src/integrations/clock/clock-worker.service.ts:186
- **Current behavior:** Each provider-event row has robust token/generation ownership. A resource fetch occurs before its database transaction; separate event IDs can fetch and later overwrite the same booking/folio without an external version comparison.
- **Problem:** With multiple workers/replicas or an overlapping stalled attempt, an older fetched snapshot from event A can commit after newer event B. Per-event locks do not serialize a shared resource.
- **Impact:** A newer cancellation/date/folio state may regress until another successful refresh. The recent same-event fencing fix is valuable and does not eliminate this separate race.
- **Recommendation:** Use a tenant/connection/resource ordering strategy or validated provider revision compare-and-swap. Test two distinct events with reversed fetch/commit order as well as same-job reassignment.
- **Effort:** M
- **Timing:** BEFORE PRODUCTION
- **Dependencies:** Verified provider revision contract or per-resource serialization design
- **Status:** Open — VERIFIED missing resource ordering; RISK under overlapping execution.


## MBA-010 — Clock financial reconciliation still sends a known-rejected filter and misallocates orders

- **Category:** Payments / Integration
- **Severity:** HIGH
- **Affected area:** ClockPaymentReconciliationService
- **Evidence:** apps/api/src/integrations/clock/clock-payment-reconciliation.service.ts:210,276; apps/api/src/integrations/clock/clock-booking.service.ts:1273; docs/integrations/clock/endpoint-matrix.md
- **Current behavior:** Reconciliation requests credit_items with reference.eq, although the refund code and dated endpoint evidence explicitly reject that filter. It selects recent online-method bookings with their own gross local charge; group charge lives only on the anchor while deposits are split per child.
- **Problem:** The check can fail before comparison. Even with the filter corrected, it compares aggregate anchor money against one child's deposit and omits siblings, refunds, older changed bookings and many manual payments.
- **Impact:** A green or absent reconciliation signal cannot establish financial consistency; genuine missing deposits can be missed and valid group payments flagged.
- **Recommendation:** Use the confirmed unfiltered list with local reference matching, then reconcile explicit payment allocations and net refund states across the full changed-record scope. Keep discrepancies read-only until reviewed.
- **Effort:** L
- **Timing:** NOW
- **Dependencies:** MBA-014 payment allocation; confirmed endpoint fixtures
- **Status:** Open — VERIFIED source plus historical contract evidence; current live endpoint not reprobed.


## MBA-011 — Stripe callbacks lack persisted checkout binding and use one global signing secret

- **Category:** Payments / Security
- **Severity:** HIGH — NOW, before real-money activation; deployed exploitability and monetary loss are unverified.
- **Affected area:** StripePaymentProvider and StripeWebhookService
- **Evidence:** apps/api/src/payments/stripe-payment.provider.ts:38,100,128; apps/api/src/payments/stripe-webhook.controller.ts:36,49; apps/api/src/payments/stripe-webhook.service.ts:58,128; apps/api/src/booking/local-pms.provider.ts:548; apps/api/src/booking/multi-room-booking.service.ts:199; apps/api/prisma/schema.prisma:637. Focused source review, four unit tests and offline signed-payload probe: [MBA-AUDIT-004](investigations/MBA-AUDIT-004.md).
- **Current behavior:** Checkout resolves the property's tenant connection. Callback verification ignores that context and uses the one configured server webhook secret. Normalization keeps metadata IDs, session ID and paid state, dropping amount/currency/account/environment and other session fields. Stripe callers do not persist issued checkout sessions in the shared table used by PokPay. The handler records the current local booking/order total and rate-plan currency without an expected-session or booking-payment-method check.
- **Problem:** Signature verification authenticates a delivery against the configured secret; it does not establish that the issued checkout for this booking paid the expected amount in the expected account/environment. The code has no connection-specific signing-secret selection. Compatibility with separate tenant accounts depends on the actual endpoint topology, which is unverified.
- **Impact:** A validly signed paid event with metadata matching an eligible local booking can pass without these payment bindings. Underpayment, wrong-account attribution, cross-tenant misuse and legitimate delivery failures are conditional risks, not demonstrated incidents. A local synthetic signed-event probe establishes missing controller checks, not Stripe issuance, a database charge or public exploitability.
- **Counterevidence:** Invalid signatures fail; raw-body verification and a paid-state gate exist. The booking lookup is tenant/property scoped and locked; status and per-tenant session-ID deduplication checks apply. Checkout/refund require test-mode tenant keys, while webhook verification does not reject live-mode payloads. Actual deployment routing and exposure remain unknown.
- **Recommendation:** Decide the approved Stripe account/webhook topology; choose the signing secret from a trustworthy connection identity and persist issued checkout/session, connection/account, booking, expected amount/currency and environment. Validate signed callbacks against that immutable record and booking method, with defined replay, asynchronous and callback-before-commit recovery.
- **Effort:** L
- **Timing:** NOW
- **Dependencies:** Owner-approved Stripe account/webhook model; isolated persistence tests; separately approved sandbox acceptance.
- **Status:** Open. **VERIFIED FINDING** for missing source/controller acceptance bindings, accepted by Astra 2026-09-27. **LIKELY FINDING** for delivery incompatibility conditional on independent endpoint secrets; **NEEDS VERIFICATION** for real miscredit/exploitation/loss. Severity narrowed from CRITICAL to HIGH because the stronger exposure claim is not demonstrated.


## MBA-012 — Refund requests are recorded as completed even when the provider reports pending

- **Category:** Payments / Accounting
- **Severity:** HIGH
- **Affected area:** Gateway refunds and ledger
- **Evidence:** apps/api/src/payments/pokpay-payment.provider.ts:104; apps/api/src/payments/stripe-payment.provider.ts:180; apps/api/src/payments/payment-refund.service.ts:175,193,250; apps/api/src/mail/booking-cancellation-notification.service.ts:70. Source challenge and offline real-service probe: [MBA-AUDIT-007](investigations/MBA-AUDIT-007.md).
- **Current behavior:** A successful provider Result is inserted as REFUNDED without checking its status; PokPay can return REFUND_PENDING and Stripe passes its status through. New rows produce refunded audit/in-app events. The API still returns the provider's status. Manual refunds can mirror to Clock inside the transaction; automatic cancellation and late-expiry paths do not use that mirror candidate. Guest refund email is conditional on confirmation data and sent after commit.
- **Problem:** Accepted submission, pending settlement and completed refund are conflated in the ledger and completion effects. The inspected Stripe/PokPay callback, pending-charge polling and expiry paths do not apply later refund settlement/failure transitions.
- **Impact:** Local history, reports, completion notifications and conditional guest/Clock effects can assert completion before it is established. Actual delayed or failed settlement, sent mail and posted Clock credits were not exercised by the probe.
- **Counterevidence:** An explicit provider Result.ok=false writes no refund/completion effects in refundCharge; transport failure is an unknown remote outcome rather than proof of refusal. The probe's fake guest query produced no email confirmation and its fake transaction did not commit SQL. The returned API status was REFUND_PENDING while the method attempted the payment insert; source fixes that insert's status to REFUNDED, while the probe labels the attempted write rather than executing or parsing its SQL.
- **Recommendation:** Persist submitted/pending/succeeded/failed/unknown states and provider identity, reconcile authoritative outcomes, and gate completion semantics, notifications and Clock effects on the appropriate confirmed state. Preserve automatic refund intent without describing submission as settled money movement.
- **Effort:** L
- **Timing:** NOW
- **Dependencies:** Verified provider refund contracts and owner-approved completion semantics; durable financial event processing.
- **Status:** Open. **VERIFIED FINDING** for local state/effect handling, accepted by Astra 2026-09-27 after source challenge and offline real-service probe. **NEEDS VERIFICATION** for provider settlement, committed SQL and actual downstream delivery outcomes.


## MBA-013 — Payments and bookings do not retain the original provider connection identity

- **Category:** Payments / Integration identity
- **Severity:** HIGH
- **Affected area:** Connection replacement, refunds and delayed events
- **Evidence:** apps/api/prisma/schema.prisma:528,615,637; apps/api/src/payments/stripe-payment.provider.ts:225; apps/api/src/payments/pokpay-payment.provider.ts:164; apps/api/src/integrations/clock/clock-booking-hydration.service.ts:119
- **Current behavior:** Financial records store a provider string/external ID, not the creating connection/account/environment. Refund/reread resolves the property's currently active credentials. Clock hydration accepts a connectionId but fetches using the currently active property connection without equality check.
- **Problem:** Changing credentials/assignment can redirect old financial operations or queued external resource IDs into a different account. Provider-event ownership is not provider-account identity.
- **Impact:** Refunds can become impossible, old events can hydrate the wrong same-number resource, and incident reconstruction loses account provenance.
- **Recommendation:** Persist immutable connection/account/environment identity on operations, sessions, payments and mappings; drain/quarantine old events on switch and retain controlled access to historical credentials for permitted recovery.
- **Effort:** L
- **Timing:** BEFORE PILOT
- **Dependencies:** Connection lifecycle design; security agent's destructive-delete finding
- **Status:** Open — VERIFIED schema and lookup behavior; cross-account incident RISK.


## MBA-014 — Refunds and manual group payments lack charge-level and order-level allocation

- **Category:** Accounting / Payments
- **Severity:** HIGH
- **Affected area:** Partial payments, group settlement and refunds
- **Evidence:** apps/api/src/payments/payment-refund.service.ts:126,270,453,470; apps/api/src/payments/manual-payment.service.ts:45,136,162; apps/api/src/booking/local-pms.provider.ts:1025,1253; apps/api/src/booking/multi-room-booking.service.ts:199; apps/api/prisma/schema.prisma:615. Reachable examples and offline real-service probes: [MBA-AUDIT-008](investigations/MBA-AUDIT-008.md).
- **Current behavior:** Refund selection uses the latest charge minus every refund on that booking. Manual group settlement reads the full order total but locks and aggregates payments only on the selected child. Group cancellation accepts any child as its refund anchor, although online checkout puts the aggregate charge on the first child.
- **Problem:** On a confirmed pay-at-hotel booking, ordinary staff calls can record 40 + 60; the refund path can reverse the latest 60 then reject another refund while the older 40 remains unhandled. Two confirmed 50-room siblings can each accept a separate 100 whole-order manual record. Cancelling a paid, free-cancellable order through a non-first child can find no charge and return a null refund success without a failure review, subject to its cancellation/transaction gates.
- **Impact:** Incomplete manual ledger reversals, overstated recorded order receipts, inconsistent balances and an omitted automatic order-refund attempt. A manual payment record is a staff assertion, not an external card charge; duplicate actual collection and committed financial effects were not demonstrated.
- **Counterevidence:** Same-child locks, same-key idempotency, positive NUMERIC constraints, tenant/property FKs and per-tenant external-ID uniqueness exist. PAYMENT_PENDING requires full settlement, so the installment example uses an already confirmed pay-at-hotel booking. The offline probe supplies query results and does not test SQL locks, constraints, API authorization, commit or provider behavior; sibling-initiated cancellation is source-traced only.
- **Recommendation:** Link refunds to original charges and payments to child/order balances; resolve the actual charge-owning anchor and enforce an order-wide settlement guard/lock. Track settled refunds separately from pending/unknown reservations. Keep unresolved refund amounts reserved to prevent duplicate attempts, releasing capacity only after authoritative failure/cancellation or another approved resolution. A full general ledger is not required to repair these allocation paths.
- **Effort:** L
- **Timing:** NOW
- **Dependencies:** Owner-approved order/partial-payment/reversal rules; migration/backfill plan; isolated transaction tests for installments, sibling settlement and cancellation through child two.
- **Status:** Open. **VERIFIED FINDING** for the three bounded source/control-flow cases and offline arithmetic/recording behavior, accepted by Astra 2026-09-27. **NEEDS VERIFICATION** for PostgreSQL concurrency/commit and actual provider or money outcomes. Pending-capacity reservation alone is not a defect.


## MBA-015 — Commercial currency and selected provider offer are not immutable booking facts

- **Category:** Pricing / Data model
- **Severity:** HIGH
- **Affected area:** Booking price snapshot
- **Evidence:** apps/api/prisma/schema.prisma:549; apps/api/src/tenancy/rate-plans.service.ts:116; apps/api/src/booking/quote.service.ts:26; apps/api/src/integrations/clock/clock-booking.service.ts:538,1659; apps/api/src/booking/booking-projection.service.ts:99
- **Current behavior:** Booking stores an amount but derives currency from a mutable rate plan. RatePlan.update permits currency changes. Clock signed quotes do not persist selected external rate/offer identity; attachment selects a current rate again and posts booking data without reconciling the paid quote total.
- **Problem:** Historical bookings can be relabeled with a new currency; provider rate changes between quote/payment/fulfillment can create a reservation under different commercial terms.
- **Impact:** Payment validation, refund calculations and reporting can disagree with the guest's accepted charge and the PMS amount.
- **Recommendation:** Snapshot currency, selected rate/offer, nightly/tax components, occupancy and policy version at sale. Define price-change handling before charging and controlled remediation after payment; keep provider projection separate.
- **Effort:** L
- **Timing:** BEFORE PILOT
- **Dependencies:** MBA-006, MBA-008; provider price-lock contract
- **Status:** Open — VERIFIED missing snapshots; actual changed-price scenario RISK.


## MBA-016 — Payment HTTP ambiguity and timeouts lack a durable recovery boundary

- **Category:** Payments / Reliability
- **Severity:** HIGH
- **Affected area:** Refund transaction boundaries and PokPay transport
- **Evidence:** apps/api/src/payments/pokpay-payment.provider.ts:104,205,244; apps/api/src/payments/stripe-payment.provider.ts:180; apps/api/src/payments/payment-refund.service.ts:257,313,497; apps/api/src/tenancy/tenant-database.service.ts:27; apps/api/src/booking/local-pms.provider.ts:998,1069,1247; apps/api/src/payments/stripe-webhook.service.ts:95. Focused review: [MBA-AUDIT-007](investigations/MBA-AUDIT-007.md).
- **Current behavior:** Manual refund intent, gateway call, result/ledger and Clock mirror share one SQL transaction and booking lock; no intent commits before the outbound call. Automatic single/group cancellation and late-expiry refunds also invoke the gateway inside their transactions. PokPay refund transport omits command.idempotencyKey and an explicit abort deadline. The manual caller uses the client transaction budget without an override; its live effective timeout was not measured.
- **Problem:** SQL abort can erase intent/recovery evidence after an external refund has acted or become ambiguous. A caught Clock error cannot make recovery writes durable through an already aborted transaction. After rollback a retry can resubmit, while the prior provider outcome is unresolved.
- **Impact:** Missing local refund evidence, repeated outbound attempts and locks held during slow external work are supported risks. Duplicate money movement depends on remote behavior and is not demonstrated; the inspected code does not establish PokPay's remote deduplication or lookup guarantees.
- **Counterevidence:** Stripe sends the supplied idempotency key. A committed local operation can answer a replay even if the original commit response was lost; tenant/external-ID uniqueness protects identical local payment IDs. These safeguards do not prove the outcome of an aborted transaction or a provider response lost before local persistence.
- **Recommendation:** Commit scoped refund intent/request identity before bounded outbound work, persist unknown outcomes and reconcile before replay. Preserve Stripe's key and verify PokPay's contract before designing retries. Move Clock mirroring to durable work after the refund transaction commits.
- **Effort:** L
- **Timing:** NOW
- **Dependencies:** Verified provider request/reconciliation contracts; MBA-012; isolated transaction/timeout/replay tests with fake outbound providers.
- **Status:** Open. **VERIFIED FINDING** for source transaction/transport boundaries, accepted by Astra 2026-09-27. **NEEDS VERIFICATION** for committed failure scenarios, actual timeout budgets, remote idempotency guarantees and duplicate financial effects.


## MBA-017 — Email delivery and group confirmation are not durably recoverable

- **Category:** Notifications / UX
- **Severity:** HIGH
- **Affected area:** Booking, payment and cancellation email
- **Evidence:** apps/api/src/mail/payment-notification.service.ts:14-18, :61-65; apps/api/src/mail/booking-confirmation-notification.service.ts:49; apps/api/src/booking/multi-room-booking.service.ts:161; apps/api/src/payments/stripe-webhook.service.ts:155
- **Current behavior:** Emails are sent after transactions and failures are logged then swallowed; no durable delivery record/retry queue is present. Group gateway confirmation calls the mail service only for the anchor and that service selects one room/total without checking CONFIRMED. Group pay-at-hotel creation has no confirmation call.
- **Problem:** Process interruption/provider failure can lose critical messages, and partial group fulfillment can produce an anchor-only or misleading confirmation.
- **Impact:** Guests and staff may not know which rooms are actually booked/paid; support cannot inspect/retry delivery reliably.
- **Recommendation:** Use a transactional notification outbox with event identity, per-recipient delivery state, retries and operator resend. Build an order-level message that distinguishes confirmed rooms, pending/attention rooms and aggregate payment.
- **Effort:** M
- **Timing:** BEFORE PILOT
- **Dependencies:** Order state and financial event definitions
- **Status:** Open — VERIFIED source; mail-provider delivery not probed.


## MBA-018 — Operational metrics mix incompatible stock, lifecycle and timezone definitions

- **Category:** Reporting / Hotel operations
- **Severity:** MEDIUM
- **Affected area:** Overview and reports
- **Evidence:** apps/api/src/tenancy/reports.service.ts:39,71,85; apps/api/src/tenancy/overview.service.ts:74; apps/api/src/booking/quote.service.ts:485
- **Current behavior:** Occupancy denominator always uses inventory_units even for individual-room modes; numerator counts CONFIRMED bookings. 'In house' means dates overlap today, without check-in state. Reports group timestamptz by database date while overview uses property timezone; advance-booking rules use UTC today.
- **Problem:** Metrics can be null/wrong for physical-room properties and day totals differ at hotel midnight. Cash receipts labeled revenue are not earned room revenue or ADR/RevPAR.
- **Impact:** Managers can make decisions from misleading occupancy/day/revenue values. No need to invent full accounting or PMS modules to correct labels and definitions.
- **Recommendation:** Publish metric definitions and use mode-aware sellable room-nights, property-local business dates, explicit expected versus actual stay status, and separate booking value/cash/net refunds/earned revenue.
- **Effort:** M
- **Timing:** BEFORE PILOT
- **Dependencies:** Operational lifecycle and reporting contract
- **Status:** Open — VERIFIED calculations; business acceptance required.


## MBA-019 — Reservations API returns the entire property's history and PII

- **Category:** API / Performance / Privacy
- **Severity:** MEDIUM
- **Affected area:** Reservation list and downstream client filtering
- **Evidence:** apps/api/src/booking/booking-projection.service.ts:65,90,133; apps/api/src/booking/booking.controller.ts:63
- **Current behavior:** list has no page/date/search/filter arguments or LIMIT; it joins all payments/folios per booking and returns guest contact/address data for all property reservations.
- **Problem:** Client filtering does not bound database work or network payload and exposes more guest details than a list generally needs.
- **Impact:** Large hotels/history will hit slow lists, heavy browser memory use and broader PII exposure; indexes alone do not remove unbounded work.
- **Recommendation:** Add scoped cursor pagination, indexed server filters and compact list projections; fetch sensitive detail on authorized demand. Load-test realistic property histories and list queries.
- **Effort:** M
- **Timing:** BEFORE PRODUCTION
- **Dependencies:** API compatibility for web/plugin; query plans
- **Status:** Open — VERIFIED unbounded query; latency thresholds UNVERIFIED.
