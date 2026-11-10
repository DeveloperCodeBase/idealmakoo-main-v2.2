#!/usr/bin/env bash
# Read-only operational diagnosis. Deliberately never dumps dotenv, Docker
# environment/arguments, provider payloads, database rows, or service logs.
set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
require_environment
python3 "$PROJECT_ROOT/deploy/bootstrap-environment.py" validate "$ENV_FILE"
log "Protected environment and Compose configuration are valid."
log "Release: $(release_id). Compose service state follows."
dc ps --all
failed=0
# Match the same validated, protected budget as Docker's probe. An explicitly
# configured slow host must not produce a contradictory default-timeout result.
health_timeout="$(env_get APP_HEALTH_TIMEOUT_SECONDS 8)"
if dc exec -T app node /app/deploy/app-healthcheck.mjs "${health_timeout:-8}" >/dev/null 2>&1; then log 'Application health: ready'; else log 'Application health: unavailable'; failed=1; fi
if dc exec -T worker node --import tsx /app/scripts/worker-health.ts >/dev/null 2>&1; then log 'Worker heartbeat: ready'; else log 'Worker heartbeat: unavailable'; failed=1; fi
if [[ ",$(env_get COMPOSE_PROFILES)," == *,antivirus,* ]]; then
  if dc exec -T clamav sh -c 'printf "zPING\0" | nc -w 3 127.0.0.1 3310 | grep -q PONG' >/dev/null 2>&1; then
    log 'Antivirus: ready'
  else log 'Antivirus: unavailable (initial signature acquisition can take several minutes)'; failed=1; fi
fi
if privacy_cli ready >/dev/null 2>&1; then log 'Independent privacy ledger and database gate: ready'; else log 'Independent privacy ledger and database gate: unavailable'; failed=1; fi
if [[ "$(env_get MAIL_SERVER_MODE external)" == local ]]; then
  if ! python3 "$PROJECT_ROOT/deploy/mail-diagnostics.py" --env-file "$ENV_FILE"; then failed=1; fi
fi
log 'For detailed service logs, inspect them privately on the host; redact credentials and personal data before sharing.'
exit "$failed"
