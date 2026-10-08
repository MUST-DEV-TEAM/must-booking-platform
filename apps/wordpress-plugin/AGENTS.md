# MUST Hotel Booking Agent Instructions

## Repository purpose

This subtree is the MUST Booking Platform guest-facing WordPress plugin. Root `AGENTS.md` applies too. The platform backend owns current booking/payment/PMS authority; retained legacy tables and classes require usage analysis, not assumptions about active behavior.

## Start every task

1. Read this file.
2. Read the repository-root `docs/README.md`, then `docs/architecture/frontends-and-api.md`. The plugin-local `docs/INDEX.md` is a compatibility pointer; predecessor docs are archived under root `docs/archive/wordpress-plugin-pre-retrofit/`.
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

Use repository-root `docs/README.md` and its task router. WordPress transport/bootstrap/legacy boundaries live in `docs/architecture/frontends-and-api.md`; domain behavior in `docs/architecture/booking-and-payments.md`; provider contracts in `docs/integrations/clock/`; checks/deployment in `docs/operations/README.md`. Do not recreate the predecessor's missing plugin-local documentation system.

Claude plans and implements; the owner approves, per `docs/maintenance.md`. Significant decisions require an ADR; routine details do not.

## Final response

Report:

- Files changed.
- What changed.
- How to test.
- Checks run and exact results.
- Risks / follow-up.
- Docs updated or not updated.
