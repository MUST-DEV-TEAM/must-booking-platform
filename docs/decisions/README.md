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

All nine foundational ADRs are accepted as of 2026-07-27. Nothing currently blocks Phase 0 or Phase 3 on an unresolved foundational decision — see `docs/ROADMAP.md` for what's next. Remaining open questions are implementation-level details noted inline in specific ADRs (e.g. exact Free-plan trial semantics in ADR-0008, further plan tiers in ADR-0007) — not new ADRs, just details to confirm during the phase that implements them.

Additional ADRs will be required for the decisions listed in `docs/source/clock-pms-integration.pdf` section 38 (availability endpoint, booking create payload, guest matching, PUSH vs SQS, cache/retry/conflict policy, etc.) once Clock adapter work starts.

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
