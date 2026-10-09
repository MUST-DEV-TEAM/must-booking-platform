#!/usr/bin/env bash
# Forced command for the GitHub Actions deploy key (authorized_keys "command=").
# The key can only run a release deploy or an ops action, never a shell.
set -euo pipefail
cd "$(dirname "$0")"
read -r -a args <<<"${SSH_ORIGINAL_COMMAND:-}"
case "${args[0]:-}" in
  deploy) exec ./deploy-release.sh "${args[1]:-}" "${args[2]:-}" ;;
  ops) exec ./ops.sh "${args[1]:-}" ;;
  *)
    echo "Refused. This key only runs 'deploy <sha> <user>' or 'ops <action>'." >&2
    exit 2
    ;;
esac
