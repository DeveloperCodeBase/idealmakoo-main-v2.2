-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): f6ca4b03372f77bcde6e1b8090decba88e79e476aa9fbede3fcb22c759348d19

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.


-- Recovered object: TABLE partner_public_approvals

CREATE TABLE partner_public_approvals (
    revision_id uuid NOT NULL,
    reviewer_id text NOT NULL,
    reviewer_role text NOT NULL,
    reason text NOT NULL,
    approved_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_public_approvals_reason_check CHECK (((length(reason) >= 10) AND (length(reason) <= 2000)))
);


-- Recovered object: TABLE partner_public_profiles

CREATE TABLE partner_public_profiles (
    id uuid NOT NULL,
    partner_id text NOT NULL,
    locale text NOT NULL,
    slug text NOT NULL,
    state text DEFAULT 'draft'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    current_revision_id uuid,
    published_revision_id uuid,
    published_at timestamp with time zone,
    created_by text NOT NULL,
    updated_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_public_profiles_check CHECK (((published_revision_id IS NULL) = (published_at IS NULL))),
    CONSTRAINT partner_public_profiles_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT partner_public_profiles_slug_check CHECK (((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND (length(slug) <= 120))),
    CONSTRAINT partner_public_profiles_state_check CHECK ((state = ANY (ARRAY['draft'::text, 'review'::text, 'approved'::text, 'archived'::text]))),
    CONSTRAINT partner_public_profiles_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE partner_public_revisions

CREATE TABLE partner_public_revisions (
    id uuid NOT NULL,
    profile_id uuid NOT NULL,
    revision_number integer NOT NULL,
    value jsonb NOT NULL,
    checksum text NOT NULL,
    agreement_stamp timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_public_revisions_checksum_check CHECK ((checksum ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT partner_public_revisions_revision_number_check CHECK ((revision_number > 0)),
    CONSTRAINT partner_public_revisions_value_check CHECK ((jsonb_typeof(value) = 'object'::text))
);


-- Recovered object: FUNCTION partner_profile_identity_guard()

CREATE FUNCTION partner_profile_identity_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN
  IF NEW.id<>OLD.id OR NEW.partner_id<>OLD.partner_id OR NEW.locale<>OLD.locale OR NEW.slug<>OLD.slug THEN RAISE EXCEPTION 'Published profile identity is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;


-- Recovered object: CONSTRAINT partner_public_approvals partner_public_approvals_pkey

ALTER TABLE ONLY partner_public_approvals
    ADD CONSTRAINT partner_public_approvals_pkey PRIMARY KEY (revision_id);


-- Recovered object: CONSTRAINT partner_public_profiles partner_public_profiles_locale_slug_key

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_public_profiles_locale_slug_key UNIQUE (locale, slug);


-- Recovered object: CONSTRAINT partner_public_profiles partner_public_profiles_partner_id_locale_key

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_public_profiles_partner_id_locale_key UNIQUE (partner_id, locale);


-- Recovered object: CONSTRAINT partner_public_profiles partner_public_profiles_pkey

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_public_profiles_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT partner_public_revisions partner_public_revisions_id_profile_id_key

ALTER TABLE ONLY partner_public_revisions
    ADD CONSTRAINT partner_public_revisions_id_profile_id_key UNIQUE (id, profile_id);


-- Recovered object: CONSTRAINT partner_public_revisions partner_public_revisions_pkey

ALTER TABLE ONLY partner_public_revisions
    ADD CONSTRAINT partner_public_revisions_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT partner_public_revisions partner_public_revisions_profile_id_revision_number_key

ALTER TABLE ONLY partner_public_revisions
    ADD CONSTRAINT partner_public_revisions_profile_id_revision_number_key UNIQUE (profile_id, revision_number);


-- Recovered object: INDEX partner_public_locale_directory

CREATE INDEX partner_public_locale_directory ON partner_public_profiles USING btree (locale, slug) WHERE (published_revision_id IS NOT NULL);


-- Recovered object: FK CONSTRAINT partner_public_approvals partner_public_approvals_reviewer_id_fkey

ALTER TABLE ONLY partner_public_approvals
    ADD CONSTRAINT partner_public_approvals_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT partner_public_approvals partner_public_approvals_revision_id_fkey

ALTER TABLE ONLY partner_public_approvals
    ADD CONSTRAINT partner_public_approvals_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES partner_public_revisions(id);


-- Recovered object: FK CONSTRAINT partner_public_profiles partner_profile_current_revision

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_profile_current_revision FOREIGN KEY (current_revision_id, id) REFERENCES partner_public_revisions(id, profile_id) DEFERRABLE INITIALLY DEFERRED;


-- Recovered object: FK CONSTRAINT partner_public_profiles partner_profile_published_revision

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_profile_published_revision FOREIGN KEY (published_revision_id, id) REFERENCES partner_public_revisions(id, profile_id) DEFERRABLE INITIALLY DEFERRED;


-- Recovered object: FK CONSTRAINT partner_public_profiles partner_public_profiles_created_by_fkey

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_public_profiles_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT partner_public_profiles partner_public_profiles_partner_id_fkey

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_public_profiles_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES crm_partner_agreements(partner_id);


-- Recovered object: FK CONSTRAINT partner_public_profiles partner_public_profiles_updated_by_fkey

ALTER TABLE ONLY partner_public_profiles
    ADD CONSTRAINT partner_public_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT partner_public_revisions partner_public_revisions_created_by_fkey

ALTER TABLE ONLY partner_public_revisions
    ADD CONSTRAINT partner_public_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT partner_public_revisions partner_public_revisions_profile_id_fkey

ALTER TABLE ONLY partner_public_revisions
    ADD CONSTRAINT partner_public_revisions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES partner_public_profiles(id);


-- Recovered object: TRIGGER partner_public_approvals partner_approval_immutable

CREATE TRIGGER partner_approval_immutable BEFORE DELETE OR UPDATE ON partner_public_approvals FOR EACH ROW EXECUTE FUNCTION workspace_append_only();


-- Recovered object: TRIGGER partner_public_profiles partner_profile_history

CREATE TRIGGER partner_profile_history BEFORE DELETE ON partner_public_profiles FOR EACH ROW EXECUTE FUNCTION workspace_append_only();


-- Recovered object: TRIGGER partner_public_profiles partner_profile_identity

CREATE TRIGGER partner_profile_identity BEFORE UPDATE ON partner_public_profiles FOR EACH ROW EXECUTE FUNCTION partner_profile_identity_guard();


-- Recovered object: TRIGGER partner_public_revisions partner_revision_immutable

CREATE TRIGGER partner_revision_immutable BEFORE DELETE OR UPDATE ON partner_public_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
