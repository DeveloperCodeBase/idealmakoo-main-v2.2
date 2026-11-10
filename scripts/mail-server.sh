#!/usr/bin/env bash
# Project-scoped domain-mail operations. Never prints passwords or sends mail.
set -Eeuo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/../deploy/lib.sh"
operation="${1:-check}"
shift || true
case "$operation" in
  dns) python3 "$PROJECT_ROOT/deploy/mail-config.py" dns --env-file "$ENV_FILE" ;;
  check) python3 "$PROJECT_ROOT/deploy/mail-diagnostics.py" --env-file "$ENV_FILE" "$@" ;;
  prepare)
    require_environment; acquire_ops_lock
    python3 "$PROJECT_ROOT/deploy/mail-config.py" prepare --env-file "$ENV_FILE"
    ;;
  reload)
    require_environment; acquire_ops_lock; pending_restore assert-clear
    [[ "$(env_get MAIL_SERVER_MODE external)" == local ]] || die 'Managed mail is not enabled.'
    python3 "$PROJECT_ROOT/deploy/mail-config.py" prepare --env-file "$ENV_FILE"
    lifecycle stop --timeout 90 mailserver
    lifecycle up --timeout 300 mailserver
    python3 "$PROJECT_ROOT/deploy/mail-diagnostics.py" --env-file "$ENV_FILE"
    ;;
  activate-outbound)
    [[ "${1:-}" == --confirm-reviewed-queue ]] || die 'Review the restored mail queue first; activation requires --confirm-reviewed-queue.'
    require_environment; acquire_ops_lock; pending_restore assert-clear
    [[ "$(env_get MAIL_SERVER_MODE external)" == local ]] || die 'Managed mail is not enabled.'
    python3 "$PROJECT_ROOT/deploy/mail-diagnostics.py" --env-file "$ENV_FILE"
    python3 "$PROJECT_ROOT/deploy/env-file.py" set "$ENV_FILE" MAIL_OUTBOUND_ENABLED true
    python3 "$PROJECT_ROOT/deploy/mail-config.py" prepare --env-file "$ENV_FILE"
    lifecycle stop --timeout 90 mailserver
    lifecycle up --timeout 300 mailserver
    ;;
  help|--help|-h)
    printf '%s\n' 'mail-server.sh dns | check [--dns-only] | prepare | reload | activate-outbound --confirm-reviewed-queue' 'Mailbox management: use the documented project-scoped Compose setup CLI. No email is sent by check.'
    ;;
  *) die 'Unknown mail operation.' ;;
esac
