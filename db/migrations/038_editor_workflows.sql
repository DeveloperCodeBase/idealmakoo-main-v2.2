-- Existing snapshots remain immutable. Forms join the existing authoring lease
-- namespace; no public preview or response data is copied into a form revision.
ALTER TABLE content_edit_leases DROP CONSTRAINT content_edit_leases_document_bucket_check;
ALTER TABLE content_edit_leases ADD CONSTRAINT content_edit_leases_document_bucket_check
 CHECK(document_bucket IN ('records','pages','forms'));

UPDATE workspace_entities
 SET data=data || jsonb_build_object('status',CASE WHEN deleted_at IS NOT NULL OR status='archived' THEN 'archived' ELSE 'active' END,
   'updatedAt',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
 status=CASE WHEN deleted_at IS NOT NULL OR status='archived' THEN 'archived' ELSE 'active' END
 WHERE bucket='forms';

CREATE TABLE content_translation_acknowledgements (
 id uuid PRIMARY KEY,
 document_bucket text NOT NULL CHECK(document_bucket IN ('records','pages')),
 target_document_id text NOT NULL,
 target_locale text NOT NULL CHECK(target_locale IN ('fa','en','tr','ar','ru')),
 source_document_id text NOT NULL,
 source_locale text NOT NULL CHECK(source_locale IN ('fa','en','tr','ar','ru')),
 source_revision_id uuid NOT NULL,
 target_revision_id uuid NOT NULL,
 source_checksum text NOT NULL CHECK(source_checksum ~ '^[a-f0-9]{64}$'),
 target_checksum text NOT NULL CHECK(target_checksum ~ '^[a-f0-9]{64}$'),
 acknowledged_by text NOT NULL REFERENCES users(id),
 acknowledged_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_locale<>target_locale),
 FOREIGN KEY(source_revision_id,document_bucket,source_document_id,source_locale)
  REFERENCES content_revisions(id,document_bucket,document_id,locale),
 FOREIGN KEY(target_revision_id,document_bucket,target_document_id,target_locale)
  REFERENCES content_revisions(id,document_bucket,document_id,locale),
 UNIQUE(document_bucket,target_document_id,target_locale,source_locale,source_revision_id,target_revision_id)
);
CREATE INDEX content_translation_acknowledgements_current_idx
 ON content_translation_acknowledgements(document_bucket,target_document_id,target_locale,source_locale,acknowledged_at DESC,id);
CREATE FUNCTION protect_content_translation_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Translation acknowledgements are immutable editorial evidence' USING ERRCODE='23514';
END $$;
CREATE TRIGGER protect_content_translation_acknowledgement
 BEFORE UPDATE OR DELETE ON content_translation_acknowledgements
 FOR EACH ROW EXECUTE FUNCTION protect_content_translation_acknowledgement();
