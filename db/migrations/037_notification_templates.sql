-- Editable plain-text transactional templates. Runtime text and capability values
-- remain encrypted in the existing outbox; this ledger contains hashes only.
CREATE TABLE notification_templates (
  id uuid PRIMARY KEY,
  template_key text NOT NULL CHECK(template_key IN ('transactional_message','request_received','request_updated','task_reminder','activity_reminder','certificate_expiring','certificate_expired','password_reset','email_verification','staff_invitation','organization_invitation','contact_verification','contact_preferences','survey_invitation')),
  channel text NOT NULL CHECK(channel IN ('email','in-app','sms','telegram','push')),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','review','approved','archived')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  current_revision_id uuid,
  active_release_id uuid,
  created_by text NOT NULL REFERENCES users(id),updated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_key,channel,locale)
);
CREATE TABLE notification_template_revisions (
  id uuid PRIMARY KEY,template_id uuid NOT NULL REFERENCES notification_templates(id),
  number integer NOT NULL CHECK(number>0),definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
  checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id,number),UNIQUE(template_id,id)
);
CREATE TABLE notification_template_reviews (
  id uuid PRIMARY KEY,revision_id uuid NOT NULL REFERENCES notification_template_revisions(id),
  decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  reviewer_id text NOT NULL REFERENCES users(id),reviewer_role text NOT NULL,reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(revision_id,id)
);
CREATE TABLE notification_template_releases (
  id uuid PRIMARY KEY,template_id uuid NOT NULL REFERENCES notification_templates(id),
  revision_id uuid NOT NULL,review_id uuid NOT NULL,activated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(template_id,id),
  FOREIGN KEY(template_id,revision_id) REFERENCES notification_template_revisions(template_id,id),
  FOREIGN KEY(revision_id,review_id) REFERENCES notification_template_reviews(revision_id,id)
);
ALTER TABLE notification_templates ADD FOREIGN KEY(id,current_revision_id) REFERENCES notification_template_revisions(template_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE notification_templates ADD FOREIGN KEY(id,active_release_id) REFERENCES notification_template_releases(template_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE notification_template_uses (
  outbox_id text PRIMARY KEY REFERENCES outbox(id),
  template_key text NOT NULL,channel text NOT NULL,locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  release_id uuid REFERENCES notification_template_releases(id),
  source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
  render_hash text NOT NULL CHECK(render_hash ~ '^[a-f0-9]{64}$'),
  builtin_hash text NOT NULL CHECK(builtin_hash ~ '^[a-f0-9]{64}$'),
  decision text NOT NULL CHECK(decision IN ('custom','builtin','content_limit','authority_revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_template_render_events (
  id bigserial PRIMARY KEY,outbox_id text NOT NULL REFERENCES notification_template_uses(outbox_id),
  decision text NOT NULL CHECK(decision IN ('custom','builtin','withdrawn','authority_revoked','content_limit')),
  render_hash text NOT NULL CHECK(render_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(outbox_id,decision,render_hash)
);
CREATE INDEX notification_template_locale_state ON notification_templates(locale,state,channel);
CREATE INDEX notification_template_history ON notification_template_revisions(template_id,number DESC);
CREATE INDEX notification_template_review_history ON notification_template_reviews(revision_id,created_at DESC,id);
CREATE INDEX notification_template_delivery_lookup ON notification_template_uses(locale,created_at DESC,outbox_id);
CREATE INDEX notification_template_lifecycle_audit ON audit_events(entity_id,id) WHERE entity_type='notification_template' AND action IN ('notification.template.activate','notification.template.deactivate','notification.template.archive');
CREATE FUNCTION notification_template_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Notification template history is immutable' USING ERRCODE='23514'; END;$$;
CREATE TRIGGER notification_template_revision_immutable BEFORE UPDATE OR DELETE ON notification_template_revisions FOR EACH ROW EXECUTE FUNCTION notification_template_immutable();
CREATE TRIGGER notification_template_review_immutable BEFORE UPDATE OR DELETE ON notification_template_reviews FOR EACH ROW EXECUTE FUNCTION notification_template_immutable();
CREATE TRIGGER notification_template_release_immutable BEFORE UPDATE OR DELETE ON notification_template_releases FOR EACH ROW EXECUTE FUNCTION notification_template_immutable();
CREATE TRIGGER notification_template_use_immutable BEFORE UPDATE OR DELETE ON notification_template_uses FOR EACH ROW EXECUTE FUNCTION notification_template_immutable();
CREATE TRIGGER notification_template_render_immutable BEFORE UPDATE OR DELETE ON notification_template_render_events FOR EACH ROW EXECUTE FUNCTION notification_template_immutable();
