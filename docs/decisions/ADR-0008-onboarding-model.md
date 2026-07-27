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

Self-serve signup, no payment card required upfront. A new tenant signs up and lands directly on the **Free** plan (ADR-0007's illustrative shape: 1 property, 3 staff seats, no PMS connection — exact numbers finalized at Milestone 8). The Free plan is **time-boxed to 30 days**, confirmed by the owner on 2026-07-27 — it is a trial, not a permanent evergreen tier.

Accepted by the owner on 2026-07-27.

## Consequences

- Signup flow: organization + first property + first admin user, activated immediately on the Free plan — no Stripe/billing step required to start using the product.
- A 30-day trial clock starts at signup. The tenant record needs a `trial_ends_at` timestamp and a scheduled job (BullMQ) to act on expiry.
- Upgrading to Basic (or a future paid tier) is a self-serve in-app action that does invoke Stripe Billing (ADR-0003) — this is the first point a payment method is collected, not signup itself.
- Because self-serve is confirmed, ADR-0003 (billing provider) and ADR-0007 (pricing model) needed to be resolved before Phase 0 closes — both are now accepted, so this no longer sequences ahead of them.
- **Not yet specified, to confirm at Milestone 8 kickoff**: exact post-expiry behavior when a tenant's 30-day trial ends without upgrading — e.g. hard-lock the account (read-only or fully inaccessible) vs. auto-downgrade to a more restricted permanent free tier if one exists. This is a real product decision still needed, just not blocking earlier milestones.
- Trial-abuse guardrails (e.g. rate-limiting signups per email/IP, verifying email before activation) are an implementation detail to include given no card gates signup.
