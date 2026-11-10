#!/usr/bin/env bash
# Sourced only by reviewed restore/install scripts after manifest authentication.
capture_restore_access() {
  local directory="$1"
  # The owner CLI stays uid10001. The only additional writable host mount is
  # this freshly created private temporary directory, never the live ledger.
  [[ ! -e "$directory" && ! -L "$directory" ]] || die "The current-access capture directory must be new."
  install -d -m 0700 -o 10001 -g 10001 "$directory"
  dc run-existing --rm --no-deps --pull never -T \
    --volume "$directory:/recovery:rw" migrate \
    node --import tsx /app/scripts/restore-security.ts capture --output=/recovery/access.json >&2
}

apply_restore_security() {
  local directory="${1:-}" isolated_database="${2:-}" require_applied="${3:-0}"
  local result_file status=0
  local options=() arguments=(apply)
  if [[ -n "$directory" ]]; then
    [[ -f "$directory/access.json" && ! -L "$directory/access.json" ]] || die "The current access policy capture is missing."
    options+=(--volume "$directory:/recovery:ro")
    arguments+=(--access=/recovery/access.json)
  fi
  [[ -z "$isolated_database" ]] || options+=(-e "PRIVACY_RESTORE_DATABASE=$isolated_database")
  result_file="$(mktemp /tmp/idealmakoo-restore-security.XXXXXXXX)" || return 1
  if dc run-existing --rm --no-deps --pull never -T "${options[@]}" migrate \
    node --import tsx /app/scripts/restore-security.ts "${arguments[@]}" > "$result_file"; then
    status=0
  else
    status=$?
  fi
  if [[ "$status" == 0 || "$status" == 2 ]]; then
    if ! python3 "$PROJECT_ROOT/deploy/pending-restore.py" validate-security-output \
      "$result_file" "$status" "$require_applied" >&2; then status=1; fi
  fi
  rm -f -- "$result_file"
  return "$status"
}

restore_empty_database() {
  local payload="$1" database="$2" isolated="${3:-0}" existing
  existing="$(dc exec -T db psql --username=postgres --dbname="$database" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  [[ "$existing" == 0 ]] || die "Restoring requires an empty target database; existing tables were not overwritten."
  dc exec -T db pg_restore --list < "$payload/database.dump" > "$payload/restore-list.raw"
  python3 "$PROJECT_ROOT/deploy/backup-archive.py" restore-list "$payload/restore-list.raw" "$payload/restore-list.txt"
  RESTORE_TOC="/tmp/idealmakoo-restore-$$-$RANDOM.list"
  # shellcheck disable=SC2016
  dc exec -T db sh -eu -c 'umask 077; cat > "$1"' sh "$RESTORE_TOC" < "$payload/restore-list.txt"
  dc exec -T db psql --username=postgres --dbname="$database" -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null
  dc exec -T db pg_restore --username=postgres --role=idealmakoo_owner --dbname="$database" \
    --no-owner --no-privileges --no-comments --use-list="$RESTORE_TOC" --exit-on-error < "$payload/database.dump"
  dc exec -T db rm -f -- "$RESTORE_TOC"
  RESTORE_TOC=""
  local override=()
  [[ "$isolated" == 0 ]] || override=(-e "PRIVACY_RESTORE_DATABASE=$database")
  if [[ -f "$payload/database-inventory.json" ]]; then
    dc run-existing --rm --no-deps --pull never -T "${override[@]}" migrate \
      node /app/deploy/backup-inventory.mjs > "$payload/restored-inventory.json"
    python3 "$PROJECT_ROOT/deploy/backup-archive.py" compare-inventory \
      "$payload/database-inventory.json" "$payload/restored-inventory.json" >&2
  fi
  dc run-existing --rm --no-deps --pull never -T "${override[@]}" migrate node /app/deploy/grant-runtime.mjs
  dc run-existing --rm --no-deps --pull never -T "${override[@]}" app node /app/deploy/verify-runtime-role.mjs >&2
}

restore_media_payload() {
  local payload="$1" replace="${2:-0}"
  # All tar members were authenticated and validated before this command.
  if [[ "$replace" == 1 ]]; then
    dc --profile operations run-existing --rm --no-deps --pull never -T --entrypoint /bin/sh storage-tool \
      -eu -c 'find /app/storage -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; exec tar --no-same-owner -C /app/storage -xf -' < "$payload/storage.tar"
  else
    dc --profile operations run-existing --rm --no-deps --pull never -T storage-tool \
      --no-same-owner -C /app/storage -xf - < "$payload/storage.tar"
  fi
  dc --profile operations run-existing --rm --no-deps --pull never -T storage-tool \
    -C /app/storage -cf - . | python3 "$PROJECT_ROOT/deploy/backup-archive.py" verify-storage-stream "$payload/storage.tar" >&2
}
