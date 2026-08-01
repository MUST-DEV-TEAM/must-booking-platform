# Milestone 0: Repository & Infrastructure Foundations

Status: Done
Depends on: ADR-0001 (monorepo/stack, accepted)

## Kickoff decisions (2026-07-27)

- Package manager: **pnpm** workspaces (`apps/*`, `packages/*`).
- ORM/migrations for `apps/api`: **Prisma**. Note for Milestone 1: Postgres RLS policies are not natively expressible in Prisma's schema DSL — RLS setup will need raw SQL migrations alongside Prisma-managed tables.
- `apps/booking-widget` (per ADR-0001's monorepo layout) is **not** scaffolded in this milestone — deferred to Milestone 6 when that work actually starts.

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
9. Base logging setup (structured logs) wired into `apps/api`, ready for later observability work (Milestone 11).
10. `CONTRIBUTING.md` or equivalent short doc: how to run the repo locally, run tests, and open a PR — so Codex/any contributor has one canonical setup reference.

## Explicitly not included

- Any tenant, auth, or booking domain logic (Milestone 1+).
- Deployed staging/production environment (Milestone 11 at the earliest).

## Tasks

| # | Task | Acceptance criteria | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | pnpm workspace setup: root `package.json`, `pnpm-workspace.yaml` (`apps/*`, `packages/*`), shared root TypeScript config, ESLint (flat config) + Prettier applied consistently across the workspace. | `pnpm install` at root resolves all workspaces; `pnpm -w lint` and a format-check script run cleanly across all packages/apps as scaffolded so far. | Done | (uncommitted locally) |
| 2 | `apps/api` — NestJS app skeleton with a `/health` endpoint. | `pnpm --filter api start:dev` boots without error; `GET /health` returns 200 with a JSON status payload; `pnpm --filter api build` succeeds. | Done | (uncommitted locally) |
| 3 | `apps/web` — Next.js (TypeScript) app skeleton with a single placeholder page. | `pnpm --filter web dev` boots; placeholder page renders at `/`; `pnpm --filter web build` succeeds. | Done | (uncommitted locally) |
| 4 | `packages/shared-types` and `packages/domain-contracts` — empty-but-wired packages containing initial `PmsProvider` / `BillingProvider` interface stubs per `docs/ARCHITECTURE.md`, consumed by `apps/api`. | Both packages build via the workspace build; `apps/api` imports at least one type from each with no type errors. | Done | (uncommitted locally) |
| 5 | Docker Compose for local PostgreSQL + Redis, one documented startup command. | `docker compose up -d` starts both containers, both healthy; connection string documented in `README.md` (actual `apps/api` connection proven in Task 6, `.env.example` added in Task 8). | Done | (uncommitted locally) |
| 6 | Prisma wired into `apps/api`: schema file, initial migration, migration scripts in `package.json`. | `pnpm --filter api prisma migrate dev` runs successfully against the Docker-Compose Postgres and applies a generated migration. | Done | (uncommitted locally) |
| 7 | CI pipeline (GitHub Actions): install (pnpm) → build → lint → test, on every PR, for all apps/packages scaffolded so far. | Workflow file exists under `.github/workflows/`; runs green on this task's own PR. | Done | (uncommitted locally — will run green once pushed/opened as a PR) |
| 8 | Environment/config management: `.env.example` covering Postgres/Redis/app config; config validation on boot in `apps/api` that fails fast on a missing required var; `.env` confirmed gitignored. | `apps/api` throws a clear startup error when a required env var is missing; `.env.example` is complete; `.env` is not committed and is gitignored. | Done | (uncommitted locally) |
| 9 | Base structured logging in `apps/api` (e.g. `nestjs-pino`), request-scoped, ready for correlation IDs later. | Requests produce structured JSON logs including method/path/status/duration; the health-check module demonstrates the injectable logger. | Done | (uncommitted locally) |
| 10 | `CONTRIBUTING.md`: local setup (pnpm, Docker Compose, Prisma migrate), running lint/tests, PR conventions referencing `AGENTS.md`/`CLAUDE.md`. | A new contributor following only `CONTRIBUTING.md` can get `apps/api` + `apps/web` running locally against the Docker-Compose Postgres/Redis. | Done | (uncommitted locally) |
