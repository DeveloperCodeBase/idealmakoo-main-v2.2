#!/usr/bin/env bash
# Apply protected app/worker environment changes within the normal operations lock.
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
require_environment
acquire_ops_lock
pending_restore assert-clear
python3 "$PROJECT_ROOT/deploy/bootstrap-environment.py" validate "$ENV_FILE"
lifecycle up --timeout 600 app worker
log 'Protected app/worker settings applied and health verified.'
