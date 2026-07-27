# Milestone 0: Repository & Infrastructure Foundations

Status: Not started
Depends on: ADR-0001 (monorepo/stack, accepted)

## Goal

A working monorepo skeleton with no business logic yet: apps build, lint, and test in CI; local dev environment (Postgres, Redis) runs via Docker; shared packages exist as empty-but-wired contracts. Done means a developer (or Codex) can clone the repo, run one command, and have `apps/api` and `apps/web` boot against a local database.

## Draft task areas (not final — define the real 10 tasks at kickoff)

1. npm/pnpm workspace setup (`apps/*`, `packages/*`), root tooling config (TypeScript, ESLint, Prettier).
2. `apps/api` — NestJS app skeleton, boots, health-check endpoint.
3. `apps/web` — Next.js app skeleton, boots, single placeholder page.
4. `packages/shared-types` and `packages/domain-contracts` — empty packages wired into both apps' builds (contracts, e.g. `PmsProvider`/`BillingProvider` interface stubs from `ARCHITECTURE.md`, live here).
5. Docker Compose for local PostgreSQL + Redis, with a documented one-command dev startup.
6. Database migration tooling wired up (choose and configure a migration tool compatible with NestJS/TypeORM or Prisma — decide as part of this task, not a separate ADR).
7. CI pipeline (GitHub Actions): install, build, lint, test on every PR for all apps/packages.
8. Environment/config management (`.env` handling, config validation on boot, secrets never committed — `.env.example` only).
9. Base logging setup (structured logs) wired into `apps/api`, ready for later observability work (Milestone 10).
10. `CONTRIBUTING.md` or equivalent short doc: how to run the repo locally, run tests, and open a PR — so Codex/any contributor has one canonical setup reference.

## Explicitly not included

- Any tenant, auth, or booking domain logic (Milestone 1+).
- Deployed staging/production environment (Milestone 10 at the earliest).

## Tasks

_To be filled in at milestone kickoff — see `docs/roadmap/README.md`._
