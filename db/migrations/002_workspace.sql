-- CMS and CRM rows share a transactional workspace clock, never a client snapshot.
CREATE TABLE IF NOT EXISTS workspace_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  settings jsonb NOT NULL DEFAULT '{}',
  preferences_draft jsonb,
  preferences_published jsonb,
  initialized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workspace_meta(singleton) VALUES (true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_entities (
  bucket text NOT NULL CHECK (bucket IN ('records','pages','media','forms','aiJobs')),
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 160),
  collection text NOT NULL,
  locale text CHECK (locale IS NULL OR locale IN ('fa','en','tr','ar','ru')),
  status text NOT NULL DEFAULT 'draft',
  owner_id text,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object' AND data ->> 'id' = id),
  revision_number bigint NOT NULL DEFAULT 1 CHECK (revision_number > 0),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (bucket,id)
);
CREATE INDEX IF NOT EXISTS workspace_live_collection ON workspace_entities(collection,status,updated_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_live_owner ON workspace_entities(owner_id,updated_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_request_id ON workspace_entities((data ->> 'requestId')) WHERE bucket='records' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workspace_page_slug_locale ON workspace_entities((data ->> 'slug'),locale) WHERE bucket='pages' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_record_tags ON workspace_entities USING gin ((data -> 'tags')) WHERE bucket='records' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS workspace_record_search ON workspace_entities USING gin (to_tsvector('simple',coalesce(data -> 'title' ->> 'fa','') || ' ' || coalesce(data -> 'title' ->> 'en','') || ' ' || coalesce(data ->> 'organization',''))) WHERE bucket='records' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS content_revisions (
  id uuid PRIMARY KEY,
  document_bucket text NOT NULL,
  document_id text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('fa','en','tr','ar','ru')),
  revision_number bigint NOT NULL CHECK (revision_number > 0),
  base_revision_id uuid REFERENCES content_revisions(id),
  schema_version int NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_bucket,document_id,locale,revision_number),
  UNIQUE(id,document_bucket,document_id,locale)
);
CREATE INDEX IF NOT EXISTS content_revision_history ON content_revisions(document_bucket,document_id,locale,revision_number DESC);

CREATE TABLE IF NOT EXISTS content_approvals (
  revision_id uuid PRIMARY KEY REFERENCES content_revisions(id),
  approved_by text NOT NULL,
  approved_role text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION guard_content_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM content_revisions WHERE id=NEW.revision_id AND created_by=NEW.approved_by) THEN
    RAISE EXCEPTION 'Author cannot approve own revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS content_approval_identity ON content_approvals;
CREATE TRIGGER content_approval_identity BEFORE INSERT ON content_approvals FOR EACH ROW EXECUTE FUNCTION guard_content_approval();

CREATE TABLE IF NOT EXISTS locale_releases (
  document_bucket text NOT NULL,
  document_id text NOT NULL,
  locale text NOT NULL CHECK (locale IN ('fa','en','tr','ar','ru')),
  kind text NOT NULL,
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 240),
  active_revision_id uuid NOT NULL,
  publication jsonb NOT NULL CHECK (jsonb_typeof(publication) = 'object'),
  release_number bigint NOT NULL DEFAULT 1 CHECK (release_number > 0),
  lock_version bigint NOT NULL DEFAULT 1 CHECK (lock_version > 0),
  published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  unpublished_at timestamptz,
  PRIMARY KEY(document_bucket,document_id,locale),
  FOREIGN KEY(active_revision_id,document_bucket,document_id,locale) REFERENCES content_revisions(id,document_bucket,document_id,locale),
  UNIQUE(slug,locale,kind)
);
CREATE INDEX IF NOT EXISTS locale_releases_public ON locale_releases(locale,kind,published_at DESC) WHERE unpublished_at IS NULL;

CREATE TABLE IF NOT EXISTS workspace_audit (
  id bigserial PRIMARY KEY,
  activity_id text NOT NULL UNIQUE,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  bucket text,
  entity_id text,
  activity jsonb NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_audit_entity ON workspace_audit(bucket,entity_id,id DESC);
CREATE OR REPLACE FUNCTION workspace_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable audit or revision record' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS workspace_audit_immutable ON workspace_audit;
CREATE TRIGGER workspace_audit_immutable BEFORE UPDATE OR DELETE ON workspace_audit FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
DROP TRIGGER IF EXISTS content_revision_immutable ON content_revisions;
CREATE TRIGGER content_revision_immutable BEFORE UPDATE OR DELETE ON content_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
DROP TRIGGER IF EXISTS content_approval_immutable ON content_approvals;
CREATE TRIGGER content_approval_immutable BEFORE UPDATE OR DELETE ON content_approvals FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

CREATE TABLE IF NOT EXISTS workspace_publish_jobs (
  id uuid PRIMARY KEY,
  document_bucket text NOT NULL,
  document_id text NOT NULL,
  locale text NOT NULL,
  revision_id uuid NOT NULL REFERENCES content_revisions(id),
  publication jsonb NOT NULL,
  requested_by text NOT NULL,
  requested_role text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','cancelled','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS workspace_publish_due ON workspace_publish_jobs(due_at,id) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS workspace_one_pending_release ON workspace_publish_jobs(document_bucket,document_id,locale) WHERE status='pending';

CREATE TABLE IF NOT EXISTS crm_lead_conversions (
  lead_id text PRIMARY KEY,
  opportunity_id text NOT NULL UNIQUE,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_merge_operations (
  id text PRIMARY KEY,
  target_id text NOT NULL,
  source_id text NOT NULL,
  collection text NOT NULL CHECK (collection IN ('accounts','contacts','leads')),
  snapshot jsonb NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz,
  CHECK (target_id <> source_id)
);
