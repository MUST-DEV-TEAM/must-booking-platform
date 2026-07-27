# Architecture Decision Records

Index of durable, cross-cutting, or hard-to-reverse decisions. Routine implementation detail does not need an ADR.

| ID | Title | Status |
| --- | --- | --- |
| [ADR-0001](ADR-0001-monorepo-and-stack.md) | Monorepo with NestJS backend + Next.js frontend | Accepted |
| [ADR-0002](ADR-0002-tenant-isolation-strategy.md) | Tenant isolation strategy | **Open — needs decision** |
| [ADR-0003](ADR-0003-platform-billing-provider.md) | Platform billing provider | **Open — needs decision** |

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
