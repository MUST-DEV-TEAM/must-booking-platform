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
| DB backup ([../backup](../backup/README.md)) | `must-booking-backup.{service,timer}` (03:15 UTC), `/etc/must-booking/backup.env` with `BACKUP_REMOTE=must-backup-crypt:postgres` (rclone `crypt` over `gdrive:must-booking-backups`, as in the backup README; the owner holds both passwords) and `PG_CONTAINER=must-booking-postgres-1` |

The release pipeline's one-time server setup was done on 2026-10-09: `deploy` user (docker
group, sudo only for `systemctl start must-booking-backup.service`), checkout `/opt/must-booking`,
`ssh-gate.sh` key, `production` environment secrets and `DEPLOY_ENABLED=true`. The first pipeline
deploy (`eb09721`, run 37914544337) passed its health check. The old checkout in
`/root/must-booking-platform` is no longer used by deploys.

SSH password logins are still enabled (`PasswordAuthentication yes`, `PermitRootLogin yes`).
The 2026-10-09 auth logs show only key logins, so turning passwords off is low risk. It is
left on by the owner's decision (2026-10-09).
