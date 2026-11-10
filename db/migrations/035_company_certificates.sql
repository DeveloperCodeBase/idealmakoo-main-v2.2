-- No demonstration or invented company certificates are seeded.
CREATE TABLE company_certificates (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK(slug~'^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 120),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),archived boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,revoked_by text REFERENCES users(id),revocation_reason text,
  created_by text NOT NULL REFERENCES users(id),updated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(revocation_reason) BETWEEN 10 AND 2000))
);
CREATE TABLE company_certificate_revisions (
  id uuid PRIMARY KEY,certificate_id uuid NOT NULL REFERENCES company_certificates(id),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),number integer NOT NULL CHECK(number>0),
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
  checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),
  resource_id uuid REFERENCES resources(id),resource_version_id uuid REFERENCES resource_versions(id),
  valid_from date,valid_until date,created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((resource_id IS NULL)=(resource_version_id IS NULL)),
  CHECK(valid_from IS NULL OR valid_until IS NULL OR valid_until>=valid_from),
  UNIQUE(certificate_id,locale,number),UNIQUE(id,certificate_id,locale)
);
CREATE TABLE company_certificate_drafts (
  certificate_id uuid NOT NULL REFERENCES company_certificates(id),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),revision_id uuid NOT NULL,
  PRIMARY KEY(certificate_id,locale),
  FOREIGN KEY(revision_id,certificate_id,locale) REFERENCES company_certificate_revisions(id,certificate_id,locale)
);
CREATE TABLE company_certificate_reviews (
  id bigserial PRIMARY KEY,revision_id uuid NOT NULL REFERENCES company_certificate_revisions(id),
  decision text NOT NULL CHECK(decision IN ('approved','rejected')),
  reviewer_id text NOT NULL REFERENCES users(id),reviewer_role text NOT NULL,
  reason text NOT NULL CHECK(length(reason)<=2000),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,revision_id)
);
CREATE TABLE company_certificate_releases (
  certificate_id uuid NOT NULL REFERENCES company_certificates(id),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  revision_id uuid NOT NULL,review_id bigint NOT NULL,
  published_by text NOT NULL REFERENCES users(id),published_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,withdrawn_reason text,
  PRIMARY KEY(certificate_id,locale),
  FOREIGN KEY(revision_id,certificate_id,locale) REFERENCES company_certificate_revisions(id,certificate_id,locale),
  FOREIGN KEY(review_id,revision_id) REFERENCES company_certificate_reviews(id,revision_id),
  CHECK((withdrawn_at IS NULL AND withdrawn_reason IS NULL) OR
    (withdrawn_at IS NOT NULL AND length(withdrawn_reason) BETWEEN 10 AND 2000))
);
CREATE TABLE company_certificate_alerts (
  id uuid PRIMARY KEY,revision_id uuid NOT NULL REFERENCES company_certificate_revisions(id),
  user_id text NOT NULL REFERENCES users(id),state text NOT NULL CHECK(state IN ('expiring','expired')),
  result text NOT NULL CHECK(result IN ('queued','suppressed')),outbox_id text UNIQUE REFERENCES outbox(id),
  created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(revision_id,user_id,state),
  CHECK((result='queued')=(outbox_id IS NOT NULL))
);
CREATE INDEX company_certificate_due ON company_certificate_revisions(valid_until,certificate_id,locale);
CREATE INDEX company_certificate_public ON company_certificate_releases(locale,certificate_id) WHERE withdrawn_at IS NULL;
CREATE INDEX company_certificate_review_order ON company_certificate_reviews(revision_id,id DESC);
CREATE INDEX company_certificate_alert_owner ON company_certificate_alerts(user_id,created_at DESC);
CREATE TRIGGER company_certificate_revision_immutable BEFORE UPDATE OR DELETE ON company_certificate_revisions FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER company_certificate_review_immutable BEFORE UPDATE OR DELETE ON company_certificate_reviews FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER company_certificate_alert_immutable BEFORE UPDATE OR DELETE ON company_certificate_alerts FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE TRIGGER company_certificate_retained BEFORE DELETE ON company_certificates FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
CREATE FUNCTION company_certificate_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.id<>OLD.id OR NEW.slug<>OLD.slug OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'Certificate identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason) THEN
    RAISE EXCEPTION 'Certificate revocation is irreversible; use a new independently reviewed certificate' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_certificate_identity BEFORE UPDATE ON company_certificates FOR EACH ROW EXECUTE FUNCTION company_certificate_identity_guard();
CREATE FUNCTION company_certificate_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.resource_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM resource_versions WHERE id=NEW.resource_version_id AND resource_id=NEW.resource_id) THEN
    RAISE EXCEPTION 'Certificate evidence must be a version of the selected resource' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_certificate_reference BEFORE INSERT ON company_certificate_revisions FOR EACH ROW EXECUTE FUNCTION company_certificate_reference_guard();
CREATE FUNCTION company_certificate_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM company_certificate_reviews a JOIN company_certificate_revisions r ON r.id=a.revision_id
    WHERE a.id=NEW.review_id AND a.revision_id=NEW.revision_id AND a.decision='approved' AND a.reviewer_id<>r.created_by
      AND r.resource_id IS NOT NULL AND r.valid_from IS NOT NULL AND r.valid_until IS NOT NULL) THEN
    RAISE EXCEPTION 'Certificate release requires its exact independently approved evidence revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_certificate_release_approval BEFORE INSERT OR UPDATE ON company_certificate_releases FOR EACH ROW EXECUTE FUNCTION company_certificate_release_guard();

CREATE FUNCTION company_certificate_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM company_certificate_revisions r WHERE r.id=NEW.revision_id AND r.created_by=NEW.reviewer_id) THEN
    RAISE EXCEPTION 'A certificate author cannot review their own revision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER company_certificate_independent_review BEFORE INSERT ON company_certificate_reviews FOR EACH ROW EXECUTE FUNCTION company_certificate_review_guard();
