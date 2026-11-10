#!/usr/bin/env bash
# Run on the operator's workstation; SSH stdout carries only encrypted bytes.
set -Eeuo pipefail
umask 077
host=""; remote_root=/var/www/idealmakoo-v2; port=22; output=""; ssh_identity=""; key_output=""; known_hosts=""
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
while (( $# )); do
  case "$1" in
    --host) host="${2:?Missing SSH user@host}"; shift 2 ;;
    --remote-root) remote_root="${2:?Missing installation root}"; shift 2 ;;
    --port) port="${2:?Missing SSH port}"; shift 2 ;;
    --output) output="${2:?Missing local archive filename}"; shift 2 ;;
    --ssh-identity) ssh_identity="${2:?Missing SSH private-key path}"; shift 2 ;;
    --known-hosts) known_hosts="${2:?Missing verified SSH known-hosts file}"; shift 2 ;;
    --recovery-key-output) key_output="${2:?Missing separate private recovery-key filename}"; shift 2 ;;
    --help) printf '%s\n' 'Usage: bash scripts/download-backup.sh --host ubuntu@SERVER --remote-root /var/www/idealmakoo-v2 --output ./website.tar.age [--recovery-key-output ./website-recovery-key.txt] [--port 22] [--ssh-identity PATH] [--known-hosts PATH]' 'Requires an already verified SSH host key, key-based SSH login and noninteractive sudo for this installation. The optional recovery key is a separate private file; protect it independently.'; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ "$host" =~ ^[a-z_][a-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || die "Use a valid user@hostname or user@IPv4 destination."
[[ "$remote_root" =~ ^/[A-Za-z0-9_/-]+$ && "$remote_root" != / ]] || die "Use a dedicated absolute remote installation path without spaces."
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( 10#$port < 1 || 10#$port > 65535 )); then die "Invalid SSH port."; fi
[[ -n "$output" && "$output" == *.tar.age && ! -e "$output" && ! -L "$output" ]] || die "Choose a new local .tar.age output filename."
[[ ! -e "$output.sha256" && ! -L "$output.sha256" ]] || die "The output checksum already exists; choose a new archive filename."
[[ -d "$(dirname "$output")" ]] || die "Create the local output directory first."
if [[ -n "$key_output" ]]; then
  [[ "$key_output" != "$output" && "$key_output" != "$output.sha256" && ! -e "$key_output" && ! -L "$key_output" && -d "$(dirname "$key_output")" ]] || die "Choose a new separate recovery-key output filename distinct from the archive and its checksum."
  # A relative/absolute spelling or a symlinked parent can name the same absent
  # file. Refuse before SSH, so a private key cannot be published under the
  # filename the operator expects to contain only encrypted backup bytes.
  output_target="$(cd -- "$(dirname "$output")" && pwd -P)/$(basename -- "$output")"
  key_target="$(cd -- "$(dirname "$key_output")" && pwd -P)/$(basename -- "$key_output")"
  [[ "$key_target" != "$output_target" && "$key_target" != "$output_target.sha256" ]] || die "The recovery key must use a different physical destination from the archive and checksum."
fi
for command in ssh sha256sum mktemp; do command -v "$command" >/dev/null || die "Required command missing: $command"; done
options=(-T -p "$((10#$port))" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ConnectionAttempts=1)
[[ -z "$ssh_identity" ]] || options+=(-i "$ssh_identity" -o IdentitiesOnly=yes)
if [[ -n "$known_hosts" ]]; then
  [[ -f "$known_hosts" ]] || die "The verified known-hosts file is missing."
  options+=(-o "UserKnownHostsFile=$known_hosts")
fi
temporary="$(mktemp "${output}.partial.XXXXXXXX")"; key_temporary=""; checksum_temporary=""
cleanup() { rm -f -- "$temporary"; [[ -z "$key_temporary" ]] || rm -f -- "$key_temporary"; [[ -z "$checksum_temporary" ]] || rm -f -- "$checksum_temporary"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# remote_root was restricted to absolute slash/alphanumeric paths before quoting.
# shellcheck disable=SC2029
ssh "${options[@]}" "$host" "sudo -n bash '$remote_root/current/scripts/backup.sh' --stdout" > "$temporary"
[[ -s "$temporary" ]] || die "Remote backup returned no archive."
[[ "$(head -c21 "$temporary")" == age-encryption.org/v1 ]] || die "Remote output is not an age archive; no completed file was written."
if [[ -n "$key_output" ]]; then
  key_temporary="$(mktemp "${key_output}.partial.XXXXXXXX")"
  # shellcheck disable=SC2029
  ssh "${options[@]}" "$host" "sudo -n cat '$remote_root/shared/backup-identity.txt'" > "$key_temporary"
  [[ "$(awk '/^AGE-SECRET-KEY-1[0-9A-Z]+$/ {count++} END {print count+0}' "$key_temporary")" == 1 ]] || die "The remote recovery identity was invalid."
  ln -- "$key_temporary" "$key_output" || die "The recovery-key destination appeared during download; it was not overwritten."
  rm -f -- "$key_temporary"; key_temporary=""
fi
ln -- "$temporary" "$output" || die "The archive destination appeared during download; it was not overwritten."
rm -f -- "$temporary"
checksum_dir="$(dirname "$output")"; checksum_name="$(basename "$output")"
checksum_temporary="$(mktemp "${output}.sha256.partial.XXXXXXXX")"
(cd "$checksum_dir" && sha256sum "$checksum_name") > "$checksum_temporary"
ln -- "$checksum_temporary" "$output.sha256" || die "The checksum destination appeared during download; it was not overwritten."
rm -f -- "$checksum_temporary"; checksum_temporary=""
printf 'Encrypted complete backup downloaded: %s\n' "$output"
[[ -z "$key_output" ]] || printf 'Separate private recovery identity saved: %s\nKeep this key in a different protected location from the archive.\n' "$key_output"
