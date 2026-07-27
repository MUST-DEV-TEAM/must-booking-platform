# ADR-0009: Tenant data retention after subscription cancellation

Status: Proposed — **explicitly left open by the owner on 2026-07-27**
Date: 2026-07-27

## Context

Options presented were: retain for a grace period (e.g. 30-90 days) then hard delete, retain indefinitely until an explicit deletion request, or delete/anonymize immediately on cancellation. This is distinct from guest-data GDPR retention (`docs/PROJECT_CONTEXT.md`, `docs/source/clock-pms-integration.pdf` section 24), which covers guest PII within an active tenant, not what happens to a whole tenant's data after it churns.

## Options

1. **Grace period then hard delete** (e.g. 30-90 days) — common SaaS pattern, allows reactivation, bounds long-term storage liability.
2. **Retain indefinitely until explicit request** — friendliest to win-back, but open-ended storage/compliance liability.
3. **Immediate deletion/anonymization** — lowest data liability, no reactivation grace window for the tenant.

## Decision

_Left open — the owner was asked directly and chose not to decide yet. Do not implement a cancellation/offboarding data-deletion job until this is resolved. Re-raise before Phase 3 (platform billing, which owns the cancellation flow) ships._

## Consequences

_To be filled in once decided._
