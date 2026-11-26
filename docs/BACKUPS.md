# Backups and restore

This page is for the developer today and for the shop owner later. It describes
the encrypted backups of the PostgreSQL database and the media volume, how to
run them, and how to restore after a lost server. Scheduling on the VPS is
Phase 12; this phase provides and tests the one-shot commands.

## Read this first: the encryption password

Backups are encrypted by [restic](https://restic.net/). The repository is
unreadable without `RESTIC_PASSWORD`.

- `RESTIC_PASSWORD` must be stored in the client's password manager.
- Do not store it only on the VPS. If the VPS is lost, the password is lost
  with it.
- Keep an offline copy (paper or an offline password-manager export).
- Losing `RESTIC_PASSWORD` means every backup is unreadable. There is no
  recovery and no support backdoor.
- `.env.compose` is **not** included in the backups. It contains the database,
  admin, storefront, Stripe, and restic secrets. The developer and the owner
  must keep an offline copy of the values they need, separately from the VPS.

The repository itself contains encrypted data. An attacker who copies the
repository still needs `RESTIC_PASSWORD` to read it.

## What is backed up

| Item | How | Notes |
| --- | --- | --- |
| PostgreSQL database | `pg_dump -Fc --no-owner --no-privileges`, verified with `pg_restore --list`, then restic snapshot tagged `db` | One snapshot per backup run |
| Media volume (`/data/media`) | restic snapshot tagged `media` | Mounted read-only in the backup container |
| Pairing | Both snapshots get the same `run-YYYYMMDDTHHMMSSZ` tag | Restore the pair, not one half |

`pg_dump` is PostgreSQL 16, the same major version as the stack server. The
backup script checks the `pg_dump` major version against the server and fails
before dumping if they differ. A dump from a different major could not be
restored reliably.

The database dump and the media snapshot are taken one after the other, not at
the same instant. A few seconds of drift between them is acceptable: a product
row and its image can differ by a few seconds during the backup. Do not run
uploads or big admin changes during the backup if that matters.

## What is not backed up

- `.env.compose` and any other secret file.
- Caddy logs, Docker logs, Docker images, and the Caddy configuration.
- The restic repository password itself.
- Anything outside the PostgreSQL database and the `media` volume.
- The local `/repo` Docker volume is a development convenience. It is on the
  same server, so it is **not** an off-server backup. Use an S3-compatible
  bucket or sftp for a real backup.

## Repository options (costs UNVERIFIED)

`RESTIC_REPOSITORY` accepts a local path, an S3-compatible bucket, or sftp.

| Option | Example | Notes |
| --- | --- | --- |
| Local development | `/repo` | A Docker volume. Not off-server. |
| S3-compatible | `s3:https://s3.us-west-004.backblazeb2.com/zayn-backups` | Also set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`. Works with Backblaze B2, Cloudflare R2, and provider object storage in S3 mode. |
| sftp | `sftp:backup@host:/srv/restic/zayn` | The backup image includes the OpenSSH client. You must provide a key or agent in a later VPS setup step. |

Costs, request pricing, and free tiers change. They were **not verified** here.
Check the provider's current pricing before choosing. A small shop database and
a small media library usually fit comfortably in a low-cost bucket. Test the
provider's S3 compatibility with `restic init` and one backup before relying on
it.

For a new **remote** repository, initialize it once:

```powershell
docker compose -p zayn -f docker-compose.stack.yml --env-file .env.compose `
  --profile backup run --rm backup init
```

A local `/repo` repository is initialized automatically on the first backup.

## Retention

After every backup the script runs:

```text
restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6
```

The values come from `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_WEEKLY`, and
`BACKUP_KEEP_MONTHLY`. The newest snapshot is always kept. A snapshot can be
kept by more than one rule, so the actual count is usually a little higher than
the daily number.

The stable restic host name (`RESTIC_HOST`, default `zayn-stack`) is important:
without it, every one-shot container would look like a different host and
retention would never remove old snapshots.

## Commands

All commands are PowerShell-friendly and use `.env.compose`.

```powershell
# One-shot backup against the running zayn stack.
pnpm docker:backup:run

# List snapshots.
pnpm docker:backup:list

# List backup pairs and restore the latest pair into throwaway targets.
pnpm docker:restore

# Run the full backup and restore drill.
pnpm docker:backup:drill
```

`docker:backup:run` refuses unless the stack is up and `RESTIC_PASSWORD` and
`RESTIC_REPOSITORY` are set in `.env.compose`. It never prints either value.

After a successful run a small status file is written to the `backup-status`
Docker volume at `/status/last-backup.json`. It contains the last success time,
the run tag, the two snapshot ids, the dump and media sizes, the duration, and
the restic/pg_dump versions. It contains no secrets.

If `HEALTHCHECK_PING_URL` is set, a successful backup GETs the URL. A failed
backup GETs the same URL with `/fail` appended. The request is best effort, has
a 5 second timeout, and the URL is never printed. A healthchecks.io-style URL
works.

A backup run fails loudly with a non-zero exit code and a line naming the failed
step. It never prints database or restic credentials.

## Restore

### Safe default: restore into throwaway targets

```powershell
# Restore the latest db/media pair into a fresh PostgreSQL container and a
# fresh media Docker volume. The live database and media are never touched.
pnpm docker:restore

# Choose a run tag (see `pnpm docker:backup:list`).
pnpm docker:restore -- --run run-20260101T020000Z

# Or provide one snapshot; the script pairs the other half by its run tag.
pnpm docker:restore -- --snapshot 1a2b3c4d

# Restore media into an empty Docker volume.
pnpm docker:restore -- --media-target zayn-restore-media-manual

# List backup pairs only.
pnpm docker:restore -- --list
```

A non-live restore:

1. Starts a fresh `postgres:16` container on the stack network with a fresh
   data volume and trust authentication. It is not published and is not the
   live database.
2. Runs the same `db-bootstrap/0000_roles.sql` the migrations use, so the `anon`
   and `authenticated` roles exist.
3. Restores the dump with `pg_restore --no-owner --clean --if-exists`.
4. Restores the media snapshot into a fresh volume (or an empty directory).
5. Prints how to inspect the restored database and how to clean up.

The script refuses a non-empty media directory unless it is the confirmed live
flow.

### Live restore after a lost server

This is the dangerous path. It restores over the live database and live media
volume. The script refuses to continue unless:

- the `api` and `web` containers are stopped;
- the live `postgres` container is running;
- you type the exact word `RESTORE-LIVE`.

Step by step on a new VPS:

1. Install Docker and Docker Compose, and clone this repository.
2. Create `.env.compose` from `.env.compose.example` or from your offline copy.
   Keep the original `RESTIC_PASSWORD`. Set the new database credentials,
   admin secret, storefront key, Stripe values, and `RESTIC_REPOSITORY`. Never
   commit or print this file.
3. Start the stack once so the network and empty database exist:
   `pnpm docker:stack:up`. The empty database is migrated automatically.
4. Stop the application containers so nothing writes during the restore:

   ```powershell
   docker compose -p zayn -f docker-compose.stack.yml --env-file .env.compose stop api web
   ```

5. Run the confirmed live restore:

   ```powershell
   pnpm docker:restore -- --into-live
   ```

   When prompted, type `RESTORE-LIVE`.

6. Start the application again:

   ```powershell
   docker compose -p zayn -f docker-compose.stack.yml --env-file .env.compose start api web
   ```

7. Check `/health` (it must report `db: true`), open the storefront, log into
   the admin with the restored owner account, and load a product image.
8. If something is wrong, do not run the live restore again blindly. Use the
   safe restore into throwaway targets and inspect it first.

The media restore replaces the contents of the live media volume. Stop the API
and web containers first; otherwise uploads and reads can race with the
restore.

## Test it every month

Run the drill on the first of every month, or after changing the backup
configuration:

```powershell
pnpm docker:backup:drill
```

The drill uses throwaway project `zayn-drill` and removes every container,
network, volume, and temp env file it creates. It:

- brings up the stack, migrates, seeds categories, creates an owner, logs in
  through the edge, creates an active product, and uploads `hero-1.jpg`;
- records row counts for every table with rows, the migration count, and the
  media sha256;
- runs the backup and checks the `db`/`media` snapshots and the shared run tag;
- runs a second backup and checks deduplication and retention;
- deletes the product row and the media file;
- restores into a fresh PostgreSQL container and a fresh media volume;
- compares every row count, the migration count, and the media sha256;
- starts the API against the restored data and checks `/health`, the public
  products endpoint, and the media URL;
- tests a wrong `RESTIC_PASSWORD`, an unreachable repository, a pg_dump/server
  major mismatch, and a corrupted pack file;
- checks that no secret appears in captured output or the status file;
- inspects the backup container to prove non-root, read-only media, dropped
  capabilities, no-new-privileges, read-only root, and no published ports.

The drill prints PASS/FAIL per assertion and a final summary. It is the proof
that the backup is real, not just a file copy.

## Phase 12: scheduling on the VPS

Scheduling is **not** implemented in this phase. Phase 12 will add a systemd
timer that calls:

```text
docker compose -p zayn -f <repo>/docker-compose.stack.yml \
  --env-file <repo>/.env.compose --profile backup run --rm backup
```

Recommended systemd shape:

- `zayn-backup.service` is `Type=oneshot`, runs as the deploy user, has the
  repository as `WorkingDirectory`, and uses `ExecStart` with the command above.
- `zayn-backup.timer` runs daily (for example `OnCalendar=*-*-* 02:30:00` with
  `Persistent=true`) so a missed run happens after the server comes back.
- The service should have a timeout and should send failure notifications
  through `HEALTHCHECK_PING_URL` or systemd's `OnFailure`.
- Rotate or cap the Docker json-file logs as the stack already does.
- Run the drill monthly and after any change to the backup or restore scripts.

## Untested / uncertain

- Real Backblaze B2, Cloudflare R2, and VPS object-storage behavior (S3
  compatibility, request costs, and large uploads) was not tested here.
- Large media libraries and long backup windows were not tested; only a small
  drill dataset was.
- Windows development uses Docker Desktop. Host-path media targets and file
  permissions differ from a Linux VPS. Prefer Docker named volumes on Windows.
- Restic memory use on a very small VPS was not measured.
- Restore time for a large database or media volume was not measured.
- The systemd timer belongs to Phase 12 and is not part of this repository yet.
