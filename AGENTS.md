# MUST Booking Platform — Agent Instructions

Multi-tenant hotel booking platform: NestJS API (`apps/api`), Next.js staff/platform dashboard (`apps/web`), WordPress guest plugin (`apps/wordpress-plugin`), Clock PMS+ integration. Live tenant: Empire Beach Resort.

## How work happens

- The owner asks; Claude plans and implements. For anything larger than a small fix, state the plan in a few lines and get the owner's OK before building.
- One change per branch and PR. CI must be green before merge; never push straight to `main`.
- Read only what the task needs: this file, then the one doc [docs/README.md](docs/README.md) routes you to, then the code. Code is the source of truth; docs are navigation.
- `docs/roadmap/` and `docs/audit/` are backlog and history, not required reading and not a gate on what may be worked on.
- Run `git status --short` first and keep unrelated changes.

## Rules that protect money and data

- **Tenancy:** every domain table, query, cache key and queue message carries `tenant_id` (and `property_id` where applicable). RLS stays on; the API uses the non-owner role.
- **Billing separation:** guest payments (Stripe/PokPay/folio) and platform subscription billing never share tables, entities or code paths.
- **PMS boundary:** booking code talks to the `PmsProvider` interface; vendor HTTP calls live only in the adapter's infrastructure layer. Do not invent Clock endpoints or fields — check `docs/integrations/clock/endpoint-matrix.md` and mark unverified assumptions as such.
- **Idempotency:** booking create/update/cancel, webhooks, refunds and reconciliation must be safe to repeat. Never blind-retry a booking create after a timeout; check the operation record and search Clock by MUST reference first.
- **Money:** `NUMERIC` or minor units, never floats.
- **Migrations:** additive, idempotent, safe to re-run; a destructive change needs a written rollback.
- **Providers and production:** no live requests to Clock, Stripe, PokPay or Resend, and no production deploys, data changes or secret changes, without the owner's explicit go-ahead for that action. Never print or commit secrets.

## Before you say it's done

- Run lint, typecheck/build and the tests for what you changed (`pnpm -w lint`, `pnpm --filter api test`, `pnpm --filter web test`, `pnpm -w build`). Report failures honestly; never skip or weaken a test to get green.
- A test that only greps source text is not behavioral proof.
- Check `git diff --stat` matches the task.

## Docs

Update the one canonical doc a change makes wrong (see the router in `docs/README.md`), in short factual sentences. Do not write task reports, diaries or new status files; history lives in Git and PRs. Record a hard-to-reverse, cross-cutting decision as a short ADR in `docs/decisions/`.

## Report

Say what changed and why, files touched, migrations, API contract changes, tests run with results, and anything left open.
