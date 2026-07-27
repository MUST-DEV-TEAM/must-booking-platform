# Contributing to MUST Booking

## Prerequisites

- Node.js 22 or newer
- pnpm 10 or newer
- Docker Desktop with Docker Compose

## Local setup

From the repository root, install workspace dependencies and start PostgreSQL and Redis:

```sh
pnpm install --frozen-lockfile
docker compose up -d
```

Copy the API environment template before running migrations or the API:

```sh
cp apps/api/.env.example apps/api/.env
```

On PowerShell, use:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

`apps/api/.env` is gitignored. The template contains local-only Docker Compose credentials and must not be used for shared or production secrets.

Apply the local Prisma migration:

```sh
pnpm --filter api prisma migrate dev
```

The template provides both required database URLs: `DATABASE_URL` is the API's
non-superuser `must_booking_app` runtime role, while
`MIGRATION_DATABASE_URL` is the `must_booking` migration owner used through
Prisma's `directUrl`. No manual environment-variable override is needed.

Run the API and web app in separate terminals:

```sh
pnpm --filter api start:dev
pnpm --filter web dev
```

The API is available at `http://localhost:3000/health` and the web placeholder is available at `http://localhost:3001`.

To stop local services, run `docker compose down`.

## Checks

Run the full workspace checks before opening a pull request:

```sh
pnpm -w build
pnpm -w lint
pnpm -w format:check
pnpm -w test
```

## Pull requests

- Keep each pull request scoped to one active roadmap task.
- Follow the tenancy, billing, PMS, migration, and verification rules in [AGENTS.md](AGENTS.md).
- Use [CLAUDE.md](CLAUDE.md) for the review checklist; only Claude marks roadmap tasks as Done.
- Describe the task number, files changed, checks run, and remaining risks in the pull request.
