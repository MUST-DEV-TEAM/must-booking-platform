# MUST Booking Platform

A hotel booking platform for many hotels at once. Guests book and pay on the hotel's own website, hotel staff run their bookings in a dashboard, and the platform keeps each hotel's property management system (Clock PMS+) in step.

Production runs at [booking.must.al](https://booking.must.al).

## What it does

| Area | What is there |
| --- | --- |
| Guest booking | Live prices and availability, single and multi-room bookings, a "manage my booking" page, cancellation by the hotel's own rules |
| Payments | Card payments through PokPay and Stripe on each hotel's own account, pay at hotel, manual settlement, full and partial refunds |
| Staff dashboard | Bookings, calendar, payments, guests, staff and roles, reports, settings, email templates |
| Clock PMS+ | Rooms and rates from Clock, live pricing, bookings created in Clock, webhooks, payments and refunds posted to the guest's bill |
| Hotel websites | A WordPress plugin, and a public guest API for sites built with Astro |
| Platform administration | A separate console for MUST staff: hotels, plans, support, health |

Some areas are partial or planned (restaurant reservations, paid platform subscriptions, a direct channel manager). The [product overview](docs/product-overview.md) lists each area with its real state.

## How it is built

- **API:** NestJS 11 on Node.js 22, PostgreSQL 17 through Prisma, Redis with BullMQ for background jobs.
- **Dashboards:** Next.js 16 and React 19.
- **Guest side:** a WordPress plugin, and Astro sites that call the public guest API.
- **Tenancy:** every hotel's data is separated in the database by row-level security. The API connects with a role that is not a superuser.
- **Money:** guest payments and refunds are kept in the platform's own ledger. Clock's bills are a copy of it, never the source.

The [documentation](docs/README.md) has the architecture, the decisions behind it and the integration notes.

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/api` | The API, the database schema and migrations, background workers |
| `apps/web` | The staff dashboard and the platform console |
| `apps/wordpress-plugin` | The guest booking plugin for WordPress sites |
| `apps/restaurant-demo` | A demo Astro site |
| `packages/` | Shared types, domain contracts and UI components |
| `infrastructure/containers` | Docker Compose files and the deploy scripts |
| `docs/` | Architecture, decisions, integrations, operations, roadmap, reviews |

## Run it locally

You need Node.js 22 or newer, pnpm 10 or newer, and Docker Desktop.

```sh
pnpm install --frozen-lockfile
docker compose up -d                      # PostgreSQL and Redis
cp apps/api/.env.example apps/api/.env    # local-only values
pnpm --filter api prisma migrate dev
pnpm --filter api start:dev               # API on http://localhost:3000
pnpm --filter web dev                     # dashboard on http://localhost:3001
```

The API answers at `http://localhost:3000/health`. [CONTRIBUTING](CONTRIBUTING.md) has the full setup, including PowerShell commands and the two database connections.

## Checks

```sh
pnpm -w build
pnpm -w lint
pnpm -w format:check
pnpm -w test
```

CI runs these on every pull request, with the API tests against a real PostgreSQL and Redis, browser tests with Playwright, and booking tests against the Clock sandbox. The API tests must not be run against a database you care about: [operations and testing](docs/operations/README.md) explains how to run them safely.

## Deploying

A merge to `main` is a production deploy. After CI passes on `main`, the deploy workflow builds the images, takes a database dump, runs the migrations and restarts the services. It goes live only if the readiness check (`/health/ready`: PostgreSQL and Redis both answer) passes, and it starts the previous release again if not.

So: one change per pull request, CI green, and the owner's approval before merging. Migrations must be additive and must keep working with the previous release, because they are not rolled back.

## Working on this repository

- [AGENTS.md](AGENTS.md) is the rule set for people and for coding agents: tenancy, money, PMS, migrations and verification.
- [Roadmap](docs/roadmap/README.md) shows what is being worked on and what is planned.
- [Hardening queue](docs/roadmap/hardening-queue.md) is the current work: the fixes that came out of the November 2026 reviews of the database, the backend, the frontend and the booking flow.
- Real hotels' data is read-only for testing. Tests use the sandbox hotel.

## License

Proprietary. An internal project of MUST-DEV-TEAM. The WordPress plugin keeps its own GPL-2.0-or-later license.
