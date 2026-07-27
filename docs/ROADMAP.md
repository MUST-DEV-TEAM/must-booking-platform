# Roadmap

Phased delivery order. Each phase should close with its own ADRs (where applicable) accepted and its own tests green before the next phase's feature work starts — do not parallelize phases 0-2.

## Phase 0 — Foundations (current)

- All Phase 0-relevant ADRs are **accepted**: ADR-0002 (tenant isolation: shared schema + RLS), ADR-0004 (EU data residency), ADR-0005 (hybrid hard/soft limit enforcement), ADR-0006 (multi-property from v1). Nothing blocks starting.
- Monorepo skeleton: `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared-types`, `packages/domain-contracts`, lint/test tooling, CI (build + lint + test on PR).
- Tenant + auth skeleton: Organization/Property/User models with `tenant_id`/`property_id` + RLS policies per ADR-0002, RBAC per `TENANCY.md`, login, tenant-scoped request context (must establish the per-request tenant-context mechanism RLS policies rely on).
- Signup skeleton: self-serve organization signup landing on the Free plan per ADR-0008 (full billing/upgrade flow is Phase 3; Phase 0 only needs the tenant to exist and be tagged `plan: free`).

## Phase 1 — Booking domain (provider-agnostic)

- Booking domain, state machine, and `LocalPmsProvider` only (no external PMS yet) — proves the domain model and idempotency design in isolation, per `ARCHITECTURE.md`.
- Guest payment domain skeleton: Stripe Checkout integration, payment ledger, refunds — kept structurally separate from platform billing (Phase 3).

## Phase 2 — Clock PMS+ adapter

- Materialize the deliverables listed in `docs/source/clock-pms-integration.pdf` section 37: `CLOCK_ARCHITECTURE.md`, `CLOCK_ENDPOINT_MATRIX.md`, `CLOCK_DATA_MAPPING.md`, `CLOCK_BOOKING_STATE_MACHINE.md`, `CLOCK_WEBHOOK_FLOW.md`, `CLOCK_RECONCILIATION.md`, `CLOCK_ERROR_CATALOGUE.md`, `CLOCK_SECURITY_REVIEW.md`, `CLOCK_RUNBOOK.md`.
- `ClockPmsProvider` implementing the `PmsProvider` interface, sandbox-validated per the brief's Definition of Done (section 36) before any production activation.
- Resolve each ADR listed in the brief's section 38 before the corresponding capability ships.

## Phase 3 — Platform billing

- All Phase 3 ADRs are **accepted**: ADR-0003 (Stripe Billing behind a `BillingProvider` interface), ADR-0007 (flat tiered plans — Free/Basic confirmed, more tiers to be specified), ADR-0008 (self-serve onto Free, upgrade invokes Stripe), ADR-0009 (30-day grace then hard delete on cancellation).
- Implement `StripeBillingProvider`, plan/subscription schema per ADR-0007's table, upgrade/downgrade flow, dunning, cancellation + the 30-day deletion job from ADR-0009.
- Plan-limit enforcement in the API layer per the hybrid model in ADR-0005 (hard-block properties/staff/PMS-gate).
- Remaining implementation-level details to confirm with the owner during this phase (not new ADRs — see the "Consequences" section of the relevant ADR): exact Free-plan trial semantics (ADR-0008), any further plan tiers beyond Free/Basic (ADR-0007), precise "hard delete" scope (ADR-0009).

## Phase 4 — WordPress shell migration

- Rebuild the predecessor plugin's public booking surface as a thin embeddable widget calling the MUST Public API only — no provider credentials, no domain logic in WordPress.
- Decommission the domain/payment/PMS code paths in the legacy plugin once the widget is validated in a non-production environment.

## Phase 5 — Production hardening

- Observability, alerting, rate limiting, WAF handling, reconciliation jobs, security review, E2E suite — per the brief's sections 27-31 and its Definition of Done (section 36), extended to cover tenancy and billing failure modes.

## Out of scope until explicitly requested

- Additional PMS vendors beyond Clock (Mews/Cloudbeds/Opera) — the `PmsProvider` interface keeps this open, but no vendor work starts without an explicit go-ahead.
- Marketplace/reseller billing, multi-currency platform billing.
