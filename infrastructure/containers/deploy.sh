#!/usr/bin/env bash
# Run from infrastructure/containers/ on the homelab host, with a real .env present.
# Pulls the latest main, rebuilds, migrates, and restarts. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"

if [ -z "${DEPLOY_SH_PULLED:-}" ]; then
  git -C "$REPO_ROOT" fetch origin main
  git -C "$REPO_ROOT" reset --hard origin/main
  # git reset --hard just overwrote this very file on disk. A script that
  # keeps executing from its already-open file descriptor after that is
  # undefined behavior in bash -- re-exec so everything past this point
  # runs from the freshly-pulled version, not a stale read/buffer.
  export DEPLOY_SH_PULLED=1
  exec bash "$REPO_ROOT/infrastructure/containers/deploy.sh"
fi

docker compose -f compose.homelab.yaml --env-file .env build
docker compose -f compose.homelab.yaml --env-file .env up -d postgres redis
docker compose -f compose.homelab.yaml --env-file .env run --rm api pnpm --filter api prisma migrate deploy
docker compose -f compose.homelab.yaml --env-file .env up -d
docker compose -f compose.homelab.yaml --env-file .env ps

# Cache-busting: Cloudflare edge-caches this app's pages aggressively (observed
# s-maxage=31536000 on Next.js's own headers), so a stale build can keep being
# served after a deploy unless purged. Optional -- .env credentials are not
# required to exist to demo/staging environment other people set up.
CF_TOKEN=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
CF_ZONE=$(grep -m1 '^CLOUDFLARE_ZONE_ID=' .env 2>/dev/null | cut -d= -f2-)
if [ -n "$CF_TOKEN" ] && [ -n "$CF_ZONE" ]; then
  curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE/purge_cache" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H 'Content-Type: application/json' \
    --data '{"purge_everything":true}'
  echo "Purged Cloudflare cache."
else
  echo "CLOUDFLARE_API_TOKEN/CLOUDFLARE_ZONE_ID not set -- skipping cache purge."
fi
