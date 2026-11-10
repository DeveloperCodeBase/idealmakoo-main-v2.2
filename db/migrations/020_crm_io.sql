CREATE TABLE crm_inbox_connectors (
  id uuid PRIMARY KEY,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),provider_label text NOT NULL CHECK(length(provider_label) BETWEEN 1 AND 120),
  channel text NOT NULL CHECK(channel IN ('email','sms','telegram','push','other')),secret_encrypted text NOT NULL,
  active boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),credential_version integer NOT NULL DEFAULT 1 CHECK(credential_version>0),
  team_id text REFERENCES crm_teams(id),territory_id text REFERENCES crm_territories(id),quality_quarantined boolean NOT NULL DEFAULT false,
  created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_inbox_items (
  id uuid PRIMARY KEY,connector_id uuid NOT NULL REFERENCES crm_inbox_connectors(id),provider_event_id text NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 160),
  body_hash text NOT NULL CHECK(body_hash~'^[a-f0-9]{64}$'),payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND payload ? 'encrypted'),
  connector_name text NOT NULL,provider_label text NOT NULL,channel text NOT NULL CHECK(channel IN ('email','sms','telegram','push','other')),
  team_id text REFERENCES crm_teams(id),territory_id text REFERENCES crm_territories(id),quality_quarantined boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','associated','archived')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
  request_id text REFERENCES requests(id),request_message_id text UNIQUE REFERENCES request_messages(id),
  received_at timestamptz NOT NULL DEFAULT now(),associated_by text REFERENCES users(id),associated_at timestamptz,updated_by text REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(connector_id,provider_event_id),CHECK((request_id IS NULL)=(request_message_id IS NULL)),CHECK(state<>'associated' OR request_id IS NOT NULL)
);
CREATE INDEX crm_inbox_cursor ON crm_inbox_items(received_at DESC,id DESC);
CREATE INDEX crm_inbox_request ON crm_inbox_items(request_id,received_at DESC) WHERE request_id IS NOT NULL;
CREATE FUNCTION crm_inbox_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Inbound provider evidence is immutable'; END IF;
  IF (to_jsonb(OLD)-ARRAY['state','version','request_id','request_message_id','associated_by','associated_at','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','version','request_id','request_message_id','associated_by','associated_at','updated_by','updated_at']) OR
     (OLD.request_id IS NOT NULL AND (OLD.request_id IS DISTINCT FROM NEW.request_id OR OLD.request_message_id IS DISTINCT FROM NEW.request_message_id OR OLD.associated_by IS DISTINCT FROM NEW.associated_by OR OLD.associated_at IS DISTINCT FROM NEW.associated_at)) THEN
    RAISE EXCEPTION 'Inbound evidence and an existing association are immutable';
  END IF; RETURN NEW;
END $$;
CREATE TRIGGER crm_inbox_item_immutable BEFORE UPDATE OR DELETE ON crm_inbox_items FOR EACH ROW EXECUTE FUNCTION crm_inbox_item_guard();

CREATE TABLE crm_transfer_jobs (
  id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('import','export')),collection text NOT NULL CHECK(collection IN ('contacts','leads')),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('preview','queued','running','paused','completed','cancelled','failed')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
  row_count integer NOT NULL CHECK(row_count BETWEEN 0 AND 2000),created_by text NOT NULL REFERENCES users(id),last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz
);
CREATE INDEX crm_transfer_owner ON crm_transfer_jobs(created_by,created_at DESC,id);
CREATE INDEX crm_transfer_pending ON crm_transfer_jobs(updated_at,id) WHERE state IN ('queued','running');
CREATE UNIQUE INDEX crm_transfer_import_source ON crm_transfer_jobs(created_by,collection,source_hash) WHERE kind='import';
CREATE TABLE crm_transfer_rows (
  job_id uuid NOT NULL REFERENCES crm_transfer_jobs(id),row_number integer NOT NULL CHECK(row_number BETWEEN 1 AND 2000),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),state text NOT NULL CHECK(state IN ('invalid','ready','applied','failed','exported')),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND payload ? 'encrypted'),issues jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(issues)='array'),
  planned_record_id text NOT NULL,record_bucket text NOT NULL DEFAULT 'records' CHECK(record_bucket='records'),source_record_id text,
  processed_at timestamptz,PRIMARY KEY(job_id,row_number),UNIQUE(job_id,planned_record_id),
  FOREIGN KEY(record_bucket,source_record_id) REFERENCES workspace_entities(bucket,id),
  CHECK(state NOT IN ('applied','exported') OR source_record_id IS NOT NULL)
);
CREATE INDEX crm_transfer_ready ON crm_transfer_rows(job_id,row_number) WHERE state='ready';
CREATE FUNCTION crm_transfer_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Transfer row evidence is immutable'; END IF;
  IF OLD.job_id<>NEW.job_id OR OLD.row_number<>NEW.row_number OR OLD.planned_record_id<>NEW.planned_record_id OR (OLD.state IN ('applied','exported') AND to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)) THEN RAISE EXCEPTION 'Applied transfer evidence is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_transfer_row_immutable BEFORE UPDATE OR DELETE ON crm_transfer_rows FOR EACH ROW EXECUTE FUNCTION crm_transfer_row_guard();

-- An external import key belongs to one authenticated importer and collection.
-- It is never an account identity, and cannot silently update an existing row.
CREATE TABLE crm_import_external_keys (
  created_by text NOT NULL REFERENCES users(id),collection text NOT NULL CHECK(collection IN ('contacts','leads')),
  external_key_hash text NOT NULL CHECK(external_key_hash~'^[a-f0-9]{64}$'),
  record_bucket text NOT NULL DEFAULT 'records' CHECK(record_bucket='records'),record_id text NOT NULL,
  job_id uuid NOT NULL,row_number integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(created_by,collection,external_key_hash),
  FOREIGN KEY(record_bucket,record_id) REFERENCES workspace_entities(bucket,id),
  FOREIGN KEY(job_id,row_number) REFERENCES crm_transfer_rows(job_id,row_number)
);
CREATE FUNCTION crm_import_external_key_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Applied import identities are immutable';
END $$;
CREATE TRIGGER crm_import_external_key_immutable BEFORE UPDATE OR DELETE ON crm_import_external_keys FOR EACH ROW EXECUTE FUNCTION crm_import_external_key_guard();
