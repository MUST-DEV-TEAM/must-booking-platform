# Architecture Decision Records

Index of durable, cross-cutting, or hard-to-reverse decisions. Routine implementation detail does not need an ADR.

| ID | Title | Status |
| --- | --- | --- |
| [ADR-0001](ADR-0001-monorepo-and-stack.md) | Monorepo with NestJS backend + Next.js frontend | Accepted |
| [ADR-0002](ADR-0002-tenant-isolation-strategy.md) | Tenant isolation strategy | **Open — explicitly left open by owner 2026-07-27** |
| [ADR-0003](ADR-0003-platform-billing-provider.md) | Platform billing provider | **Open — explicitly left open by owner 2026-07-27** |
| [ADR-0004](ADR-0004-data-residency.md) | Data residency / hosting region | Accepted — EU now, room to expand later |
| [ADR-0005](ADR-0005-plan-limit-enforcement.md) | Plan limit enforcement style | Accepted — hybrid hard/soft |
| [ADR-0006](ADR-0006-multi-property-v1.md) | Multi-property tenants from v1 | Accepted |
| [ADR-0007](ADR-0007-pricing-model.md) | Pricing model shape | **Open — explicitly left open by owner 2026-07-27** |
| [ADR-0008](ADR-0008-onboarding-model.md) | Tenant onboarding model | **Open — explicitly left open by owner 2026-07-27** |
| [ADR-0009](ADR-0009-data-retention-churn.md) | Tenant data retention after cancellation | **Open — explicitly left open by owner 2026-07-27** |

Open ADRs are not blockers for Phase 0 monorepo/tenancy-skeleton work in general, but each names the specific phase it must be resolved before (see each ADR's Decision section and `docs/ROADMAP.md`). Do not implement against an open ADR's assumption — re-raise it with the owner instead.

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
