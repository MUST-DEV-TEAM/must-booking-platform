# MUST Booking Platform

Multi-tenant hotel booking platform with a NestJS API, Next.js staff/platform dashboards, a WordPress guest frontend and Clock PMS+ integration. Guest payments are implemented; paid platform subscriptions remain planned beyond the Free-plan foundation.

## Start here

- [Documentation](docs/README.md) - canonical entry point, current architecture and task router.
- [Roadmap](docs/roadmap/README.md) - active work, review state and historical milestones.
- [Contributing](CONTRIBUTING.md) - local setup and checks.
- [Agent instructions](AGENTS.md) - repository rules and how work is done.

The repository contains working application code. See [product scope](docs/product-overview.md) for implemented features and known limits; checked-in code and historical sandbox evidence are not a production certification.

## Local services

```sh
docker compose up -d
```

Use the API's non-superuser RLS role in `DATABASE_URL` and the migration-owner connection in `MIGRATION_DATABASE_URL`. Follow CONTRIBUTING for installation, migrations and running the apps. Deployment context and the retired homelab boundary are documented in [operations](docs/operations/README.md).

## License

Proprietary platform - MUST-DEV-TEAM internal project. The imported WordPress plugin retains its own GPL-2.0-or-later metadata.
