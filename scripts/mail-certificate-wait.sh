#!/usr/bin/env bash
# Invoked by the installer while its operations lock is already held.
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
mail_hostname="$(env_get MAIL_HOSTNAME)"
[[ "$mail_hostname" =~ ^[a-z0-9.-]+$ ]] || die 'Invalid mail hostname.'
mail_certificate="/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$mail_hostname/$mail_hostname.crt"
mail_key="/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$mail_hostname/$mail_hostname.key"
# The service receives only its own certificate directory, never all site keys.
for attempt in $(seq 1 30); do
  if timeout 15s python3 "$PROJECT_ROOT/deploy/compose.py" "$PROJECT_ROOT" "$ENV_FILE" --profile operations run-existing --rm --no-deps --pull never -T --entrypoint /bin/sh proxy-data-tool -eu -c 'test -s "$1" && test -s "$2"' sh "$mail_certificate" "$mail_key" >/dev/null 2>&1; then exit 0; fi
  sleep 3
done
die 'Mail certificate was not issued within the bounded wait. Check mail DNS, inbound80/443, ACME access and Caddy state; no self-signed fallback was used.'
