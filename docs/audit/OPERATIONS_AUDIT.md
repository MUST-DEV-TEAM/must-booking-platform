# Operations, delivery and verification audit

Evidence date: 2026-09-26. Audit-only work authorized by the owner's complete-audit request, spanning Milestone 14 Tasks 1-4, 10-12 and 15; no task is marked Done. The working tree contains substantial pre-existing changes. All observations concern this working tree, not a certified deployed revision. No production/provider request, migration, seed, backup restoration or deployment was performed.

## Status and coverage

In progress: infrastructure, observability and test execution reviewed; detailed source and historical-document reconciliation continuing. Dedicated findings IDs MBA-300 through MBA-399 belong to this file. Parent audit must cross-reference them in the central findings index rather than duplicate the underlying issue.

Read: repository instructions, documentation router, decisions and roadmap indexes; operations guide; Milestone 14; root README/CONTRIBUTING/CLAUDE/CHANGELOG; archive index and archived roadmap process/index. Historical Milestone 0, Milestone 12 and foreign-origin archived Milestone 20 are being read and classified, never treated as current certification.

Inspected: CI and plugin release workflows; container Dockerfiles/Compose; deploy, webhook, drift-check and alert scripts; API bootstrap/AppModule/environment/health/Sentry; provider-health, payment-expiry and Clock webhook-health workers; Vitest and Playwright configuration and dangerous-resource setup hooks. Selected isolated tests and non-emitting TypeScript checks are running; final results pending.

## Findings

### MBA-300 — Recoverability has no repository-backed backup or restore proof

- Category: Reliability / Disaster recovery. Severity: HIGH. Affected area: PostgreSQL, Redis, R2 assets, integration encryption key, production operations.
- Evidence: `infrastructure/containers/compose.homelab.yaml` supplies same-host PostgreSQL/Redis volumes; no backup service, archival schedule or restore procedure exists in the infrastructure tree. `docs/operations/README.md` explicitly does not verify the live host. Milestone 14 Task 4 requires off-host backups and a test restoration and remains unverified.
- Current behavior: database and cache survive ordinary container recreation through local volumes; deployed off-host backup behavior is UNVERIFIED.
- Problem/impact: neither a backup artifact nor a tested ability to reconstruct tenant bookings, payment history, encrypted provider credentials and asset references is demonstrated. Loss of the host or encryption key could make data unrecoverable.
- Recommendation: choose business-approved RPO/RTO, document encrypted off-host PostgreSQL recovery and key escrow, identify R2/Redis reconstruction requirements, and rehearse restoration into an isolated environment with booking/payment reconciliation. Record restore evidence and an accountable operator.
- Effort: M. Timing: BEFORE PILOT. Dependencies: owner-approved production access and recovery targets. Status: Confirmed repository gap; live controls UNVERIFIED.

### MBA-301 — Health and alerting can report success while critical dependencies fail

- Category: Observability / Reliability. Severity: HIGH. Affected area: API availability, queues, incident response.
- Evidence: `apps/api/src/health/health.controller.ts` always returns `{ status: 'ok' }`; production Compose has dependency health checks only for PostgreSQL/Redis and no API/web healthcheck. `apps/api/src/observability/error-tracking.ts` silently disables reporting without a DSN, while `apps/api/src/config/environment.ts` does not require one. Clock webhook-health checks run every six hours and backlog checks consider only waiting/active counts above 100.
- Current behavior: liveness is exposed and structured logging/Sentry hooks exist; there is no dependency-aware readiness endpoint, queue-age SLO, independent watchdog or checked-in alert-routing/acknowledgment evidence.
- Problem/impact: a responding API process, a stuck queue below 100 jobs, or a failed scheduler can remain apparently healthy while hotels miss bookings. The monitoring job shares the same API process/Redis failure domain it monitors.
- Recommendation: retain lightweight liveness; add bounded DB/Redis readiness, external synthetic monitoring, oldest-job/last-success indicators, and alert-delivery/acknowledgment drills. Define a small operational SLO set and ownership before broader dashboard work.
- Effort: M. Timing: BEFORE PILOT. Dependencies: deployed monitoring/alert recipient configuration. Status: Confirmed source behavior; deployed monitoring UNVERIFIED.

### MBA-302 — Deploy drift compares the checkout, not the code actually serving users

- Category: DevOps / Release integrity. Severity: HIGH. Affected area: checked-in deployment mechanism.
- Evidence: `infrastructure/containers/deploy.sh` resets HEAD to `origin/main` before building/migrating/restarting; `check-deploy-drift.mjs` only compares `git rev-parse HEAD` and `origin/main`. `deploy-webhook.mjs` accepts successful main CI events but deploys the latest main through the script, does not bind deployment to `workflow_run.head_sha`, and spawns detached deploys without a lock or child-exit alert.
- Current behavior: ownership protection and signature verification are present. A failed build after resetting Git leaves HEAD current but the old container serving. Overlapping successful CI events can launch concurrent deploys.
- Problem/impact: drift can falsely pass after failed deployment, and the deployed revision need not be the revision whose CI succeeded. No image artifact promotion, post-deploy business check or rollback path is demonstrated.
- Recommendation: replace the retired-host mechanism as already planned, using serialized promotion of a tested immutable image/SHA, explicit running-revision verification, migration compatibility/recovery gates, health checks and failure alerts. Do not deploy the archived homelab target.
- Effort: M. Timing: BEFORE PILOT. Dependencies: Milestone 14 Task 2 and actual host inventory. Status: Confirmed checked-in defect; applicability to live host UNVERIFIED.

### MBA-303 — Browser and WordPress behavior are outside CI and plugin publication is independent of verification

- Category: QA / Supply chain. Severity: HIGH. Affected area: dashboard and guest-plugin releases.
- Evidence: `.github/workflows/ci.yml` runs workspace build/lint/format/tests but never `pnpm e2e`, plugin PHP lint or plugin behavioral harnesses. Root ESLint explicitly excludes `apps/wordpress-plugin/**`. `.github/workflows/wordpress-plugin-release.yml` independently publishes on main plugin-version changes, checks ZIP shape, and can replace an existing release asset with `--clobber`.
- Current behavior: TypeScript workspace unit/integration checks and package-layout validation exist. There is no workflow dependency that requires CI/plugin behavior checks to pass before distributing the plugin.
- Problem/impact: a plugin with runtime or booking-funnel regressions can be published independently of a failing CI run. Unit/source-string checks do not establish browser payment/confirmation behavior or install/upgrade safety.
- Recommendation: require plugin PHP syntax and focused real behavior checks plus a critical browser smoke suite in release gates; publish the exact tested package with checksum/provenance and immutable version assets. Verify branch/environment protections separately.
- Effort: M. Timing: BEFORE PILOT. Dependencies: isolated test stack and PHP/WordPress harness; owner-controlled release repository. Status: Confirmed workflow gap; external branch protections UNVERIFIED.

### MBA-304 — Full test commands can target ordinary local resources and implicitly enable real-provider tests

- Category: QA / Developer safety. Severity: MEDIUM. Affected area: API integration and browser tests.
- Evidence: API Vitest configuration does not separate projects; `api test` runs unit and integration specs. `apps/api/test/health.e2e.spec.ts` initializes the full AppModule, including workers. Many integration specs use fixed localhost DB/Redis coordinates. `apps/web/playwright.config.ts` loads `apps/api/.env`; `apps/web/e2e/support.ts` falls back from E2E database/Redis URLs to ordinary migration/Redis URLs. Real Clock sandbox suites activate when credential variables are present.
- Current behavior: targeted tenant cleanup and mocks exist, but isolation is primarily operator convention. Browser tests perform data writes and the full API startup registers jobs.
- Problem/impact: a developer running the documented test command can mutate a shared local database/Redis or unintentionally make provider calls. CI/test concurrency can share schedulers and rate-limit keys, creating misleading failures.
- Recommendation: distinct unit/integration/provider projects and explicit opt-in provider flag; disposable named test database/Redis namespace with target validation; refuse non-test coordinates before mutation. Keep full AppModule workers disabled or isolated in tests not exercising them.
- Effort: M. Timing: BEFORE PRODUCTION. Dependencies: test harness/environment contract. Status: Confirmed configuration behavior.

## Checks

Executed 2026-09-26 on Windows, Node `v24.15.0`, pnpm `10.12.4` (CI uses Node 22). No product build was run because builds can rewrite generated app outputs.

| Exact command | Result | Limits |
| --- | --- | --- |
| `pnpm --filter api exec tsc --project tsconfig.build.json --noEmit --incremental false` | PASS, exit 0 | Source build type graph, not full integration-test type graph; existing generated Prisma/shared outputs used. |
| `pnpm --filter web exec tsc --noEmit --incremental false` | PASS, exit 0 | Existing generated Next/shared outputs used; not a clean Next production build. |
| `pnpm -w lint` | PASS, exit 0 | ESLint excludes WordPress plugin. |
| `pnpm --filter api exec vitest run src --exclude '**/*.sandbox.spec.ts' --reporter=dot` | FAIL, exit 1: 45 files passed / 2 failed; 306 tests passed / 4 failed / 8 skipped; 156.53s | The docs' source-only selection still includes `clock-queue.service.spec.ts` and `clock-rate-limiter.spec.ts`, which need real Redis. localhost:6379 refused connections, then hooks timed out. No Redis/server was started; this is a harness/resource failure, not evidence of a business defect. |
| `pnpm --filter web test -- --reporter=dot` | FAIL, exit 1: 37 files passed / 1 failed; 136 tests passed / 5 failed; 153.55s | All failures in `walk-in-booking.test.tsx`; first test timed out under the initial concurrent run, with subsequent missing-element/assertion failures. A bounded rerun is required before classifying product behavior. |

The initial tests/typechecks ran concurrently. Subsequent checks use bounded Vitest workers to distinguish resource contention from genuine regressions. Test logs contain expected mocked Clock failures; these are not real provider calls. The real sandbox suite was explicitly excluded.

## Unresolved evidence

- Current production runtime/image revision, reverse proxy/TLS/firewall topology, operating-system maintenance, alert routing and delivered incidents.
- Existence, encryption, retention and latest successful restoration of off-host backups; custody/recovery of `INTEGRATION_CREDENTIALS_KEY`.
- Branch protections, production deploy gates, access/release-token scope and the actual pipeline replacing the retired host scripts.
- No capacity, load, soak or failover measurements have yet been established.
