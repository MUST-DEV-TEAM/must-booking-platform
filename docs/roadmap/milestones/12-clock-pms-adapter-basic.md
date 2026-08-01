# Milestone 12: Clock PMS+ Adapter (Basic Integration)

Status: Not started
Depends on: Milestone 4 (booking domain/`PmsProvider`); reference material: `docs/source/clock-pms-integration.pdf`

**Carried forward from Milestone 2 (Task 7, 2026-07-28):** Milestone 2's Free-plan limit enforcement could not gate PMS connections — no PMS-connection endpoint existed at all yet. When this milestone builds Task 3's per-tenant Clock connection settings/admin UI (the actual "connect a PMS" mutation point), add enforcement of `plans.pms_enabled` there: a plan without PMS access must have connection attempts rejected outright (feature gate, not a count), per ADR-0007.

## Goal

A first working `ClockPmsProvider`, sandbox-validated, covering the core loop: connect, catalog sync, availability, and booking create/update/cancel. This is deliberately **basic**, not the full production-grade integration the source brief specifies (full webhook reconciliation, WAF handling, complete observability, all deliverable documents) — that hardening is Milestone 13 and beyond. Done means: a real Clock sandbox account can be connected, its catalog synced, and a booking created/cancelled through `ClockPmsProvider`, end to end.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. Clock HTTP client: Digest Authentication, connection pooling, TLS, timeouts, structured logging (source brief section 9).
2. Rate limiting (4 req/s per API user via Redis, source brief section 10) and basic error classification (section 11).
3. Credential storage/config: per-tenant Clock connection settings, encrypted at rest, admin UI for entering them (source brief section 8).
4. Test-connection flow (`testConnection` on `PmsProvider`).
5. Catalog sync: initial full sync with preview/confirm, per source brief section 14 — room types, rooms, rates, mapped into local catalog mapping tables (section 13).
6. Availability query integration (`getAvailability`), with the endpoint-matrix caveat from section 16 (short-lived cache only, final check before booking).
7. `createBooking`/`updateBooking`/`cancelBooking` on `ClockPmsProvider`, idempotent per section 18-19's pattern (reuse Milestone 4's `integration_operations` design).
8. Webhook endpoint skeleton (SNS-shaped, section 20): signature verification, dedup, fast-2xx-then-queue — event *hydration* can be minimal/manual-triggered for this milestone; full reconciliation is Milestone 13+.
9. Sandbox validation report: for every endpoint used, record verification status per source brief section 39 (`CONFIRMED_BY_DOCS` / `CONFIRMED_IN_SANDBOX` / etc.) — start of `CLOCK_ENDPOINT_MATRIX.md`.
10. Manual-review queue stub for unknown/ambiguous Clock results (section 26) — doesn't need full automation yet, but must not silently misclassify an unknown result as success.

## Explicitly not included (deferred to post-Milestone-13 hardening backlog)

- Full reconciliation jobs, WAF-suspicion circuit breakers, complete observability/alerting (source brief sections 22, 12, 28).
- All the source brief's deliverable documents beyond the endpoint matrix (`CLOCK_ARCHITECTURE.md`, `CLOCK_WEBHOOK_FLOW.md`, etc.) — written up properly before any production activation, not required for this milestone's sandbox-only scope.
- Any PMS vendor other than Clock.
- Production activation — this milestone is sandbox-only, per the source brief's Definition of Done (section 36).

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
