CREATE TABLE data_rooms (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE,
  title jsonb NOT NULL, summary jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE resources (
  id uuid PRIMARY KEY, slug text NOT NULL UNIQUE,
  title jsonb NOT NULL, summary jsonb NOT NULL DEFAULT '{}',
  type text NOT NULL CHECK(type IN ('catalog','brochure','ifu','sds','shade','mould','research','other')),
  visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','authenticated','restricted')),
  room_id uuid REFERENCES data_rooms(id),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  current_version_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_by text NOT NULL REFERENCES users(id), updated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(room_id IS NULL OR visibility='restricted'),
  CHECK(status<>'published' OR current_version_id IS NOT NULL)
);
CREATE INDEX resources_public_idx ON resources(status,visibility,updated_at DESC);
CREATE INDEX resources_room_idx ON resources(room_id);
CREATE TABLE resource_versions (
  id uuid PRIMARY KEY, resource_id uuid NOT NULL REFERENCES resources(id),
  number integer NOT NULL CHECK(number>0), label text NOT NULL,
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  asset_id text NOT NULL REFERENCES assets(id), filename text NOT NULL,
  mime_type text NOT NULL, bytes bigint NOT NULL CHECK(bytes>0), sha256 text NOT NULL,
  metadata_snapshot jsonb NOT NULL, metadata_hash text NOT NULL,
  rights_confirmed boolean NOT NULL CHECK(rights_confirmed), rights_expires_at timestamptz,
  created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_id,number), UNIQUE(resource_id,id)
);
ALTER TABLE resources ADD CONSTRAINT resources_current_version_fk FOREIGN KEY(id,current_version_id) REFERENCES resource_versions(resource_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX resource_versions_asset_idx ON resource_versions(asset_id);
CREATE TABLE resource_reviews (
  id uuid PRIMARY KEY, version_id uuid NOT NULL REFERENCES resource_versions(id),
  reviewer_id text NOT NULL REFERENCES users(id), decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resource_reviews_latest_idx ON resource_reviews(version_id,created_at DESC,id DESC);
CREATE TABLE resource_publications (
  id uuid PRIMARY KEY, resource_id uuid NOT NULL REFERENCES resources(id),
  version_id uuid NOT NULL REFERENCES resource_versions(id), published_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(resource_id,version_id)
);
CREATE TABLE access_grants (
  id uuid PRIMARY KEY, resource_id uuid REFERENCES resources(id), room_id uuid REFERENCES data_rooms(id),
  user_id text REFERENCES users(id), organization_id uuid REFERENCES customer_organizations(id),
  can_view boolean NOT NULL DEFAULT true, can_download boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
  granted_by text NOT NULL REFERENCES users(id), revoked_by text REFERENCES users(id), revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(resource_id,room_id)=1), CHECK(num_nonnulls(user_id,organization_id)=1),
  CHECK(can_view), CHECK(NOT can_download OR can_view)
);
CREATE INDEX access_grants_user_idx ON access_grants(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX access_grants_organization_idx ON access_grants(organization_id,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX access_grants_resource_idx ON access_grants(resource_id,room_id) WHERE revoked_at IS NULL;
CREATE OR REPLACE FUNCTION resource_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Resource versions, reviews and publication history are immutable'; END $$;
CREATE TRIGGER resource_versions_immutable BEFORE UPDATE OR DELETE ON resource_versions FOR EACH ROW EXECUTE FUNCTION resource_history_immutable();
CREATE TRIGGER resource_reviews_immutable BEFORE UPDATE OR DELETE ON resource_reviews FOR EACH ROW EXECUTE FUNCTION resource_history_immutable();
CREATE TRIGGER resource_publications_immutable BEFORE UPDATE OR DELETE ON resource_publications FOR EACH ROW EXECUTE FUNCTION resource_history_immutable();
