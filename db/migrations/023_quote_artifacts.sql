-- A quote revision owns immutable PDF bytes. This binary artifact is included
-- in the database backup and is separate from uploaded-media storage quotas.
ALTER TABLE quote_snapshots ADD CONSTRAINT quote_snapshot_identity_unique UNIQUE(id,record_id,request_id);

CREATE TABLE quote_revision_files (
  quote_id text PRIMARY KEY REFERENCES quote_snapshots(id),
  issuance_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  pdf_bytes bytea NOT NULL,
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK(byte_count BETWEEN 5 AND 4194304),
  origin text NOT NULL CHECK(origin IN ('issued','legacy-rendered')),
  renderer_version text NOT NULL DEFAULT 'idealmakoo-pdf-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(octet_length(pdf_bytes)=byte_count),
  CHECK(sha256=encode(sha256(pdf_bytes),'hex')),
  CHECK(substring(pdf_bytes FROM 1 FOR 5)=decode('255044462d','hex'))
);
CREATE TRIGGER quote_revision_files_immutable BEFORE UPDATE OR DELETE ON quote_revision_files
  FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

CREATE TABLE crm_quote_envelopes (
  record_id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests(id),
  current_revision_id text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(current_revision_id,record_id,request_id)
    REFERENCES quote_snapshots(id,record_id,request_id)
);
CREATE INDEX crm_quote_envelopes_request ON crm_quote_envelopes(request_id,record_id);

-- Keep existing issued identities, including an archived or older workspace
-- source. A backfill records the latest stored issue; it invents no approval,
-- issue event, PDF, or replacement commercial snapshot.
INSERT INTO crm_quote_envelopes(record_id,request_id,current_revision_id,updated_at)
SELECT DISTINCT ON(record_id) record_id,request_id,id,created_at
FROM quote_snapshots ORDER BY record_id,created_at DESC,id DESC;

CREATE FUNCTION validate_quote_revision_file() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb;
BEGIN
  SELECT snapshot INTO document FROM quote_snapshots WHERE id=NEW.quote_id;
  IF document IS NULL THEN RAISE EXCEPTION 'Quotation snapshot is required' USING ERRCODE='23514'; END IF;
  IF NEW.origin='issued' THEN
    IF document->>'fileSha256' IS DISTINCT FROM NEW.sha256
       OR (document->>'fileByteCount')::integer IS DISTINCT FROM NEW.byte_count
       OR document->>'fileOrigin' IS DISTINCT FROM 'issued'
       OR (document->>'fileCreatedAt')::timestamptz IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION 'Issued PDF metadata must match its immutable snapshot' USING ERRCODE='23514';
    END IF;
  ELSIF document ?| ARRAY['fileSha256','fileByteCount','fileOrigin','fileCreatedAt'] THEN
    RAISE EXCEPTION 'An issued artifact cannot be replaced by a legacy rendering' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_revision_files_binding BEFORE INSERT ON quote_revision_files
  FOR EACH ROW EXECUTE FUNCTION validate_quote_revision_file();

CREATE FUNCTION protect_quote_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_sequence bigint;previous_sequence bigint;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued quote envelopes cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND (NEW.record_id IS DISTINCT FROM OLD.record_id
      OR NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.current_revision_id=OLD.current_revision_id OR NEW.version<>OLD.version+1) THEN
    RAISE EXCEPTION 'Quote envelope identity and revision history are protected' USING ERRCODE='23514';
  END IF;
  SELECT issuance_sequence INTO next_sequence FROM quote_revision_files
    WHERE quote_id=NEW.current_revision_id AND origin='issued';
  IF next_sequence IS NULL THEN RAISE EXCEPTION 'A current revision needs a stored issuance artifact' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN
    SELECT issuance_sequence INTO previous_sequence FROM quote_revision_files WHERE quote_id=OLD.current_revision_id;
    IF next_sequence<=coalesce(previous_sequence,0) THEN
      RAISE EXCEPTION 'A quote envelope cannot move to an older issued artifact' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_quote_envelopes_protected BEFORE INSERT OR UPDATE OR DELETE ON crm_quote_envelopes
  FOR EACH ROW EXECUTE FUNCTION protect_quote_envelope();

-- Every post-migration insertion must use the issuance transaction. Legacy rows
-- were already present before this migration and are never newly fabricated.

-- Customer response remains mutable once. All issued identity, commercial
-- fields, dates and provenance are immutable, including older revisions.
CREATE OR REPLACE FUNCTION protect_quote_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued quote snapshots cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','response','responded_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','response','responded_at']) THEN
    RAISE EXCEPTION 'Issued quote snapshots are immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.status,NEW.response,NEW.responded_at) IS DISTINCT FROM (OLD.status,OLD.response,OLD.responded_at)
     AND (OLD.status<>'issued' OR NEW.status NOT IN ('accepted_interest','declined','revision_requested')
          OR NEW.responded_at IS NULL OR length(coalesce(NEW.response,''))>4000) THEN
    RAISE EXCEPTION 'A customer may answer an issued revision only once' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER quote_snapshot_immutable ON quote_snapshots;
CREATE TRIGGER quote_snapshot_immutable BEFORE UPDATE OR DELETE ON quote_snapshots
  FOR EACH ROW EXECUTE FUNCTION protect_quote_snapshot();

CREATE FUNCTION require_issued_quote_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot->>'id' IS DISTINCT FROM NEW.id
     OR NEW.snapshot->>'recordId' IS DISTINCT FROM NEW.record_id
     OR NEW.snapshot->>'requestId' IS DISTINCT FROM NEW.request_id
     OR NEW.snapshot->>'snapshotHash' IS DISTINCT FROM NEW.snapshot_hash
     OR NOT EXISTS(
    SELECT 1 FROM quote_revision_files f JOIN crm_quote_envelopes e
      ON e.current_revision_id=f.quote_id AND e.record_id=NEW.record_id AND e.request_id=NEW.request_id
    WHERE f.quote_id=NEW.id AND f.origin='issued' AND f.sha256=NEW.snapshot->>'fileSha256'
  ) THEN RAISE EXCEPTION 'Snapshot, PDF artifact and current envelope must commit together' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER issued_quote_artifact_required AFTER INSERT ON quote_snapshots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_issued_quote_artifact();
