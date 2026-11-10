-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): cc4821b17b31355ed18a802b63d09c50af25aeb7373e0faa3679fcd78b42294f

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.


-- Recovered object: TABLE tender_asset_bindings

CREATE TABLE tender_asset_bindings (
    asset_id text NOT NULL,
    bid_id uuid NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_asset_bindings_kind_check CHECK ((kind = ANY (ARRAY['technical'::text, 'financial'::text])))
);


-- Recovered object: TABLE tender_asset_refs

CREATE TABLE tender_asset_refs (
    bid_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    kind text NOT NULL,
    asset_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


-- Recovered object: TABLE tender_bid_events

CREATE TABLE tender_bid_events (
    id uuid NOT NULL,
    bid_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    action text NOT NULL,
    actor_id text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_bid_events_action_check CHECK ((action = ANY (ARRAY['submitted'::text, 'revised'::text, 'withdrawn'::text, 'technical_accepted'::text, 'technical_rejected'::text, 'finance_opened'::text]))),
    CONSTRAINT tender_bid_events_reason_check CHECK (((length(reason) >= 10) AND (length(reason) <= 2000)))
);


-- Recovered object: TABLE tender_bid_revisions

CREATE TABLE tender_bid_revisions (
    id uuid NOT NULL,
    bid_id uuid NOT NULL,
    call_id uuid NOT NULL,
    call_revision_id uuid NOT NULL,
    number integer NOT NULL,
    contact_encrypted text NOT NULL,
    contact_hash text NOT NULL,
    consent_snapshot jsonb NOT NULL,
    submitted_by text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_bid_revisions_consent_snapshot_check CHECK (((consent_snapshot ->> 'purpose'::text) = 'request_processing'::text)),
    CONSTRAINT tender_bid_revisions_contact_hash_check CHECK ((contact_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT tender_bid_revisions_number_check CHECK ((number > 0))
);


-- Recovered object: TABLE tender_bids

CREATE TABLE tender_bids (
    id uuid NOT NULL,
    call_id uuid NOT NULL,
    request_id text NOT NULL,
    owner_id text NOT NULL,
    locale text NOT NULL,
    current_revision_id uuid NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    technical_reviewed_by text,
    technical_reviewed_at timestamp with time zone,
    finance_opened_by text,
    finance_opened_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_bids_check CHECK (((technical_reviewed_by IS NULL) = (technical_reviewed_at IS NULL))),
    CONSTRAINT tender_bids_check1 CHECK (((finance_opened_by IS NULL) = (finance_opened_at IS NULL))),
    CONSTRAINT tender_bids_check2 CHECK (((status <> 'financial_open'::text) OR ((technical_reviewed_by IS NOT NULL) AND (finance_opened_by IS NOT NULL) AND (technical_reviewed_by <> finance_opened_by)))),
    CONSTRAINT tender_bids_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT tender_bids_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'withdrawn'::text, 'technical_accepted'::text, 'technical_rejected'::text, 'financial_open'::text]))),
    CONSTRAINT tender_bids_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE tender_call_reviews

CREATE TABLE tender_call_reviews (
    id uuid NOT NULL,
    call_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    reviewer_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_call_reviews_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'rejected'::text]))),
    CONSTRAINT tender_call_reviews_reason_check CHECK (((length(reason) >= 10) AND (length(reason) <= 2000)))
);


-- Recovered object: TABLE tender_call_revisions

CREATE TABLE tender_call_revisions (
    id uuid NOT NULL,
    call_id uuid NOT NULL,
    number integer NOT NULL,
    definition jsonb NOT NULL,
    definition_hash text NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    deadline_at timestamp with time zone NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_call_revisions_check CHECK ((deadline_at > opens_at)),
    CONSTRAINT tender_call_revisions_definition_check CHECK ((jsonb_typeof(definition) = 'object'::text)),
    CONSTRAINT tender_call_revisions_definition_hash_check CHECK ((definition_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT tender_call_revisions_number_check CHECK ((number > 0))
);


-- Recovered object: TABLE tender_calls

CREATE TABLE tender_calls (
    id uuid NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    current_revision_id uuid NOT NULL,
    published_revision_id uuid,
    version integer DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_calls_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'closed'::text, 'cancelled'::text]))),
    CONSTRAINT tender_calls_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE tender_envelopes

CREATE TABLE tender_envelopes (
    bid_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    kind text NOT NULL,
    payload_encrypted text NOT NULL,
    payload_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tender_envelopes_kind_check CHECK ((kind = ANY (ARRAY['technical'::text, 'financial'::text]))),
    CONSTRAINT tender_envelopes_payload_hash_check CHECK ((payload_hash ~ '^[0-9a-f]{64}$'::text))
);


-- Recovered object: TABLE tender_reviewer_grants

CREATE TABLE tender_reviewer_grants (
    call_id uuid NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    granted_by text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT tender_reviewer_grants_check CHECK ((active = (revoked_at IS NULL))),
    CONSTRAINT tender_reviewer_grants_kind_check CHECK ((kind = ANY (ARRAY['technical'::text, 'financial'::text])))
);


-- Recovered object: FUNCTION check_tender_submission_contract()

CREATE FUNCTION check_tender_submission_contract() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE revision tender_bid_revisions%ROWTYPE; bid tender_bids%ROWTYPE; request_owner text; request_kind text;
BEGIN
  SELECT * INTO revision FROM tender_bid_revisions WHERE id=NEW.id;
  SELECT * INTO bid FROM tender_bids WHERE id=revision.bid_id;
  SELECT owner_id,kind INTO request_owner,request_kind FROM requests WHERE id=bid.request_id;
  IF request_owner IS DISTINCT FROM bid.owner_id OR request_kind<>'outsourcing_bid' OR revision.submitted_by<>bid.owner_id THEN
    RAISE EXCEPTION 'A tender revision must belong to its authenticated request owner';
  END IF;
  IF (SELECT count(*) FROM tender_envelopes WHERE revision_id=revision.id)<>2 THEN
    RAISE EXCEPTION 'Both confidential tender envelopes must commit together';
  END IF;
  IF EXISTS(SELECT 1 FROM tender_envelopes e WHERE e.revision_id=revision.id AND NOT EXISTS(SELECT 1 FROM tender_asset_refs a WHERE a.revision_id=e.revision_id AND a.kind=e.kind)) THEN
    RAISE EXCEPTION 'Each tender envelope requires its retained document references';
  END IF;
  IF EXISTS(SELECT 1 FROM tender_asset_refs r JOIN assets a ON a.id=r.asset_id WHERE r.revision_id=revision.id AND (a.owner_id IS DISTINCT FROM bid.owner_id OR a.visibility<>'private' OR a.request_id IS NOT NULL OR a.deleted_at IS NOT NULL OR a.scan_status<>'clean')) THEN
    RAISE EXCEPTION 'A submitted envelope requires private, clean, owner-bound retained files';
  END IF;
  RETURN NULL;
END $$;


-- Recovered object: FUNCTION protect_tender_identity()

CREATE FUNCTION protect_tender_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME='tender_calls' THEN
    IF (NEW.id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.created_by,OLD.created_at) OR
       (OLD.published_revision_id IS NOT NULL AND (NEW.current_revision_id,NEW.published_revision_id) IS DISTINCT FROM (OLD.current_revision_id,OLD.published_revision_id)) OR
       (OLD.status='cancelled' AND NEW.status<>OLD.status) OR (OLD.status='closed' AND NEW.status='open') THEN
      RAISE EXCEPTION 'Published tender identity and conditions are immutable';
    END IF;
  ELSE
    IF (NEW.id,NEW.call_id,NEW.request_id,NEW.owner_id,NEW.locale,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.call_id,OLD.request_id,OLD.owner_id,OLD.locale,OLD.created_at) OR
       (OLD.status IN ('withdrawn','financial_open') AND NEW.status<>OLD.status) OR
       (NEW.current_revision_id<>OLD.current_revision_id AND (OLD.status<>'submitted' OR OLD.technical_reviewed_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'Submitted tender ownership and reviewed revisions are immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;


-- Recovered object: CONSTRAINT tender_asset_bindings tender_asset_bindings_asset_id_bid_id_kind_key

ALTER TABLE ONLY tender_asset_bindings
    ADD CONSTRAINT tender_asset_bindings_asset_id_bid_id_kind_key UNIQUE (asset_id, bid_id, kind);


-- Recovered object: CONSTRAINT tender_asset_bindings tender_asset_bindings_pkey

ALTER TABLE ONLY tender_asset_bindings
    ADD CONSTRAINT tender_asset_bindings_pkey PRIMARY KEY (asset_id);


-- Recovered object: CONSTRAINT tender_asset_refs tender_asset_refs_pkey

ALTER TABLE ONLY tender_asset_refs
    ADD CONSTRAINT tender_asset_refs_pkey PRIMARY KEY (revision_id, kind, asset_id);


-- Recovered object: CONSTRAINT tender_bid_events tender_bid_events_pkey

ALTER TABLE ONLY tender_bid_events
    ADD CONSTRAINT tender_bid_events_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT tender_bid_revisions tender_bid_revisions_bid_id_id_key

ALTER TABLE ONLY tender_bid_revisions
    ADD CONSTRAINT tender_bid_revisions_bid_id_id_key UNIQUE (bid_id, id);


-- Recovered object: CONSTRAINT tender_bid_revisions tender_bid_revisions_bid_id_number_key

ALTER TABLE ONLY tender_bid_revisions
    ADD CONSTRAINT tender_bid_revisions_bid_id_number_key UNIQUE (bid_id, number);


-- Recovered object: CONSTRAINT tender_bid_revisions tender_bid_revisions_pkey

ALTER TABLE ONLY tender_bid_revisions
    ADD CONSTRAINT tender_bid_revisions_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT tender_bids tender_bids_call_id_owner_id_key

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_call_id_owner_id_key UNIQUE (call_id, owner_id);


-- Recovered object: CONSTRAINT tender_bids tender_bids_id_call_id_key

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_id_call_id_key UNIQUE (id, call_id);


-- Recovered object: CONSTRAINT tender_bids tender_bids_pkey

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT tender_bids tender_bids_request_id_key

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_request_id_key UNIQUE (request_id);


-- Recovered object: CONSTRAINT tender_call_reviews tender_call_reviews_pkey

ALTER TABLE ONLY tender_call_reviews
    ADD CONSTRAINT tender_call_reviews_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT tender_call_revisions tender_call_revisions_call_id_id_key

ALTER TABLE ONLY tender_call_revisions
    ADD CONSTRAINT tender_call_revisions_call_id_id_key UNIQUE (call_id, id);


-- Recovered object: CONSTRAINT tender_call_revisions tender_call_revisions_call_id_number_key

ALTER TABLE ONLY tender_call_revisions
    ADD CONSTRAINT tender_call_revisions_call_id_number_key UNIQUE (call_id, number);


-- Recovered object: CONSTRAINT tender_call_revisions tender_call_revisions_pkey

ALTER TABLE ONLY tender_call_revisions
    ADD CONSTRAINT tender_call_revisions_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT tender_calls tender_calls_pkey

ALTER TABLE ONLY tender_calls
    ADD CONSTRAINT tender_calls_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT tender_envelopes tender_envelopes_bid_id_revision_id_kind_key

ALTER TABLE ONLY tender_envelopes
    ADD CONSTRAINT tender_envelopes_bid_id_revision_id_kind_key UNIQUE (bid_id, revision_id, kind);


-- Recovered object: CONSTRAINT tender_envelopes tender_envelopes_pkey

ALTER TABLE ONLY tender_envelopes
    ADD CONSTRAINT tender_envelopes_pkey PRIMARY KEY (revision_id, kind);


-- Recovered object: CONSTRAINT tender_reviewer_grants tender_reviewer_grants_pkey

ALTER TABLE ONLY tender_reviewer_grants
    ADD CONSTRAINT tender_reviewer_grants_pkey PRIMARY KEY (call_id, user_id, kind);


-- Recovered object: INDEX tender_asset_retention

CREATE INDEX tender_asset_retention ON tender_asset_refs USING btree (asset_id);


-- Recovered object: INDEX tender_bid_timeline

CREATE INDEX tender_bid_timeline ON tender_bid_events USING btree (bid_id, created_at DESC, id);


-- Recovered object: INDEX tender_bids_call

CREATE INDEX tender_bids_call ON tender_bids USING btree (call_id, created_at DESC, id);


-- Recovered object: INDEX tender_bids_owner

CREATE INDEX tender_bids_owner ON tender_bids USING btree (owner_id, created_at DESC, id);


-- Recovered object: INDEX tender_call_current_review

CREATE INDEX tender_call_current_review ON tender_call_reviews USING btree (revision_id, created_at DESC, id);


-- Recovered object: INDEX tender_calls_creator

CREATE INDEX tender_calls_creator ON tender_calls USING btree (created_by, created_at DESC, id);


-- Recovered object: INDEX tender_calls_public

CREATE INDEX tender_calls_public ON tender_calls USING btree (status, created_at DESC, id);


-- Recovered object: INDEX tender_current_reviewer

CREATE INDEX tender_current_reviewer ON tender_reviewer_grants USING btree (user_id, call_id, kind) WHERE active;


-- Recovered object: FK CONSTRAINT tender_asset_bindings tender_asset_bindings_asset_id_fkey

ALTER TABLE ONLY tender_asset_bindings
    ADD CONSTRAINT tender_asset_bindings_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id);


-- Recovered object: FK CONSTRAINT tender_asset_bindings tender_asset_bindings_bid_id_fkey

ALTER TABLE ONLY tender_asset_bindings
    ADD CONSTRAINT tender_asset_bindings_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES tender_bids(id);


-- Recovered object: FK CONSTRAINT tender_asset_refs tender_asset_refs_asset_id_bid_id_kind_fkey

ALTER TABLE ONLY tender_asset_refs
    ADD CONSTRAINT tender_asset_refs_asset_id_bid_id_kind_fkey FOREIGN KEY (asset_id, bid_id, kind) REFERENCES tender_asset_bindings(asset_id, bid_id, kind);


-- Recovered object: FK CONSTRAINT tender_asset_refs tender_asset_refs_bid_id_revision_id_kind_fkey

ALTER TABLE ONLY tender_asset_refs
    ADD CONSTRAINT tender_asset_refs_bid_id_revision_id_kind_fkey FOREIGN KEY (bid_id, revision_id, kind) REFERENCES tender_envelopes(bid_id, revision_id, kind);


-- Recovered object: FK CONSTRAINT tender_bid_events tender_bid_events_actor_id_fkey

ALTER TABLE ONLY tender_bid_events
    ADD CONSTRAINT tender_bid_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_bid_events tender_bid_events_bid_id_revision_id_fkey

ALTER TABLE ONLY tender_bid_events
    ADD CONSTRAINT tender_bid_events_bid_id_revision_id_fkey FOREIGN KEY (bid_id, revision_id) REFERENCES tender_bid_revisions(bid_id, id);


-- Recovered object: FK CONSTRAINT tender_bid_revisions tender_bid_revisions_bid_id_call_id_fkey

ALTER TABLE ONLY tender_bid_revisions
    ADD CONSTRAINT tender_bid_revisions_bid_id_call_id_fkey FOREIGN KEY (bid_id, call_id) REFERENCES tender_bids(id, call_id);


-- Recovered object: FK CONSTRAINT tender_bid_revisions tender_bid_revisions_call_id_call_revision_id_fkey

ALTER TABLE ONLY tender_bid_revisions
    ADD CONSTRAINT tender_bid_revisions_call_id_call_revision_id_fkey FOREIGN KEY (call_id, call_revision_id) REFERENCES tender_call_revisions(call_id, id);


-- Recovered object: FK CONSTRAINT tender_bid_revisions tender_bid_revisions_submitted_by_fkey

ALTER TABLE ONLY tender_bid_revisions
    ADD CONSTRAINT tender_bid_revisions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_bids tender_bid_current_revision_fk

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bid_current_revision_fk FOREIGN KEY (id, current_revision_id) REFERENCES tender_bid_revisions(bid_id, id) DEFERRABLE INITIALLY DEFERRED;


-- Recovered object: FK CONSTRAINT tender_bids tender_bids_call_id_fkey

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_call_id_fkey FOREIGN KEY (call_id) REFERENCES tender_calls(id);


-- Recovered object: FK CONSTRAINT tender_bids tender_bids_finance_opened_by_fkey

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_finance_opened_by_fkey FOREIGN KEY (finance_opened_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_bids tender_bids_owner_id_fkey

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_bids tender_bids_request_id_fkey

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_request_id_fkey FOREIGN KEY (request_id) REFERENCES requests(id);


-- Recovered object: FK CONSTRAINT tender_bids tender_bids_technical_reviewed_by_fkey

ALTER TABLE ONLY tender_bids
    ADD CONSTRAINT tender_bids_technical_reviewed_by_fkey FOREIGN KEY (technical_reviewed_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_call_reviews tender_call_reviews_call_id_revision_id_fkey

ALTER TABLE ONLY tender_call_reviews
    ADD CONSTRAINT tender_call_reviews_call_id_revision_id_fkey FOREIGN KEY (call_id, revision_id) REFERENCES tender_call_revisions(call_id, id);


-- Recovered object: FK CONSTRAINT tender_call_reviews tender_call_reviews_reviewer_id_fkey

ALTER TABLE ONLY tender_call_reviews
    ADD CONSTRAINT tender_call_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_call_revisions tender_call_revisions_call_id_fkey

ALTER TABLE ONLY tender_call_revisions
    ADD CONSTRAINT tender_call_revisions_call_id_fkey FOREIGN KEY (call_id) REFERENCES tender_calls(id);


-- Recovered object: FK CONSTRAINT tender_call_revisions tender_call_revisions_created_by_fkey

ALTER TABLE ONLY tender_call_revisions
    ADD CONSTRAINT tender_call_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_calls tender_calls_created_by_fkey

ALTER TABLE ONLY tender_calls
    ADD CONSTRAINT tender_calls_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_calls tender_current_revision_fk

ALTER TABLE ONLY tender_calls
    ADD CONSTRAINT tender_current_revision_fk FOREIGN KEY (id, current_revision_id) REFERENCES tender_call_revisions(call_id, id) DEFERRABLE INITIALLY DEFERRED;


-- Recovered object: FK CONSTRAINT tender_calls tender_published_revision_fk

ALTER TABLE ONLY tender_calls
    ADD CONSTRAINT tender_published_revision_fk FOREIGN KEY (id, published_revision_id) REFERENCES tender_call_revisions(call_id, id) DEFERRABLE INITIALLY DEFERRED;


-- Recovered object: FK CONSTRAINT tender_envelopes tender_envelopes_bid_id_revision_id_fkey

ALTER TABLE ONLY tender_envelopes
    ADD CONSTRAINT tender_envelopes_bid_id_revision_id_fkey FOREIGN KEY (bid_id, revision_id) REFERENCES tender_bid_revisions(bid_id, id);


-- Recovered object: FK CONSTRAINT tender_reviewer_grants tender_reviewer_grants_call_id_fkey

ALTER TABLE ONLY tender_reviewer_grants
    ADD CONSTRAINT tender_reviewer_grants_call_id_fkey FOREIGN KEY (call_id) REFERENCES tender_calls(id);


-- Recovered object: FK CONSTRAINT tender_reviewer_grants tender_reviewer_grants_granted_by_fkey

ALTER TABLE ONLY tender_reviewer_grants
    ADD CONSTRAINT tender_reviewer_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT tender_reviewer_grants tender_reviewer_grants_user_id_fkey

ALTER TABLE ONLY tender_reviewer_grants
    ADD CONSTRAINT tender_reviewer_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);


-- Recovered object: TRIGGER tender_asset_bindings tender_asset_binding_immutable

CREATE TRIGGER tender_asset_binding_immutable BEFORE DELETE OR UPDATE ON tender_asset_bindings FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();


-- Recovered object: TRIGGER tender_asset_refs tender_asset_ref_immutable

CREATE TRIGGER tender_asset_ref_immutable BEFORE DELETE OR UPDATE ON tender_asset_refs FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();


-- Recovered object: TRIGGER tender_bid_events tender_bid_event_immutable

CREATE TRIGGER tender_bid_event_immutable BEFORE DELETE OR UPDATE ON tender_bid_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();


-- Recovered object: TRIGGER tender_bid_revisions tender_bid_revision_immutable

CREATE TRIGGER tender_bid_revision_immutable BEFORE DELETE OR UPDATE ON tender_bid_revisions FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();


-- Recovered object: TRIGGER tender_bid_revisions tender_complete_submission

CREATE CONSTRAINT TRIGGER tender_complete_submission AFTER INSERT ON tender_bid_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_tender_submission_contract();


-- Recovered object: TRIGGER tender_bids tender_bid_identity_guard

CREATE TRIGGER tender_bid_identity_guard BEFORE UPDATE ON tender_bids FOR EACH ROW EXECUTE FUNCTION protect_tender_identity();


-- Recovered object: TRIGGER tender_call_reviews tender_call_review_immutable

CREATE TRIGGER tender_call_review_immutable BEFORE DELETE OR UPDATE ON tender_call_reviews FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();


-- Recovered object: TRIGGER tender_call_revisions tender_call_revision_immutable

CREATE TRIGGER tender_call_revision_immutable BEFORE DELETE OR UPDATE ON tender_call_revisions FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();


-- Recovered object: TRIGGER tender_calls tender_identity_guard

CREATE TRIGGER tender_identity_guard BEFORE UPDATE ON tender_calls FOR EACH ROW EXECUTE FUNCTION protect_tender_identity();


-- Recovered object: TRIGGER tender_envelopes tender_envelope_immutable

CREATE TRIGGER tender_envelope_immutable BEFORE DELETE OR UPDATE ON tender_envelopes FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
