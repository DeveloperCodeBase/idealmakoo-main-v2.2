#!/usr/bin/env bash
# Only reload this managed service when Caddy's current public cert changed.
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
require_environment; acquire_ops_lock; pending_restore assert-clear
[[ "$(env_get MAIL_SERVER_MODE external)" == local ]] || exit 0
mail_hostname="$(env_get MAIL_HOSTNAME)"
[[ "$mail_hostname" =~ ^[a-z0-9.-]+$ ]] || die 'Invalid mail hostname.'
certificate="/srv/mail-tls/$mail_hostname.crt"
mail_data="$(env_get MAIL_DATA_DIR)"
marker="$mail_data/config/idealmakoo-certificate.sha256"
fingerprint="$(dc exec -T mailserver openssl x509 -in "$certificate" -noout -fingerprint -sha256)"
[[ "$fingerprint" =~ ^sha256\ Fingerprint=([A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$ ]] || die 'Mail certificate fingerprint could not be validated.'
dc exec -T mailserver openssl x509 -in "$certificate" -noout -checkhost "$mail_hostname" -checkend 86400 >/dev/null
if [[ -f "$marker" && ! -L "$marker" && "$(cat "$marker")" == "$fingerprint" ]]; then exit 0; fi
lifecycle stop --timeout 90 mailserver
lifecycle up --timeout 300 mailserver
python3 "$PROJECT_ROOT/deploy/mail-diagnostics.py" --env-file "$ENV_FILE" --tls-only
[[ ! -L "$marker" ]] || die 'Unsafe certificate state path.'
printf '%s\n' "$fingerprint" > "$marker"
chmod 600 "$marker"
log 'Managed mail certificate reloaded and authenticated TLS checked.'
