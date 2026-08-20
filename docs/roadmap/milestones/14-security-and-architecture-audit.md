# Milestone 14: Security & Architecture Audit

Status: Not started
Depends on: Milestone 12 (Integration & Initial Release Readiness); Milestone 13 (Application UI/UX & Feature Enhancements — this milestone does not start until Milestone 13 is fully closed out, per ADR-0028's "no parallel milestones" decision)

**New milestone (2026-08-17, ADR-0028).** The owner asked for a dedicated, systematic security/architecture pass rather than an ad hoc list, having flagged limited domain background to judge this alone. This milestone is broader and more systematic than Milestone 12 Task 5's security pass, which was explicitly scoped to "the real internet-facing surface" for one live tenant (Empire Beach Resort) — this milestone should not repeat work Task 5 already verified (see its written summary in `docs/roadmap/milestones/12-integration-and-initial-release.md`), only extend past it.

## Goal

A systematic sweep of the categories `AGENTS.md` itself calls out as the highest-cost mistakes in this codebase — tenant isolation, payment/billing separation, PMS-integration idempotency — plus the standard cross-cutting security categories a multi-tenant SaaS handling real payments needs checked periodically, not just once. This is an audit-and-fix milestone: findings get fixed if realistically exploitable/likely, and consciously deferred with written reasoning otherwise (matching Task 5's own precedent), not silently skipped.

## Draft task areas (not final — define the real tasks at kickoff)

1. **Tenant isolation audit**: systematic check that every table/query/cache-key/queue-message carries `tenant_id` (and `property_id` where applicable) per `docs/TENANCY.md`, across every module built since Milestone 1 — not just the ones touched by a specific PR review.
2. **Guest-payment / platform-billing separation audit**: confirm no table, entity, or code path is shared between the two domains per `docs/BILLING.md`, especially once Milestone 15 (Platform Billing) exists.
3. **PMS-integration idempotency audit**: booking creation/update/cancellation/webhook/reconciliation paths actually check the operation record before retrying (per `AGENTS.md`'s "do not blind-retry" rule), across `LocalPmsProvider` and `ClockPmsProvider`.
4. **Auth & authorization audit**: staff role/capability checks enforced server-side (not just UI-hidden) on every endpoint; guest anonymous-session model (ADR-0017) can't be forged/escalated; platform-admin auth stays fully separate from tenant-staff auth.
5. **Webhook/callback audit**: signature verification, replay protection, and amount/reference binding across Stripe, PokPay, and Clock SNS — building on Task 5's fixes, re-verifying they still hold as the codebase has grown.
6. **Database/migration audit**: idempotent/rollback-safe migrations, `NUMERIC` (never float) for money, tenant-scoping story reviewed per new table added since Milestone 1.
7. **Secrets/credentials audit**: no tracked secret values (recurring check, not one-time); revisit `INTEGRATION_CREDENTIALS_KEY`'s real migration plan (flagged, not yet resolved, after the 2026-08-10 homelab `.env` exposure).
8. **Public API surface audit**: dependency audit (`pnpm audit`) as a recurring practice, not a one-time Task 5 run; revisit the Clock outbound-host allowlist Task 5 consciously deferred for a single-tenant context.
9. **WordPress guest-plugin domain-logic boundary audit**: confirm no PMS/payment credentials or domain logic have crept back into `apps/wordpress-plugin` since ADR-0016's retrofit, and that `esc_html`/`esc_attr`/`esc_url` escaping and nonce verification are consistently applied.
10. **General OWASP-style pass**: XSS, CSRF, injection, session fixation, CORS configuration — scoped to what's realistically exploitable given the current live tenant, matching Task 5's own risk-based approach rather than a generic checklist run for its own sake.

## Explicitly not included

- Re-running checks Milestone 12 Task 5 already did and verified clean (rate limiting, Clock SNS topic binding, Next.js dependency tree) — only re-verify if something material changed since.
- A formal third-party penetration test or compliance certification — not scoped here unless the owner explicitly wants it.
- Platform-wide security work gated on a second tenant existing (per Milestone 12's own explicit deferral note) — this milestone covers what applies now, for Empire Beach Resort's real live operation.

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
