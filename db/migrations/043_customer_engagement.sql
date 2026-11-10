-- Additive: existing credentials, grants, revisions and notification consent are preserved.
ALTER TABLE users ADD COLUMN phone_number text UNIQUE;
ALTER TABLE users ADD COLUMN phone_verified_at timestamptz;
ALTER TABLE users ADD COLUMN email_placeholder boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD CONSTRAINT users_verified_phone CHECK
  ((phone_number IS NULL AND phone_verified_at IS NULL) OR
   (phone_number ~ '^\+[1-9][0-9]{9,14}$' AND phone_verified_at IS NOT NULL));
ALTER TABLE users ADD CONSTRAINT users_placeholder_email CHECK
  (NOT email_placeholder OR (role='customer' AND NOT email_verified));

CREATE TABLE customer_otp_challenges (
  token_hash text PRIMARY KEY CHECK(length(token_hash)=64),
  phone_hash text NOT NULL CHECK(length(phone_hash)=64),
  phone_encrypted text NOT NULL,
  code_hash text NOT NULL CHECK(length(code_hash)=64),
  display_name text NOT NULL DEFAULT '' CHECK(length(display_name)<=100),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  visitor_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE INDEX customer_otp_phone_idx ON customer_otp_challenges(phone_hash,created_at DESC);
CREATE INDEX customer_otp_expiry_idx ON customer_otp_challenges(expires_at);

CREATE TABLE content_comments (
  id uuid PRIMARY KEY,
  path text NOT NULL CHECK(length(path)<=500),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  content_kind text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK(length(body) BETWEEN 2 AND 4000),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  moderated_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz
);
CREATE INDEX content_comments_public_idx ON content_comments(path,locale,created_at DESC) WHERE state='approved';
CREATE INDEX content_comments_review_idx ON content_comments(state,locale,created_at);
CREATE TABLE content_likes (
  path text NOT NULL CHECK(length(path)<=500),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  content_kind text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(path,locale,user_id)
);
CREATE TABLE content_reports (
  id uuid PRIMARY KEY,
  path text NOT NULL CHECK(length(path)<=500),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  content_kind text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES content_comments(id),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','resolved','dismissed')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  moderated_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz
);
CREATE INDEX content_reports_review_idx ON content_reports(state,locale,created_at);
CREATE TABLE content_visits (
  path text NOT NULL CHECK(length(path)<=500),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  content_kind text NOT NULL,
  window_start timestamptz NOT NULL,
  visitor_hash text NOT NULL CHECK(length(visitor_hash)=64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(path,locale,window_start,visitor_hash)
);
CREATE INDEX content_visits_report_idx ON content_visits(created_at,locale,content_kind);

CREATE TABLE provider_usage (
  outbox_id text PRIMARY KEY REFERENCES outbox(id),
  actor_id text REFERENCES users(id),
  provider text NOT NULL,
  channel text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL CHECK(status IN ('accepted','uncertain','failed')),
  units integer CHECK(units IS NULL OR units>0),
  currency text CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  actual_cost numeric(20,6) CHECK(actual_cost IS NULL OR actual_cost>=0),
  estimated_cost numeric(20,6) CHECK(estimated_cost IS NULL OR estimated_cost>=0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_usage_report_idx ON provider_usage(created_at,provider,channel);

-- New broadcast topic is opt-in. Existing research/event consents are not reused.
ALTER TABLE notification_publication_events DROP CONSTRAINT notification_publication_events_topic_check;
ALTER TABLE notification_publication_events ADD CONSTRAINT notification_publication_events_topic_check CHECK(topic IN ('products','research','events','content'));
ALTER TABLE notification_digest_items DROP CONSTRAINT notification_digest_items_topic_check;
ALTER TABLE notification_digest_items ADD CONSTRAINT notification_digest_items_topic_check CHECK(topic IN ('requests','products','research','events','content'));
ALTER TABLE communication_binding_consents DROP CONSTRAINT communication_binding_consents_topic_check;
ALTER TABLE communication_binding_consents ADD CONSTRAINT communication_binding_consents_topic_check CHECK(topic IN ('requests','products','research','events','content'));
UPDATE notification_preferences SET preferences=jsonb_set(preferences,'{topics,content}','{"email":{"enabled":false,"frequency":"instant","quietStart":null,"quietEnd":null},"inApp":{"enabled":false,"frequency":"instant","quietStart":null,"quietEnd":null}}'::jsonb) WHERE NOT(preferences->'topics' ? 'content');
UPDATE communication_bindings SET preferences=jsonb_set(preferences,'{topics,content}','{"enabled":false,"frequency":"instant","quietStart":null,"quietEnd":null}'::jsonb) WHERE NOT(preferences->'topics' ? 'content');
