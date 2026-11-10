#!/usr/bin/env bash
# Stops only this project's writers for a coordinated database/media snapshot.
set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
output=""; stream=0
while (( $# )); do
  case "$1" in
    --output) output="${2:?Missing output archive path}"; shift 2 ;;
    --stdout) stream=1; shift ;;
    --help) printf '%s\n' 'Usage: sudo bash scripts/backup.sh [--output /absolute/site.tar.age] [--stdout]' 'Complete encrypted website, database, media, configuration, integration files and disaster-recovery ledger. --stdout emits only encrypted bytes; logs stay on stderr.'; exit 0 ;;
    *) die "Unknown backup option: $1" ;;
  esac
done
require_environment
acquire_ops_lock
pending_restore assert-clear
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
need age; need age-keygen; need sha256sum; need tar; need openssl
backup_dir="${IDEALMAKOO_BACKUP_DIR:-$(dirname "$ENV_FILE")/backups}"
identity="${IDEALMAKOO_BACKUP_IDENTITY:-$(dirname "$ENV_FILE")/backup-identity.txt}"
[[ -f "$identity" ]] || die "Missing backup identity: $identity. Generate it with age-keygen -o this-path and chmod 600."
(( (8#$(stat -c '%a' "$identity") & 8#077) == 0 )) || die "Backup identity must have mode 600."
if [[ -n "$output" ]]; then
  [[ "$output" == /* && "$output" == *.tar.age ]] || die "--output must be an absolute .tar.age filename."
  [[ ! -e "$output" && ! -L "$output" ]] || die "The output archive already exists; choose a new filename."
  [[ ! -e "$output.sha256" && ! -L "$output.sha256" ]] || die "The output checksum already exists; choose a new archive filename."
  backup_dir="$(dirname "$output")"
  [[ -d "$backup_dir" && "$(realpath "$backup_dir")" == "$backup_dir" ]] || die "The output parent must be an existing real directory without symlinks."
else
  mkdir -p "$backup_dir"
  [[ "$(realpath "$backup_dir")" == "$backup_dir" ]] || die "Backup directory cannot traverse symlinks."
  chmod 700 "$backup_dir"
fi
work="$(mktemp -d "$backup_dir/.snapshot.XXXXXXXX")"
archive="${output:-$backup_dir/idealmakoo-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4).tar.age}"
# Keep the small, private identity snapshot outside the payload directory so a
# full-disk failure can free its large temporary files before resuming services.
runtime_snapshot="$work.runtime.json"
writers_stopped=0
resume_attempted=0
cleanup() {
  local result=$? resume_result=0
  trap - EXIT INT TERM
  # Release temporary disk space before restarting writers after a full-disk or
  # partial-snapshot failure. The published encrypted archive lives outside it.
  if ! rm -rf -- "$work"; then
    log "ERROR: Temporary backup files could not be fully removed. Continuing the bounded service resumption attempt."
    (( result != 0 )) || result=1
  fi
  if (( writers_stopped && ! resume_attempted )); then
    resume_attempted=1
    if lifecycle start --snapshot "$runtime_snapshot" --timeout 1200 >/dev/null; then
      writers_stopped=0
    else
      resume_result=$?
      # Retain the original snapshot/dump error if resumption also failed.
      (( result != 0 )) || result=$resume_result
    fi
  fi
  if (( writers_stopped )); then
    log "ERROR: The original service subset could not be verified ready. Its private container-identity snapshot is retained at $runtime_snapshot. Resolve the startup error before retrying resumption."
  else
    if ! rm -f -- "$runtime_snapshot"; then
      log "ERROR: The private service snapshot could not be removed after verified resumption."
      (( result != 0 )) || result=1
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# A failed Docker observation must abort before any writer is stopped or any
# database/media snapshot begins. Empty successful selections remain valid.
lifecycle snapshot --output "$runtime_snapshot" --timeout 30
# A container retains its immutable image identity after its tag is moved or
# removed. Validate the actual local image before pausing any service; a tag is
# only descriptive release metadata, never authority for a backup helper.
container_image_id() {
  local container="$1" service="$2" image_id inspected
  image_id="$(docker inspect --format '{{ .Image }}' "$container")" \
    || die "Unable to observe the deployed $service image identity."
  [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] \
    || die "The deployed $service image identity is invalid."
  inspected="$(docker image inspect --format '{{ .Id }}' "$image_id" 2>/dev/null)" \
    || die "The deployed $service image is unavailable locally; preserve or recover that exact image before backup."
  [[ "$inspected" == "$image_id" ]] \
    || die "The deployed $service image identity could not be verified locally."
  printf '%s\n' "$image_id"
}
# Inspect the actual deployed container. A restore can invoke this script from
# an older release, so the caller's directory is not authoritative evidence.
app_container="$(dc ps --all --quiet app)"
[[ -n "$app_container" && "$app_container" != *$'\n'* ]] || die "A single deployed app container is required to identify this backup's release."
active_release="$(docker inspect --format '{{ index .Config.Labels "com.idealmakoo.release" }}' "$app_container")"
active_image="$(docker inspect --format '{{ .Config.Image }}' "$app_container")"
active_image_id="$(container_image_id "$app_container" app)"
active_source="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$app_container")"
[[ "$active_release" =~ ^[a-zA-Z0-9._-]+$ && "$active_release" != '<no value>' ]] || die "The active container has no valid release label; its code version cannot be verified."
[[ "$active_image" =~ ^[a-zA-Z0-9._:/@-]+$ ]] || die "The active image reference is invalid."
# The matching deployed runtime validates its ledger and storage format.
[[ -d "$active_source" && "$(realpath "$active_source")" == "$active_source" ]] || die "The deployed source directory is unavailable or traverses a symlink."
[[ -f "$active_source/.release.env" && "$(python3 "$PROJECT_ROOT/deploy/env-file.py" get "$active_source/.release.env" RELEASE_SHA)" == "$active_release" ]] || die "The deployed source release does not match the running image."
export IDEALMAKOO_OBSERVED_APP_IMAGE="$active_image_id"
printf 'RELEASE_SHA=%s\nAPP_IMAGE=%s\n' "$active_release" "$active_image" > "$work/release.env"
proxy_container="$(dc ps --all --quiet proxy)"
if [[ -n "$proxy_container" && "$proxy_container" != *$'\n'* ]]; then
  proxy_image="$(docker inspect --format '{{ .Config.Image }}' "$proxy_container")"
  proxy_image_id="$(container_image_id "$proxy_container" proxy)"
  [[ "$proxy_image" =~ ^[a-zA-Z0-9._:/@-]+$ ]] || die "The active proxy image reference is invalid."
  printf 'PROXY_IMAGE=%s\n' "$proxy_image" >> "$work/release.env"
  export IDEALMAKOO_OBSERVED_PROXY_IMAGE="$proxy_image_id"
fi
[[ -n "${proxy_image:-}" ]] || die "A deployed proxy image is required for complete backup."
database_container="$(dc ps --all --quiet db)"
[[ -n "$database_container" && "$database_container" != *$'\n'* ]] || die "A single deployed database is required."
database_reference="$(docker inspect --format '{{ .Config.Image }}' "$database_container")" \
  || die "Unable to observe the deployed database repository reference."
database_image_id="$(container_image_id "$database_container" database)"
# An upgrade pulls the database tag before taking its safety backup. Resolve
# all digests from the running container's image, never the new tag. Containerd
# can synthesize digests for unrelated local aliases: select only its deployed
# repository. Registry publication and retention remain recovery prerequisites;
# observing a local digest does not prove remote availability.
database_repo_digests="$(docker image inspect --format '{{json .RepoDigests}}' "$database_image_id" 2>/dev/null)" \
  || die "Unable to observe the deployed database image's registry digests."
database_image="$(printf '%s' "$database_repo_digests" \
  | python3 "$PROJECT_ROOT/deploy/backup-image-reference.py" "$database_reference")"
python3 "$PROJECT_ROOT/deploy/backup-archive.py" pack-tree "$active_source" "$work/source.tar" source
writers_stopped=1
lifecycle stop --snapshot "$runtime_snapshot" --timeout 90 >/dev/null
log "Creating a consistent database and storage snapshot."
privacy_cli head > "$work/privacy-anchor.json"
dc run-existing --rm --no-deps --pull never -T migrate node /app/deploy/backup-inventory.mjs > "$work/database-inventory.json"
IFS='|' read -r migration_count relation_count table_count < <(database_inventory "$(database_name)")
# These variables expand inside the database container, never on the host.
# shellcheck disable=SC2016
dc exec -T db sh -eu -c 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --schema=public --format=custom --no-owner --no-acl' > "$work/database.dump"
dc exec -T db pg_restore --list < "$work/database.dump" >/dev/null
dc --profile operations run-existing --rm --no-deps --pull never -T storage-tool \
  -C /app/storage -cf - . > "$work/storage.tar"
dc --profile operations run-existing --rm --no-deps --pull never -T proxy-data-tool \
  -C /data -cf - . > "$work/caddy-data.tar"
dc --profile operations run-existing --rm --no-deps --pull never -T proxy-data-tool \
  -C /config -cf - . > "$work/caddy-config.tar"
python3 "$PROJECT_ROOT/deploy/backup-archive.py" pack-tree "$(env_get INTEGRATIONS_HOST_DIR)" "$work/integrations.tar" integrations
python3 "$PROJECT_ROOT/deploy/backup-archive.py" pack-tree "$(env_get PRIVACY_LEDGER_HOST_DIR)" "$work/privacy-ledger.tar" ledger
privacy_cli head > "$work/privacy-after.json"
cmp -s "$work/privacy-anchor.json" "$work/privacy-after.json" || die "The independent privacy ledger changed during snapshot; retry after its writer finishes."
cp "$ENV_FILE" "$work/environment.env"
python3 "$PROJECT_ROOT/deploy/backup-archive.py" deployment-manifest "$work/deployment.json" "$active_release" "$(env_get COMPOSE_PROJECT_NAME idealmakoo)" "$database_image"
python3 "$PROJECT_ROOT/deploy/mail-data.py" snapshot --env-file "$ENV_FILE" --payload "$work"
python3 "$PROJECT_ROOT/deploy/backup-archive.py" manifest "$work" "$active_release" "$(env_get COMPOSE_PROJECT_NAME idealmakoo)" "$migration_count" "$relation_count" "$identity"
# Mark the attempt before invoking the helper: its failure must not cause a
# second full startup attempt from EXIT. Only the captured existing IDs resume.
resume_attempted=1
lifecycle start --snapshot "$runtime_snapshot" --timeout 1200 >/dev/null
writers_stopped=0
recipient="$(age-keygen -y "$identity")"
tar -C "$work" -cf - database.dump storage.tar environment.env release.env privacy-anchor.json source.tar \
  integrations.tar privacy-ledger.tar caddy-data.tar caddy-config.tar database-inventory.json deployment.json mail.tar mail-manifest.json manifest.json \
  | age --encrypt --recipient "$recipient" > "$work/encrypted.tar.age"
python3 - "$work/encrypted.tar.age" "$archive" <<'PY'
import hashlib, os, sys
from pathlib import Path
partial, target = map(Path, sys.argv[1:])
# Exclusive publication also closes the race between an early existence check
# and a concurrent file/symlink appearing in an operator-selected export path.
os.link(partial, target)
partial.unlink()
checksum = hashlib.sha256()
with target.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        checksum.update(chunk)
with Path(str(target) + '.sha256').open('x') as output:
    output.write(checksum.hexdigest() + '  ' + target.name + '\n')
PY
record_recovery backup "$archive" "$started" "$active_release" "$migration_count" "$table_count" false backup-script >&2
log "Encrypted backup saved: $archive"
if (( stream )); then cat "$archive"; else printf '%s\n' "$archive"; fi

