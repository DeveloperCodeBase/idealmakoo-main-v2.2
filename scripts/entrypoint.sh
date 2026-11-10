#!/bin/sh
set -eu
case "${1:-web}" in
  web)
    node /app/deploy/wait-for-database.mjs
    node --import tsx /app/scripts/privacy-ledger.ts ready
    exec node /app/server.js
    ;;
  worker)
    node /app/deploy/wait-for-database.mjs
    node --import tsx /app/scripts/privacy-ledger.ts ready
    exec node --import tsx /app/scripts/worker.ts
    ;;
  migrate)
    node /app/deploy/wait-for-database.mjs
    node --import tsx /app/scripts/db-migrate.ts
    # Fresh databases have no accounts yet; existing ledger identity is verified.
    # An uninitialized database with existing users needs explicit operator review.
    node --import tsx /app/scripts/privacy-ledger.ts initialize
    node --import tsx /app/scripts/privacy-ledger.ts replay
    node --import tsx /app/scripts/privacy-ledger.ts ready
    node --import tsx /app/scripts/db-seed.ts
    exec node /app/deploy/grant-runtime.mjs
    ;;
  *) exec "$@" ;;
esac
