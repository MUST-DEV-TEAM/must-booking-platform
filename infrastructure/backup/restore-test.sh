#!/usr/bin/env bash
# Weekly restore test: proves the newest off-site backup can be restored.
#
# Downloads the newest must-booking-*.dump from BACKUP_REMOTE, restores it into a throwaway
# database in the Postgres container, compares row counts of a few key tables with the live
# database, then drops the throwaway database. Exits non-zero on any failure, so the systemd
# OnFailure alert fires. Nothing here writes to the live database.
# Setup: infrastructure/backup/README.md ("Weekly restore test").
#
# Settings (environment, or /etc/must-booking/backup.env when run by the systemd unit):
#   BACKUP_REMOTE           rclone remote holding the dumps (required, same as the backup)
#   PG_CONTAINER            Docker container running Postgres (required)
#   PG_USER / PG_DATABASE   superuser and live database (default must_booking / must_booking)
#   RESTORE_TEST_DB         throwaway database name (default must_booking_restore_test)
#   RESTORE_TEST_FILE       restore this local dump instead of downloading (for testing the script)
#   RESTORE_TOLERANCE_BASE      rows a table may differ by regardless of age (default 50)
#   RESTORE_TOLERANCE_PER_HOUR  extra rows allowed per hour since the dump (default 20)
#   RESTORE_MAX_AGE_HOURS   fail if the newest dump is older than this (default 36)
set -euo pipefail

: "${PG_CONTAINER:?Set PG_CONTAINER, e.g. must-booking-postgres-1}"
PG_USER="${PG_USER:-must_booking}"
PG_DATABASE="${PG_DATABASE:-must_booking}"
RESTORE_TEST_DB="${RESTORE_TEST_DB:-must_booking_restore_test}"
BASE="${RESTORE_TOLERANCE_BASE:-50}"
PER_HOUR="${RESTORE_TOLERANCE_PER_HOUR:-20}"
MAX_AGE_HOURS="${RESTORE_MAX_AGE_HOURS:-36}"
TABLES=(bookings payments guests _prisma_migrations)

if [[ "$RESTORE_TEST_DB" == "$PG_DATABASE" || ! "$RESTORE_TEST_DB" =~ ^[a-z_][a-z0-9_]*$ ]]; then
  echo "RESTORE_TEST_DB must be a plain name different from the live database." >&2
  exit 2
fi

psql_in() { docker exec -i "$PG_CONTAINER" psql -X -v ON_ERROR_STOP=1 -U "$PG_USER" -tA "$@"; }
drop_test_db() { docker exec "$PG_CONTAINER" dropdb -U "$PG_USER" --if-exists "$RESTORE_TEST_DB" >/dev/null 2>&1 || true; }

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"; drop_test_db' EXIT

if [[ -n "${RESTORE_TEST_FILE:-}" ]]; then
  name="$(basename "$RESTORE_TEST_FILE")"
  dump="$RESTORE_TEST_FILE"
else
  : "${BACKUP_REMOTE:?Set BACKUP_REMOTE, e.g. must-backup-crypt:postgres}"
  # Names carry a UTC timestamp (must-booking-YYYY-MM-DDTHHMMSSZ.dump), so the last one sorted is the newest.
  name="$(rclone lsf --files-only --include 'must-booking-*.dump' "$BACKUP_REMOTE" | sort | tail -n 1)"
  if [[ -z "$name" ]]; then
    echo "No backup found in ${BACKUP_REMOTE}." >&2
    exit 1
  fi
  dump="${work}/${name}"
  rclone copyto "${BACKUP_REMOTE}/${name}" "$dump"
fi

# Age of the dump from its name; an unreadable name counts as too old.
stamp="$(sed -n 's/^must-booking-\([0-9-]*\)T\([0-9][0-9]\)\([0-9][0-9]\)\([0-9][0-9]\)Z\.dump$/\1 \2:\3:\4/p' <<<"$name")"
dumped_at="$(date -u -d "${stamp:-1970-01-01 00:00:00}" +%s 2>/dev/null || echo 0)"
hours=$(( ($(date -u +%s) - dumped_at) / 3600 ))
if (( hours > MAX_AGE_HOURS )); then
  echo "Newest backup ${name} is ${hours} hours old (limit ${MAX_AGE_HOURS})." >&2
  exit 1
fi

drop_test_db
docker exec "$PG_CONTAINER" createdb -U "$PG_USER" "$RESTORE_TEST_DB"
if ! docker exec -i "$PG_CONTAINER" pg_restore -U "$PG_USER" -d "$RESTORE_TEST_DB" \
  --no-owner --no-privileges --exit-on-error <"$dump"; then
  echo "pg_restore failed for ${name}." >&2
  exit 1
fi

allowed=$(( BASE + PER_HOUR * hours ))
failed=0
report=""
for table in "${TABLES[@]}"; do
  restored="$(psql_in -d "$RESTORE_TEST_DB" -c "SELECT count(*) FROM public.\"${table}\"")"
  live="$(psql_in -d "$PG_DATABASE" -c "SELECT count(*) FROM public.\"${table}\"")"
  diff=$(( live - restored ))
  report+=" ${table}=${restored}/${live}"
  if (( ${diff#-} > allowed )); then
    echo "Row count of ${table} differs too much: restored ${restored}, live ${live}, allowed ±${allowed}." >&2
    failed=1
  fi
done
if [[ "$(psql_in -d "$RESTORE_TEST_DB" -c 'SELECT count(*) > 0 FROM public."_prisma_migrations"')" != "t" ]]; then
  echo "The restored database has no migration history." >&2
  failed=1
fi
if (( failed )); then
  exit 1
fi

echo "Restore test passed: ${name} (${hours} h old) restored; restored/live rows:${report}."
