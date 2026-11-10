-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): 26410fee70a68243b1a5054c4cc7f64d1bcffdd88e52f3a2ab4c431a1a8f9b08

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.

ALTER TABLE crm_segment_snapshot_members DROP CONSTRAINT crm_segment_snapshot_members_pkey;

ALTER TABLE crm_campaign_deliveries DROP CONSTRAINT crm_campaign_deliveries_channel_check;
ALTER TABLE crm_campaign_deliveries ADD CONSTRAINT crm_campaign_deliveries_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'in-app'::text, 'sms'::text, 'telegram'::text, 'push'::text])));

ALTER TABLE crm_campaign_enrollments ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE crm_campaign_enrollments ADD COLUMN recipient_id uuid;

ALTER TABLE crm_campaign_enrollments ADD COLUMN endpoint_refs jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE crm_campaign_enrollments ADD CONSTRAINT crm_campaign_enrollments_endpoint_refs_check CHECK (((jsonb_typeof(endpoint_refs) = 'array'::text) AND (jsonb_array_length(endpoint_refs) <= 8) AND (octet_length((endpoint_refs)::text) <= 8192)));

ALTER TABLE crm_campaign_revisions ADD COLUMN audience text DEFAULT 'users'::text NOT NULL;

ALTER TABLE crm_campaign_revisions ADD CONSTRAINT crm_campaign_revisions_audience_check CHECK ((audience = ANY (ARRAY['users'::text, 'contacts'::text, 'all'::text])));

ALTER TABLE crm_campaign_suppressions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE crm_campaign_suppressions ADD COLUMN recipient_id uuid;

ALTER TABLE crm_campaign_suppressions DROP CONSTRAINT crm_campaign_suppressions_channel_check;
ALTER TABLE crm_campaign_suppressions ADD CONSTRAINT crm_campaign_suppressions_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'in-app'::text, 'sms'::text, 'telegram'::text, 'push'::text, 'all'::text])));

ALTER TABLE crm_segment_snapshot_members ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE crm_segment_snapshot_members ADD COLUMN recipient_id uuid;

ALTER TABLE crm_segments ADD COLUMN audience text DEFAULT 'users'::text NOT NULL;

ALTER TABLE crm_segments ADD CONSTRAINT crm_segments_audience_check CHECK ((audience = ANY (ARRAY['users'::text, 'contacts'::text, 'all'::text])));

ALTER TABLE notification_digest_items ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE notification_digest_items ADD COLUMN recipient_id uuid;

ALTER TABLE notification_digest_items ADD COLUMN endpoint_id uuid;

ALTER TABLE notification_digest_items ADD COLUMN endpoint_version integer;

ALTER TABLE notification_digest_items ADD COLUMN binding_id uuid;

ALTER TABLE notification_digest_items DROP CONSTRAINT notification_digest_items_channel_check;
ALTER TABLE notification_digest_items ADD CONSTRAINT notification_digest_items_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'in-app'::text, 'sms'::text, 'telegram'::text, 'push'::text])));

ALTER TABLE notification_digest_items ADD CONSTRAINT notification_digest_items_endpoint_version_check CHECK ((endpoint_version > 0));

ALTER TABLE notification_digest_items ADD CONSTRAINT notification_digest_recipient_kind CHECK ((((binding_id IS NULL) AND (((user_id IS NOT NULL) AND (endpoint_id IS NULL) AND (endpoint_version IS NULL)) OR ((user_id IS NULL) AND (recipient_id IS NOT NULL) AND (endpoint_id IS NOT NULL) AND (endpoint_version IS NOT NULL)))) OR ((binding_id IS NOT NULL) AND (recipient_id IS NOT NULL) AND (endpoint_id IS NULL) AND (endpoint_version IS NOT NULL))));

-- Upgrade existing account audiences by their exact user primary key. Email,
-- contact fields, endpoint verification and consent are deliberately not used.
-- The migration runner holds one transaction; the table DDL above excludes
-- concurrent writers until this backfill and every final constraint commit.
INSERT INTO communication_recipients(id, subject_type, subject_id, user_id)
SELECT gen_random_uuid(), 'user', id, id FROM users
ON CONFLICT(subject_type, subject_id) DO NOTHING;

UPDATE crm_campaign_enrollments AS enrollment
SET recipient_id = recipient.id
FROM communication_recipients AS recipient
WHERE recipient.subject_type = 'user' AND recipient.user_id = enrollment.user_id;

UPDATE crm_campaign_suppressions AS suppression
SET recipient_id = recipient.id
FROM communication_recipients AS recipient
WHERE recipient.subject_type = 'user' AND recipient.user_id = suppression.user_id;

-- Immutable snapshot membership keeps the same snapshot and user IDs. Only
-- its newly introduced typed foreign key is populated by the schema owner;
-- the original append-only trigger is restored before runtime writes resume.
ALTER TABLE crm_segment_snapshot_members DISABLE TRIGGER crm_segment_snapshot_member_immutable;
UPDATE crm_segment_snapshot_members AS member
SET recipient_id = recipient.id
FROM communication_recipients AS recipient
WHERE recipient.subject_type = 'user' AND recipient.user_id = member.user_id;
ALTER TABLE crm_segment_snapshot_members ENABLE TRIGGER crm_segment_snapshot_member_immutable;

UPDATE notification_digest_items AS item
SET recipient_id = recipient.id
FROM communication_recipients AS recipient
WHERE recipient.subject_type = 'user' AND recipient.user_id = item.user_id;

ALTER TABLE crm_campaign_enrollments ALTER COLUMN recipient_id SET NOT NULL;
ALTER TABLE crm_campaign_suppressions ALTER COLUMN recipient_id SET NOT NULL;
ALTER TABLE crm_segment_snapshot_members ALTER COLUMN recipient_id SET NOT NULL;

-- Old traversal cursors contain user IDs, whereas the new traversal orders
-- recipient UUIDs. Restart scanning without changing revisions, membership,
-- enrollment states, accepted deliveries or explicit suppressions. Existing
-- enrollment uniqueness makes an in-progress audience rescan idempotent.
UPDATE crm_campaigns SET enrollment_cursor = '', enrollment_scanned = 0;

ALTER TABLE ONLY crm_segment_snapshot_members
    ADD CONSTRAINT crm_segment_snapshot_members_pkey PRIMARY KEY (snapshot_id, recipient_id);


-- Recovered object: SEQUENCE communication_binding_consents_id_seq

CREATE SEQUENCE communication_binding_consents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


-- Recovered object: TABLE communication_binding_challenges

CREATE TABLE communication_binding_challenges (
    token_hash text NOT NULL,
    binding_id uuid NOT NULL,
    endpoint_version integer NOT NULL,
    channel text NOT NULL,
    code_hash text,
    attempts integer DEFAULT 0 NOT NULL,
    locale text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT communication_binding_challenges_attempts_check CHECK (((attempts >= 0) AND (attempts <= 5))),
    CONSTRAINT communication_binding_challenges_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'telegram'::text, 'push'::text]))),
    CONSTRAINT communication_binding_challenges_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '00:30:00'::interval)))),
    CONSTRAINT communication_binding_challenges_check1 CHECK (((channel = 'sms'::text) = (code_hash IS NOT NULL))),
    CONSTRAINT communication_binding_challenges_code_hash_check CHECK ((code_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_binding_challenges_endpoint_version_check CHECK ((endpoint_version > 0)),
    CONSTRAINT communication_binding_challenges_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT communication_binding_challenges_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text))
);


-- Recovered object: TABLE communication_binding_consents

CREATE TABLE communication_binding_consents (
    id bigint NOT NULL,
    binding_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    endpoint_version integer NOT NULL,
    topic text NOT NULL,
    accepted boolean NOT NULL,
    source text NOT NULL,
    policy_version text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communication_binding_consents_endpoint_version_check CHECK ((endpoint_version > 0)),
    CONSTRAINT communication_binding_consents_source_check CHECK ((source = ANY (ARRAY['recipient-proof'::text, 'recipient-preferences'::text, 'recipient-unsubscribe'::text, 'recipient-revoked'::text]))),
    CONSTRAINT communication_binding_consents_topic_check CHECK ((topic = ANY (ARRAY['requests'::text, 'products'::text, 'research'::text, 'events'::text])))
);


-- Recovered object: TABLE communication_bindings

CREATE TABLE communication_bindings (
    id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    channel text NOT NULL,
    provider text NOT NULL,
    endpoint_encrypted text,
    endpoint_hash text,
    endpoint_version integer DEFAULT 1 NOT NULL,
    source_endpoint_id uuid,
    source_endpoint_version integer,
    source_value_hash text,
    verified_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    preferences jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT communication_bindings_channel_check CHECK ((channel = ANY (ARRAY['sms'::text, 'telegram'::text, 'push'::text]))),
    CONSTRAINT communication_bindings_check CHECK (((endpoint_encrypted IS NULL) = (endpoint_hash IS NULL))),
    CONSTRAINT communication_bindings_check1 CHECK (((verified_at IS NULL) OR (endpoint_encrypted IS NOT NULL))),
    CONSTRAINT communication_bindings_check2 CHECK ((((source_endpoint_id IS NULL) AND (source_endpoint_version IS NULL) AND (source_value_hash IS NULL)) OR ((source_endpoint_id IS NOT NULL) AND (source_endpoint_version IS NOT NULL) AND (source_value_hash IS NOT NULL)))),
    CONSTRAINT communication_bindings_check3 CHECK ((((channel = 'sms'::text) AND (provider = 'kavenegar'::text)) OR ((channel = 'telegram'::text) AND (provider = 'telegram'::text)) OR ((channel = 'push'::text) AND (provider = 'najva'::text)))),
    CONSTRAINT communication_bindings_endpoint_hash_check CHECK ((endpoint_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_bindings_endpoint_version_check CHECK ((endpoint_version > 0)),
    CONSTRAINT communication_bindings_preferences_check CHECK (((jsonb_typeof(preferences) = 'object'::text) AND (octet_length((preferences)::text) <= 20000))),
    CONSTRAINT communication_bindings_provider_check CHECK ((provider = ANY (ARRAY['kavenegar'::text, 'telegram'::text, 'najva'::text]))),
    CONSTRAINT communication_bindings_source_endpoint_version_check CHECK ((source_endpoint_version > 0)),
    CONSTRAINT communication_bindings_source_value_hash_check CHECK ((source_value_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_bindings_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE communication_preference_tokens

CREATE TABLE communication_preference_tokens (
    token_hash text NOT NULL,
    recipient_id uuid NOT NULL,
    endpoint_id uuid,
    endpoint_version integer NOT NULL,
    value_hash text NOT NULL,
    scope text NOT NULL,
    locale text NOT NULL,
    outbox_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    consumed_at timestamp with time zone,
    binding_id uuid,
    CONSTRAINT communication_preference_source CHECK (((((endpoint_id IS NOT NULL))::integer + ((binding_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT communication_preference_tokens_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '30 days'::interval)))),
    CONSTRAINT communication_preference_tokens_endpoint_version_check CHECK ((endpoint_version > 0)),
    CONSTRAINT communication_preference_tokens_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT communication_preference_tokens_scope_check CHECK ((scope = ANY (ARRAY['preferences'::text, 'unsubscribe'::text]))),
    CONSTRAINT communication_preference_tokens_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT communication_preference_tokens_value_hash_check CHECK ((value_hash ~ '^[a-f0-9]{64}$'::text))
);


-- Recovered object: TABLE crm_endpoint_preferences

CREATE TABLE crm_endpoint_preferences (
    endpoint_id uuid NOT NULL,
    endpoint_version integer NOT NULL,
    timezone text DEFAULT 'Asia/Tehran'::text NOT NULL,
    preferences jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_endpoint_preferences_endpoint_version_check CHECK ((endpoint_version > 0)),
    CONSTRAINT crm_endpoint_preferences_preferences_check CHECK (((jsonb_typeof(preferences) = 'object'::text) AND (octet_length((preferences)::text) <= 16384))),
    CONSTRAINT crm_endpoint_preferences_version_check CHECK ((version > 0))
);


-- Recovered object: SEQUENCE OWNED BY communication_binding_consents_id_seq

ALTER SEQUENCE communication_binding_consents_id_seq OWNED BY communication_binding_consents.id;


-- Recovered object: DEFAULT communication_binding_consents id

ALTER TABLE ONLY communication_binding_consents ALTER COLUMN id SET DEFAULT nextval('communication_binding_consents_id_seq'::regclass);


-- Recovered object: FUNCTION communication_binding_guard()

CREATE FUNCTION communication_binding_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.source_endpoint_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_contact_endpoints WHERE id=NEW.source_endpoint_id AND recipient_id=NEW.recipient_id) THEN
    RAISE EXCEPTION 'Channel proof source belongs to a different recipient' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.recipient_id<>OLD.recipient_id OR NEW.channel<>OLD.channel OR NEW.provider<>OLD.provider OR NEW.created_at<>OLD.created_at OR
       NEW.source_endpoint_id IS DISTINCT FROM OLD.source_endpoint_id OR NEW.source_endpoint_version IS DISTINCT FROM OLD.source_endpoint_version OR NEW.source_value_hash IS DISTINCT FROM OLD.source_value_hash OR
       (NOT OLD.active AND NEW.active) OR NEW.version<>OLD.version+1 OR NEW.endpoint_version<OLD.endpoint_version OR
       (OLD.verified_at IS NOT NULL AND (NEW.endpoint_encrypted IS DISTINCT FROM OLD.endpoint_encrypted OR NEW.endpoint_hash IS DISTINCT FROM OLD.endpoint_hash OR NEW.verified_at IS DISTINCT FROM OLD.verified_at)) THEN
      RAISE EXCEPTION 'Verified destination identity is immutable; revoke and connect again' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;


-- Recovered object: FUNCTION communication_campaign_identity()

CREATE FUNCTION communication_campaign_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE selected communication_recipients%ROWTYPE;
BEGIN
  IF NEW.recipient_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT * INTO selected FROM communication_recipients WHERE subject_type='user' AND user_id=NEW.user_id;
    NEW.recipient_id:=selected.id;
  ELSE SELECT * INTO selected FROM communication_recipients WHERE id=NEW.recipient_id;
  END IF;
  IF selected.id IS NULL OR (NEW.user_id IS NOT NULL AND (selected.subject_type<>'user' OR selected.user_id<>NEW.user_id)) THEN
    RAISE EXCEPTION 'Campaign recipient identity does not match its typed namespace' USING ERRCODE='23514';
  END IF;
  NEW.user_id:=selected.user_id;
  IF TG_OP='UPDATE' AND (OLD.recipient_id IS DISTINCT FROM NEW.recipient_id OR OLD.user_id IS DISTINCT FROM NEW.user_id) THEN
    RAISE EXCEPTION 'Campaign recipient identity is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='crm_campaign_enrollments' AND TG_OP='UPDATE' THEN
    IF OLD.endpoint_refs IS DISTINCT FROM NEW.endpoint_refs OR OLD.locale IS DISTINCT FROM NEW.locale OR OLD.revision_id IS DISTINCT FROM NEW.revision_id THEN
      RAISE EXCEPTION 'Enrolled locale and endpoint references are immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;


-- Recovered object: FUNCTION communication_challenge_guard()

CREATE FUNCTION communication_challenge_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (to_jsonb(NEW)-'attempts'-'consumed_at'-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'attempts'-'consumed_at'-'revoked_at') OR
     NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1 OR
     (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) OR
     (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Channel proof challenge identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;


-- Recovered object: FUNCTION communication_token_immutable()

CREATE FUNCTION communication_token_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (to_jsonb(NEW)-'revoked_at'-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at'-'consumed_at') OR
     (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) OR
     (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    RAISE EXCEPTION 'The scoped communication token is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;


-- Recovered object: CONSTRAINT communication_binding_challenges communication_binding_challenges_pkey

ALTER TABLE ONLY communication_binding_challenges
    ADD CONSTRAINT communication_binding_challenges_pkey PRIMARY KEY (token_hash);


-- Recovered object: CONSTRAINT communication_binding_consents communication_binding_consents_pkey

ALTER TABLE ONLY communication_binding_consents
    ADD CONSTRAINT communication_binding_consents_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT communication_bindings communication_bindings_id_recipient_id_key

ALTER TABLE ONLY communication_bindings
    ADD CONSTRAINT communication_bindings_id_recipient_id_key UNIQUE (id, recipient_id);


-- Recovered object: CONSTRAINT communication_bindings communication_bindings_pkey

ALTER TABLE ONLY communication_bindings
    ADD CONSTRAINT communication_bindings_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT communication_preference_tokens communication_preference_tokens_pkey

ALTER TABLE ONLY communication_preference_tokens
    ADD CONSTRAINT communication_preference_tokens_pkey PRIMARY KEY (token_hash);


-- Recovered object: CONSTRAINT crm_campaign_enrollments crm_campaign_enrollments_revision_id_recipient_id_key

ALTER TABLE ONLY crm_campaign_enrollments
    ADD CONSTRAINT crm_campaign_enrollments_revision_id_recipient_id_key UNIQUE (revision_id, recipient_id);


-- Recovered object: CONSTRAINT crm_endpoint_preferences crm_endpoint_preferences_pkey

ALTER TABLE ONLY crm_endpoint_preferences
    ADD CONSTRAINT crm_endpoint_preferences_pkey PRIMARY KEY (endpoint_id);


-- Recovered object: INDEX communication_binding_active_endpoint

CREATE UNIQUE INDEX communication_binding_active_endpoint ON communication_bindings USING btree (recipient_id, channel, endpoint_hash) WHERE (active AND (endpoint_hash IS NOT NULL));


-- Recovered object: INDEX communication_binding_latest_consent

CREATE INDEX communication_binding_latest_consent ON communication_binding_consents USING btree (binding_id, topic, id DESC);


-- Recovered object: INDEX communication_binding_recipient

CREATE INDEX communication_binding_recipient ON communication_bindings USING btree (recipient_id, channel, created_at, id);


-- Recovered object: INDEX communication_pending_proofs

CREATE INDEX communication_pending_proofs ON communication_binding_challenges USING btree (binding_id, expires_at) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));


-- Recovered object: INDEX communication_preference_endpoint

CREATE INDEX communication_preference_endpoint ON communication_preference_tokens USING btree (endpoint_id, created_at);


-- Recovered object: INDEX crm_campaign_suppression_typed_active

CREATE UNIQUE INDEX crm_campaign_suppression_typed_active ON crm_campaign_suppressions USING btree (recipient_id, COALESCE(sender_id, ''::text), topic, channel) WHERE (revoked_at IS NULL);


-- Recovered object: INDEX crm_campaign_typed_recipient

CREATE INDEX crm_campaign_typed_recipient ON crm_campaign_enrollments USING btree (recipient_id, created_at, id);


-- Recovered object: INDEX notification_digest_contact

CREATE INDEX notification_digest_contact ON notification_digest_items USING btree (recipient_id, endpoint_id, endpoint_version, state, due_at);


-- Recovered object: FK CONSTRAINT communication_binding_challenges communication_binding_challenges_binding_id_fkey

ALTER TABLE ONLY communication_binding_challenges
    ADD CONSTRAINT communication_binding_challenges_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES communication_bindings(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT communication_binding_consents communication_binding_consents_binding_id_fkey

ALTER TABLE ONLY communication_binding_consents
    ADD CONSTRAINT communication_binding_consents_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES communication_bindings(id);


-- Recovered object: FK CONSTRAINT communication_binding_consents communication_binding_consents_binding_id_recipient_id_fkey

ALTER TABLE ONLY communication_binding_consents
    ADD CONSTRAINT communication_binding_consents_binding_id_recipient_id_fkey FOREIGN KEY (binding_id, recipient_id) REFERENCES communication_bindings(id, recipient_id);


-- Recovered object: FK CONSTRAINT communication_binding_consents communication_binding_consents_recipient_id_fkey

ALTER TABLE ONLY communication_binding_consents
    ADD CONSTRAINT communication_binding_consents_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES communication_recipients(id);


-- Recovered object: FK CONSTRAINT communication_bindings communication_bindings_recipient_id_fkey

ALTER TABLE ONLY communication_bindings
    ADD CONSTRAINT communication_bindings_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES communication_recipients(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT communication_bindings communication_bindings_source_endpoint_id_fkey

ALTER TABLE ONLY communication_bindings
    ADD CONSTRAINT communication_bindings_source_endpoint_id_fkey FOREIGN KEY (source_endpoint_id) REFERENCES crm_contact_endpoints(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT communication_preference_tokens communication_preference_tokens_binding_id_fkey

ALTER TABLE ONLY communication_preference_tokens
    ADD CONSTRAINT communication_preference_tokens_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES communication_bindings(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT communication_preference_tokens communication_preference_tokens_endpoint_id_fkey

ALTER TABLE ONLY communication_preference_tokens
    ADD CONSTRAINT communication_preference_tokens_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES crm_contact_endpoints(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT communication_preference_tokens communication_preference_tokens_outbox_id_fkey

ALTER TABLE ONLY communication_preference_tokens
    ADD CONSTRAINT communication_preference_tokens_outbox_id_fkey FOREIGN KEY (outbox_id) REFERENCES outbox(id);


-- Recovered object: FK CONSTRAINT communication_preference_tokens communication_preference_tokens_recipient_id_fkey

ALTER TABLE ONLY communication_preference_tokens
    ADD CONSTRAINT communication_preference_tokens_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES communication_recipients(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT crm_campaign_enrollments crm_campaign_enrollments_recipient_id_fkey

ALTER TABLE ONLY crm_campaign_enrollments
    ADD CONSTRAINT crm_campaign_enrollments_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES communication_recipients(id);


-- Recovered object: FK CONSTRAINT crm_campaign_suppressions crm_campaign_suppressions_recipient_id_fkey

ALTER TABLE ONLY crm_campaign_suppressions
    ADD CONSTRAINT crm_campaign_suppressions_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES communication_recipients(id);


-- Recovered object: FK CONSTRAINT crm_endpoint_preferences crm_endpoint_preferences_endpoint_id_fkey

ALTER TABLE ONLY crm_endpoint_preferences
    ADD CONSTRAINT crm_endpoint_preferences_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES crm_contact_endpoints(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT crm_segment_snapshot_members crm_segment_snapshot_members_recipient_id_fkey

ALTER TABLE ONLY crm_segment_snapshot_members
    ADD CONSTRAINT crm_segment_snapshot_members_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES communication_recipients(id);


-- Recovered object: FK CONSTRAINT notification_digest_items notification_digest_items_binding_id_fkey

ALTER TABLE ONLY notification_digest_items
    ADD CONSTRAINT notification_digest_items_binding_id_fkey FOREIGN KEY (binding_id) REFERENCES communication_bindings(id);


-- Recovered object: FK CONSTRAINT notification_digest_items notification_digest_items_endpoint_id_fkey

ALTER TABLE ONLY notification_digest_items
    ADD CONSTRAINT notification_digest_items_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES crm_contact_endpoints(id);


-- Recovered object: FK CONSTRAINT notification_digest_items notification_digest_items_recipient_id_fkey

ALTER TABLE ONLY notification_digest_items
    ADD CONSTRAINT notification_digest_items_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES communication_recipients(id);


-- Recovered object: TRIGGER communication_binding_challenges communication_proof_identity

CREATE TRIGGER communication_proof_identity BEFORE UPDATE ON communication_binding_challenges FOR EACH ROW EXECUTE FUNCTION communication_challenge_guard();


-- Recovered object: TRIGGER communication_binding_consents communication_binding_consent_immutable

CREATE TRIGGER communication_binding_consent_immutable BEFORE DELETE OR UPDATE ON communication_binding_consents FOR EACH ROW EXECUTE FUNCTION workspace_append_only();


-- Recovered object: TRIGGER communication_bindings communication_binding_identity

CREATE TRIGGER communication_binding_identity BEFORE INSERT OR UPDATE ON communication_bindings FOR EACH ROW EXECUTE FUNCTION communication_binding_guard();


-- Recovered object: TRIGGER communication_preference_tokens communication_preference_token_guard

CREATE TRIGGER communication_preference_token_guard BEFORE UPDATE ON communication_preference_tokens FOR EACH ROW EXECUTE FUNCTION communication_token_immutable();


-- Recovered object: TRIGGER crm_campaign_enrollments crm_enrollment_recipient

CREATE TRIGGER crm_enrollment_recipient BEFORE INSERT OR UPDATE ON crm_campaign_enrollments FOR EACH ROW EXECUTE FUNCTION communication_campaign_identity();


-- Recovered object: TRIGGER crm_campaign_suppressions crm_suppression_recipient

CREATE TRIGGER crm_suppression_recipient BEFORE INSERT OR UPDATE ON crm_campaign_suppressions FOR EACH ROW EXECUTE FUNCTION communication_campaign_identity();


-- Recovered object: TRIGGER crm_segment_snapshot_members crm_snapshot_recipient

CREATE TRIGGER crm_snapshot_recipient BEFORE INSERT ON crm_segment_snapshot_members FOR EACH ROW EXECUTE FUNCTION communication_campaign_identity();
