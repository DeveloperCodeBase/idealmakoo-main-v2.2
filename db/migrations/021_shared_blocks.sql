CREATE TABLE shared_blocks (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shared_block_revisions (
  id uuid PRIMARY KEY,
  block_id uuid NOT NULL REFERENCES shared_blocks(id),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  revision_number integer NOT NULL CHECK(revision_number>0),
  base_revision_id uuid REFERENCES shared_block_revisions(id),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND NOT(payload?'id') AND NOT(payload?'shared')),
  checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(block_id,locale,revision_number)
);
CREATE INDEX shared_block_revisions_history_idx ON shared_block_revisions(block_id,created_at DESC,id DESC);
CREATE TABLE shared_block_asset_refs (
  revision_id uuid NOT NULL REFERENCES shared_block_revisions(id),
  asset_id text NOT NULL REFERENCES assets(id),
  PRIMARY KEY(revision_id,asset_id)
);
CREATE INDEX shared_block_asset_refs_asset_idx ON shared_block_asset_refs(asset_id);
CREATE FUNCTION protect_shared_block_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shared block revisions and retained asset references are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER protect_shared_block_revision BEFORE UPDATE OR DELETE ON shared_block_revisions FOR EACH ROW EXECUTE FUNCTION protect_shared_block_revision();
CREATE TRIGGER protect_shared_block_asset_ref BEFORE UPDATE OR DELETE ON shared_block_asset_refs FOR EACH ROW EXECUTE FUNCTION protect_shared_block_revision();
