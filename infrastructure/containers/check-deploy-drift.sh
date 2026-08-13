#!/usr/bin/env bash
# Thin cron/systemd-timer entrypoint. The Node implementation is also directly
# testable on every supported development platform.
set -euo pipefail
REPO_ROOT="${DEPLOY_REPOSITORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
exec node "$REPO_ROOT/infrastructure/containers/check-deploy-drift.mjs"
