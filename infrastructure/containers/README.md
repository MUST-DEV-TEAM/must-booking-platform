# Production Deployment (Docker)

This directory holds the Docker Compose stack and supporting scripts for running MUST Booking
(Postgres, Redis, API, Web) as containers. These are checked-in deployment artifacts, not proof of the live topology. The homelab was recorded retired on 2026-09-10; see [current operations context](../../docs/operations/README.md). Verify applicability to the actual target before use.

## What's in this directory

Core stack — needed for any deployment:

- `compose.homelab.yaml` — the full stack: postgres, redis, api, web.
- `api.Dockerfile`, `web.Dockerfile` — multi-stage builds for each app.
- `homelab.env.example` — template for the `.env` file `compose.homelab.yaml` reads.

Optional automation — historically used by the retired homelab host, safe to ignore elsewhere:

- `deploy-webhook.mjs`, `deploy-webhook.Dockerfile`, `compose.deploy-webhook.yaml` — a webhook
  service that triggers `deploy.sh` on push to `main`.
- `check-deploy-drift.mjs`, `check-deploy-drift.sh`, `must-booking-deploy-drift.service`,
  `must-booking-deploy-drift.timer` — a systemd timer that alerts if the running containers fall
  behind `origin/main`.
- `deploy.sh` — pulls `main`, rebuilds, runs migrations, restarts; called by the webhook, but also
  runnable by hand (see below) with no webhook involved.
- `report-operational-alert.mjs` — sends the drift/health alerts above through Sentry.

`compose.homelab.yaml` plus a filled-in `.env` is the entire runtime requirement. None of the
optional automation needs to exist for a manual deployment.

## Release pipeline (booking.must.al)

Production deploys from GitHub, so the server never builds anything (it has 1 vCPU and 1 GB RAM):

1. CI passes on `main`.
2. `.github/workflows/deploy.yml` builds the api and web images and pushes them to GHCR as
   `ghcr.io/must-dev-team/must-booking-platform-{api,web}:<commit sha>`.
3. It connects over SSH and runs `deploy-release.sh <sha>`. That script:
   1. checks out that commit;
   2. saves a local `pg_dump` to `~/pre-deploy-backups` of the deploy user (last 5 kept), then runs the
      off-site backup (`must-booking-backup.service`, see [../backup](../backup/README.md)) if it is
      installed. A failed off-site backup only warns; a failed local dump stops the deploy;
   3. pulls the images, runs migrations and `db:set-app-password`, and restarts api and web
      (`compose.release.yaml` swaps their `build:` for the GHCR images);
   4. waits for `/api/health`. If it fails, it starts the previous release again and the
      workflow goes red.

Migrations are not rolled back, so a migration must keep working with the previous release.
Add columns and tables in one release, and drop them in a later one.

To roll back by hand, run the Deploy workflow from the Actions tab with an older commit of `main`
(one that already has this pipeline; older commits have no prebuilt images).
The Ops workflow runs fixed maintenance actions: `status`, `health`, `sentry` (which Sentry project api and web report to), `restart-api`,
`restart-web`, `backup-now` and `cleanup`. It does not show application logs, because they can
contain guest details. Read logs over SSH instead.

### One-time server setup

Run as root. The checkout moves to `/opt/must-booking`, the path the backup unit expects.

```sh
adduser --disabled-password --gecos '' deploy
usermod -aG docker deploy
git clone https://github.com/MUST-DEV-TEAM/must-booking-platform.git /opt/must-booking
cp /root/must-booking-platform/infrastructure/containers/.env /opt/must-booking/infrastructure/containers/.env
chown -R deploy:deploy /opt/must-booking
chmod 600 /opt/must-booking/infrastructure/containers/.env
# Lets the deploy take a backup without any other root access.
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start must-booking-backup.service' >/etc/sudoers.d/must-deploy
chmod 440 /etc/sudoers.d/must-deploy
```

Keep the compose project name `must-booking` (it is set in `compose.homelab.yaml`), so the new
checkout drives the same containers and volumes.

Generate a key used only by GitHub, and pin it to `ssh-gate.sh` so it can run nothing but a
deploy or an Ops action:

```sh
ssh-keygen -t ed25519 -N '' -C github-deploy -f /root/github-deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
echo "restrict,command=\"/opt/must-booking/infrastructure/containers/ssh-gate.sh\" $(cat /root/github-deploy.pub)" \
  >>/home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
ssh-keyscan -t ed25519 <server ip>      # value for DEPLOY_KNOWN_HOSTS
```

In GitHub, open Settings, then Environments, and create `production` with these secrets:
`DEPLOY_HOST` (server IP), `DEPLOY_USER` (`deploy`), `DEPLOY_SSH_KEY` (the contents of
`/root/github-deploy`, then delete that file) and `DEPLOY_KNOWN_HOSTS`. For the web build, also
add the repository secrets `WEB_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` and
`SENTRY_AUTH_TOKEN`, copied from the server's `.env`. Finally, set the repository variable
`DEPLOY_ENABLED` to `true`. Until then the workflow builds images and skips the deploy.

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose`, not the standalone `docker-compose`).
- Something to terminate TLS and route a public domain to the `web` service — this repo doesn't
  include one. The retired homelab used nginx-proxy-manager plus a Cloudflare Tunnel; any reverse proxy or
  load balancer works.
- `compose.homelab.yaml` declares `proxy` as an `external: true` Docker network so a reverse-proxy
  container can reach `web`. Either create it (`docker network create proxy`) before `up`, or
  remove that network from the `web` service if you're fronting the stack differently (e.g. a
  host-level proxy hitting the published port directly).

## Bringing the stack up

1. Copy the env template and fill in every value:

   ```sh
   cp homelab.env.example .env
   ```

   Every variable in `homelab.env.example` has a comment explaining what it's for and whether it's
   required. Generate fresh secrets for a new environment — `POSTGRES_PASSWORD`,
   `APP_DATABASE_PASSWORD`, `QUOTE_SIGNING_SECRET`, and `INTEGRATION_CREDENTIALS_KEY` must not be
   reused from another deployment.

2. Build, start the database and cache, migrate, then bring up the app:

   ```sh
   docker compose -f compose.homelab.yaml --env-file .env build
   docker compose -f compose.homelab.yaml --env-file .env up -d postgres redis
   docker compose -f compose.homelab.yaml --env-file .env run --rm api pnpm --filter api prisma migrate deploy
   docker compose -f compose.homelab.yaml --env-file .env run --rm api pnpm --filter api db:set-app-password
   docker compose -f compose.homelab.yaml --env-file .env up -d
   ```

   `deploy.sh` automates exactly this (plus a `git pull` and an optional Cloudflare cache purge) —
   read it if you'd rather run one script than these four commands.

3. Confirm health: `docker compose -f compose.homelab.yaml --env-file .env ps` — `api` and `web`
   should be running, not restarting.

## The runtime database role

The API connects as `must_booking_app`, a non-superuser role that RLS actually applies to — not as
the migration owner, which would bypass it. A migration has no access to the deployment's secrets,
so `20260727180000_runtime_database_role_and_users_insert_policy` creates that role with a
placeholder password and `db:set-app-password` rewrites it from `APP_DATABASE_PASSWORD` afterwards.

Run `db:set-app-password` after every `prisma migrate deploy` and before starting `api`; `deploy.sh`
already does. It is idempotent, and it must run on the migration-owner connection, since the API's
own role cannot change its own password.

Changing `APP_DATABASE_PASSWORD` in `.env` therefore takes two steps: run `db:set-app-password` to
move the role to the new value, then recreate `api` so it picks the new value up. Restarting `api`
alone will leave it unable to authenticate.
