-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): 10096a29c3e0b67419a58f8fef2b6cc950886cc72b3cbcf3088a476d1f56e826

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.


-- Recovered object: TABLE staff_handover_events

CREATE TABLE staff_handover_events (
    id uuid NOT NULL,
    source_user_id text NOT NULL,
    performed_by text NOT NULL,
    reason text NOT NULL,
    plan_hash text NOT NULL,
    workspace_version_before bigint NOT NULL,
    workspace_version_after bigint NOT NULL,
    assignments jsonb NOT NULL,
    revoked_sessions integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_handover_events_assignments_check CHECK (((jsonb_typeof(assignments) = 'array'::text) AND (jsonb_array_length(assignments) <= 5000))),
    CONSTRAINT staff_handover_events_check CHECK ((workspace_version_after > workspace_version_before)),
    CONSTRAINT staff_handover_events_plan_hash_check CHECK ((plan_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT staff_handover_events_reason_check CHECK (((length(reason) >= 10) AND (length(reason) <= 2000))),
    CONSTRAINT staff_handover_events_revoked_sessions_check CHECK ((revoked_sessions >= 0)),
    CONSTRAINT staff_handover_events_workspace_version_before_check CHECK ((workspace_version_before >= 0))
);


-- Recovered object: TABLE staff_invitations

CREATE TABLE staff_invitations (
    id uuid NOT NULL,
    email text NOT NULL,
    target_user_id text,
    role text NOT NULL,
    allowed_locales jsonb NOT NULL,
    quality_scope boolean NOT NULL,
    crm_scope text NOT NULL,
    crm_permissions jsonb NOT NULL,
    team_ids jsonb NOT NULL,
    territory_ids jsonb NOT NULL,
    locale text NOT NULL,
    token_hash text NOT NULL,
    invited_by text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_by text,
    accepted_at timestamp with time zone,
    revoked_by text,
    revoked_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_invitations_allowed_locales_check CHECK (((jsonb_typeof(allowed_locales) = 'array'::text) AND ((jsonb_array_length(allowed_locales) >= 1) AND (jsonb_array_length(allowed_locales) <= 5)))),
    CONSTRAINT staff_invitations_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '168:01:00'::interval)))),
    CONSTRAINT staff_invitations_check1 CHECK (((accepted_at IS NULL) = (accepted_by IS NULL))),
    CONSTRAINT staff_invitations_check2 CHECK (((revoked_at IS NULL) = (revoked_by IS NULL))),
    CONSTRAINT staff_invitations_check3 CHECK (((accepted_at IS NULL) OR (revoked_at IS NULL))),
    CONSTRAINT staff_invitations_crm_permissions_check CHECK (valid_crm_permissions(crm_permissions)),
    CONSTRAINT staff_invitations_crm_scope_check CHECK ((crm_scope = ANY (ARRAY['assigned'::text, 'team'::text, 'all'::text]))),
    CONSTRAINT staff_invitations_email_check CHECK (((email = lower(email)) AND ((length(email) >= 3) AND (length(email) <= 254)))),
    CONSTRAINT staff_invitations_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT staff_invitations_role_check CHECK ((role = ANY (ARRAY['superAdmin'::text, 'admin'::text, 'contentEditor'::text, 'productManager'::text, 'scientificReviewer'::text, 'translator'::text, 'publisher'::text, 'hr'::text, 'business'::text, 'analyst'::text, 'support'::text]))),
    CONSTRAINT staff_invitations_team_ids_check CHECK (((jsonb_typeof(team_ids) = 'array'::text) AND (jsonb_array_length(team_ids) <= 50))),
    CONSTRAINT staff_invitations_territory_ids_check CHECK (((jsonb_typeof(territory_ids) = 'array'::text) AND (jsonb_array_length(territory_ids) <= 50))),
    CONSTRAINT staff_invitations_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT staff_invitations_version_check CHECK ((version > 0))
);


-- Recovered object: FUNCTION protect_staff_invitation()

CREATE FUNCTION protect_staff_invitation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Staff invitation history is retained'; END IF;
  IF (to_jsonb(NEW)-ARRAY['accepted_by','accepted_at','revoked_by','revoked_at','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['accepted_by','accepted_at','revoked_by','revoked_at','version'])
     OR OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL OR NEW.version<>OLD.version+1
     OR (NEW.accepted_at IS NULL AND NEW.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Staff invitation grants and completed history are immutable';
  END IF;
  RETURN NEW;
END $$;


-- Recovered object: CONSTRAINT staff_handover_events staff_handover_events_pkey

ALTER TABLE ONLY staff_handover_events
    ADD CONSTRAINT staff_handover_events_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT staff_invitations staff_invitations_pkey

ALTER TABLE ONLY staff_invitations
    ADD CONSTRAINT staff_invitations_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT staff_invitations staff_invitations_token_hash_key

ALTER TABLE ONLY staff_invitations
    ADD CONSTRAINT staff_invitations_token_hash_key UNIQUE (token_hash);


-- Recovered object: INDEX staff_handover_source_history

CREATE INDEX staff_handover_source_history ON staff_handover_events USING btree (source_user_id, created_at DESC);


-- Recovered object: INDEX staff_invitation_creator

CREATE INDEX staff_invitation_creator ON staff_invitations USING btree (invited_by, created_at DESC);


-- Recovered object: INDEX staff_invitation_expiration

CREATE INDEX staff_invitation_expiration ON staff_invitations USING btree (expires_at) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


-- Recovered object: INDEX staff_invitation_pending_email

CREATE UNIQUE INDEX staff_invitation_pending_email ON staff_invitations USING btree (email) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));


-- Recovered object: FK CONSTRAINT staff_handover_events staff_handover_events_performed_by_fkey

ALTER TABLE ONLY staff_handover_events
    ADD CONSTRAINT staff_handover_events_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT staff_handover_events staff_handover_events_source_user_id_fkey

ALTER TABLE ONLY staff_handover_events
    ADD CONSTRAINT staff_handover_events_source_user_id_fkey FOREIGN KEY (source_user_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT staff_invitations staff_invitations_accepted_by_fkey

ALTER TABLE ONLY staff_invitations
    ADD CONSTRAINT staff_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT staff_invitations staff_invitations_invited_by_fkey

ALTER TABLE ONLY staff_invitations
    ADD CONSTRAINT staff_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT staff_invitations staff_invitations_revoked_by_fkey

ALTER TABLE ONLY staff_invitations
    ADD CONSTRAINT staff_invitations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT staff_invitations staff_invitations_target_user_id_fkey

ALTER TABLE ONLY staff_invitations
    ADD CONSTRAINT staff_invitations_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id);


-- Recovered object: TRIGGER staff_handover_events staff_handover_immutable

CREATE TRIGGER staff_handover_immutable BEFORE DELETE OR UPDATE ON staff_handover_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();


-- Recovered object: TRIGGER staff_invitations staff_invitation_immutable

CREATE TRIGGER staff_invitation_immutable BEFORE DELETE OR UPDATE ON staff_invitations FOR EACH ROW EXECUTE FUNCTION protect_staff_invitation();
