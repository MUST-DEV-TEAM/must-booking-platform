# Milestone 2: Self-Serve Signup & Free Plan Onboarding

Status: Not started
Depends on: Milestone 1; ADR-0007 (illustrative plan shape, PMS connections capped not unlimited), ADR-0008 (self-serve, permanent Free plan — separate from any paid-plan trial)

## Goal

A new hotel can sign up self-serve, without a payment card, and land directly on the **permanent** Free plan (illustrative limits from `docs/BILLING.md` — real numbers confirmed at Milestone 8). Free has no expiry clock — signup does not start a trial. Done means: a stranger can complete signup end-to-end and reach an empty tenant dashboard on Free. The separate, optional paid-plan-trial start/expiry mechanism (ADR-0008) is built in Milestone 8 alongside the upgrade flow, not here.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. Signup flow API: create organization + first property + first admin user in one transaction, per Milestone 1's schema.
2. Signup UI (Next.js): organization name, first property basics, admin account creation.
3. Assign new tenants the Free plan (permanent, no `trial_ends_at` set at signup — ADR-0008).
4. Email verification requirement before full activation (using Milestone 1's primitive).
5. Welcome email (transactional email provider chosen and wired here).
6. Signup-abuse guardrails: rate limiting per email/IP, basic bot protection.
7. Free-plan limits enforced from day one (max 1 property / 3 staff, illustrative) using the plan/limit fields from task 9 — no trial-expiry job in this milestone.
8. "Upgrade to unlock more" prompts in the dashboard shell where a Free limit is hit (no trial countdown — Free doesn't expire).
9. Plan/limit fields (`max_properties`, `max_staff_seats`, `pms_enabled`) added to the organization record, sourced from the plan table.
10. E2E test: full signup → email verify → login → land on empty Free-plan dashboard.

## Explicitly not included

- Upgrade/payment flow (Milestone 8).
- Any property/room/rate management beyond the property created at signup (Milestone 3).

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
