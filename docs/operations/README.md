# Operations and testing

Status: **Repository-backed procedures; live environment NOT VERIFIED in this audit** (2026-09-19).

## Setup and deployment sources

Use [CONTRIBUTING.md](../../CONTRIBUTING.md) for local Node/pnpm/Postgres/Redis setup and [container instructions](../../infrastructure/containers/README.md) for checked-in Compose/build/migration scripts. [environment.ts](../../apps/api/src/config/environment.ts) owns API validation; templates list variable names. Do not copy secret values into docs.

The last maintained environment record (2026-09-10, [Milestone 14](../roadmap/milestones/14-security-and-architecture-audit.md)) says production moved to `booking.must.al` and the homelab was retired. The old `compose.homelab.yaml` and deploy-webhook/systemd files remain repository artifacts; their presence does not prove they run on that host. No live infrastructure was contacted during initialization. Do not deploy to the retired host.

The API runtime must use the RLS-constrained database role; migrations use the owner connection. The container procedure runs `db:set-app-password` after migrations. That command changes a database credential and belongs only in the explicitly targeted environment. Production secrets, DNS/TLS and deployment automation still require Milestone 14 reconciliation, not a silent status change. Nightly encrypted database backups to Google Drive are set up by hand on the server from [infrastructure/backup](../../infrastructure/backup/README.md); the repository cannot show whether a given host has done so.

## Jobs and observability

Workers run in the API process; startup of a full AppModule can connect to Redis, register schedules and initiate external work. Use isolated test resources.

| Owner | Schedule / responsibility |
| --- | --- |
| `payments/payment-expiry.service.ts` | Every minute: poll pending PokPay orders; expire payment-pending bookings older than 30 minutes, batch 100 |
| `platform/provider-health.service.ts` | Every 5 minutes: provider health checks/cache |
| `integrations/clock/clock-worker.service.ts` | Daily 03:00 UTC: fan out booking-consistency and payment checks over a rolling 31-day window; webhook hydration |
| `integrations/clock/clock-webhook-health.service.ts` | Every 6 hours: 48-hour webhook silence, queue backlog >100, PMS-pending bookings older than one hour |
| `integrations/clock/clock-queue.service.ts` | Queue handles/backoff/dead-letter copying; only implemented processors perform business work |

Pino supplies request IDs and structured request/response logging. `observability/error-tracking.ts` and the exception filter report to Sentry when configured; Clock failures/manual review/circuit breaking have reporting hooks. A reporting call in code is not proof alerts are delivered to an operator. No full metrics/histogram/export system was found. Inspect log payloads and configuration before treating logs as safe to publish.

Clock recovery, webhook setup and limitations belong in the [Clock runbook](../integrations/clock/runbook.md). Reconciliation finds discrepancies; it does not automatically repair financial records.

## Verification map

| Check | Command / prerequisites |
| --- | --- |
| Workspace compile/build | `pnpm -w build`; API TypeScript + web Next build + shared packages |
| API compile | `pnpm --filter api build` |
| Frontend build | `pnpm --filter web build` |
| Lint | `pnpm -w lint` |
| Formatting | `pnpm -w format:check`; for docs-only work, check only changed Markdown to preserve unrelated files |
| API tests | `pnpm --filter api test`; default Vitest includes unit **and** DB/Redis integration specs |
| API isolated unit selection | `pnpm --filter api exec vitest run src --exclude '**/*.sandbox.spec.ts'`; confirm selected tests' resource use first |
| Frontend unit tests | `pnpm --filter web test` |
| Browser tests | `pnpm --filter web e2e`; use `apps/web/e2e/run.mjs` and isolated stack |
| Plugin syntax | `pnpm lint:wordpress-plugin`; PowerShell/PHP required |
| Focused plugin behavior | PHP files and Node tests under `apps/wordpress-plugin/tests/`; inspect each harness before execution |
| Documentation changes | Relative-link and source-path checks, claim inspection, secret-pattern check, changed-Markdown formatting, `git diff --check`, scope review |

[CI](../../.github/workflows/ci.yml) installs, builds, lints, checks formatting, migrates a local PostgreSQL service and runs workspace tests with Redis. It does not run the separate web browser command or plugin PHP checks. Clock sandbox tests require sandbox credentials and must not be enabled accidentally when running broad tests. Historical passing counts are not a current test result.

Tests under `apps/api/test` cover RLS, auth/capabilities, last-unit concurrency, individual-room modes, orders, payments and Clock flows. Co-located API/web/UI unit specs cover narrower logic. Browser tests cover selected auth, booking-mode and calendar-blocking flows. Some plugin checks inspect source strings: label them structural checks, not behavior or concurrency proof.

Documentation-only edits do not require starting services, exercising gateways or rebuilding product code. Report exactly which checks ran and their limits.
