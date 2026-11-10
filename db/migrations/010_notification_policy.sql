CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id text PRIMARY KEY REFERENCES users(id),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  preferences jsonb NOT NULL CHECK(jsonb_typeof(preferences)='object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE outbox DROP CONSTRAINT IF EXISTS outbox_state_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_state_check
  CHECK(state IN ('pending','running','batched','delivered','failed','cancelled','uncertain'));

CREATE TABLE IF NOT EXISTS notification_digest_items (
  outbox_id text PRIMARY KEY REFERENCES outbox(id),
  user_id text NOT NULL REFERENCES users(id),
  channel text NOT NULL CHECK(channel IN ('email','in-app')),
  topic text NOT NULL CHECK(topic IN ('requests','products','research','events')),
  frequency text NOT NULL CHECK(frequency IN ('daily','weekly')),
  due_at timestamptz NOT NULL,
  digest_outbox_id text REFERENCES outbox(id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','batched','delivered','cancelled','failed','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_digest_pending_idx
  ON notification_digest_items(due_at,user_id,channel) WHERE state='pending';
CREATE INDEX IF NOT EXISTS notification_digest_batch_idx
  ON notification_digest_items(digest_outbox_id) WHERE state='batched';

CREATE TABLE IF NOT EXISTS notification_unsubscribe_tokens (
  token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
  user_id text NOT NULL REFERENCES users(id),
  email_hash text NOT NULL CHECK(length(email_hash)=64),
  scope text NOT NULL DEFAULT 'marketing-email' CHECK(scope='marketing-email'),
  outbox_id text NOT NULL REFERENCES outbox(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '365 days',
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_unsubscribe_owner_idx
  ON notification_unsubscribe_tokens(user_id,created_at DESC);

ALTER TABLE crm_activity_reminders DROP CONSTRAINT IF EXISTS crm_activity_reminders_status_check;
ALTER TABLE crm_activity_reminders ADD CONSTRAINT crm_activity_reminders_status_check
  CHECK(status IN ('pending','queued','sent','cancelled','failed','uncertain'));
ALTER TABLE crm_activity_reminders ADD COLUMN IF NOT EXISTS queued_count integer NOT NULL DEFAULT 0 CHECK(queued_count>=0);
ALTER TABLE crm_activity_reminders ADD COLUMN IF NOT EXISTS recipient_key text NOT NULL DEFAULT '';
UPDATE crm_activity_reminders SET recipient_key='role:'||owner_role WHERE recipient_key='';
ALTER TABLE crm_activity_reminders DROP CONSTRAINT IF EXISTS crm_activity_reminders_record_id_due_value_owner_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS crm_reminder_recipient_dedupe ON crm_activity_reminders(record_id,due_value,recipient_key);
CREATE TABLE IF NOT EXISTS crm_activity_reminder_deliveries (
  reminder_id text NOT NULL REFERENCES crm_activity_reminders(id),
  user_id text NOT NULL REFERENCES users(id),
  outbox_id text NOT NULL UNIQUE REFERENCES outbox(id),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','cancelled','failed','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(reminder_id,user_id)
);

CREATE TABLE IF NOT EXISTS notification_publication_events (
  id text PRIMARY KEY,
  document_bucket text NOT NULL CHECK(document_bucket IN ('records','pages')),
  document_id text NOT NULL,
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  revision_id uuid NOT NULL REFERENCES content_revisions(id),
  topic text NOT NULL CHECK(topic IN ('products','research','events')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','cancelled')),
  cursor_user_id text NOT NULL DEFAULT '',
  processed_count integer NOT NULL DEFAULT 0,
  queued_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(document_bucket,document_id,locale,revision_id)
);
CREATE INDEX IF NOT EXISTS notification_publication_pending_idx
  ON notification_publication_events(created_at,id) WHERE state='pending';
