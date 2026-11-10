CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support')),
  active boolean NOT NULL DEFAULT true,
  quality_scope boolean NOT NULL DEFAULT false,
  allowed_locales jsonb NOT NULL DEFAULT '["fa","en","tr","ar","ru"]',
  email_verified boolean NOT NULL DEFAULT false,
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret text,
  mfa_pending_secret text,
  mfa_pending_expires_at timestamptz,
  mfa_last_counter bigint NOT NULL DEFAULT -1,
  recovery_hashes jsonb NOT NULL DEFAULT '[]',
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, token_hash text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token text NOT NULL, mfa_verified boolean NOT NULL DEFAULT false,
  user_agent text NOT NULL DEFAULT '', ip_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS sessions_expiration_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_challenges (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('mfa','password_reset','email_verify')),
  expires_at timestamptz NOT NULL, consumed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_settings (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}', preferences jsonb NOT NULL DEFAULT '{}',
  collection jsonb NOT NULL DEFAULT '{"inquiries":[],"compare":[],"saved":[]}',
  portal jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_expiry_idx ON rate_limits(reset_at);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY, actor_id text, action text NOT NULL,
  entity_type text NOT NULL, entity_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_actor_created_idx ON audit_events(actor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type,entity_id,created_at DESC);
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only'; END $$;
DROP TRIGGER IF EXISTS audit_immutable ON audit_events;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TABLE IF NOT EXISTS requests (
  id text PRIMARY KEY, owner_id text REFERENCES users(id),
  kind text NOT NULL, locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  data jsonb NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  quality_quarantined boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_owner_created_idx ON requests(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS requests_kind_idx ON requests(kind,updated_at DESC);
CREATE INDEX IF NOT EXISTS requests_data_gin ON requests USING gin(data jsonb_path_ops);
CREATE TABLE IF NOT EXISTS request_messages (
  id text PRIMARY KEY, request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  visibility text NOT NULL CHECK(visibility IN ('public','internal')),
  actor_id text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_messages_request_idx ON request_messages(request_id,created_at,id);
CREATE TABLE IF NOT EXISTS quote_snapshots (
  id text PRIMARY KEY, request_id text NOT NULL REFERENCES requests(id), record_id text NOT NULL,
  locale text NOT NULL, snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','accepted_interest','declined','revision_requested')),
  issued_by text NOT NULL REFERENCES users(id), response text, responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(record_id,snapshot_hash)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,key)
);
CREATE INDEX IF NOT EXISTS idempotency_created_idx ON idempotency_keys(created_at);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY, owner_id text REFERENCES users(id), request_id text REFERENCES requests(id),
  name text NOT NULL, storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL, bytes bigint NOT NULL CHECK(bytes > 0), sha256 text NOT NULL,
  visibility text NOT NULL CHECK(visibility IN ('public','private')),
  scan_status text NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending','clean','blocked','error')),
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS assets_request_idx ON assets(request_id);
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','delivered','failed','cancelled','uncertain')),
  dedupe_key text UNIQUE, attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz,
  lock_token text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox(available_at) WHERE state='pending';
CREATE TABLE IF NOT EXISTS delivery_events (
  id bigserial PRIMARY KEY, outbox_id text NOT NULL REFERENCES outbox(id), provider text NOT NULL,
  status text NOT NULL, provider_id text, detail text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
  title text NOT NULL, body text NOT NULL, href text,
  read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), dedupe_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS notifications_owner_idx ON notifications(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS worker_heartbeats (name text PRIMARY KEY, heartbeat_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS ai_usage (
  id text PRIMARY KEY, actor_id text REFERENCES users(id), visitor_hash text,
  mode text NOT NULL, provider text NOT NULL, model text NOT NULL,
  state text NOT NULL CHECK(state IN ('reserved','complete','failed','uncertain')),
  reserved_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK(reserved_usd >= 0),
  actual_usd numeric(14,6), tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, response_id text
);
CREATE INDEX IF NOT EXISTS ai_usage_budget_idx ON ai_usage(created_at,state);
CREATE TABLE IF NOT EXISTS ai_jobs (
  id text PRIMARY KEY, actor_id text NOT NULL REFERENCES users(id), mode text NOT NULL,
  input jsonb NOT NULL, output jsonb, status text NOT NULL DEFAULT 'pending',
  provider_id text, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_events (provider text NOT NULL,event_id text NOT NULL,received_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id));

