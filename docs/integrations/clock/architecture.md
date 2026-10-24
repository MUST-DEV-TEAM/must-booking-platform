# Clock PMS+ integration

Status: **PARTIALLY IMPLEMENTED against the original production brief**. Code inspected 2026-09-19; no provider calls made for this audit.

## Read by concern

| Concern | Document |
| --- | --- |
| Endpoint contracts and dated vendor evidence | [Endpoint matrix](endpoint-matrix.md) |
| Catalog, rate, guest, booking and folio fields | [Data mapping](data-mapping.md) |
| Creation, payment, updates, cancellation and financial posting | [Booking lifecycle](booking-lifecycle.md) |
| SNS ingestion, hydration, schedules and drift checks | [Webhooks and reconciliation](webhooks-and-reconciliation.md) |
| Errors, limits and actual retry behavior | [Errors and retries](errors-and-retries.md) |
| Setup and diagnosis | [Runbook](runbook.md) |
| Prior live/sandbox observations | [Archived evidence](../../archive/README.md) |

## Module and connection model

What Clock told us in writing is kept in the [correspondence log](correspondence.md).

Implementation lives in [apps/api/src/integrations/clock](../../../apps/api/src/integrations/clock). AppModule registers the services directly; there is no standalone `ClockIntegrationModule` or separate worker deployable.

`IntegrationConnectionsService` owns tenant-scoped encrypted named connections and property assignments. `CredentialCipherService` uses AES-256-GCM. A property may use one enabled PMS connection; webhook resolution currently additionally requires the connection to map to exactly one enabled property. Clock credentials include the host, two path IDs, API user/key and pinned SNS topic ARN.

The HTTP stack is `ClockHttpClient` (Digest, undici transport, TLS/timeouts), `ClockRateLimiterService` (Redis), `ClockCircuitBreakerService` (process-local) and error classification. Service-specific wrappers duplicate this orchestration. Inspect `clock-http-client.ts` when handling IDs: legacy credential names `accountId`/`subscriptionId` concatenate in that order, while recorded Clock docs use subscription/account terminology. Do not swap stored values as a cosmetic correction.

`ClockPmsProvider` implements the eight-method PMS port. Registry selection exists, but public checkout/cancellation remain in LocalPmsProvider and directly invoke Clock services. Quotes, multi-room orchestration and refunds also have Clock dependencies; see [platform architecture](../../architecture/overview.md#provider-seams-and-current-coupling).

## Availability and rate selection

Catalog confirmation maps room types and physical rooms. Rates are read from `/rates/`, filtered to the room type and `wbe: true`; a parent rate-plan ID is not a bookable rate ID. `selectRateForStay` queries `/products` using stay dates and normalized adults/children. A configured per-type ranking chooses the first valid ranked rate; otherwise a deterministic cheapest valid offer wins. This selector is shared by quotes and both booking-create paths.

A room-type availability query uses `/rates_availability`. The recorded 2026-09-15 evidence says its `rooms` parameter did not provide physical-room isolation. `isAvailableForBooking` therefore checks specific rooms via overlap booking IDs and detail reads using `ClockBookingConsistencyService.hasActiveRoomConflict`. Search can cache that answer; the single-booking pre-payment guard does not.

| In-process cache in ClockAvailabilityService | TTL | Key / limit |
| --- | --- | --- |
| General availability | 20 minutes | Connection ID, external room type, dates |
| Room-type rates | 20 minutes | API user and external room type; lacks explicit tenant/property/connection identity |
| Display prices | 5 minutes | Scoped selection/stay/occupancy key |
| Search booking availability | 45 seconds | Tenant, property, connection, selection, dates, occupancy |
| SNS certificate cache (verification service) | 1 hour | Certificate URL; public certificate data |

These are memory Maps, not shared Redis caches. Their capacity/invalidation and credential-identity assumptions need review before scale-out; an older 60-second availability claim was obsolete. The distributed rate limiter is a different Redis concern.

## Implemented synchronization and operations

Bookings attach after verified online payment, or immediately for explicit no-online-payment flows. Deposit posting and manual refund mirroring exist; deposit folios stay **open** after the 2026-09-18 correction. Real SNS booking and folio handlers maintain local projections. Daily booking/payment checks and periodic webhook/backlog/stuck-booking checks are implemented. Sentry reporting depends on deployment configuration.

Six Clock business queues plus dead-letter exist. Only `clock.webhooks` and `clock.reconciliation` currently dispatch business processors; critical commands, booking sync, financial sync and catalog sync otherwise log receipt. Do not infer asynchronous creation from a queue name.

## Known gaps and deviations

These are findings for planning/review, not new authorized implementation tasks.

| Finding | Evidence and implication |
| --- | --- |
| Provider-port isolation incomplete | LocalPmsProvider, QuoteService, MultiRoomBookingService and PaymentRefundService inject Clock services directly. A new PMS may require orchestration changes. |
| Hydration bypasses domain effects | `clock-booking-hydration.service.ts` directly upserts status, totals, dates/rooms and version; no local inventory/refund transition pipeline runs. Replayed hydration is identity-idempotent, not a no-op on version. |
| Pre-payment guard coverage differs | Single booking has the uncached guard; MultiRoomBookingService does not call it. Local atomic reservations do not reserve inventory at Clock while a guest pays. |
| Payment reconciliation is narrow | It selects online-method bookings with local charges and compares gross charge-reference credit items; not net refunds, all manual payments, all order children or general folio settlement. |
| Ingest defenses have limits | The custom text/plain parser buffers before the Content-Length check; no streaming byte cap is evident. Certificate/SubscribeURL checks validate the starting host while fetch follows redirects. Confirmation's boolean result is not used to change the acknowledgment. |
| Connection cardinality | Notifications for zero/multiple enabled properties are acknowledged and dropped. Configuration allows assignment mechanics broader than this webhook assumption. |
| Contract verification incomplete | Reference lookup and vendor assumptions have historical evidence gaps; inspect the matrix. Code use is not verification. |
| Hardening incomplete | No dedicated WAF detector or full metrics system; retry policy helpers are not uniformly wired; some network calls remain inside transactions. |

Historical comments that say "skeleton only," "single rate," or "postDeposit closes the folio" are stale where executable branches now disagree. Current docs follow the branches and preserve earlier claims only in dated history.

## Staff read projections and imports (2026-10-21)

Owner-authorized Demo Beach improvements add resumable read-only imports. `ClockImportService` reads stays overlapping bounded date windows and uses the existing hydrator with notifications disabled; repeat batches update existing external booking identities and do not recreate payments. Bulk import preserves supplied provider creation/update timestamps so old records do not manufacture current booking/cancellation events. `ClockGuestImportService` imports the documented `/guests` numeric index and `/guests/{id}` contacts into a separate tenant/property/connection-scoped projection. Missing email is retained, never fabricated; selecting a profile for a new reservation still requires the booking's contact validation. No automatic local identity merge is added.

Guest endpoints and `family_id` are CONFIRMED_BY_DOCS in the [official Clock Postman workspace](https://www.postman.com/clockintegrations/clock-pms-integrations-s-public-workspace/documentation/pperm12/clock-pms-api-docs?entity=request-8389346-1fe52a79-026d-445a-beea-e7c7602c782e); the numeric index, details and bounded import are CONFIRMED_IN_SANDBOX on Demo Beach. Import pauses on unknown booking statuses or missing mappings rather than dropping records. Owner/admin controls require existing settings management permission; guest reads require guest viewing permission.

The shared booking consistency and hydration GET readers retry actual HTTP 429 responses at most three times with 0.5/1/2-second backoff, reacquiring the local limiter. Exhaustion remains an error, never an empty result. This adds no retry to provider writes.

Room-count tiles read actual configured `/rooms`, not hotel occupancy. Read-only day snapshots expose supported Clock free-room counts and restrictions, with Closed distinct from Sold out. Complete block history and occupancy remain managed in Clock. These snapshots and configured counts are cached for at most 20 minutes and are not final booking authorization. Actual-stay quotes and existing final booking checks remain authoritative. Published booking-engine rates are listed per room type with guest limits and existing preferred ordering; this is not a complete tax, fee or restriction catalogue.


### Stored booking finances (2026-10-22 corrective pass)

`ClockFinancialService` reads a linked booking, its folio IDs, each non-voided booking-owned folio, and active credit items. Tenant/property/connection-scoped snapshots live in the existing `clock_sync_jobs` rows (`financial:<booking-id>`). Recent and upcoming confirmed bookings are scheduled automatically; opening an older linked booking queues its financial read. Completed snapshots refresh every five minutes. Screens read stored data and retain the last successful snapshot during failures; historical reads create neither MUST ledger entries nor guest emails.

Booking balance, folio balances, active credit items, currencies and identities must reconcile before collection. Transfers remain visible but are excluded from guest payment totals. Clock and MUST payment totals are separate views of potentially overlapping payments and must never be added together. A negative Clock balance is guest credit. Collection refreshes the provider position and rechecks the booking version, local charges/refunds and active connection under the booking transaction; uncertain late captures are recorded and flagged for review. Standalone hotels keep the local ledger path.

Inconsistent provider currencies block collection and retry automatically with a specific explanation. Sandbox evidence includes a deposit folio labelled ALL while its active payment is EUR; no exchange rate or correction is inferred. The read model is deliberately incomplete for those records. Clock policy IDs alone do not supply executable cancellation terms: the official collection inspected in this pass did not document a policy-detail read sufficient to calculate a penalty. Explicit staff refund decisions remain necessary there; local policy calculation is retained.


### Interactive request capacity (2026-10-23)

The shared Redis allowance remains four requests/second per Clock API user. Scheduled read synchronization uses an asynchronous background context capped at two of those slots, leaving capacity for foreground booking actions. Rejected attempts do not consume slots. Availability/catalogue GET readers wait through a bounded local allowance delay; availability retries actual provider HTTP429 twice, reacquiring allowance, without treating throttling as a circuit-breaker outage. No write is replayed. Identical concurrent room-type display searches share one in-flight result within their tenant/property and exact stay/occupancy query; existing final booking checks remain fresh.

A booking notification wakes booking/guest and bounded availability projections, plus the matching saved financial projection. A known folio event wakes its mapped booking finances. Notifications no longer bring room/rate/catalogue jobs forward indiscriminately; periodic reconciliation remains the fallback. This is narrower scheduling, not proof of a complete provider event feed or a complete locally reproducible Clock pricing engine.


### MUST policy boundary and financial freshness (2026-10-23)

Provider policy-detail reading remains unverified. Under [ADR-0035](../../decisions/ADR-0035-booking-policy-snapshots-and-guest-requests.md), new MUST bookings use the hotel's saved agreed terms; imported and older unconfirmed Clock terms remain staff-reviewed. This does not infer a Clock penalty from its policy ID. Financial projection reads bring a healthy stale job forward for background refresh; they do not silently revive FAILED jobs. Guest automatic cancellation requires current verified finances and a matching saved policy, with checks repeated at confirmation. Historical currency/credit conflicts remain blocked and are not repaired by this policy change.

Catalogue GET failures now preserve the shared error classification: throttling, temporary upstream unavailability, circuit recovery and network/timeouts stay eligible for scheduled retry; authentication and permission errors stay parked for review. HTTP429 does not count as a circuit failure. This prevents temporary catalogue failures being mislabeled as permanent configuration failures; it does not automatically revive an already parked historical job.

### Requested financial refresh priority (2026-10-23)

Opening a stale financial snapshot marks that scoped job requested. The existing worker claims requested work ahead of overdue periodic jobs, consuming the request marker at claim; a request arriving during active work can still schedule another run. This changes ordering, not provider concurrency or rate allowance. Repeated reads do not call Clock synchronously and do not requeue an active lease. A PostgreSQL regression verifies selected-booking priority, consumed markers and continued periodic work.
