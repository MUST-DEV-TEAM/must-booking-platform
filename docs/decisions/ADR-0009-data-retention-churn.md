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
- **Scope confirmed by the owner (2026-07-27): tenant data only.** Deletion covers the organization/tenant record, properties, staff/user accounts, and operational subscription state (plan assignment, tenant-side billing settings). It explicitly does **not** cover guest/booking/payment history — that data follows its own retention rule (unaffected by this ADR), per `PROJECT_CONTEXT.md`'s domain separation between platform billing and guest payments. If guest/booking data must eventually be deleted for a churned tenant (e.g. a GDPR erasure request), that is governed separately, not by this ADR.
- **Refined by the owner (2026-07-27, second review pass): billing/legal records are explicitly carved out of the 30-day hard delete**, correcting the earlier version of this ADR which listed "invoices, payment method" as deleted with tenant data. The 30-day job must not delete:
  - **Invoices, tax records, and payment-transaction records** — retained per applicable legal/tax retention policy (typically several years), independent of the tenant-data deletion job.
  - **Security/fraud/audit logs** — retained per the security retention policy, not the 30-day tenant-data window.
  These are excluded from deletion by classifying them as a distinct data category in the deletion job's query, not by a blanket "billing data" exception — the job must delete the tenant's *operational* billing settings (e.g. which plan they were on) while leaving the Stripe-side invoice/transaction records referenced by ADR-0003's external-reference mapping untouched.
- Backups are not required to be purged synchronously with the day-30 deletion; they expire on their own backup-retention cycle. A backup containing deleted tenant data must not be restored to production without re-applying the deletion to the restored data first.
- Reactivation within the 30-day window restores full access without data loss; this must be tested as an explicit case, not just the deletion path.

## Alternatives considered

- Retain indefinitely: rejected — open-ended storage liability.
- Immediate deletion: rejected — no win-back grace window judged too harsh for accidental/exploratory cancellations.
