-- Non-destructive image provenance and current distribution rights.
-- Raw originals remain private; their derivative is the ordinary media asset.
CREATE TABLE asset_image_sources (
  asset_id text PRIMARY KEY REFERENCES assets(id),
  original_asset_id text NOT NULL UNIQUE REFERENCES assets(id),
  width integer NOT NULL CHECK(width BETWEEN 1 AND 32000000),
  height integer NOT NULL CHECK(height BETWEEN 1 AND 32000000),
  original_sha256 text NOT NULL CHECK(original_sha256~'^[a-f0-9]{64}$'),
  created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(asset_id<>original_asset_id),CHECK(width::bigint*height<=32000000)
);
CREATE TRIGGER asset_image_sources_immutable BEFORE UPDATE OR DELETE ON asset_image_sources FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE asset_image_derivatives (
  asset_id text PRIMARY KEY REFERENCES assets(id),
  source_asset_id text NOT NULL REFERENCES assets(id),
  recipe jsonb NOT NULL CHECK(jsonb_typeof(recipe)='object'),
  source_sha256 text NOT NULL CHECK(source_sha256~'^[a-f0-9]{64}$'),
  created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(asset_id<>source_asset_id)
);
CREATE INDEX asset_image_derivatives_source ON asset_image_derivatives(source_asset_id,created_at,asset_id);
CREATE TRIGGER asset_image_derivatives_immutable BEFORE UPDATE OR DELETE ON asset_image_derivatives FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE asset_usage_policies (
  asset_id text PRIMARY KEY REFERENCES assets(id),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  rights_confirmed boolean NOT NULL,rights_expires_at timestamptz,
  license_note text NOT NULL DEFAULT '' CHECK(length(license_note)<=2000),
  updated_by text NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
