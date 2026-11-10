#!/usr/bin/env bash
# Provision staff exclusively through protected environment settings.
set -Eeuo pipefail
# shellcheck source=deploy/lib.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
for argument in "$@"; do
  case "$argument" in
    --sync-grants|--rotate-passwords|--help) ;;
    --reactivate=*) [[ "${argument#--reactivate=}" =~ ^[a-z][a-z0-9_-]{1,63}$ ]] || die "Invalid stable staff key for explicit reactivation." ;;
    --reset-mfa=*) [[ "${argument#--reset-mfa=}" =~ ^[a-z][a-z0-9_-]{1,63}$ ]] || die "Invalid stable staff key for explicit MFA reset." ;;
    *) die "Supported options: --sync-grants, --rotate-passwords, --reactivate=stable-key, --reset-mfa=stable-key, --help" ;;
  esac
done
require_environment
acquire_ops_lock
pending_restore provision-allowed
dc run-existing --rm --no-deps --pull never -T migrate node --import tsx /app/scripts/provision-staff.ts "$@"
