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

Self-serve signup, no payment card required upfront. A new tenant signs up and lands directly on the **Free** plan (ADR-0007's illustrative shape: 1 property, 3 staff seats, no PMS connection — exact numbers finalized at Milestone 8).

**Corrected 2026-07-27 (owner review round two):** Free plan and free trial are two separate concepts, not one. The original version of this ADR conflated them by making the Free plan itself expire after 30 days — that is wrong and is superseded by this text:

- **Free plan**: permanent, no expiry. A tenant can stay on Free indefinitely at its (low, illustrative) limits.
- **Paid-plan trial**: a separate, optional, time-boxed trial (illustrative: 14 days) that grants a paid tier's features (e.g. "Professional trial") without requiring payment upfront. A tenant may start this from the dashboard at any time, not only at signup. If the trial is not converted to a paid subscription before it ends, the tenant **reverts to the Free plan** — not locked, not deleted.

Accepted by the owner on 2026-07-27; refined by the owner on 2026-07-27 (second review pass) to split Free-plan-permanent from paid-plan-trial.

## Consequences

- Signup flow: organization + first property + first admin user, activated immediately on the **Free** plan — no Stripe/billing step required to start using the product, and no expiry clock starts at signup.
- `trial_ends_at` is **not** set on every tenant at signup. It is only set on a tenant record when that tenant explicitly starts a paid-plan trial. A tenant that never starts a trial simply stays on Free with no trial clock at all.
- A scheduled job (BullMQ) acts on `trial_ends_at` only for tenants who started a paid-plan trial: on expiry without conversion, downgrade to Free plan limits/features (not a lock, not a deletion — Free is a normal, supported permanent state).
- Upgrading to Basic (or a future paid tier), or starting a paid-plan trial, is a self-serve in-app action that does invoke Stripe Billing (ADR-0003) — this is the first point a payment method may be collected (trials still do not require a card upfront), not signup itself.
- Because self-serve is confirmed, ADR-0003 (billing provider) and ADR-0007 (pricing model) needed to be resolved before Phase 0 closes — both are now accepted, so this no longer sequences ahead of them.
- **To confirm at Milestone 8 kickoff**: which paid tier(s) offer a trial, the trial length (illustrative: 14 days), and whether a tenant can retrigger a trial more than once (abuse guardrail). Free-plan permanence itself is settled by this ADR and is not open at Milestone 8.
- Trial-abuse guardrails (e.g. rate-limiting signups per email/IP, verifying email before activation, limiting one paid-plan trial per tenant) are an implementation detail to include given no card gates signup or trial start.
