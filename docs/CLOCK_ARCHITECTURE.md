# Clock PMS+ Architecture

Milestone 11 deliverable (source brief section 37/Appendix B). Describes what Tasks 1-13 actually built, not the source brief's full production-grade vision — see `docs/roadmap/milestones/11-clock-pms-adapter-basic.md` for what's explicitly deferred to later milestones.

## Module layout

```
apps/api/src/integrations/
├── credential-cipher.ts              AES-256-GCM encrypt/decrypt (Task 1)
├── connection-tester.ts              ConnectionTestRegistry — per-provider testers self-register (Task 2)
├── integration-connections.service.ts / .controller.ts   Tenant CRUD + property assignment (Tasks 1-2)
├── manual-review.service.ts          Generic (not Clock-specific) — provider_events'-style naming (Task 12)
└── clock/
    ├── clock-http-client.ts          Sole module allowed to call Clock directly (Task 4)
    ├── clock-digest-auth.ts          RFC 7616 Digest Authentication (Task 4)
    ├── clock-rate-limiter.ts         Redis Lua INCR+EXPIRE, 4 req/s/API-user (Task 5)
    ├── clock-circuit-breaker.ts      Per-API-user CLOSED/OPEN/HALF_OPEN (Task 5)
    ├── clock-retry-policy.ts         isRetryEligible/nextRetryDelayMs — see "Retry: policy vs. execution" below (Task 5)
    ├── clock-error-classification.ts 14-category classifier (Task 5)
    ├── clock-credentials.ts          Shared raw-record → ClockConnectionCredentials parser
    ├── clock-connection-ping.ts      Shared real "ping Clock" used by test-connection UI + PmsProvider (Task 6)
    ├── clock-connection-tester.ts    Registers into ConnectionTestRegistry (Task 6)
    ├── clock-catalog-sync.service.ts / .controller.ts   Room type/room sync, PROPOSED→CONFIRMED (Task 7)
    ├── clock-availability.service.ts Real /rates_availability calls + 60s cache (Task 8)
    ├── clock-queue-names.ts / clock-queue.service.ts / clock-worker.service.ts   BullMQ (Task 9)
    ├── clock-booking.service.ts      create/update/cancel + idempotency + state machine (Task 10)
    ├── clock-webhook-signature.ts    Pure AWS SNS signature verification (Task 11)
    ├── clock-webhook-verification.service.ts   Cert fetch + cache wrapping the pure module (Task 11)
    ├── clock-webhook.service.ts / .controller.ts   Public webhook gateway (Task 11)
    └── clock-pms.provider.ts         Implements the domain PmsProvider interface, composes the above
```

This matches the source brief's proposed `ClockIntegrationModule` (domain/application/infrastructure/contracts) in spirit — `clock-pms.provider.ts` is the "application" seam implementing the domain's `PmsProvider` port, everything else under `clock/` is "infrastructure." A literal `contracts/clock-api.models`/`clock-normalizers` split wasn't introduced as separate files; DTO shapes live as inline TypeScript interfaces next to the code that uses them (e.g. `ClockBookingResource` in `clock-booking.service.ts`) since this milestone's scope didn't need a shared normalizer layer yet.

## Provider interface conformance

`ClockPmsProvider implements PmsProvider` (`packages/domain-contracts/src/index.ts`) — the exact 8-method interface the source brief specifies (section 7). All 8 methods are implemented:

| Method | Status |
| --- | --- |
| `testConnection` | Real (Task 6) |
| `syncCatalog` | Real (Task 7) |
| `getAvailability` | Real (Task 8) |
| `getBooking` | Real — local-row lookup by `externalBookingId` (Task 10) |
| `findBookingByExternalReference` | Real — local-row lookup by `externalReference` (Task 10) |
| `createBooking` | Real (Task 10) |
| `updateBooking` | Real, dates-only (Task 10) |
| `cancelBooking` | Real (Task 10) |

**`ClockPmsProvider` is not the DI-bound `PMS_PROVIDER` yet** — `LocalPmsProvider` still is (see `apps/api/src/booking/local-pms.provider.ts`, `PMS_PROVIDER` token in `app.module.ts`). Swapping which provider a given property actually uses is explicitly out of this milestone's scope (would require a per-property provider-selection mechanism that doesn't exist yet). Every Clock code path in this milestone is exercised directly (unit tests, or real sandbox e2e tests instantiating the service out of the app's DI container), not through a live guest-facing booking flow.

## Scope boundary: PMS-interface-only booking CRUD

`ClockBookingService.createBooking`/`updateBooking`/`cancelBooking` implement exactly the plain `PmsProvider` interface — insert/update a `bookings` row, call Clock, drive `BookingStateMachine`, record `integration_operations` idempotency. They deliberately do **not** replicate `LocalPmsProvider`'s guest-checkout orchestration (quote validation, Stripe/PokPay checkout-session creation, guest-session return URLs) — those aren't part of the `CreateBookingCommand`/`PmsProvider` contract at all (`LocalCreateBookingCommand`'s extra fields — `quoteToken`, `staffActorId`, `returnUrl` — are Local-only extensions), and since `ClockPmsProvider` isn't the live provider, there's no real caller that would supply them yet. This was an explicit scope decision made with the project owner at Task 10's kickoff, not an oversight.

## HTTP call stack

Every outbound Clock call goes through the same layered stack, built bottom-up across Tasks 4-5:

```
ClockAvailabilityService / ClockBookingService / ClockCatalogSyncService
  │  (each has its own small `fetch<T>` wrapper — no shared base class;
  │   see "Known duplication" below)
  ▼
1. ClockCircuitBreakerService.assertClosed(apiUser)   — throws CircuitOpenError if OPEN
2. ClockRateLimiterService.consume(apiUser)           — 4 req/s, Redis-backed, real distributed limit
3. ClockHttpClient.request(...)                        — Digest auth, undici Agent (pooling/TLS), timeout
4. classifyClockHttpResponse / classifyClockClientFailure  — maps status/error → one of 14 categories
5. circuitBreaker.recordSuccess/recordFailure(apiUser)
```

Controllers and use-cases never call Clock directly (source brief section 9) — `ClockHttpClient` is the only module that does.

### Circuit breaker

Per-API-user (not global), in-memory (not distributed — a second API instance has its own breaker state). `CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5` consecutive failures opens it; `CIRCUIT_BREAKER_COOLDOWN_MS = 30_000` before a single HALF_OPEN trial call is allowed through. Thresholds are documented `ASSUMPTION`s (the brief requires a circuit breaker but doesn't specify numbers) — see `clock-circuit-breaker.ts`.

### Retry: policy vs. execution

`clock-retry-policy.ts` implements the brief's exact rule (section 11) — retry only for `rate_limited`, `provider_unavailable`, `network`, and `timeout`-on-GET; never blind-retry an unconfirmed mutation — and is unit-tested. **It is not currently wired into any calling code.** Every real Clock call in this milestone (`ClockAvailabilityService`, `ClockBookingService`, `ClockCatalogSyncService`) makes exactly one attempt and returns a classified `Result` (with `retryable: true/false`) to its caller; none of them loop and retry automatically using `isRetryEligible`/`nextRetryDelayMs`. `retryable` is informational today, not self-healing. Wiring an actual retry loop through this policy is real remaining work, not done in this milestone.

### Known duplication

`ClockAvailabilityService`, `ClockBookingService`, and `ClockCatalogSyncService` each have their own private `fetch<T>` method with near-identical circuit-breaker/rate-limiter/classification wiring, rather than a shared base class or composed helper. This was a deliberate choice under this milestone's time constraints (each service landed as its own task, and extracting a shared abstraction risked destabilizing already-verified code for tasks done later) — a legitimate refactor target, not an oversight.

## Queue infrastructure

`ClockQueueService` owns 6 named BullMQ queues (`clock.critical.commands`, `clock.webhooks`, `clock.booking.sync`, `clock.catalog.sync`, `clock.financial.sync`, `clock.reconciliation`) plus `clock.dead-letter`, backed by a shared `ioredis` connection. `ClockWorkerService` starts one real `Worker` per named queue; a job that exhausts its configured `attempts` is copied onto the dead-letter queue by the worker's `failed` handler.

Two consumers have real business logic: `clock.webhooks` hydrates supported booking events (see `CLOCK_WEBHOOK_FLOW.md`), and `clock.reconciliation` runs daily at 03:00 UTC. On application startup, the worker idempotently upserts BullMQ's `daily-clock-booking-reconciliation` Job Scheduler. Each run discovers enabled Clock PMS properties through tenant-scoped reads and enqueues two idempotent jobs per property: `reconcile-property`, which checks the preceding 31-day rolling window of booking status/existence drift with `ClockBookingConsistencyService`, and `reconcile-payments`, which checks every MUST-paid, Clock-attached booking created in that same window against its real deposit-folio `credit_item`s with `ClockPaymentReconciliationService` (financial-flow Task C, `docs/CLOCK_FINANCIAL_RECONCILIATION_PLAN.md`). Both services own their own reconciliation audit records and `PAYMENT_BOOKING_MISMATCH`/consistency mismatch alerting independently. The remaining queue processors log receipt only.

## Security posture actually built

- Credentials: AES-256-GCM at rest (`CredentialCipherService`), never logged, decrypted only transiently inside a request (`IntegrationConnectionsService.activePmsConnectionCredentials`).
- Tenant isolation: every Clock table (`clock_catalog_mappings`, `provider_events`, `manual_review_items`) has Postgres RLS enabled+forced, scoped by `app.tenant_id`/`app.property_id`. The webhook gateway's pre-tenant-context lookup uses a dedicated read-only RLS carve-out (`app.role = 'webhook_gateway'`), not a bypass-RLS connection.
- Webhook signature verification: real AWS SNS RSA-SHA1/SHA256 verification (see `CLOCK_WEBHOOK_FLOW.md`), SSRF-protected cert/subscribe-URL host checks, replay protection (5-minute window).
- WAF/403-suspicion circuit breaker (source brief section 12): **not built**. The generic circuit breaker (above) trips on any repeated failure including 403s, but there's no dedicated "suspicious behavior" detector or alert — explicitly deferred (see the milestone's "Explicitly not included" section).

## Diagram: request flow (booking creation)

```
ClockPmsProvider.createBooking(context, command)
  │
  ▼
ClockBookingService.createBooking
  │  1. validate stay/amount
  │  2. fetch + decrypt tenant's Clock credentials (outside any DB transaction —
  │     IntegrationConnectionsService opens its own; nesting isn't supported)
  │  3. BEGIN transaction (30-45s timeout override — see "Why the custom
  │     transaction timeout" below)
  │     a. resolve room_type/room external ids via clock_catalog_mappings
  │     b. resolve the property's single Clock rate plan (basic-milestone
  │        simplification — see CLOCK_DATA_MAPPING.md)
  │     c. resolve/create the guest by email
  │     d. INSERT bookings row (status DRAFT)
  │     e. drive BookingStateMachine: DRAFT → QUOTED → INVENTORY_REVALIDATING
  │        → PAYMENT_NOT_REQUIRED → PMS_CREATION_PENDING
  │     f. POST to Clock /bookings/  (circuit breaker → rate limiter → HTTP client)
  │     g. on success: validate response shape (schema_mismatch guard) → CONFIRMED
  │        on clean rejection: → PMS_REJECTED
  │        on timeout/network failure: search Clock by reference_number first
  │          (section 18) → CONFIRMED if found, else → PMS_UNKNOWN_RESULT +
  │          manual_review_items row
  │  4. COMMIT (idempotency result stored in integration_operations)
```

### Why the custom transaction timeout

`TenantDatabaseService.withTenantTransaction` defaults to Prisma's 5000ms interactive-transaction timeout. `ClockBookingService` makes a real outbound HTTP call to Clock *inside* that transaction (steps 3f-g above) — under real network latency this can exceed 5s, which would abort an otherwise-successful local write. An optional `timeoutMs` override was added (Task 10, caught by the real sandbox e2e test failing under real latency) — 45s for create (up to 3 sequential Clock calls: rate plans, booking create, reconciliation lookup), 30s for update/cancel (GET current state + PUT).
