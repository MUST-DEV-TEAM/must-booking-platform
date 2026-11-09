#!/usr/bin/env bash
# Fixed maintenance actions for the Ops workflow. Only the actions below exist, and
# none of them print application logs (they can contain guest details).
# Usage: ops.sh status|health|sentry|restart-api|restart-web|backup-now|cleanup|disk-check
set -euo pipefail
cd "$(dirname "$0")"

STATE_FILE="$PWD/.deployed-release"
TAG="$(cat "$STATE_FILE" 2>/dev/null || true)"
compose() {
  if [ -n "$TAG" ]; then
    IMAGE_TAG="$TAG" docker compose -f compose.homelab.yaml -f compose.release.yaml --env-file .env "$@"
  else
    docker compose -f compose.homelab.yaml --env-file .env "$@"
  fi
}

case "${1:-}" in
  status)
    echo "Deployed release: ${TAG:-none (locally built images)}"
    compose ps
    df -h /
    docker system df
    ;;
  health)
    curl -fsS --max-time 10 http://127.0.0.1:4011/api/health
    echo
    ;;
  sentry)
    # Shows which Sentry project each service reports to: the project id only,
    # never the key part of the DSN. web falls back to apps/web/sentry.dsn.ts when unset.
    for service in api web; do
      dsn="$(compose exec -T "$service" printenv SENTRY_DSN 2>/dev/null || true)"
      if [ -n "$dsn" ]; then echo "$service: Sentry project ${dsn##*/}"; else echo "$service: SENTRY_DSN not set"; fi
    done
    ;;
  restart-api) compose restart api ;;
  restart-web) compose restart web ;;
  backup-now) sudo -n systemctl start must-booking-backup.service && echo "Backup finished." ;;
  cleanup)
    docker image prune -af --filter 'until=240h'
    docker builder prune -af
    df -h /
    ;;
  disk-check)
    # Fails when the server disk is nearly full, so the scheduled Server watch workflow goes red before a
    # deploy or the database runs into a full disk (it did on 2026-11-09). Alert level: DISK_ALERT_PERCENT.
    limit="${DISK_ALERT_PERCENT:-80}"
    used="$(df --output=pcent / | tail -n 1 | tr -dc '0-9')"
    free="$(df -h --output=avail / | tail -n 1 | tr -d ' ')"
    echo "Disk: ${used}% used, ${free} free (alert at ${limit}%)."
    if [ -f /var/run/reboot-required ]; then echo "Note: the server has updates waiting for a reboot."; fi
    if [ "$used" -ge "$limit" ]; then
      echo "ALERT: the server disk is ${used}% full. Run the Ops cleanup action, then look at what is growing." >&2
      docker system df || true
      exit 1
    fi
    ;;
  *)
    echo "Unknown action. Use status, health, sentry, restart-api, restart-web, backup-now, cleanup or disk-check." >&2
    exit 2
    ;;
esac
