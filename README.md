# MUST Booking Platform

Multi-tenant SaaS platform for hotel booking, PMS integration, and platform subscription billing. This is a clean-slate rebuild that replaces the domain/payment/PMS logic previously embedded in the [must-hotel-booking](https://github.com/MUST-DEV-TEAM/must-hotel-booking) WordPress plugin.

## Why a new project

The WordPress plugin grew business logic, payment integrity, and PMS synchronization directly inside the WordPress runtime for a single tenant. That produced hard-to-verify concurrency patches and no path to multi-tenancy or platform billing. See [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) for the full rationale.

The WordPress plugin is not discarded: it is being repositioned as a thin embeddable booking-widget frontend over this new backend (see `docs/ARCHITECTURE.md`).

## Start here

- [docs/INDEX.md](docs/INDEX.md) — task router, read this first.
- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) — product purpose, scope, status.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture and stack.
- [docs/ROADMAP.md](docs/ROADMAP.md) — phased delivery plan.
- [docs/decisions/](docs/decisions/) — architecture decision records (ADRs).
- [docs/source/clock-pms-integration.pdf](docs/source/clock-pms-integration.pdf) — original Clock PMS+ integration brief (source material for the PMS adapter work).
- [infrastructure/containers/README.md](infrastructure/containers/README.md) — how to build and run the full stack in Docker for a production-style deployment.

## Repository status

Pre-implementation. Documentation, tenancy/billing decisions, and initial ADRs are being established before any application code is written.

## Local services

Start the local PostgreSQL and Redis services from the repository root:

```sh
docker compose up -d
```

The API runtime uses the non-superuser RLS role in `DATABASE_URL`.
Prisma migrations use the separate migration-owner connection in `MIGRATION_DATABASE_URL`.
Redis is available at `redis://localhost:6379`.

For the complete local setup and contribution workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Proprietary — MUST-DEV-TEAM internal project.
