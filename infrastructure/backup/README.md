# Nightly database backup and weekly restore test

`backup-postgres.sh` dumps the MUST Booking PostgreSQL database every night and uploads it to an [rclone](https://rclone.org) remote. It also keeps a local copy and checks the dump is readable and the upload is complete. Remote copies older than 30 days and local copies older than 7 days are deleted. `restore-test.sh` restores the newest remote copy into a throwaway database every week and fails (with an alert email) if it cannot.

The script works with any rclone remote. Today that is Google Drive, a stopgap with little free space. The professional destination is an S3-compatible bucket on a different provider than the server, with versioning and a retention lock (section 3b, GitHub issue #370). Switching is one line, `BACKUP_REMOTE` in `/etc/must-booking/backup.env` (see `backup.env.example`).

The dump contains guest names, emails and phone numbers, so it is encrypted before it leaves the server (rclone `crypt`). The storage provider sees only scrambled file names and contents.

Run these steps on the production server as root. Nothing here changes the database. `pg_dump` only reads.

## 1. Install rclone

```sh
curl https://rclone.org/install.sh | sudo bash
rclone version
```

## 2. Connect Google Drive

The server has no browser, so the Google sign-in happens on your own computer.

1. Install rclone on your computer as well (https://rclone.org/downloads/).
2. On the server, run `rclone config` and answer:
   - `n` (new remote), name: `gdrive`
   - Storage: `drive` (Google Drive)
   - client_id / client_secret: leave empty
   - scope: `3` (`drive.file`: rclone sees only files it created)
   - service_account_file: leave empty. Advanced config: `n`
   - Use web browser to authenticate: `n`. rclone prints a command like `rclone authorize "drive" "..."`.
3. Run that command on your computer and sign in with the Google account that should hold the backups. Paste the token it prints back into the server prompt.
4. Shared drive: `n`. Then `y` to keep the remote.

## 3. Add encryption on top

Still in `rclone config`:

- `n`, name: `must-backup-crypt`
- Storage: `crypt`
- remote: `gdrive:must-booking-backups`
- filename_encryption: `standard`. directory_name_encryption: `true`
- Password: `y`, type a long password. Salt password: `y`, type a second one.

**Save both passwords in your password manager now.** Without them the backups cannot be decrypted, and nobody (including Google) can recover them. `/root/.config/rclone/rclone.conf` holds them too, so keep that file private and copy it somewhere safe off the server.

Check it works:

```sh
echo test | rclone rcat must-backup-crypt:check.txt && rclone cat must-backup-crypt:check.txt && rclone delete must-backup-crypt:check.txt
```

## 3b. Professional destination: S3-compatible bucket (issue #370)

Use a bucket on a different provider than the server (for example Backblaze B2, Wasabi, Hetzner or Scaleway object storage), used only for these backups. In the provider's console:

- Create the bucket with **versioning on** and **object lock** (retention lock) in compliance or governance mode, default retention **at least 30 days**. A copy then cannot be changed or deleted before it is 30 days old, even with the server's key. Add a lifecycle rule that removes old versions after 60 days.
- Create an access key limited to that bucket that can **write and list objects but not delete object versions** (no `DeleteObjectVersion`, no bucket-policy or lock changes). A stolen server key can then add files, but not destroy the history.
- Turn on the hosting provider's server snapshots as a second, independent layer.

On the server, `rclone config`:

- `n`, name: `must-backup-s3`. Storage: `s3`. Provider: the one you chose. `env_auth`: `false`. Paste the access key and secret. Region and endpoint as the provider shows them.
- `n`, name: `must-backup-s3-crypt`. Storage: `crypt`. remote: `must-backup-s3:<bucket name>/must-booking`. filename_encryption `standard`, directory_name_encryption `true`. Use the **same two passwords** as `must-backup-crypt`, so one set of passwords opens every copy.

Example result in `/root/.config/rclone/rclone.conf` (values elided; rclone writes them):

```ini
[must-backup-s3]
type = s3
provider = <provider>
access_key_id = ...
secret_access_key = ...
endpoint = <provider endpoint>
no_check_bucket = true

[must-backup-s3-crypt]
type = crypt
remote = must-backup-s3:<bucket name>/must-booking
filename_encryption = standard
directory_name_encryption = true
password = ...
password2 = ...
```

`no_check_bucket = true` lets a key without bucket-creation rights upload. Check it with the same `rcat`/`cat` line as above, using `must-backup-s3-crypt:` (the test file stays until the lock expires; that is expected). Then switch `BACKUP_REMOTE=must-backup-s3-crypt:postgres` in `/etc/must-booking/backup.env`. On a locked bucket, the script's 30-day prune only hides old copies; the lifecycle rule removes them.

## 4. Configure the backup

`backup.env.example` lists every setting. By hand:

```sh
docker ps --format '{{.Names}}' | grep postgres   # note the Postgres container name
mkdir -p /etc/must-booking
cat >/etc/must-booking/backup.env <<'ENV'
BACKUP_REMOTE=must-backup-crypt:postgres
PG_CONTAINER=<postgres container name from above>
ENV
chmod 600 /etc/must-booking/backup.env
```

If Postgres runs directly on the server or as a managed database instead of in Docker, replace `PG_CONTAINER` with `BACKUP_DATABASE_URL=postgresql://must_backup@<host>:5432/must_booking`, and keep the password out of the URL:

- The tables force row-level security, so the backup role must bypass it. Create a dedicated read-only role once (as a superuser): `CREATE ROLE must_backup LOGIN BYPASSRLS PASSWORD '<long random>'; GRANT pg_read_all_data TO must_backup;`. Some managed databases don't allow `BYPASSRLS`; there, use their own snapshot backups instead.
- Put the password in root's `~/.pgpass` as `<host>:5432:must_booking:must_backup:<password>` and run `chmod 600 ~/.pgpass`.
- `pg_dump`, `pg_restore` and `psql` on the server must be version 17 or newer.

The script refuses a URL that contains a password, and it refuses a role that can't bypass row-level security. Optional settings (`LOCAL_KEEP_DAYS`, `REMOTE_KEEP_DAYS`, `BACKUP_LOCAL_DIR`) are listed at the top of the script.

## 5. Run it once by hand

The systemd unit expects the repository at `/opt/must-booking`. Adjust `ExecStart` in the `.service` file if it lives elsewhere.

```sh
set -a; . /etc/must-booking/backup.env; set +a
/opt/must-booking/infrastructure/backup/backup-postgres.sh
rclone ls must-backup-crypt:postgres
```

You should see `Backup must-booking-<date>.dump (... bytes) uploaded`. A nonzero exit means the dump, the readability check or the upload check failed, and the message says which.

## 6. Schedule it nightly

```sh
cp /opt/must-booking/infrastructure/backup/must-booking-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now must-booking-backup.timer
systemctl list-timers must-booking-backup.timer      # next run is ~03:15 server time
journalctl -u must-booking-backup.service -n 20      # result of the last run
```

## 7. Weekly restore test

`restore-test.sh` takes the newest dump from `BACKUP_REMOTE`, restores it into `must_booking_restore_test` inside the Postgres container, compares the row counts of `bookings`, `payments`, `guests` and `_prisma_migrations` with the live database (allowed difference: 50 rows plus 20 per hour since the dump), and drops the throwaway database. It also fails if the newest dump is older than 36 hours. It only reads the live database. The weekly unit has `OnFailure=must-booking-alert@%n.service` built in, so a failure emails the platform admin (see [../ops](../ops/README.md)).

One-time host steps:

```sh
cp /opt/must-booking/infrastructure/backup/must-booking-restore-test.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl start must-booking-restore-test.service       # run once by hand
journalctl -u must-booking-restore-test.service -n 20   # expect "Restore test passed: ..."
systemctl enable --now must-booking-restore-test.timer  # Sundays ~05:00 server time
```

The restore needs free disk about the size of the live database for a few minutes. To check the script itself against a bad file, point `RESTORE_TEST_FILE` at a local dump (for example a truncated copy): it must exit non-zero.

## Restore

A backup only counts once a restore has worked. The weekly test above does this automatically; the steps below are the manual version.

The decrypted dump holds guest data, so keep it readable only by root and delete it even if a step fails:

```sh
umask 077
trap 'rm -f /tmp/restore.dump' EXIT
rclone ls must-backup-crypt:postgres                                   # pick a file
rclone copyto must-backup-crypt:postgres/<file>.dump /tmp/restore.dump
docker exec <postgres container> createdb -U must_booking restore_check
docker exec -i <postgres container> pg_restore -U must_booking -d restore_check --no-owner </tmp/restore.dump
docker exec <postgres container> psql -U must_booking -d restore_check -c 'select count(*) from bookings'
docker exec <postgres container> dropdb -U must_booking restore_check
```

Restoring over the live database is a production data change. Stop the `api` and `web` containers first, restore into a fresh database, and only switch over once it checks out.
