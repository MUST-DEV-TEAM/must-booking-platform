# ADR-0009: Tenant data retention after subscription cancellation

Status: Accepted
Date: 2026-07-27

## Context

Options presented were: retain for a grace period (e.g. 30-90 days) then hard delete, retain indefinitely until an explicit deletion request, or delete/anonymize immediately on cancellation. This is distinct from guest-data GDPR retention (`docs/PROJECT_CONTEXT.md`, `docs/source/clock-pms-integration.pdf` section 24), which covers guest PII within an active tenant, not what happens to a whole tenant's data after it churns.

## Options

1. **Grace period then hard delete** (e.g. 30-90 days) — common SaaS pattern, allows reactivation, bounds long-term storage liability.
2. **Retain indefinitely until explicit request** — friendliest to win-back, but open-ended storage/compliance liability.
3. **Immediate deletion/anonymization** — lowest data liability, no reactivation grace window for the tenant.

## Decision

Option 1: 30-day grace period after subscription cancellation, then hard delete.

Accepted by the owner on 2026-07-27.

## Consequences

- On cancellation, the tenant's account moves to a `cancelled` state with data intact but access gated (per ADR-0005/0008's Free-plan boundary — a cancelled paid tenant likely reverts to Free-plan-level access, or no access; confirm exact reactivation-window UX during Phase 3 implementation, not blocking this ADR).
- A scheduled job (BullMQ, per `ARCHITECTURE.md`) hard-deletes a tenant's data 30 days after cancellation if the subscription has not been reactivated. This must be idempotent and auditable (log what was deleted and when).
- "Hard delete" scope must be defined precisely during Phase 3 implementation: does it include guest/booking history the hotel may have a separate legal retention obligation for (distinct from platform billing — see `PROJECT_CONTEXT.md`'s domain separation), or only tenant/subscription/staff data? Default assumption pending that implementation detail: guest-facing booking/payment records follow their own retention rule (unaffected by this ADR), only tenant account, staff, and platform-billing-owned data are deleted per this 30-day rule.
- Reactivation within the 30-day window restores full access without data loss; this must be tested as an explicit case, not just the deletion path.

## Alternatives considered

- Retain indefinitely: rejected — open-ended storage liability.
- Immediate deletion: rejected — no win-back grace window judged too harsh for accidental/exploratory cancellations.
