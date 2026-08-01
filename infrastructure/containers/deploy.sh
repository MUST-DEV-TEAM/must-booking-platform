#!/usr/bin/env bash
# Run from infrastructure/containers/ on the homelab host, with a real .env present.
set -euo pipefail
cd "$(dirname "$0")"

docker compose -f compose.homelab.yaml --env-file .env build
docker compose -f compose.homelab.yaml --env-file .env up -d postgres redis
docker compose -f compose.homelab.yaml --env-file .env run --rm api pnpm --filter api prisma migrate deploy
docker compose -f compose.homelab.yaml --env-file .env up -d
docker compose -f compose.homelab.yaml --env-file .env ps
