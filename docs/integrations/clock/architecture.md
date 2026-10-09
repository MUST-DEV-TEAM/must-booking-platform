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
