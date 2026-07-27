# ADR-0004: Data residency / hosting region

Status: Accepted
Date: 2026-07-27

## Context

Guest and tenant data includes GDPR-relevant personal data (see `docs/source/clock-pms-integration.pdf` section 24 on guests/GDPR). Hosting region affects compliance posture and infrastructure choice.

## Decision

Host in the EU for now. The owner confirmed EU-only hosting as the immediate target, explicitly wanting the option to expand to additional regions later without a re-architecture.

## Consequences

- Infrastructure (managed Postgres, Redis, object storage) is provisioned in an EU region initially.
- Region must be a configuration parameter, not a hardcoded assumption, in infra-as-code, connection strings, and any provider (Stripe/PokPay/Clock) region selection — so a future region/tenant-shard expansion doesn't require rewriting core plumbing.
- Whichever tenant isolation strategy is chosen in ADR-0002, it should not assume all tenants forever live in one physical database/region; keep tenant-to-region assignment at least conceptually possible even if not built now.
- Does not by itself resolve GDPR data-processing-agreement or sub-processor questions with Stripe/PokPay/Clock — track separately when contracts are reviewed.

## Alternatives considered

- Multi-region from day one: rejected as premature infrastructure complexity before there are tenants requiring it.
- No preference / decide later: rejected — the owner gave a concrete answer (EU now) rather than deferring.
