# Roadmap

Phased delivery order. Each phase should close with its own ADRs (where applicable) accepted and its own tests green before the next phase's feature work starts — do not parallelize phases 0-2.

## Phase 0 — Foundations (current)

- Accept ADR-0002 (tenant isolation) and ADR-0003 (billing provider) with the user.
- Monorepo skeleton: `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared-types`, `packages/domain-contracts`, lint/test tooling, CI (build + lint + test on PR).
- Tenant + auth skeleton: Organization/Property/User models, RBAC per `TENANCY.md`, login, tenant-scoped request context.

## Phase 1 — Booking domain (provider-agnostic)

- Booking domain, state machine, and `LocalPmsProvider` only (no external PMS yet) — proves the domain model and idempotency design in isolation, per `ARCHITECTURE.md`.
- Guest payment domain skeleton: Stripe Checkout integration, payment ledger, refunds — kept structurally separate from platform billing (Phase 3).

## Phase 2 — Clock PMS+ adapter

- Materialize the deliverables listed in `docs/source/clock-pms-integration.pdf` section 37: `CLOCK_ARCHITECTURE.md`, `CLOCK_ENDPOINT_MATRIX.md`, `CLOCK_DATA_MAPPING.md`, `CLOCK_BOOKING_STATE_MACHINE.md`, `CLOCK_WEBHOOK_FLOW.md`, `CLOCK_RECONCILIATION.md`, `CLOCK_ERROR_CATALOGUE.md`, `CLOCK_SECURITY_REVIEW.md`, `CLOCK_RUNBOOK.md`.
- `ClockPmsProvider` implementing the `PmsProvider` interface, sandbox-validated per the brief's Definition of Done (section 36) before any production activation.
- Resolve each ADR listed in the brief's section 38 before the corresponding capability ships.

## Phase 3 — Platform billing

- Tenant subscription, plans, trial, invoicing, dunning per accepted ADR-0003.
- Plan-limit enforcement in the API layer per `BILLING.md`.

## Phase 4 — WordPress shell migration

- Rebuild the predecessor plugin's public booking surface as a thin embeddable widget calling the MUST Public API only — no provider credentials, no domain logic in WordPress.
- Decommission the domain/payment/PMS code paths in the legacy plugin once the widget is validated in a non-production environment.

## Phase 5 — Production hardening

- Observability, alerting, rate limiting, WAF handling, reconciliation jobs, security review, E2E suite — per the brief's sections 27-31 and its Definition of Done (section 36), extended to cover tenancy and billing failure modes.

## Out of scope until explicitly requested

- Additional PMS vendors beyond Clock (Mews/Cloudbeds/Opera) — the `PmsProvider` interface keeps this open, but no vendor work starts without an explicit go-ahead.
- Marketplace/reseller billing, multi-currency platform billing.
