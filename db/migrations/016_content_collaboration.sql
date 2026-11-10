CREATE TABLE content_edit_leases (
  id uuid PRIMARY KEY,
  document_bucket text NOT NULL CHECK(document_bucket IN ('records','pages')),
  document_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL,
  token_hash text NOT NULL,
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  renewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_bucket,document_id),
  FOREIGN KEY(document_bucket,document_id) REFERENCES workspace_entities(bucket,id)
);
CREATE INDEX content_edit_leases_expiry_idx ON content_edit_leases(lease_until);

CREATE TABLE content_previews (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  document_bucket text NOT NULL CHECK(document_bucket IN ('records','pages')),
  document_id text NOT NULL,
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  revision_id uuid NOT NULL REFERENCES content_revisions(id),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY(document_bucket,document_id) REFERENCES workspace_entities(bucket,id),
  CHECK(expires_at>created_at)
);
CREATE INDEX content_previews_document_idx ON content_previews(document_bucket,document_id,created_at DESC);
CREATE INDEX content_previews_expiry_idx ON content_previews(expires_at);
CREATE FUNCTION protect_content_preview_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Preview snapshots and revocations are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_content_preview_snapshot BEFORE UPDATE ON content_previews FOR EACH ROW EXECUTE FUNCTION protect_content_preview_snapshot();
