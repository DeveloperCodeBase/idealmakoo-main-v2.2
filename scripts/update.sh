#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
source_dir=""; rollback_dir=""; schema_compatible=0
while (( $# )); do
  case "$1" in
    --source) source_dir="${2:?Missing new release directory}"; shift 2 ;;
    --rollback) rollback_dir="${2:?Missing previous release directory}"; shift 2 ;;
    --schema-compatible) schema_compatible=1; shift ;;
    --help) printf '%s\n' 'Usage: sudo bash scripts/update.sh --source /path/to/reviewed-new-release' '       sudo bash scripts/update.sh --rollback /var/www/idealmakoo/previous --schema-compatible'; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ "$EUID" == 0 ]] || die "Use sudo for installed releases."
require_environment; acquire_ops_lock
pending_restore assert-clear
app_dir="$(dirname "$(dirname "$ENV_FILE")")"
[[ "$ENV_FILE" == "$app_dir/shared/.env" ]] || die "Update helper requires an installer-managed release."
if [[ -n "$rollback_dir" ]]; then
  (( schema_compatible )) || die "An application rollback needs explicit --schema-compatible after reviewing migration compatibility. For incompatible schema changes, restore the matching encrypted backup."
  rollback_dir="$(realpath "$rollback_dir")"
  case "$rollback_dir" in "$app_dir"/releases/*) ;; *) die "Rollback must name an existing release of this installation." ;; esac
  [[ -f "$rollback_dir/.release.env" ]] || die "Rollback release metadata is missing."
  [[ -f "$rollback_dir/deploy/compose.py" && -f "$rollback_dir/docker-compose.yml" ]] || die "Rollback Compose configuration is missing."
  # Keep the reviewed operations implementation while selecting the older
  # release's Compose file and image metadata. That release need not contain
  # this lifecycle helper, and its shell library must not replace our cleanup.
  rollback_lifecycle="$LIFECYCLE_IMPLEMENTATION"
  rollback_stop_on_failure=0
  # Invoked indirectly by the EXIT trap; caller tests execute this cleanup.
  # shellcheck disable=SC2317,SC2329
  rollback_finished() {
    local result=$?
    (( result == 0 )) && return
    trap - EXIT INT TERM
    if (( rollback_stop_on_failure )); then
      if python3 "$rollback_lifecycle" --root "$rollback_dir" --env-file "$ENV_FILE" \
        stop --timeout 90 app worker >/dev/null; then
        log "Rollback failed; this project's app and worker are stopped. Database, media and the safety backup were retained."
      else
        log "ERROR: Rollback failed and writer shutdown could not be verified. Check Docker access and stop this project's app and worker before allowing traffic."
      fi
    fi
    exit "$result"
  }
  trap 'rollback_finished' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  bash "$PROJECT_ROOT/scripts/backup.sh" >/dev/null
  rollback_stop_on_failure=1
  lifecycle stop --timeout 90 app worker >/dev/null
  old_dir="$PROJECT_ROOT"
  python3 "$rollback_lifecycle" --root "$rollback_dir" --env-file "$ENV_FILE" \
    up --timeout 1200 app worker proxy
  python3 "$rollback_lifecycle" --root "$rollback_dir" --env-file "$ENV_FILE" \
    check --timeout 240
  ln -s "$old_dir" "$app_dir/previous.next"
  mv -Tf "$app_dir/previous.next" "$app_dir/previous"
  ln -s "$rollback_dir" "$app_dir/current.next"
  mv -Tf "$app_dir/current.next" "$app_dir/current"
  rollback_stop_on_failure=0
  log "Application rollback completed. Database and media were not rolled back."
  exit 0
fi
[[ -n "$source_dir" && -f "$source_dir/scripts/install-ubuntu.sh" ]] || die "Provide --source with a complete reviewed new release directory."
site_address="$(env_get SITE_ADDRESS)"
domain="${site_address#http://}"
args=(--domain "$domain" --app-dir "$app_dir" --project-name "$(env_get COMPOSE_PROJECT_NAME idealmakoo)" \
  --email "$(env_get ACME_EMAIL)" --http-port "$(env_get HTTP_PORT 80)" --https-port "$(env_get HTTPS_PORT 443)" --bind-ip "$(env_get BIND_IP 0.0.0.0)")
[[ "$site_address" != http://* ]] || args+=(--http)
[[ ",$(env_get COMPOSE_PROFILES)," == *,antivirus,* ]] || args+=(--without-antivirus)
exec bash "$source_dir/scripts/install-ubuntu.sh" "${args[@]}"
