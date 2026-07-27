# Changelog

## Unreleased

- Project inception: established documentation baseline (`PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, `TENANCY.md`, `BILLING.md`, `ROADMAP.md`), agent collaboration conventions (`AGENTS.md`, `CLAUDE.md`), and initial ADRs (ADR-0001 accepted). No application code yet.
- Owner decision round 1 (2026-07-27): ADR-0004 (EU data residency), ADR-0005 (hybrid hard/soft plan-limit enforcement), and ADR-0006 (multi-property tenants from v1) accepted. ADR-0002, ADR-0003, ADR-0007, ADR-0008, ADR-0009 initially left open.
- Owner decision round 2 (2026-07-27): remaining ADRs resolved. ADR-0002 — shared schema + Postgres RLS, hybrid escape hatch for future enterprise tenants. ADR-0003 — Stripe Billing now, behind a `BillingProvider` interface so PokPay can be added later for platform-subscription payments. ADR-0007 — flat tiered plans (Free: 1 property/3 staff/no PMS; Basic: 3 properties/10 staff/unlimited PMS; more tiers to come). ADR-0008 — self-serve signup landing directly on the Free plan, no card upfront. ADR-0009 — 30-day grace period after cancellation, then hard delete. All 9 foundational ADRs are now accepted; nothing blocks Phase 0 or Phase 3 on an unresolved decision.
