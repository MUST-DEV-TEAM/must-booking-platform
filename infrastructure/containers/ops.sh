#!/usr/bin/env bash
# Fixed maintenance actions for the Ops workflow. Only the actions below exist, and
# none of them print application logs (they can contain guest details).
# Usage: ops.sh status|health|restart-api|restart-web|backup-now|cleanup
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
  restart-api) compose restart api ;;
  restart-web) compose restart web ;;
  backup-now) sudo -n systemctl start must-booking-backup.service && echo "Backup finished." ;;
  cleanup)
    docker image prune -af --filter 'until=240h'
    docker builder prune -af
    df -h /
    ;;
  *)
    echo "Unknown action. Use status, health, restart-api, restart-web, backup-now or cleanup." >&2
    exit 2
    ;;
esac
