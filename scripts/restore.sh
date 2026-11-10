#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
# shellcheck source=deploy/recovery.sh
source "$PROJECT_ROOT/deploy/recovery.sh"
archive=""; mode=verify; confirm=""; restore_keys=0; allow_legacy=0; resume=0
while (( $# )); do
  case "$1" in
    --file) archive="${2:?Missing backup filename}"; shift 2 ;;
    --verify-only) mode=verify; shift ;;
    --drill) mode=drill; shift ;;
    --confirm-replace) mode=restore; confirm="${2:?Provide the exact Compose project name}"; shift 2 ;;
    --restore-keys) restore_keys=1; shift ;;
    --resume) resume=1; shift ;;
    --allow-legacy-format2) allow_legacy=1; shift ;;
    --help) printf '%s\n' 'Usage: bash scripts/restore.sh --file backup.tar.age [--verify-only | --drill | --confirm-replace idealmakoo [--restore-keys] [--resume]]' 'A failed replacement retains its original current-access checkpoint. --resume requires the same archive, release, project and --restore-keys choice; normal reruns refuse pending restores.' 'Default: authenticated complete format3/format4 only. --allow-legacy-format2 explicitly accepts independently verified historical data-only archives without sender authentication.'; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done
[[ -f "$archive" ]] || die "Supply --file with an existing encrypted backup."
require_environment; acquire_ops_lock
mail_writer=""; [[ "$(env_get MAIL_SERVER_MODE external)" != local ]] || mail_writer=1
retained_mail_dir="$(env_get MAIL_DATA_DIR)"; retained_mail_dir="${retained_mail_dir:-$(env_get INSTALL_ROOT /var/www/idealmakoo)/mail-server}"
[[ ! -e "$retained_mail_dir/.idealmakoo-mail.json" ]] || mail_writer=1
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
need age; need tar
project="$(env_get COMPOSE_PROJECT_NAME idealmakoo)"
[[ "$mode" != restore || "$confirm" == "$project" ]] || die "--confirm-replace must match project $project."
[[ "$resume" == 0 || "$mode" == restore ]] || die "--resume requires --confirm-replace with the original project name."
pending_directory="$(dirname "$ENV_FILE")/.pending-restore"
if (( resume )); then
  [[ -e "$pending_directory" || -L "$pending_directory" ]] || die "There is no pending same-host restore to resume."
else
  pending_restore assert-clear
fi
identity="${IDEALMAKOO_BACKUP_IDENTITY:-$(dirname "$ENV_FILE")/backup-identity.txt}"
[[ -f "$identity" ]] || die "Backup identity is missing."
(( (8#$(stat -c '%a' "$identity") & 8#077) == 0 )) || die "Backup identity must have mode 600."
work="$(mktemp -d "$(dirname "$ENV_FILE")/.restore.XXXXXXXX")"
drill_db=""
drill_created=0
restore_list="/tmp/idealmakoo-restore-$$-$RANDOM.list"
RESTORE_TOC=""
stop_writers_on_failure=0
checkpoint_owned=0
checkpoint_phase=""
safety_backup=""
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if [[ "$mode" == restore && "$result" != 0 && "$stop_writers_on_failure" == 1 ]]; then
    if lifecycle stop --timeout 90 app worker ${mail_writer:+mailserver} >/dev/null; then
      log "Restore stopped after an error. This project's app and worker are stopped; the database, persistent volumes and safety backup are retained for diagnosis."
    else
      log "ERROR: Restore failed and this project's app and worker could not be stopped. Check Docker access and stop these writers before allowing traffic or further recovery. The safety backup is preserved."
    fi
    if [[ "$checkpoint_owned" == 1 ]]; then
      pending_restore failure "$result" || log "The failure could not be appended to the private checkpoint; preserve it unchanged for diagnosis."
      log "The original current-access checkpoint remains in shared/.pending-restore. Use the same authenticated archive and restore.sh --resume; do not delete this checkpoint or recapture historical grants."
    fi
  fi
  if (( drill_created )); then
    if ! dc exec -T db dropdb --username=postgres --if-exists --force "$drill_db" >/dev/null; then
      log "ERROR: The isolated restore-drill database could not be removed. Inspect it before another drill."
      (( result != 0 )) || result=1
    fi
  fi
  dc exec -T db rm -f -- "$restore_list" >/dev/null 2>&1 || true
  [[ -z "$RESTORE_TOC" ]] || dc exec -T db rm -f -- "$RESTORE_TOC" >/dev/null 2>&1 || true
  if ! rm -rf -- "$work"; then
    log "ERROR: Temporary restore files could not be fully removed. Retain them privately for diagnosis."
    (( result != 0 )) || result=1
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if (( resume )); then
  # A previous process may have died after temporarily starting writers. Close
  # that window before archive validation, including on an invalid retry.
  stop_writers_on_failure=1
  lifecycle stop --timeout 90 app worker ${mail_writer:+mailserver} >/dev/null
fi
python3 "$PROJECT_ROOT/deploy/backup-archive.py" preflight-decryption "$archive" "$work"
age --decrypt --identity "$identity" --output "$work/archive.tar" "$archive"
mkdir "$work/verified"
backup_release="$(python3 "$PROJECT_ROOT/deploy/backup-archive.py" unpack "$work/archive.tar" "$work/verified" "$identity")"
python3 "$PROJECT_ROOT/deploy/backup-archive.py" restore-policy "$work/verified" "$identity" "$allow_legacy"
dc exec -T db pg_restore --list < "$work/verified/database.dump" > "$work/archive-list.txt"
python3 "$PROJECT_ROOT/deploy/backup-archive.py" restore-list "$work/archive-list.txt" "$work/restore-list.txt"
privacy_cli verify-anchor --anchor - < "$work/verified/privacy-anchor.json" > /dev/null
expected_inventory="$(python3 "$PROJECT_ROOT/deploy/backup-archive.py" inventory "$work/verified" "$identity")"
if [[ "$mode" == verify ]]; then
  log "Encryption, checksums, database archive, safe media and the current independent privacy ledger anchor verified. No restore was executed."
  exit 0
fi
# The positional parameter expands only inside the database container.
# shellcheck disable=SC2016
dc exec -T db sh -eu -c 'umask 077; cat > "$1"' sh "$restore_list" < "$work/restore-list.txt"
restore_database() {
  dc exec -T db createdb --username=postgres --owner=idealmakoo_owner "$1"
  [[ "$mode" != drill ]] || drill_created=1
  local isolated=0
  [[ "$mode" != drill ]] || isolated=1
  restore_empty_database "$work/verified" "$1" "$isolated"
  IFS='|' read -r migration_count relation_count table_count < <(database_inventory "$1")
  [[ "$migration_count|$relation_count" == "$expected_inventory" ]] || die "Restored schema inventory differs from the checked manifest."
}
if [[ "$mode" == drill ]]; then
  capture_restore_access "$work/security"
  drill_db="idealmakoo_drill_$(date -u +%s)_$RANDOM"
  restore_database "$drill_db"
  dc run-existing --rm --no-deps --pull never -T -e "PRIVACY_RESTORE_DATABASE=$drill_db" migrate \
    node --import tsx /app/scripts/privacy-ledger.ts replay --anchor - < "$work/verified/privacy-anchor.json" > /dev/null
  apply_restore_security "$work/security" "$drill_db"
  dc run-existing --rm --no-deps --pull never -T -e "PRIVACY_RESTORE_DATABASE=$drill_db" migrate \
    node --import tsx /app/scripts/privacy-ledger.ts ready
  mkdir "$work/drill-storage"
  python3 "$PROJECT_ROOT/deploy/backup-archive.py" extract-storage "$work/verified/storage.tar" "$work/drill-storage"
  if [[ -f "$work/verified/mail-manifest.json" ]]; then python3 "$PROJECT_ROOT/deploy/mail-data.py" drill --payload "$work/verified"; fi
  record_recovery restore-drill "$archive" "$started" "$backup_release" "$migration_count" "$table_count" true restore-script >&2
  log "Restore drill passed: isolated database, row/structure/sequence fingerprints for complete backups, exact media bytes, limited runtime grants, current access policy, historical authentication revocation, independent erasure replay and readiness verified. Live application data was unchanged."
  exit 0
fi
[[ "$backup_release" == "$(release_id)" ]] || die "Backup release $backup_release differs from this release $(release_id). Run this restore from the matching release directory."
if (( resume )); then
  checkpoint_phase="$(pending_restore validate-retry "$archive" "$backup_release" "$restore_keys")"
  checkpoint_owned=1
fi
mapfile -t required_images < <(dc config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); print("\n".join(sorted({v["image"] for s,v in c["services"].items() if s in ("app","worker","proxy","mailserver")})))')
(( ${#required_images[@]} >= 1 )) || die "Unable to identify the release images."
for required_image in "${required_images[@]}"; do
  docker image inspect "$required_image" >/dev/null || die "Required release image is missing: $required_image. Build or load it before restoring."
done
key_args=()
if [[ "$checkpoint_phase" != security-applied && "$restore_keys" == 1 ]]; then key_args+=(--allow-different); fi
python3 "$PROJECT_ROOT/deploy/env-file.py" restore-keys "$work/verified/environment.env" "$ENV_FILE" "${key_args[@]}"
if (( resume == 0 )); then
  log "Taking a safety backup before replacing this project's database and media."
  safety_backup="$(bash "$PROJECT_ROOT/scripts/backup.sh")"
  stop_writers_on_failure=1
  lifecycle stop --timeout 90 app worker ${mail_writer:+mailserver} >/dev/null
  # Capture after writers stop. Publish those exact bytes durably before DROP,
  # outside temporary cleanup, so a retry can never capture historical grants.
  capture_restore_access "$work/security"
  pending_restore prepare "$archive" "$backup_release" "$restore_keys" "$work/security" "$safety_backup"
  checkpoint_owned=1
  checkpoint_phase=prepared
fi
db_name="$(database_name)"
if [[ "$checkpoint_phase" == prepared ]]; then
  if (( restore_keys )); then
    python3 "$PROJECT_ROOT/deploy/env-file.py" restore-keys "$work/verified/environment.env" "$ENV_FILE" --apply
  fi
  # A failed predecessor may have dropped the DB without creating it again.
  dc exec -T db dropdb --username=postgres --if-exists --force "$db_name"
  restore_database "$db_name"
  restore_media_payload "$work/verified" 1
  if [[ -f "$work/verified/mail-manifest.json" ]]; then python3 "$PROJECT_ROOT/deploy/mail-data.py" restore --env-file "$ENV_FILE" --payload "$work/verified"; fi
elif [[ "$checkpoint_phase" == security-applied ]]; then
  log "Resuming the verified security phase. Existing database, media, keys and explicit owner account recovery are retained."
  IFS='|' read -r migration_count relation_count table_count < <(database_inventory "$db_name")
  [[ "$migration_count" =~ ^[0-9]+$ && "$relation_count" =~ ^[0-9]+$ && "$table_count" =~ ^[0-9]+$ ]] || die "Cannot obtain the current restored database inventory."
else
  die "The pending restore has no supported recovery phase."
fi
privacy_cli replay --anchor - < "$work/verified/privacy-anchor.json" > /dev/null
security_status=0
require_applied=0
[[ "$checkpoint_phase" != security-applied ]] || require_applied=1
if apply_restore_security "$pending_directory" "" "$require_applied"; then
  security_status=0
else
  security_status=$?
fi
if [[ "$security_status" == 0 || "$security_status" == 2 ]]; then
  # Exit 2 has committed security changes too. Persist this before any owner
  # recovery, so a retry cannot rewind its newly provisioned password or MFA.
  pending_restore security-applied
  checkpoint_phase=security-applied
else
  exit "$security_status"
fi
if [[ "$security_status" == 2 ]]; then
  log "Security reconciliation committed but no active senior administrator remains. Review the protected env, explicitly recover the chosen owner-managed staff account, then repeat this command with --resume."
  exit 2
fi
privacy_cli ready
mail_enabled=""; [[ "$(env_get MAIL_SERVER_MODE external)" != local ]] || mail_enabled=1
lifecycle up --timeout 1200 app worker proxy ${mail_enabled:+mailserver}
bash "$PROJECT_ROOT/scripts/check-health.sh" 240
record_recovery restore-replace "$archive" "$started" "$backup_release" "$migration_count" "$table_count" true restore-script >&2
managed_root="$(dirname "$(dirname "$ENV_FILE")")"
if [[ "$ENV_FILE" == "$managed_root/shared/.env" && "$PROJECT_ROOT" == "$managed_root/releases/"* && -L "$managed_root/current" ]]; then
  previous_release="$(readlink -f "$managed_root/current")"
  if [[ "$previous_release" != "$PROJECT_ROOT" ]]; then
    ln -s "$previous_release" "$managed_root/.previous.restore.$$"
    mv -Tf "$managed_root/.previous.restore.$$" "$managed_root/previous"
    ln -s "$PROJECT_ROOT" "$managed_root/.current.restore.$$"
    mv -Tf "$managed_root/.current.restore.$$" "$managed_root/current"
  fi
fi
pending_restore clear
checkpoint_owned=0
stop_writers_on_failure=0
log "The selected backup was restored successfully."
