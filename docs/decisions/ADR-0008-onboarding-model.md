# ADR-0008: Tenant onboarding model

Status: Accepted
Date: 2026-07-27

## Context

Options presented were: self-serve signup with card required upfront, self-serve signup with a free trial and no card upfront, or sales-assisted/manual onboarding by MUST staff for v1. This affects the signup flow, trial handling, and how early ADR-0003/ADR-0007 need to be resolved (self-serve requires a working billing integration on day one; sales-assisted does not).

## Options

1. **Self-serve, card required upfront** — filters serious leads, standard SaaS pattern, but a slower path to first signup.
2. **Self-serve, free trial without card** — higher top-of-funnel conversion, defers payment friction, more exposure to trial abuse without additional guardrails.
3. **Sales-assisted / manual (MUST staff onboards each tenant) for v1** — highest control over onboarding quality, but does not scale and delays needing self-serve billing until later.

## Decision

Self-serve signup, no payment card required upfront. A new tenant signs up and lands directly on the **Free** plan (ADR-0007: 1 property, 3 staff seats, no PMS connection) — the Free plan itself is the trial/entry point, rather than a separate time-boxed "trial of everything" tier.

Accepted by the owner on 2026-07-27.

## Consequences

- Signup flow: organization + first property + first admin user, activated immediately on the Free plan — no Stripe/billing step required to start using the product.
- Upgrading to Basic (or a future paid tier) is a self-serve in-app action that does invoke Stripe Billing (ADR-0003) — this is the first point a payment method is collected, not signup itself.
- Because self-serve is confirmed, ADR-0003 (billing provider) and ADR-0007 (pricing model) needed to be resolved before Phase 0 closes — both are now accepted, so this no longer sequences ahead of them.
- **One detail intentionally left unspecified, not blocking**: whether the Free plan is a permanent evergreen free tier (tenant can stay on it indefinitely) or additionally time-boxed (e.g. must upgrade or lose access after N days). Confirm this with the owner during Phase 3 implementation of the Free plan's exact behavior — it does not change the onboarding flow shape decided here either way.
- Trial-abuse guardrails (e.g. rate-limiting signups per email/IP, verifying email before activation) are a Phase 0/3 implementation detail to include given no card gates signup.
