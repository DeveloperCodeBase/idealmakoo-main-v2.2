-- Managed documents have an independent, immutable publication history. Keep
-- their fanout receipts separate from workspace content-revision releases.
CREATE TABLE resource_notification_events (
  id text PRIMARY KEY,
  publication_id uuid NOT NULL UNIQUE REFERENCES resource_publications(id),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','cancelled')),
  cursor_user_id text NOT NULL DEFAULT '',
  processed_count integer NOT NULL DEFAULT 0 CHECK(processed_count>=0),
  queued_count integer NOT NULL DEFAULT 0 CHECK(queued_count>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX resource_notification_pending_idx
  ON resource_notification_events(created_at,id) WHERE state='pending';
