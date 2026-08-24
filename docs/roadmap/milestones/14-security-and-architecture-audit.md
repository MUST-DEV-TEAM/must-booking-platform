# Milestone 14: Environment Rebuild & Security Audit

Status: Kicked off 2026-08-21, 15 tasks defined below
Depends on: Milestone 12 (Integration & Initial Release Readiness); Milestone 13 (Application UI/UX & Feature Enhancements — this milestone does not start until Milestone 13 is fully closed out, per ADR-0028's "no parallel milestones" decision)
Owner: DenisZoi (GitHub: zoidenis)

**New milestone (2026-08-17, ADR-0028), scope expanded 2026-08-21.** Originally scoped as a standalone security/architecture audit. The owner decided to move the whole application off the homelab (`must.dejvis.dev`) onto a new, separately-owned environment — a clean rebuild, not a data migration (existing booking history stays on the retired homelab; Empire Beach Resort is re-onboarded fresh). Rather than harden the homelab's security now and repeat that work on the new box later, this milestone folds environment build-out into the audit pass: DenisZoi builds the new environment and runs the already-planned security audit against it before it goes live, one owner, one milestone, no repeated work.

This milestone is broader and more systematic than Milestone 12 Task 5's security pass, which was explicitly scoped to "the real internet-facing surface" for one live tenant (Empire Beach Resort) — this milestone should not repeat work Task 5 already verified (see its written summary in `docs/roadmap/milestones/12-integration-and-initial-release.md`), only extend past it.

## Goal

Two halves, one owner:

1. **Build the new production environment correctly from scratch** — provision, deploy, connect every integration, and prove it live, using `infrastructure/containers/README.md` as the deployment reference.
2. **A systematic security/architecture sweep** against that new environment — the categories `AGENTS.md` itself calls out as the highest-cost mistakes in this codebase (tenant isolation, payment/billing separation, PMS-integration idempotency), plus the standard cross-cutting security categories a multi-tenant SaaS handling real payments needs checked periodically, not just once.

This is a build-then-audit-and-fix milestone: findings get fixed if realistically exploitable/likely, and consciously deferred with written reasoning otherwise (matching Milestone 12 Task 5's own precedent), not silently skipped. The code-level audit tasks (5-14 below) don't strictly depend on the new environment existing — DenisZoi can sequence them in parallel with or ahead of the build-out if that's more efficient; only the go-live checklist (Task 15) genuinely depends on the new environment being up.

## Explicitly not included

- Re-running checks Milestone 12 Task 5 already did and verified clean (rate limiting, Clock SNS topic binding, Next.js dependency tree) — only re-verify if something material changed since.
- A formal third-party penetration test or compliance certification — not scoped here unless the owner explicitly wants it.
- Migrating existing booking/tenant data from the homelab — this is a clean rebuild, not a migration, per the owner's explicit 2026-08-21 decision.
- Platform-wide security work gated on a second tenant existing (per Milestone 12's own explicit deferral note) — this milestone covers what applies now, for Empire Beach Resort's real live operation.

## Tasks

| # | Task | Acceptance criteria | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | Provision and deploy the new environment | Provision the new server, deploy the Docker stack per `infrastructure/containers/README.md`, generate fresh secrets for everything (`POSTGRES_PASSWORD`, `QUOTE_SIGNING_SECRET`, `INTEGRATION_CREDENTIALS_KEY`, `SENTRY_DSN` — none reused from the homelab). **Fix the hardcoded runtime DB password in `compose.homelab.yaml`'s `api` service before this is deployed anywhere new** — it currently reads a literal string instead of `.env`, a real gap found during the Docker-build verification pass. **Acceptance**: `docker compose build` and `up` succeed on the new host from a fresh clone; the api service's DB credential is sourced from `.env`, not hardcoded. | Not started | |
| 2 | DNS/TLS cutover and a real deploy pipeline | Point the domain (or a new one, owner's call) at the new host with TLS terminated correctly. Replace the homelab-specific webhook + systemd-timer deploy mechanism (it already broke silently once, per Milestone 12 Task 1) with something more standard — e.g. a GitHub Actions deploy on push to `main`. **Acceptance**: a real `git push origin main` deploys cleanly end-to-end on the new environment; the site is reachable over HTTPS at the new domain. | Not started | |
| 3 | Re-onboard the tenant and reconnect every integration | Re-onboard Empire Beach Resort fresh on the new environment (no data migration). Reconnect Clock PMS+, Stripe, PokPay, and Resend — update webhook URLs at each provider's dashboard to point at the new host. Run a full live guest journey (search → book → pay → confirm → cancel → refund) proving it end to end, the same rigor as Milestone 12 Task 4. **Acceptance**: a real booking, payment, and cancellation/refund all succeed against the new environment, verified against the audit log and each provider's own dashboard, not just the confirmation screen. | Not started | |
| 4 | Infra-level hardening | SSH key-only access, no root login. Firewall confirms Postgres/Redis are not reachable from the public internet — only the reverse proxy's ports are exposed. Automated, off-host Postgres backups (real gap flagged earlier — nothing ships this today). Secrets stored properly (a password manager or the host's own secret store, not pasted in chat — there's history here worth not repeating). A patching/update cadence for the OS and Docker images. **Acceptance**: each item verified directly (e.g. `nmap`/`nc` confirms DB port isn't public; a real backup file exists off-host and has been test-restored once). | Not started | |
| 5 | Tenant isolation audit | Systematic check that every table/query/cache-key/queue-message carries `tenant_id` (and `property_id` where applicable) per `docs/TENANCY.md`, across every module built since Milestone 1 — not just the ones touched by a specific PR review. | Not started | |
| 6 | Guest-payment / platform-billing separation audit | Confirm no table, entity, or code path is shared between the two domains per `docs/BILLING.md`, especially once Milestone 15 (Platform Billing) exists. | Not started | |
| 7 | PMS-integration idempotency audit | Booking creation/update/cancellation/webhook/reconciliation paths actually check the operation record before retrying (per `AGENTS.md`'s "do not blind-retry" rule), across `LocalPmsProvider` and `ClockPmsProvider`. | Not started | |
| 8 | Auth & authorization audit | Staff role/capability checks enforced server-side (not just UI-hidden) on every endpoint; guest anonymous-session model (ADR-0017) can't be forged/escalated; platform-admin auth stays fully separate from tenant-staff auth. | Not started | |
| 9 | Webhook/callback audit | Signature verification, replay protection, and amount/reference binding across Stripe, PokPay, and Clock SNS — building on Milestone 12 Task 5's fixes, re-verifying they still hold on the new environment. | Not started | |
| 10 | Database/migration audit | Idempotent/rollback-safe migrations, `NUMERIC` (never float) for money, tenant-scoping story reviewed per table added since Milestone 1. | Not started | |
| 11 | Secrets/credentials audit | No tracked secret values (recurring check, not one-time). `INTEGRATION_CREDENTIALS_KEY` generated and stored properly on the new environment this time, closing the gap flagged after the 2026-08-10 homelab `.env` exposure. | Not started | |
| 12 | Public API surface audit | Dependency audit (`pnpm audit`) as a recurring practice, not a one-time run. Revisit the Clock outbound-host allowlist Milestone 12 Task 5 consciously deferred for a single-tenant context. | Not started | |
| 13 | WordPress guest-plugin domain-logic boundary audit | Confirm no PMS/payment credentials or domain logic have crept back into `apps/wordpress-plugin` since ADR-0016's retrofit, and that `esc_html`/`esc_attr`/`esc_url` escaping and nonce verification are consistently applied. | Not started | |
| 14 | General OWASP-style pass | XSS, CSRF, injection, session fixation, CORS configuration — scoped to what's realistically exploitable given the current live tenant, matching Task 5's own risk-based approach rather than a generic checklist run for its own sake. | Not started | |
| 15 | Go-live checklist and cutover | Full guest/staff/platform-admin journey proven stable on the new environment; explicit owner sign-off recorded here; a real cutover and rollback plan. Decommission the homelab only once the new environment has proven stable for a period the owner is comfortable with — not the same day as cutover. | Not started | |
