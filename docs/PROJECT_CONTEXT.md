# Project Context

## Evidence baseline

- This document was established 2026-07-27, at project inception, before any application code existed.
- Predecessor system: [MUST-DEV-TEAM/must-hotel-booking](https://github.com/MUST-DEV-TEAM/must-hotel-booking), a single-tenant WordPress plugin. Its `docs/PROJECT_CONTEXT.md` (evidence date 2026-07-15) recorded: implemented but "code-hardened, not production-certified" Clock-backed booking, no automatic recovery for Clock fulfillment stuck in manual review, WP-Cron as the only sync mechanism, and no tenancy or platform billing concept.

## Product purpose

MUST Booking Platform is a multi-tenant SaaS product for hotel sales and operations. Hotel businesses (tenants) sign up, connect one or more properties, sell rooms online, optionally synchronize with Clock PMS+ (and later other PMS providers), and are billed by MUST on a subscription basis for using the platform.

## Why this is a new project, not an extension of the plugin

The WordPress plugin entangled booking domain logic, payment integrity, and PMS synchronization inside the WordPress runtime for one hotel per install. That produced concurrency workarounds built after the fact rather than a state machine and queue designed up front, and it has no path to multi-tenancy or platform billing without a rewrite of its core. Full historical detail lives in the predecessor repository; it is not duplicated here.

The predecessor's `AGENTS.md` collaboration discipline (scoped tasks, canonical docs, mandatory ADRs for durable decisions, explicit verification before reporting done) worked well and is carried forward into this project's `AGENTS.md`/`CLAUDE.md`.

## Two distinct billing domains — do not conflate

1. **Platform billing** (this project's new scope): MUST charges tenants (hotels) a subscription to use the platform — plans, usage limits, trials, invoicing, dunning. See `BILLING.md`.
2. **Guest payment domain**: hotel guests pay for rooms via Stripe, PokPay, or pay-at-hotel; reconciled against Clock folios where applicable. This is carried over from the architecture in `docs/source/clock-pms-integration.pdf` (Clock PMS+ integration brief), unchanged in principle.

These use separate ledgers, separate domain models, and must never share a table, an entity, or a code path. A tenant's subscription invoice is not a booking payment, and a guest's room payment is not platform revenue recognition.

## Relationship to the WordPress plugin

The plugin is not discarded. It is repositioned as a thin, embeddable booking-widget frontend that talks only to this platform's public API — it must not hold PMS/payment provider credentials and must not contain booking domain logic. See `ARCHITECTURE.md` and `ROADMAP.md` phase covering the WordPress shell migration.

## Current status

Pre-implementation. No application code exists yet. Current work is establishing tenancy model, billing model, and foundational ADRs before the first line of backend code is written.

## Current priorities

1. Decide and record the tenant isolation strategy (ADR) — see `TENANCY.md`.
2. Decide and record the platform billing provider/model (ADR) — see `BILLING.md`.
3. Stand up the monorepo skeleton (backend, frontend, shared packages, CI) as the first implementation task.
4. Carry the Clock PMS+ integration architecture from `docs/source/clock-pms-integration.pdf` into the domain layer, adapted for multi-tenancy (`hotel_id`/`tenant_id` on every provider mapping, credential, and queue message).
