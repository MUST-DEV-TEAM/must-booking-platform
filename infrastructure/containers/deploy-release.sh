#!/usr/bin/env bash
# Deploys one commit of main from the images the Deploy workflow pushed to GHCR:
# backup, pull, migrate, restart, health check, and roll the containers back to the
# previous release if the new one does not come up healthy.
#
# Usage: deploy-release.sh <commit-sha> [registry-user]
# A GHCR read token may be passed on stdin (the Deploy workflow sends its short-lived
# GITHUB_TOKEN); without one, the images must be public or already logged in.
#
# Migrations are not rolled back. Keep them backward compatible with the previous
# release (add columns and tables first, drop them in a later release).
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
SHA="${1:-}"
REGISTRY_USER="${2:-must-deploy}"
STATE_FILE="$PWD/.deployed-release"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4011/api/health}"

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: deploy-release.sh <40-character commit sha> [registry-user]" >&2
  exit 2
fi
if [[ ! "$REGISTRY_USER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "Invalid registry user." >&2
  exit 2
fi

if [ -z "${DEPLOY_RELEASE_CHECKED_OUT:-}" ]; then
  if foreign_path=$(find "$REPO_ROOT" -xdev ! -uid "$(id -u)" -print -quit 2>/dev/null) && [ -n "$foreign_path" ]; then
    echo "Refusing to deploy: checkout contains a path not owned by $(id -un): $foreign_path" >&2
    exit 1
  fi

  if [ ! -t 0 ]; then
    token="$(cat)"
    if [ -n "$token" ]; then
      printf '%s' "$token" | docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null
      echo "Logged in to ghcr.io."
    fi
  fi

  git -C "$REPO_ROOT" fetch --quiet origin main
  if ! git -C "$REPO_ROOT" merge-base --is-ancestor "$SHA" origin/main; then
    echo "Refusing to deploy $SHA: it is not a commit on main." >&2
    exit 1
  fi
  # Releases from before this pipeline have no GHCR images or release tooling.
  if ! git -C "$REPO_ROOT" cat-file -e "$SHA:infrastructure/containers/compose.release.yaml" 2>/dev/null; then
    echo "Refusing to deploy $SHA: it predates the release pipeline, so it has no prebuilt images." >&2
    exit 1
  fi
  PREVIOUS_REF="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  git -C "$REPO_ROOT" checkout --quiet --detach "$SHA"
  # The checkout may just have replaced this file. Continue from the new version.
  export DEPLOY_RELEASE_CHECKED_OUT=1 PREVIOUS_REF
  exec bash "$REPO_ROOT/infrastructure/containers/deploy-release.sh" "$SHA" "$REGISTRY_USER" </dev/null
fi

release() { IMAGE_TAG="$1" docker compose -f compose.homelab.yaml -f compose.release.yaml --env-file .env "${@:2}"; }

healthy() {
  for _ in $(seq 1 36); do
    if curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    sleep 5
  done
  return 1
}

PREVIOUS_TAG="$(cat "$STATE_FILE" 2>/dev/null || true)"

# prepare: nothing user-facing has changed yet, so a failure only restores the checkout.
# swap: api/web may already run the new release, so a failure also restarts the previous one.
PHASE=prepare
finish() {
  local status=$?
  docker logout ghcr.io >/dev/null 2>&1 || true
  if [ "$status" -eq 0 ] || [ "$PHASE" = finished ]; then
    return
  fi
  set +e
  git -C "$REPO_ROOT" checkout --quiet --detach "$PREVIOUS_REF"
  if [ "$PHASE" = swap ]; then
    # Container logs stay on the server: they can contain guest details.
    echo "Release $SHA failed. Rolling back. See docker compose logs api web on the server." >&2
    if [ -n "$PREVIOUS_TAG" ]; then
      release "$PREVIOUS_TAG" up -d --no-build api web
    else
      docker compose -f compose.homelab.yaml --env-file .env up -d --no-build api web
    fi
    if healthy; then
      echo "Rolled back to ${PREVIOUS_TAG:-the previous local images}; the site is healthy." >&2
    else
      echo "Rollback is not healthy either. Check the server now." >&2
    fi
  else
    echo "Release $SHA failed before the restart; the running site was not changed." >&2
  fi
  exit 1
}
trap finish EXIT

purge_cdn_cache() {
  local token zone
  token=$(grep -m1 '^CLOUDFLARE_API_TOKEN=' .env 2>/dev/null | cut -d= -f2-) || true
  zone=$(grep -m1 '^CLOUDFLARE_ZONE_ID=' .env 2>/dev/null | cut -d= -f2-) || true
  if [ -n "$token" ] && [ -n "$zone" ]; then
    # Cloudflare edge-caches Next.js pages for up to a year, so a stale UI would survive the deploy.
    curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/$zone/purge_cache" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
      --data '{"purge_everything":true}' >/dev/null &&
      echo "Purged Cloudflare cache." ||
      echo "WARNING: Cloudflare cache purge failed." >&2
  fi
}

echo "Deploying $SHA (previous release: ${PREVIOUS_TAG:-none, locally built images})."

release "$SHA" pull api web

if systemctl cat must-booking-backup.service >/dev/null 2>&1; then
  echo "Backing up the database before migrating."
  sudo -n systemctl start must-booking-backup.service
else
  echo "WARNING: must-booking-backup.service is not installed; deploying without a fresh backup." >&2
fi

release "$SHA" up -d postgres redis
release "$SHA" run --rm api pnpm --filter api prisma migrate deploy
# After migrate (the role may have just been created) and before api starts.
release "$SHA" run --rm api pnpm --filter api db:set-app-password

PHASE=swap
release "$SHA" up -d --no-build api web
healthy

PHASE=finished
echo "$SHA" >"$STATE_FILE"
release "$SHA" ps
purge_cdn_cache
docker image prune -af --filter 'until=240h' >/dev/null || true
echo "Deployed $SHA."
