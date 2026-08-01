# Documentation Index

This file routes humans and agents to the minimum context required for a task.

**Do not load all documentation for every task.**

## All tasks

Read:

- `../AGENTS.md`
- `PROJECT_CONTEXT.md`

Then follow one route below and verify current behavior in the relevant source before editing it.

## Architecture or database tasks

Also read:

- `ARCHITECTURE.md`
- Relevant ADRs in `decisions/`
- `OPERATIONS.md` for installation or migration work

## Booking, availability, pricing, payment, cancellation, or refund tasks

Also read:

- `DOMAIN_LIFECYCLES.md`
- `ARCHITECTURE.md`
- Relevant ADRs

## PokPay, Clock PMS, Stripe, webhook, email, updater, or provider tasks

Also read:

- `INTEGRATIONS.md`
- `DOMAIN_LIFECYCLES.md`
- `OPERATIONS.md`

## Admin, staff portal, frontend, booking-calendar, Elementor, or interface tasks

Also read:

- `UI_UX.md`
- Relevant sections of `DOMAIN_LIFECYCLES.md`
- `ARCHITECTURE.md` when routes, capabilities, hooks, or data access change

## Deployment, diagnostics, production investigation, or recovery

Also read:

- `OPERATIONS.md`
- `INTEGRATIONS.md`
- Relevant lifecycle and ADR sections

## Historical reasoning

Read:

- `DECISIONS.md`
- The relevant ADR
- `PROJECT_TIMELINE.md`
- `../CHANGELOG.md`
- Git history when exact implementation detail is needed

## Temporary repository cleanup

Only when executing an approved cleanup phase, read:

- `REPOSITORY_CONSOLIDATION_PLAN.md`
- Only the requested phase and its explicitly required canonical documents

The consolidation plan records suspected defects and future work; it is not authoritative current-behavior documentation.

## Canonical ownership

| Document | Owns |
| --- | --- |
| `PROJECT_CONTEXT.md` | Product scope, status, terminology, capabilities, limitations, priorities |
| `ARCHITECTURE.md` | Bootstrap, modules, persistence, routes, hooks, configuration, jobs, entry points |
| `DOMAIN_LIFECYCLES.md` | Booking, payment, cancellation, refund, amendment, sync, accounting state transitions |
| `INTEGRATIONS.md` | External systems, auth models, callbacks, identifiers, retry, idempotency, testing boundaries |
| `OPERATIONS.md` | Setup, deployment, diagnostics, tests, incidents, rollback, cron, secret handling |
| `UI_UX.md` | Public/admin/staff interface and interaction contracts |
| `PROJECT_TIMELINE.md` | Major evidence-backed milestones and incidents |
| `DECISIONS.md` | Searchable decision register and ADR links |
