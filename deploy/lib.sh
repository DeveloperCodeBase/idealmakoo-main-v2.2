#!/usr/bin/env bash
# Shared operations helpers. Never source a dotenv file as shell code.
set -Eeuo pipefail
umask 077
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${IDEALMAKOO_ENV_FILE:-$PROJECT_ROOT/.env}"
# Keep reviewed lifecycle code separate from a selected historical deployment.
LIFECYCLE_IMPLEMENTATION="$PROJECT_ROOT/deploy/service-lifecycle.py"
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[idealmakoo] %s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || die "Required command is missing: $1"; }
env_get() {
  python3 "$PROJECT_ROOT/deploy/env-file.py" get "$ENV_FILE" "$1" "${2:-}"
}
require_environment() {
  need docker; need python3
  [[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE; run the installer or prepare .env first."
  ENV_FILE="$(realpath "$ENV_FILE")"
  local mode
  mode="$(stat -c '%a' "$ENV_FILE")"
  (( (8#$mode & 8#077) == 0 )) || die "$ENV_FILE must be private; run chmod 600 on it."
  docker compose version >/dev/null
  if [[ -n "${IDEALMAKOO_COMPOSE_OVERRIDE:-}" ]]; then
    [[ -f "$IDEALMAKOO_COMPOSE_OVERRIDE" ]] || die "Compose override does not exist."
  fi
  dc config --quiet
}
dc() { python3 "$PROJECT_ROOT/deploy/compose.py" "$PROJECT_ROOT" "$ENV_FILE" "$@"; }
lifecycle() { python3 "$LIFECYCLE_IMPLEMENTATION" --root "$PROJECT_ROOT" --env-file "$ENV_FILE" "$@"; }
build_release_images() { python3 "$PROJECT_ROOT/deploy/build-images.py" "$PROJECT_ROOT" "$ENV_FILE" "$@"; }
pending_restore() { python3 "$PROJECT_ROOT/deploy/pending-restore.py" "$1" "$ENV_FILE" "${@:2}"; }
privacy_cli() {
  dc run-existing --rm --no-deps --pull never -T migrate node --import tsx /app/scripts/privacy-ledger.ts "$@"
}
database_inventory() {
  dc exec -T db psql --username=postgres --dbname="$1" -v ON_ERROR_STOP=1 -Atc \
    "SELECT (SELECT count(*) FROM public.schema_migrations),count(*) FILTER (WHERE c.relkind IN ('r','p','v','m')),count(*) FILTER (WHERE c.relkind IN ('r','p')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'"
}
record_recovery() {
  python3 "$PROJECT_ROOT/deploy/recovery-evidence.py" "$@" \
    | dc run-existing --rm --no-deps --pull never -T migrate node --import tsx /app/scripts/record-recovery.ts
}
acquire_ops_lock() {
  need flock
  if [[ "${IDEALMAKOO_OPS_LOCK_HELD:-0}" != 1 ]]; then
    exec 9>"$(dirname "$ENV_FILE")/.operations.lock"
    flock -n 9 || die "Another deployment, backup or restore is running."
    export IDEALMAKOO_OPS_LOCK_HELD=1
  fi
}
release_id() {
  if [[ -f "$PROJECT_ROOT/.release.env" ]]; then
    python3 "$PROJECT_ROOT/deploy/env-file.py" get "$PROJECT_ROOT/.release.env" RELEASE_SHA local
  else env_get RELEASE_SHA local; fi
}
database_name() {
  local db
  db="$(env_get POSTGRES_DB idealmakoo)"
  [[ "$db" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || die "Invalid POSTGRES_DB."
  printf '%s' "$db"
}

