#!/usr/bin/env bash
# Nightly PostgreSQL backup to an rclone remote (for example an encrypted Google Drive folder).
#
# Dumps the database in pg_dump custom format, keeps a local copy, uploads it, checks the
# uploaded size matches, then prunes copies older than the retention windows.
# Setup and restore steps: infrastructure/backup/README.md.
#
# Settings (environment, or /etc/must-booking/backup.env when run by the systemd unit):
#   BACKUP_REMOTE          rclone destination, e.g. "must-backup-crypt:postgres" (required)
#   PG_CONTAINER           Docker container running Postgres, e.g. "containers-postgres-1".
#                          Set this OR BACKUP_DATABASE_URL.
#   BACKUP_DATABASE_URL    postgresql:// URL for a host-installed pg_dump (owner role, not the app role)
#   PG_USER / PG_DATABASE  user and database inside the container (default must_booking / must_booking)
#   BACKUP_LOCAL_DIR       local copy directory (default /var/backups/must-booking)
#   LOCAL_KEEP_DAYS        days of local copies to keep (default 7)
#   REMOTE_KEEP_DAYS       days of remote copies to keep (default 30)
set -euo pipefail

: "${BACKUP_REMOTE:?Set BACKUP_REMOTE, e.g. must-backup-crypt:postgres}"
PG_USER="${PG_USER:-must_booking}"
PG_DATABASE="${PG_DATABASE:-must_booking}"
BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/must-booking}"
LOCAL_KEEP_DAYS="${LOCAL_KEEP_DAYS:-7}"
REMOTE_KEEP_DAYS="${REMOTE_KEEP_DAYS:-30}"

if [[ -z "${PG_CONTAINER:-}" && -z "${BACKUP_DATABASE_URL:-}" ]]; then
  echo "Set PG_CONTAINER or BACKUP_DATABASE_URL." >&2
  exit 2
fi

umask 077
mkdir -p "$BACKUP_LOCAL_DIR"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
name="must-booking-${stamp}.dump"
file="${BACKUP_LOCAL_DIR}/${name}"
partial="${file}.partial"
trap 'rm -f "$partial"' EXIT

if [[ -n "${PG_CONTAINER:-}" ]]; then
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DATABASE" -Fc --no-owner >"$partial"
else
  pg_dump "$BACKUP_DATABASE_URL" -Fc --no-owner >"$partial"
fi

# A dump pg_restore cannot read is not a backup. In container mode use the container's own
# pg_restore: the host's may be an older major version that cannot read a Postgres 17 dump.
if [[ -n "${PG_CONTAINER:-}" ]]; then
  docker exec -i "$PG_CONTAINER" pg_restore --list <"$partial" >/dev/null
else
  pg_restore --list "$partial" >/dev/null
fi
mv "$partial" "$file"
size="$(stat -c %s "$file")"

rclone copyto "$file" "${BACKUP_REMOTE}/${name}"
remote_size="$(rclone size --json "${BACKUP_REMOTE}/${name}" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
if [[ "$remote_size" != "$size" ]]; then
  echo "Upload check failed: local ${size} bytes, remote ${remote_size:-missing} bytes." >&2
  exit 1
fi

find "$BACKUP_LOCAL_DIR" -maxdepth 1 -name 'must-booking-*.dump' -mtime "+${LOCAL_KEEP_DAYS}" -delete
rclone delete --min-age "${REMOTE_KEEP_DAYS}d" --include 'must-booking-*.dump' "$BACKUP_REMOTE"

echo "Backup ${name} (${size} bytes) uploaded to ${BACKUP_REMOTE}."
