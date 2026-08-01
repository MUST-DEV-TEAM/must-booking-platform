# MUST Hotel Booking Agent Instructions

## Repository purpose

This repository is the MUST Hotel Booking WordPress plugin. Work only inside this plugin unless the user explicitly expands scope.

## Start every task

1. Read this file.
2. Read `docs/INDEX.md`.
3. Read only the canonical documents routed for the task. Do not load all documentation by default.
4. Run `git status --short` before editing and preserve unrelated changes.
5. Use the documentation as navigation; verify behavior in current executable code before changing it.

## Scope and safety

- Keep changes minimal and task-scoped. Do not perform unrelated refactoring.
- Never discard, reset, overwrite, or silently absorb unrelated user work.
- Do not create task reports, completion reports, scratch plans, diaries, or random Markdown files. Exact implementation history belongs in Git.
- Before removing a file, inspect runtime loading, autoloading, hooks, dynamic callbacks, deployment/package use, migrations, tests, operations, Git history, and compatibility significance.
- Distinguish verified current behavior, intended behavior, historical behavior, unresolved behavior, and suspected defects.

## WordPress and PHP conventions

- Preserve plugin bootstrap, namespaces, compatibility aliases, managed pages, rewrite rules, routes, hooks, query arguments, option names, metadata keys, and public FQCNs.
- Escape template output, sanitize input, verify nonces, and enforce capabilities.
- Do not trust `$_GET`, `$_POST`, cookies, sessions, return URLs, provider payloads, or external responses.
- Keep frontend, admin, and staff-portal selectors scoped under plugin wrappers. Avoid global theme/Elementor side effects.
- Keep business rules in engines/services/providers/repositories rather than templates.
- PHP 7.4 is the declared minimum, but current code uses PHP 8-only helpers. Do not claim PHP 7.4 works or introduce further incompatibility without an approved compatibility change and tests.

## Database compatibility

- Schema changes must be additive or have an explicit migration and rollback plan.
- Installation and upgrade logic must be idempotent and preserve existing data.
- Do not rename or drop tables/columns, delete historical migrations, or reinterpret stored provider/payment identifiers without verified usage and migration analysis.
- Existing installations may have partial or legacy shapes; test both fresh install and upgrades.
- Never delete guest, reservation, payment, refund, room, availability, provider, accounting, or activity data unless explicitly requested.

## Booking and payment integrity

- Do not double-reserve inventory or bypass final availability/price/policy validation.
- A normal online booking must not be confirmed before authoritative server-side payment verification.
- Browser returns, redirects, frontend state, and order creation are not payment success.
- Booking status, payment status, payment rows, provider transaction status, deposit, paid amount, balance, refund, and Clock folio balance are distinct.
- Booking, payment, Clock creation, webhook, refund, accounting, reconciliation, and retry paths must be idempotent.
- Failed or ambiguous provider operations remain failed, retryable, or manual review; never document or convert them as success.
- Offline Pay at Hotel is an explicit opt-in flow and must remain separate from Stripe/PokPay verification.
- Preserve cancellation/refund separation and manual Clock accounting boundaries unless an approved business rule changes them.

## External providers and production data

- Do not guess Stripe, PokPay, Clock PMS, AWS SNS, GitHub, email, or other external contracts.
- Do not make provider or production requests, including read-only probes, without explicit approval.
- Do not trigger cron, sync, reconciliation, bookings, payments, refunds, cancellations, webhooks, or accounting jobs without explicit approval.
- Do not expose credentials, tokens, webhook secrets, customer data, provider payloads, or unmasked identifiers in output, tests, logs, or documentation.
- Use non-production environments and backups for approved write E2E. Stop if environment separation, callback reachability, credentials, or rollback is uncertain.

## Lightweight verification

- Run `php -l` for every changed PHP file.
- Run `node --check` for changed JavaScript when Node is available.
- Run the focused standalone PHP tests relevant to the changed behavior.
- Use `git diff --check`, inspect `git diff --stat`, and confirm the final file scope.
- Do not call a test “behavioral” if it only scans source text.
- Documentation-only tasks require link, scope, secret-pattern, and claim verification; PHP lint is not required when no PHP changed.

## Canonical documentation ownership

| Change type | Canonical document |
| --- | --- |
| Product scope, status, capabilities, limitations, priorities | `docs/PROJECT_CONTEXT.md` |
| Bootstrap, modules, data model, routes, hooks, jobs, configuration architecture | `docs/ARCHITECTURE.md` |
| Booking, availability, pricing, payment, cancellation, refund, amendment, reconciliation | `docs/DOMAIN_LIFECYCLES.md` |
| Provider authentication, endpoints, callbacks, retry, idempotency, safety | `docs/INTEGRATIONS.md` |
| Setup, deployment, diagnostics, tests, incidents, recovery | `docs/OPERATIONS.md` |
| Public/admin/staff interfaces and interaction contracts | `docs/UI_UX.md` |
| Major milestones/incidents | `docs/PROJECT_TIMELINE.md` |
| Durable decisions | `docs/DECISIONS.md` and a selective ADR under `docs/decisions/` |
| Notable user-facing, integration, operational, compatibility, or security changes | `CHANGELOG.md` |

Significant, cross-cutting, high-risk, or difficult-to-reverse decisions require an ADR. Do not create ADRs for routine implementation detail. Update docs only when the task changes or clarifies durable knowledge.

## Final response

Report:

- Files changed.
- What changed.
- How to test.
- Checks run and exact results.
- Risks / follow-up.
- Docs updated or not updated.
