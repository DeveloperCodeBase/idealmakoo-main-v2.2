#!/bin/sh
# Runs only for an empty PostgreSQL volume. Existing credentials are never reset.
set -eu
: "${POSTGRES_DB:?}" "${POSTGRES_APP_PASSWORD:?}" "${POSTGRES_MIGRATION_PASSWORD:?}"
psql -X -v ON_ERROR_STOP=1 --set=ECHO=none --set=VERBOSITY=terse \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv db POSTGRES_DB
\getenv app_password POSTGRES_APP_PASSWORD
\getenv owner_password POSTGRES_MIGRATION_PASSWORD
SELECT format('CREATE ROLE idealmakoo_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'owner_password') \gexec
SELECT format('CREATE ROLE idealmakoo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_password') \gexec
SELECT format('ALTER DATABASE %I OWNER TO idealmakoo_owner', :'db') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'db') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO idealmakoo_app', :'db') \gexec
ALTER SCHEMA public OWNER TO idealmakoo_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO idealmakoo_app;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
ALTER DEFAULT PRIVILEGES FOR ROLE idealmakoo_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO idealmakoo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE idealmakoo_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO idealmakoo_app;
SQL

