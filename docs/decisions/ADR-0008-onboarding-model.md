# ADR-0008: Tenant onboarding model

Status: Proposed — **explicitly left open by the owner on 2026-07-27**
Date: 2026-07-27

## Context

Options presented were: self-serve signup with card required upfront, self-serve signup with a free trial and no card upfront, or sales-assisted/manual onboarding by MUST staff for v1. This affects the signup flow, trial handling, and how early ADR-0003/ADR-0007 need to be resolved (self-serve requires a working billing integration on day one; sales-assisted does not).

## Options

1. **Self-serve, card required upfront** — filters serious leads, standard SaaS pattern, but a slower path to first signup.
2. **Self-serve, free trial without card** — higher top-of-funnel conversion, defers payment friction, more exposure to trial abuse without additional guardrails.
3. **Sales-assisted / manual (MUST staff onboards each tenant) for v1** — highest control over onboarding quality, but does not scale and delays needing self-serve billing until later.

## Decision

_Left open — the owner was asked directly and chose not to decide yet. This has a sequencing consequence: if manual onboarding is chosen, ADR-0003/ADR-0007 (billing provider/pricing) can be deferred further without blocking early tenant onboarding; if self-serve is chosen, those need to be resolved before Phase 0 closes. Re-raise this ADR before committing to a Phase 0 delivery order for onboarding._

## Consequences

_To be filled in once decided._
