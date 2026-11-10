CREATE TABLE crm_segments (
  id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  filter jsonb NOT NULL CHECK(jsonb_typeof(filter)='object'), active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_segment_revisions (
  segment_id uuid NOT NULL REFERENCES crm_segments(id), version integer NOT NULL CHECK(version>0),
  definition jsonb NOT NULL, definition_hash text NOT NULL CHECK(length(definition_hash)=64),
  created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(segment_id,version)
);
CREATE TRIGGER crm_segment_revision_immutable BEFORE UPDATE OR DELETE ON crm_segment_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE crm_segment_snapshots (
  id uuid PRIMARY KEY, segment_id uuid NOT NULL, segment_version integer NOT NULL,
  definition_hash text NOT NULL CHECK(length(definition_hash)=64), membership_hash text NOT NULL CHECK(length(membership_hash)=64),
  created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(segment_id,segment_version) REFERENCES crm_segment_revisions(segment_id,version)
);
CREATE TRIGGER crm_segment_snapshot_immutable BEFORE UPDATE OR DELETE ON crm_segment_snapshots FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE crm_segment_snapshot_members (
  snapshot_id uuid NOT NULL REFERENCES crm_segment_snapshots(id), user_id text NOT NULL REFERENCES users(id),
  PRIMARY KEY(snapshot_id,user_id)
);
CREATE TRIGGER crm_segment_snapshot_member_immutable BEFORE UPDATE OR DELETE ON crm_segment_snapshot_members FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

CREATE TABLE crm_campaigns (
  id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), draft jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','scheduled','running','completed','cancelled','failed')),
  created_by text NOT NULL REFERENCES users(id), current_revision_id uuid, start_at timestamptz,
  enrollment_cursor text NOT NULL DEFAULT '', enrollment_scanned integer NOT NULL DEFAULT 0 CHECK(enrollment_scanned>=0),
  enrollment_complete boolean NOT NULL DEFAULT false, stop_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_campaign_due ON crm_campaigns(start_at,id) WHERE status IN ('scheduled','running');
CREATE TABLE crm_campaign_revisions (
  id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES crm_campaigns(id), version integer NOT NULL CHECK(version>0),
  draft jsonb NOT NULL, segment_id uuid NOT NULL, segment_version integer NOT NULL,
  filter jsonb NOT NULL, snapshot_id uuid REFERENCES crm_segment_snapshots(id),
  sender_id text NOT NULL REFERENCES users(id), sender_scope jsonb NOT NULL,
  start_at timestamptz NOT NULL, revision_hash text NOT NULL CHECK(length(revision_hash)=64),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(campaign_id,version),
  FOREIGN KEY(segment_id,segment_version) REFERENCES crm_segment_revisions(segment_id,version)
);
CREATE TRIGGER crm_campaign_revision_immutable BEFORE UPDATE OR DELETE ON crm_campaign_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
ALTER TABLE crm_campaigns ADD CONSTRAINT crm_campaign_revision_fk FOREIGN KEY(current_revision_id) REFERENCES crm_campaign_revisions(id);

CREATE TABLE crm_campaign_enrollments (
  id uuid PRIMARY KEY, revision_id uuid NOT NULL REFERENCES crm_campaign_revisions(id), user_id text NOT NULL REFERENCES users(id),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','waiting','completed','suppressed','failed','uncertain','cancelled')),
  step_index integer NOT NULL DEFAULT 0 CHECK(step_index BETWEEN 0 AND 4), next_at timestamptz,
  stop_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(revision_id,user_id)
);
CREATE INDEX crm_campaign_enrollment_due ON crm_campaign_enrollments(next_at,id) WHERE state IN ('pending','waiting');
CREATE TABLE crm_campaign_deliveries (
  id uuid PRIMARY KEY, enrollment_id uuid NOT NULL REFERENCES crm_campaign_enrollments(id),
  revision_id uuid NOT NULL REFERENCES crm_campaign_revisions(id), step_index integer NOT NULL CHECK(step_index BETWEEN 0 AND 4),
  channel text NOT NULL CHECK(channel IN ('email','in-app')), locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  endpoint_hash text NOT NULL CHECK(length(endpoint_hash)=64), outbox_id text NOT NULL UNIQUE REFERENCES outbox(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(revision_id,step_index,channel,endpoint_hash,locale), UNIQUE(enrollment_id,step_index,channel)
);
CREATE TRIGGER crm_campaign_delivery_immutable BEFORE UPDATE OR DELETE ON crm_campaign_deliveries FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

CREATE TABLE crm_campaign_suppressions (
  id uuid PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), sender_id text REFERENCES users(id),
  topic text NOT NULL CHECK(topic IN ('products','research','events','all')),
  channel text NOT NULL CHECK(channel IN ('email','in-app','all')),
  reason text NOT NULL CHECK(length(reason) BETWEEN 8 AND 500), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz, revoked_by text REFERENCES users(id), release_reason text,
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND release_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(release_reason) BETWEEN 8 AND 500))
);
CREATE UNIQUE INDEX crm_campaign_suppression_active ON crm_campaign_suppressions(user_id,COALESCE(sender_id,''),topic,channel) WHERE revoked_at IS NULL;
CREATE INDEX crm_campaign_suppression_recipient ON crm_campaign_suppressions(user_id,sender_id) WHERE revoked_at IS NULL;
