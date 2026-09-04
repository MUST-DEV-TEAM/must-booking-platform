# Production Deployment (Docker)

This directory holds the Docker Compose stack and supporting scripts for running MUST Booking
(Postgres, Redis, API, Web) as containers. It's what currently runs the homelab deployment at
must.dejvis.dev, but nothing here is homelab-specific except where noted below.

## What's in this directory

Core stack — needed for any deployment:

- `compose.homelab.yaml` — the full stack: postgres, redis, api, web.
- `api.Dockerfile`, `web.Dockerfile` — multi-stage builds for each app.
- `homelab.env.example` — template for the `.env` file `compose.homelab.yaml` reads.

Optional automation — only used by the current homelab host, safe to ignore elsewhere:

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

## Prerequisites

- Docker Engine with the Compose plugin (`docker compose`, not the standalone `docker-compose`).
- Something to terminate TLS and route a public domain to the `web` service — this repo doesn't
  include one. The homelab uses nginx-proxy-manager plus a Cloudflare Tunnel; any reverse proxy or
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
