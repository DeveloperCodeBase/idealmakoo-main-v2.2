#!/usr/bin/env bash
# Complete website recovery from an authenticated archive onto an empty host.
set -Eeuo pipefail
umask 077
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
archive=""; identity=""; fresh=0; app_dir=""; latest_ledger=""; activate_outbound=0
install_args=()
while (( $# )); do
  case "$1" in
    --file) archive="${2:?Missing encrypted archive}"; shift 2 ;;
    --identity) identity="${2:?Missing external recovery identity}"; shift 2 ;;
    --new-host) fresh=1; shift ;;
    --app-dir) app_dir="${2:?Missing new dedicated installation path}"; shift 2 ;;
    --latest-ledger) latest_ledger="${2:?Missing latest independent ledger directory}"; shift 2 ;;
    --activate-outbound) activate_outbound=1; shift ;;
    --domain|--email|--project-name|--http-port|--https-port|--bind-ip|--mail-mode) install_args+=("$1" "${2:?Missing installer option value}"); shift 2 ;;
    --http|--without-antivirus|--skip-resource-check|--without-backup-timer|--with-mail-server|--without-mail-server) install_args+=("$1"); shift ;;
    --help) printf '%s\n' 'Usage: sudo bash scripts/recover-ubuntu.sh --new-host --file /secure/website.tar.age --identity /secure/recovery-key.txt --app-dir /var/www/idealmakoo-v2 [--domain example.com --email ops@example.com] [--latest-ledger /secure/latest-ledger]' 'Default: restored outbound channels stay paused. --activate-outbound explicitly resumes the restored provider settings. Existing installations use restore.sh --confirm-replace instead.'; exit 0 ;;
    *) die "Unknown recovery option: $1" ;;
  esac
done
[[ "$EUID" == 0 ]] || die "Run new-host recovery with sudo."
(( fresh )) || die "Use --new-host explicitly. This command must not replace an existing installation."
[[ "$app_dir" =~ ^/[A-Za-z0-9_/-]+$ && "$app_dir" != / && "$app_dir" != /var && "$app_dir" != /var/www && "$app_dir" != /opt && "$app_dir" != /tmp ]] || die "Choose a new dedicated absolute --app-dir without spaces."
[[ "$(realpath -m "$app_dir")" == "$app_dir" ]] || die "Recovery target cannot traverse symlinks."
if [[ -e "$app_dir" ]]; then
  [[ -d "$app_dir" && -z "$(find "$app_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "The recovery target is not empty; no existing installation was overwritten."
fi
[[ -f "$archive" && ! -L "$archive" && -f "$identity" && ! -L "$identity" ]] || die "Supply regular existing --file and separate --identity paths."
archive="$(realpath "$archive")"; identity="$(realpath "$identity")"
[[ -f /etc/os-release ]] || die "Cannot identify host OS."
# shellcheck source=/dev/null
source /etc/os-release
[[ "$ID" == ubuntu && ( "$VERSION_ID" == 22.04 || "$VERSION_ID" == 24.04 ) && -d /run/systemd/system ]] || die "New-host recovery requires Ubuntu 22.04/24.04 with systemd."
if ! command -v age >/dev/null || ! command -v python3 >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o APT::Update::Error-Mode=any update
  apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends age python3 ca-certificates
fi
work="$(mktemp -d /tmp/idealmakoo-disaster-recovery.XXXXXXXX)"
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 "$PROJECT_ROOT/deploy/backup-archive.py" preflight-decryption "$archive" "$work"
age --decrypt --identity "$identity" --output "$work/archive.tar" "$archive"
mkdir "$work/verified" "$work/source"
python3 "$PROJECT_ROOT/deploy/backup-archive.py" unpack "$work/archive.tar" "$work/verified" "$identity" >/dev/null
python3 - "$work/verified/manifest.json" <<'PY'
import json, sys
with open(sys.argv[1]) as source:
    if json.load(source).get('format') not in (3, 4):
        raise SystemExit('Complete new-host recovery requires an authenticated format3/format4 archive.')
PY
[[ -f "$work/verified/source.tar" ]] || die "This is a legacy data-only backup. Complete new-host recovery requires format3."
python3 "$PROJECT_ROOT/deploy/backup-archive.py" extract-source "$work/verified/source.tar" "$work/source"
args=(--env-file "$work/verified/environment.env" --app-dir "$app_dir" --recover-payload "$work/verified" --recover-identity "$identity")
[[ -z "$latest_ledger" ]] || args+=(--recover-latest-ledger "$(realpath "$latest_ledger")")
(( activate_outbound == 0 )) || args+=(--recover-activate-outbound)
log "Authenticated complete backup verified. Rebuilding its recorded source and restoring to the empty target."
bash "$work/source/scripts/install-ubuntu.sh" "${args[@]}" "${install_args[@]}"
log "Complete website recovery finished. The original encrypted archive and separate recovery identity were preserved."
