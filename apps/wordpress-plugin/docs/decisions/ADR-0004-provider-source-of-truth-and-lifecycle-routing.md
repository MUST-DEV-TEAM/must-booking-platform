# ADR-0004: Provider source of truth and lifecycle routing

- Status: Accepted
- Date: 2026-07-07
- Scope: Local/Clock provider ownership, reservation synchronization, presentation data, and payment state
- Supersedes: Direct provider-mirror status writes and ambiguous single-schedule ownership
- Superseded by: —
- Evidence confidence: Verified

## Context

The plugin can operate with local inventory or Clock PMS. In Clock mode, one record can contain local presentation data, provider-owned availability/reservation state, and gateway/local-ledger money state. Treating one store as authoritative for every field causes stale availability, skipped lifecycle hooks, or incorrect payment conclusions.

Clock work also has different operational cadences: catalog, availability/rates, inbound reservation events, fallback reservation polling, and queued accounting/reconciliation.

## Decision

- Clock owns its external IDs, live availability/restrictions, final provider price, room assignment, and provider reservation status in Clock mode.
- The WordPress plugin owns website presentation/content, managed pages, local correlations, workflow metadata, and the local mirror.
- Stripe/PokPay plus the local payment/refund ledger own payment and refund state; Clock folio accounting is a separate synchronized representation.
- Provider-originated reservation transitions must pass through the booking lifecycle service so hooks, emails, inventory effects, and review states are applied consistently.
- Catalog, availability/rate, reservation fallback, inbound webhook, and queued synchronization work retain separate schedules/diagnostics.
- Webhooks are preferred for reservation freshness; bounded polling is a recovery path.

## Alternatives considered

- Make the local database authoritative for all fields in Clock mode. Rejected because it cannot prove current provider inventory or status.
- Treat Clock folio balance as payment-provider truth. Rejected because it is a downstream accounting representation.
- Write mirror statuses directly through repositories. Rejected because it bypasses lifecycle side effects.
- Use one undifferentiated cron schedule. Rejected because failures and freshness requirements cannot be diagnosed independently.

## Consequences

### Positive

- Ownership is explicit at conflict boundaries.
- Provider-originated cancellations can trigger the same lifecycle hooks as local actions.
- Operators can diagnose catalog, live availability, reservation, and queue health separately.

### Negative

- Cross-system state is eventually consistent and needs reconciliation.
- `fallback_to_local_when_clock_unavailable` can create a split-brain risk if operators expect Clock to remain authoritative.
- Scheduler and provider service overlap remains a maintenance concern.

## Implementation constraints

- Never infer paid/refunded state solely from Clock reservation status or booking balance.
- Final Clock availability and price require live revalidation as defined in ADR-0002.
- Inbound events are acknowledged only after durable handling; failures remain retryable.
- Preserve local presentation fields during catalog/provider refresh.
- Do not remove legacy hooks, option names, provider identifiers, or schedule names without an upgrade and compatibility plan.

## Verification

- Provider/local conflict tests for each owned field.
- Lifecycle-hook and email behavior for inbound cancellation/status changes.
- Webhook duplicate/failure/retry tests and fallback polling convergence.
- Cron schedule repair, lock, overdue, and queue-exhaustion diagnostics.
- Confirm payment/refund truth cannot be changed by provider mirror data alone.

## Evidence

- `src/Provider/ProviderManager.php` and provider registries/adapters.
- `src/Provider/Clock/ClockInboundSyncService.php` and `ClockReservationSyncService.php`.
- `src/Engine/BookingLifecycleSyncService.php` and `BookingStatusEngine.php`.
- `src/Provider/Clock/ClockSyncScheduler.php`.
- Commits `607a19e`, `21fe26d`, and `be9442a` (`v0.4.88`).
