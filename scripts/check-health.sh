#!/usr/bin/env bash
set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
timeout_seconds="${1:-240}"
(( $# <= 1 )) || die "Usage: bash scripts/check-health.sh [timeout-seconds]"
# The helper validates the protected environment and bounds every Docker/HTTP
# operation. It observes Docker's existing health probes without spawning extra
# Node processes or mutating any service.
lifecycle check --timeout "$timeout_seconds"

