# Architecture Decision Records

Index of durable, cross-cutting, or hard-to-reverse decisions. Routine implementation detail does not need an ADR.

| ID | Title | Status |
| --- | --- | --- |
| [ADR-0001](ADR-0001-monorepo-and-stack.md) | Monorepo with NestJS backend + Next.js frontend | Accepted |
| [ADR-0002](ADR-0002-tenant-isolation-strategy.md) | Tenant isolation strategy | Accepted — shared schema + RLS, hybrid escape hatch |
| [ADR-0003](ADR-0003-platform-billing-provider.md) | Platform billing provider | Accepted — Stripe Billing now, `BillingProvider` interface for PokPay later |
| [ADR-0004](ADR-0004-data-residency.md) | Data residency / hosting region | Accepted — EU now, room to expand later |
| [ADR-0005](ADR-0005-plan-limit-enforcement.md) | Plan limit enforcement style | Accepted — hybrid hard/soft |
| [ADR-0006](ADR-0006-multi-property-v1.md) | Multi-property tenants from v1 | Accepted |
| [ADR-0007](ADR-0007-pricing-model.md) | Pricing model shape | Accepted — flat tiered plans (Free/Basic + more later) |
| [ADR-0008](ADR-0008-onboarding-model.md) | Tenant onboarding model | Accepted — self-serve onto Free plan, no card upfront |
| [ADR-0009](ADR-0009-data-retention-churn.md) | Tenant data retention after cancellation | Accepted — 30-day grace then hard delete |
| [ADR-0010](ADR-0010-dashboard-tenant-routing.md) | Dashboard tenant routing | Accepted — tenant ID in the URL, no server-side selected-tenant state |
| [ADR-0011](ADR-0011-object-storage-provider.md) | Object storage provider and access model | Accepted — Cloudflare R2, public-read bucket, presigned upload only |
| [ADR-0012](ADR-0012-rate-plan-base-rate-model.md) | Base rate vs. date-bounded override in rate rules | Accepted — nullable-date rule is the base rate, dated rules are overrides |
| [ADR-0013](ADR-0013-local-inventory-consumption-model.md) | Local inventory consumption model for bookings | Accepted — separate `booked_units` counter, availability derived at read time |
| [ADR-0014](ADR-0014-booking-state-machine.md) | Booking state machine is the full production state list from Milestone 4 | Accepted — full state list from day one, `LocalPmsProvider` resolves PMS states synchronously |
| [ADR-0015](ADR-0015-guest-matching-rule.md) | Guest matching rule for Milestone 4 | Accepted — exact email match only, phone stored but never used to auto-merge |
| [ADR-0016](ADR-0016-guest-frontend-is-retrofitted-legacy-plugin.md) | Guest-facing frontend is the retrofitted legacy WordPress plugin, not a new widget | Accepted — import the legacy plugin as `apps/wordpress-plugin`, strip its domain/payment/PMS code, keep its UI |
| [ADR-0017](ADR-0017-anonymous-guest-session.md) | Anonymous guest session for quotes and booking creation | Accepted — new `must_guest_session` cookie + `@PublicTenantScoped` guard, distinct from staff `must_session` |
| [ADR-0018](ADR-0018-refund-policy-from-cancellation-snapshot.md) | Refund amount is driven automatically by the cancellation-policy snapshot | Accepted — `cancellation_is_free: true` triggers an automatic full refund; staff can still override manually |
| [ADR-0019](ADR-0019-reserve-then-expire-payment-pending.md) | Reserve inventory immediately, expire on payment timeout | Accepted — reserve at `PAYMENT_PENDING`, sweep abandoned checkouts to `EXPIRED` |

All nine foundational ADRs are accepted as of 2026-07-27; ADR-0010, ADR-0011, and ADR-0012 followed on 2026-07-28 once Milestone 3 surfaced the need for dashboard tenant-routing, object-storage, and rate-plan-modeling decisions. ADR-0013 through ADR-0015 followed on 2026-07-30 at Milestone 4 kickoff, resolving the inventory-consumption, state-machine-scope, and guest-matching questions the source brief left open for the local-only path. ADR-0016 followed the same day, revising the guest-frontend plan from a green-field widget to a retrofit of the legacy plugin, ahead of Milestone 6. ADR-0017 followed immediately after, once Task 5's review surfaced that no anonymous-guest access path existed yet for the quote/booking-creation flow Milestone 4 (and eventually Milestone 6) actually needs. ADR-0018 and ADR-0019 followed at Milestone 5 kickoff, connecting Milestone 4's cancellation-policy snapshot to real refund behavior and settling when inventory is actually reserved relative to Stripe payment. Nothing currently blocks the active milestone on an unresolved foundational decision — see `docs/roadmap/README.md` for what's next. Remaining open questions are implementation-level details noted inline in specific ADRs (e.g. exact Free-plan trial semantics in ADR-0008, further plan tiers in ADR-0007) — not new ADRs, just details to confirm during the phase that implements them.

Additional ADRs will be required for the remaining decisions listed in `docs/source/clock-pms-integration.pdf` section 38 (availability endpoint, booking create payload, PUSH vs SQS, cache/retry/conflict policy, etc.) once Clock adapter work starts in Milestone 9 — guest matching's local-only precedence is now settled by ADR-0015, though Clock's external-ID signal will extend it.

## Template

```
# ADR-XXXX: <title>

Status: Proposed | Accepted | Superseded by ADR-YYYY
Date: YYYY-MM-DD

## Context
## Decision
## Consequences
## Alternatives considered
```
