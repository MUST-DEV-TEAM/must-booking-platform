# Production operations (booking.must.al)

Scripts installed on the production host (`139.162.153.25`, Ubuntu, Docker Compose project
`must-booking` in `/root/must-booking-platform`). See the 2026-10-09 inspection in
[docs/operations](../../docs/operations/README.md) for the host's state.

## Automatic deploy (`must-deploy.sh` + `.github/workflows/deploy.yml`)

When CI passes on a push to `main`, the Deploy workflow:

1. builds the api and web images in GitHub Actions, tagged with the commit SHA (the host has
   1 vCPU / 1 GB RAM, so it no longer builds);
2. streams them to the host over SSH (`must-deploy load`);
3. runs `must-deploy deploy <sha>` on the host, which checks out that commit, takes a
   pre-deploy `pg_dump` into `/var/backups/must-booking/pre-deploy` (last 5 kept), runs
   `prisma migrate deploy` and `db:set-app-password`, recreates api and web, and health-checks
   `:4010/health` and `:4011/`. If unhealthy it switches back to the previous images;
4. checks `https://booking.must.al/api/health` publicly.

Rollback: run the Deploy workflow manually with `rollback`, or `must-deploy rollback` on the host.
Migrations are forward-only; a rollback restores app images, not the schema (use the
pre-deploy dump if a migration has to be undone).

The GitHub key (`DEPLOY_SSH_KEY`, comment `github-actions-deploy`) is installed in root's
`authorized_keys` with `command="/usr/local/sbin/must-deploy"`, so it can only run the
subcommands above. Repo secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, and for
the web build `WEB_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (optional;
without them the web bundle ships without Sentry).

Releases are tagged `must-booking-{api,web}:<sha>`, the last 3 are kept, and `:latest` always
points at the running one so manual `docker compose up -d` keeps working. The images running
before this pipeline are tagged `pre-pipeline`. State lives in `/var/lib/must-deploy`.

## WordPress backup sorting (`updraft-organize.py`)

UpdraftPlus on the client WordPress sites uploads to the `UpdraftPlus` folder of the backup
Google Drive. This script (hourly, via rclone remote `gdrive`) moves each file older than 3 hours
into `UpdraftPlus/<Site>/` and, per site and backup part, moves older copies to the Drive trash
when a newer copy at least half its size exists. `--dry-run` and `--move-only` are available.
To restore a site from WordPress, move its files back to the `UpdraftPlus` root first.
