#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

MEDIA_DIR="${MEDIA_DIR:-/data/media}"
SCRATCH="${SCRATCH_DIR:-/scratch}"
STATUS_FILE="${BACKUP_STATUS_FILE:-/status/last-backup.json}"
DUMP_FILE="$SCRATCH/db.dump"
BOOTSTRAP_SQL="/usr/local/share/zayn/db-bootstrap/0000_roles.sql"

CURRENT_STEP="startup"

log_info() {
  printf '%s\n' "$*"
}

prepare_scratch() {
  mkdir -p "$SCRATCH"
  if [ -n "${RESTIC_CACHE_DIR:-}" ]; then
    mkdir -p "$RESTIC_CACHE_DIR"
  fi
  if [ -n "${TMPDIR:-}" ]; then
    mkdir -p "$TMPDIR"
  fi
}

healthcheck_ping() {
  local suffix="${1:-}"
  [ -n "${HEALTHCHECK_PING_URL:-}" ] || return 0

  local base="${HEALTHCHECK_PING_URL%/}"
  # Best effort, 5 second timeout. Never print the URL or curl's error text.
  curl -fsS -m 5 -o /dev/null "${base}${suffix}" >/dev/null 2>&1 || true
}

on_error() {
  local code=$?
  trap - ERR
  printf 'backup failed at step: %s (exit %s)\n' "$CURRENT_STEP" "$code" >&2
  healthcheck_ping "/fail"
  exit "$code"
}
trap on_error ERR

require_env() {
  local name="$1"

  if [ -z "${!name:-}" ]; then
    printf 'required environment variable %s is missing\n' "$name" >&2
    return 1
  fi
}

assert_major_match() {
  local dump_bin="${PG_DUMP_BIN:-pg_dump}"
  local dump_major="${PG_DUMP_MAJOR:-}"
  local server_major="${SERVER_MAJOR:-}"

  if [ -z "$dump_major" ]; then
    dump_major="$(
      "$dump_bin" --version 2>/dev/null |
        sed -nE 's/.* ([0-9]+)(\.[0-9]+)*.*/\1/p' |
        head -n 1
    )"
  fi

  if [ -z "$server_major" ]; then
    server_major="$(
      psql --no-password -X -A -t \
        -c "SELECT current_setting('server_version_num')::int / 10000"
    )"
  fi

  dump_major="${dump_major//[^0-9]/}"
  server_major="${server_major//[^0-9]/}"

  if [ -z "$dump_major" ] || [ -z "$server_major" ]; then
    printf 'could not determine the pg_dump or PostgreSQL server major version\n' >&2
    return 1
  fi

  if [ "$dump_major" != "$server_major" ]; then
    printf 'pg_dump major version %s does not match PostgreSQL server major version %s; refusing to create an incompatible dump\n' \
      "$dump_major" "$server_major" >&2
    return 1
  fi

  PG_DUMP_MAJOR_RESOLVED="$dump_major"
  SERVER_MAJOR_RESOLVED="$server_major"
}

repo_ready() {
  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  prepare_scratch

  if restic cat config >/dev/null 2>&1; then
    return 0
  fi

  case "$RESTIC_REPOSITORY" in
    /* | ./* | ../*)
      if [ -e "$RESTIC_REPOSITORY/config" ]; then
        printf 'cannot open the restic repository; check RESTIC_PASSWORD (the repository already exists)\n' >&2
        return 1
      fi
      mkdir -p "$RESTIC_REPOSITORY"
      restic init
      ;;
    *)
      printf 'cannot open the restic repository; initialize a new remote repository once with "restic init", otherwise check RESTIC_PASSWORD and RESTIC_REPOSITORY\n' >&2
      return 1
      ;;
  esac
}

backup_summary_field() {
  local file="$1"
  local field="$2"
  local summary

  summary="$(jq -c 'select(.message_type == "summary")' "$file" | tail -n 1)"

  if [ -z "$summary" ]; then
    return 1
  fi

  printf '%s' "$summary" | jq -r --arg field "$field" '.[$field] // empty'
}

newest_snapshot_id() {
  local tag="$1"
  local run_tag="$2"

  restic snapshots --json --tag "$tag" --tag "$run_tag" |
    jq -r 'sort_by(.time) | last | .id // empty'
}

do_backup() {
  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  require_env PGHOST || return 1
  require_env PGUSER || return 1
  require_env PGDATABASE || return 1
  require_env PGPASSWORD || return 1

  local started_ms ended_ms duration_ms
  local run_tag dump_bytes db_snapshot db_added
  local media_snapshot media_added media_bytes
  local keep_daily="${BACKUP_KEEP_DAILY:-7}"
  local keep_weekly="${BACKUP_KEEP_WEEKLY:-4}"
  local keep_monthly="${BACKUP_KEEP_MONTHLY:-6}"

  for pair in \
    "BACKUP_KEEP_DAILY:$keep_daily" \
    "BACKUP_KEEP_WEEKLY:$keep_weekly" \
    "BACKUP_KEEP_MONTHLY:$keep_monthly"; do
    local name="${pair%%:*}"
    local value="${pair#*:}"

    if ! [[ "$value" =~ ^[0-9]+$ ]]; then
      printf '%s must be a non-negative integer\n' "$name" >&2
      return 1
    fi
  done

  started_ms="$(date +%s%3N)"
  run_tag="run-$(date -u +%Y%m%dT%H%M%SZ)"

  CURRENT_STEP="asserting pg_dump and PostgreSQL major versions match"
  assert_major_match

  CURRENT_STEP="opening the restic repository"
  repo_ready

  CURRENT_STEP="dumping the database in custom format"
  rm -f "$DUMP_FILE"
  pg_dump --no-password -Fc --no-owner --no-privileges --file="$DUMP_FILE"
  pg_restore --list "$DUMP_FILE" >/dev/null
  dump_bytes="$(stat -c %s "$DUMP_FILE")"

  CURRENT_STEP="backing up the database dump to restic"
  restic backup --json --host "${RESTIC_HOST:-zayn-stack}" \
    --tag db --tag "$run_tag" "$DUMP_FILE" \
    >"$SCRATCH/db-backup.json"
  db_snapshot="$(backup_summary_field "$SCRATCH/db-backup.json" snapshot_id || true)"
  db_added="$(backup_summary_field "$SCRATCH/db-backup.json" data_added || true)"

  if [ -z "$db_snapshot" ]; then
    db_snapshot="$(newest_snapshot_id db "$run_tag")"
  fi

  if [ -z "$db_snapshot" ]; then
    printf 'could not determine the database snapshot id\n' >&2
    return 1
  fi

  db_added="${db_added:-0}"

  CURRENT_STEP="backing up the media volume to restic"
  restic backup --json --host "${RESTIC_HOST:-zayn-stack}" \
    --tag media --tag "$run_tag" "$MEDIA_DIR" \
    >"$SCRATCH/media-backup.json"
  media_snapshot="$(backup_summary_field "$SCRATCH/media-backup.json" snapshot_id || true)"
  media_added="$(backup_summary_field "$SCRATCH/media-backup.json" data_added || true)"
  media_bytes="$(backup_summary_field "$SCRATCH/media-backup.json" total_bytes_processed || true)"

  if [ -z "$media_snapshot" ]; then
    media_snapshot="$(newest_snapshot_id media "$run_tag")"
  fi

  if [ -z "$media_snapshot" ]; then
    printf 'could not determine the media snapshot id\n' >&2
    return 1
  fi

  media_added="${media_added:-0}"
  media_bytes="${media_bytes:-0}"

  CURRENT_STEP="applying restic retention"
  restic forget --prune \
    --keep-daily "$keep_daily" \
    --keep-weekly "$keep_weekly" \
    --keep-monthly "$keep_monthly"

  CURRENT_STEP="checking restic repository metadata"
  restic check

  if [ -n "${BACKUP_READ_DATA_SUBSET:-}" ]; then
    CURRENT_STEP="checking restic repository data subset ${BACKUP_READ_DATA_SUBSET}"
    restic check --read-data-subset="$BACKUP_READ_DATA_SUBSET"
  fi

  CURRENT_STEP="writing the backup status file"
  ended_ms="$(date +%s%3N)"
  duration_ms=$((ended_ms - started_ms))

  mkdir -p "$(dirname "$STATUS_FILE")"
  jq -n \
    --arg last_success "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg run_tag "$run_tag" \
    --arg db_snapshot "$db_snapshot" \
    --arg media_snapshot "$media_snapshot" \
    --arg restic_version "$(restic version | head -n 1)" \
    --arg pg_dump_version "$(pg_dump --version | head -n 1)" \
    --argjson dump_bytes "$dump_bytes" \
    --argjson db_added "$db_added" \
    --argjson media_bytes "$media_bytes" \
    --argjson media_added "$media_added" \
    --argjson duration_ms "$duration_ms" \
    '{
      last_success: $last_success,
      run_tag: $run_tag,
      db_snapshot: $db_snapshot,
      media_snapshot: $media_snapshot,
      dump_bytes: $dump_bytes,
      db_added: $db_added,
      media_bytes: $media_bytes,
      media_added: $media_added,
      duration_ms: $duration_ms,
      restic_version: $restic_version,
      pg_dump_version: $pg_dump_version
    }' >"$STATUS_FILE.tmp"
  mv "$STATUS_FILE.tmp" "$STATUS_FILE"
  chmod 0640 "$STATUS_FILE"

  local summary
  summary="$(
    jq -c '{
      run_tag,
      db_snapshot,
      media_snapshot,
      dump_bytes,
      db_added,
      media_bytes,
      media_added,
      duration_ms
    }' "$STATUS_FILE"
  )"

  printf 'BACKUP_SUMMARY %s\n' "$summary"
  printf 'backup ok: run=%s db=%s media=%s database=%sB media=%sB added_total=%sB duration=%sms\n' \
    "$run_tag" "$db_snapshot" "$media_snapshot" "$dump_bytes" "$media_bytes" \
    "$((db_added + media_added))" "$duration_ms"

  healthcheck_ping
}

do_list() {
  CURRENT_STEP="listing restic snapshots"
  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  prepare_scratch
  restic snapshots
}

do_snapshots_json() {
  CURRENT_STEP="listing restic snapshots as JSON"
  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  prepare_scratch
  restic snapshots --json
}

do_status() {
  CURRENT_STEP="reading the backup status file"

  if [ ! -f "$STATUS_FILE" ]; then
    printf 'no backup status file has been written yet\n' >&2
    return 1
  fi

  cat "$STATUS_FILE"
}

do_check() {
  CURRENT_STEP="checking restic repository metadata"
  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  prepare_scratch
  restic check
}

do_init() {
  CURRENT_STEP="initializing the restic repository"
  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  prepare_scratch
  restic init
}

do_restore_db() {
  local snapshot="${1:-}"
  local target_db="${2:-}"

  if [ -z "$snapshot" ] || [ -z "$target_db" ]; then
    printf 'usage: restore-db <snapshot> <database>\n' >&2
    return 1
  fi

  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  require_env PGHOST || return 1
  require_env PGUSER || return 1
  prepare_scratch

  CURRENT_STEP="restoring the database dump from restic"
  rm -f "$SCRATCH/restore.dump"
  restic dump "$snapshot" "$DUMP_FILE" >"$SCRATCH/restore.dump"
  pg_restore --list "$SCRATCH/restore.dump" >/dev/null

  CURRENT_STEP="applying the role bootstrap to ${target_db}"
  PGDATABASE="$target_db" psql --no-password -X -v ON_ERROR_STOP=1 \
    -f "$BOOTSTRAP_SQL" >/dev/null

  CURRENT_STEP="restoring the database into ${target_db}"
  PGDATABASE="$target_db" pg_restore --no-password \
    --no-owner --clean --if-exists --single-transaction \
    --dbname="$target_db" "$SCRATCH/restore.dump"

  printf 'database restore complete\n'
}

do_restore_media() {
  local snapshot="${1:-}"

  if [ -z "$snapshot" ]; then
    printf 'usage: restore-media <snapshot>\n' >&2
    return 1
  fi

  require_env RESTIC_REPOSITORY || return 1
  require_env RESTIC_PASSWORD || return 1
  prepare_scratch

  local target="${RESTORE_TARGET:-/restore-target}"

  if [ ! -d "$target" ]; then
    printf 'media restore target %s does not exist\n' "$target" >&2
    return 1
  fi

  CURRENT_STEP="checking the media restore target is empty"
  local nonempty
  nonempty="$(
    find "$target" -mindepth 1 -maxdepth 1 ! -name lost+found \
      -print -quit 2>/dev/null || true
  )"

  if [ -n "$nonempty" ] && [ "${RESTORE_ALLOW_NONEMPTY:-0}" != "1" ]; then
    printf 'media restore target %s is not empty; refusing to overwrite it (the live restore flow sets RESTORE_ALLOW_NONEMPTY=1 only after confirmation)\n' \
      "$target" >&2
    return 1
  fi

  CURRENT_STEP="restoring the media snapshot from restic"
  rm -rf "$SCRATCH/restore-media"
  mkdir -p "$SCRATCH/restore-media"
  restic restore "$snapshot" --target "$SCRATCH/restore-media"

  CURRENT_STEP="copying restored media into the target"
  if [ ! -d "$SCRATCH/restore-media$MEDIA_DIR" ]; then
    printf 'the media snapshot did not contain %s\n' "$MEDIA_DIR" >&2
    return 1
  fi

  if [ "${RESTORE_ALLOW_NONEMPTY:-0}" = "1" ]; then
    find "$target" -mindepth 1 -maxdepth 1 ! -name lost+found \
      -exec rm -rf {} +
  fi

  cp -a "$SCRATCH/restore-media$MEDIA_DIR/." "$target/"
  printf 'media restore complete\n'
}

main() {
  local command="${1:-backup}"
  shift || true

  case "$command" in
    backup) do_backup "$@" ;;
    list) do_list "$@" ;;
    snapshots-json) do_snapshots_json "$@" ;;
    status) do_status "$@" ;;
    check) do_check "$@" ;;
    init) do_init "$@" ;;
    restore-db) do_restore_db "$@" ;;
    restore-media) do_restore_media "$@" ;;
    version)
      restic version
      pg_dump --version
      psql --version
      ;;
    *)
      printf 'usage: zayn-backup <backup|list|snapshots-json|status|check|init|restore-db|restore-media|version>\n' >&2
      return 1
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
