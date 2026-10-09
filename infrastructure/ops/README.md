# Host scripts for booking.must.al

Small host-level jobs that sit next to the [release pipeline](../containers/README.md#release-pipeline-booking-must-al)
and the [database backup](../backup/README.md). They are copies: after changing one here, install
it on the host again.

## UpdraftPlus backup sorting (`updraft-organize.py`)

UpdraftPlus on the client WordPress sites uploads every site's backup into the `UpdraftPlus`
folder of the backup Google Drive. Hourly (`updraft-organize.{service,timer}`), this script moves
each file older than 3 hours into `UpdraftPlus/<Site>/` and, per site and backup part (db,
plugins, themes, uploads, others, ...), moves older copies to the Drive trash once a newer copy
at least half the size exists. A much smaller newest copy usually means a failed upload, so the
older one is kept. `--dry-run` and `--move-only` are available.

UpdraftPlus's Restore button only sees its own folder: to restore a site from WordPress, move
that site's files back to the `UpdraftPlus` root first.

## Failure emails (`alert-email.sh`, `must-booking-alert@.service`)

`OnFailure=must-booking-alert@%n.service` emails `PLATFORM_ADMIN_EMAIL` through Resend (values
from the app's `.env`) with the unit's last log lines. Used by the sorter and, through
`must-booking-backup.service.d-override.conf`, by the database backup.

## Installed on the host (2026-10-09)

| What | Where |
| --- | --- |
| rclone 1.60 (apt), remote `gdrive`: full Drive scope on the backup Google account | `/root/.config/rclone/rclone.conf` |
| UpdraftPlus sorter | `/usr/local/sbin/updraft-organize`, `updraft-organize.{service,timer}` |
| Failure email | `/usr/local/sbin/must-booking-alert`, `must-booking-alert@.service` |
| DB backup ([../backup](../backup/README.md)) | `must-booking-backup.{service,timer}` (03:15 UTC), `/etc/must-booking/backup.env` with `BACKUP_REMOTE=gdrive:MUST Booking backups` (**not encrypted yet**) and `PG_CONTAINER=must-booking-postgres-1` |

Until the release pipeline's `/opt/must-booking` checkout exists, the backup drop-in on the host
also has `ExecStart=/usr/local/sbin/must-booking-backup`, a copy of `backup-postgres.sh` from main.
Remove that line once `/opt/must-booking` is in place.
