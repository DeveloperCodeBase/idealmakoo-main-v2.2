-- Database-only CRM actions commit with their event and audit evidence. No
-- external delivery is performed by these rules; provider sends use outbox.
CREATE TABLE IF NOT EXISTS crm_automation_events (
  id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('record.created','record.updated','activity.due')),
  source text NOT NULL CHECK (source IN ('mutation','manual','reminder')),
  record_id text NOT NULL,
  collection text NOT NULL,
  actor_id text,
  depth integer NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 3),
  parent_event_id text REFERENCES crm_automation_events(id),
  facts jsonb NOT NULL CHECK (jsonb_typeof(facts)='object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_automation_event_record ON crm_automation_events(record_id,created_at DESC);

CREATE TABLE IF NOT EXISTS crm_automation_runs (
  id text PRIMARY KEY,
  rule_id text NOT NULL,
  event_id text NOT NULL REFERENCES crm_automation_events(id),
  creator_id text NOT NULL,
  rule_checksum text NOT NULL CHECK (rule_checksum ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  result jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(result)='array'),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(rule_id,event_id)
);
CREATE INDEX IF NOT EXISTS crm_automation_pending ON crm_automation_runs(created_at,id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS crm_automation_rule_history ON crm_automation_runs(rule_id,created_at DESC);

CREATE TABLE IF NOT EXISTS crm_automation_batches (
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  event_ids jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(event_ids)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,idempotency_key)
);

-- Causal depth is durable server evidence, never trusted from editable details.
-- This also bounds loops that cross from create_activity to activity.due.
CREATE TABLE IF NOT EXISTS crm_automation_origins (
  record_id text PRIMARY KEY,
  rule_id text NOT NULL,
  event_id text NOT NULL REFERENCES crm_automation_events(id),
  depth integer NOT NULL CHECK (depth BETWEEN 1 AND 3),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_activity_reminders (
  id text PRIMARY KEY,
  record_id text NOT NULL,
  due_value text NOT NULL,
  owner_role text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  event_id text REFERENCES crm_automation_events(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent')),
  notified_count integer NOT NULL DEFAULT 0 CHECK (notified_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(record_id,due_value,owner_role)
);
CREATE INDEX IF NOT EXISTS crm_activity_reminders_retry ON crm_activity_reminders(next_attempt_at) WHERE status='pending';
CREATE INDEX IF NOT EXISTS crm_activity_deadline ON workspace_entities((data->>'due'),id)
  WHERE bucket='records' AND collection='activities' AND deleted_at IS NULL;

DROP TRIGGER IF EXISTS crm_automation_event_immutable ON crm_automation_events;
CREATE TRIGGER crm_automation_event_immutable BEFORE UPDATE OR DELETE ON crm_automation_events
  FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
DROP TRIGGER IF EXISTS crm_automation_origin_immutable ON crm_automation_origins;
CREATE TRIGGER crm_automation_origin_immutable BEFORE UPDATE OR DELETE ON crm_automation_origins
  FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
