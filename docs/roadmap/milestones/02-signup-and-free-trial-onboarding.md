# Milestone 2: Self-Serve Signup & Free Trial Onboarding

Status: Not started
Depends on: Milestone 1; ADR-0007 (illustrative plan shape), ADR-0008 (self-serve, 30-day Free trial)

## Goal

A new hotel can sign up self-serve, without a payment card, and land on the Free plan (illustrative limits from `docs/BILLING.md` — real numbers confirmed at Milestone 8) with a running 30-day trial clock. Done means: a stranger can complete signup end-to-end and reach an empty tenant dashboard, and the trial-expiry job exists (even if its exact post-expiry behavior is finalized at Milestone 8).

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. Signup flow API: create organization + first property + first admin user in one transaction, per Milestone 1's schema.
2. Signup UI (Next.js): organization name, first property basics, admin account creation.
3. Assign new tenants the Free plan and set `trial_ends_at` = signup time + 30 days (ADR-0008).
4. Email verification requirement before full activation (using Milestone 1's primitive).
5. Welcome email (transactional email provider chosen and wired here).
6. Signup-abuse guardrails: rate limiting per email/IP, basic bot protection.
7. Trial-expiry scheduled job (BullMQ): fires at `trial_ends_at`; exact action (lock vs. downgrade) stubbed/logged for now, finalized at Milestone 8 — this task builds the mechanism, not the final business behavior.
8. Trial countdown surfaced in the tenant dashboard shell (basic "N days left on your trial" banner).
9. Plan/limit fields (`max_properties`, `max_staff_seats`, `pms_enabled`) added to the organization record, sourced from the plan table.
10. E2E test: full signup → email verify → login → land on empty dashboard.

## Explicitly not included

- Upgrade/payment flow (Milestone 8).
- Any property/room/rate management beyond the property created at signup (Milestone 3).

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
