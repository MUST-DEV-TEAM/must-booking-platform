#!/usr/bin/env bash
# Production deploy entry point for booking.must.al.
#
# Installed as /usr/local/sbin/must-deploy and used as the *forced command* of the
# GitHub Actions SSH key in root's authorized_keys, so that key can run exactly
# these subcommands and nothing else:
#
#   load            read a `docker save | gzip` stream on stdin and `docker load` it
#   deploy <sha>    migrate and switch api+web to images tagged <sha>, health-check,
#                   roll back to the previous images automatically if unhealthy
#   rollback        switch back to the previously deployed images
#   status          print the deployed and previous commit
#
# Images are built in GitHub Actions (this host has 1 vCPU / 1 GB RAM). Database
# migrations are forward-only: a rollback restores the previous app images but
# not the previous schema; a pre-deploy dump is kept in $BACKUP_DIR for that case.
set -euo pipefail

REPO=${REPO:-/root/must-booking-platform}
COMPOSE_DIR=$REPO/infrastructure/containers
STATE_DIR=${STATE_DIR:-/var/lib/must-deploy}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/must-booking/pre-deploy}
PG_CONTAINER=${PG_CONTAINER:-must-booking-postgres-1}
API_HEALTH=${API_HEALTH:-http://127.0.0.1:4010/health}
WEB_HEALTH=${WEB_HEALTH:-http://127.0.0.1:4011/}
KEEP_RELEASES=3

if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  # shellcheck disable=SC2086 # split the forced-command arguments on purpose
  set -- $SSH_ORIGINAL_COMMAND
fi
mkdir -p "$STATE_DIR"
exec 9>"$STATE_DIR/lock"
flock -w 900 9 || { echo "Another deploy is running." >&2; exit 1; }

compose() { (cd "$COMPOSE_DIR" && docker compose -f compose.homelab.yaml --env-file .env "$@"); }
current() { cat "$STATE_DIR/current" 2>/dev/null || true; }
previous() { cat "$STATE_DIR/previous" 2>/dev/null || true; }

# Releases are tagged by commit; the images running before this pipeline existed
# are tagged `pre-pipeline` and have no commit to check out.
checkout_if_sha() {
  [[ $1 =~ ^[0-9a-f]{40}$ ]] && git -C "$REPO" checkout --quiet -B main "$1" || true
}

healthy() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS -m 5 -o /dev/null "$API_HEALTH" && curl -fsS -m 5 -o /dev/null "$WEB_HEALTH"; then
      return 0
    fi
    sleep 4
  done
  return 1
}

switch_to() {
  local tag=$1
  docker tag "must-booking-api:$tag" must-booking-api:latest
  docker tag "must-booking-web:$tag" must-booking-web:latest
  compose up -d --no-build api web
}

prune_releases() {
  local image keep
  keep="$(current) $(previous)"
  for image in must-booking-api must-booking-web; do
    docker images "$image" --format '{{.Tag}} {{.CreatedAt}}' |
      grep -E '^[0-9a-f]{40} ' | sort -k2 -r | awk '{print $1}' | tail -n +$((KEEP_RELEASES + 1)) |
      while read -r tag; do
        case " $keep " in *" $tag "*) continue ;; esac
        docker rmi "$image:$tag" >/dev/null && echo "Removed old image $image:$tag"
      done
  done
  docker image prune -f >/dev/null
}

cmd_deploy() {
  local sha=$1 old
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "deploy needs a full commit SHA" >&2; exit 2; }
  docker image inspect "must-booking-api:$sha" "must-booking-web:$sha" >/dev/null
  old=$(current)

  # Same compose file and migrations as the images being deployed.
  git -C "$REPO" fetch --quiet origin main
  git -C "$REPO" checkout --quiet -B main "$sha"

  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
  docker exec "$PG_CONTAINER" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$BACKUP_DIR/before-${sha:0:12}.dump"
  find "$BACKUP_DIR" -name 'before-*.dump' -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r rm -f

  docker tag "must-booking-api:$sha" must-booking-api:latest
  compose run --rm --no-deps api pnpm --filter api prisma migrate deploy
  # Must follow every migrate and precede the api restart (see README).
  compose run --rm --no-deps api pnpm --filter api db:set-app-password
  switch_to "$sha"

  if healthy; then
    [ -n "$old" ] && [ "$old" != "$sha" ] && echo "$old" > "$STATE_DIR/previous"
    echo "$sha" > "$STATE_DIR/current"
    prune_releases
    echo "Deployed $sha"
    return 0
  fi

  echo "Health check failed for $sha" >&2
  compose logs --tail 80 api web >&2 || true
  if [ -n "$old" ] && docker image inspect "must-booking-api:$old" >/dev/null 2>&1; then
    echo "Rolling back to $old" >&2
    switch_to "$old"
    checkout_if_sha "$old"
    healthy && echo "Rollback to $old is healthy" >&2 || echo "Rollback is ALSO unhealthy" >&2
  fi
  exit 1
}

cmd_rollback() {
  local prev cur
  prev=$(previous)
  cur=$(current)
  [ -n "$prev" ] || { echo "No previous release recorded." >&2; exit 1; }
  switch_to "$prev"
  checkout_if_sha "$prev"
  healthy || { echo "Rolled back to $prev but it is unhealthy." >&2; exit 1; }
  echo "$prev" > "$STATE_DIR/current"
  echo "$cur" > "$STATE_DIR/previous"
  echo "Rolled back to $prev"
}

case "${1:-}" in
  load) gunzip | docker load ;;
  deploy) cmd_deploy "${2:-}" ;;
  rollback) cmd_rollback ;;
  status) echo "current=$(current) previous=$(previous)" ;;
  *) echo "usage: must-deploy load|deploy <sha>|rollback|status" >&2; exit 2 ;;
esac
