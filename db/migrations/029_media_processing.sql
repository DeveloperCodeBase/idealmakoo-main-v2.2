-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): 93daab9d7ffbfaf082704d20035df4da817fca61230eb0fa8b81f8228d0ac22d

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.


-- Recovered object: TABLE asset_media_derivatives

CREATE TABLE asset_media_derivatives (
    asset_id text NOT NULL,
    source_asset_id text NOT NULL,
    job_id uuid NOT NULL,
    kind text NOT NULL,
    profile text,
    locale text,
    source_sha256 text NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_media_derivatives_check CHECK ((asset_id <> source_asset_id)),
    CONSTRAINT asset_media_derivatives_check1 CHECK ((((kind = 'video'::text) AND (profile IS NOT NULL) AND (locale IS NULL)) OR ((kind = 'subtitle'::text) AND (profile IS NULL) AND (locale IS NOT NULL)))),
    CONSTRAINT asset_media_derivatives_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'subtitle'::text]))),
    CONSTRAINT asset_media_derivatives_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT asset_media_derivatives_profile_check CHECK ((profile = ANY (ARRAY['web_480p'::text, 'web_720p'::text]))),
    CONSTRAINT asset_media_derivatives_source_sha256_check CHECK ((source_sha256 ~ '^[a-f0-9]{64}$'::text))
);


-- Recovered object: TABLE media_processing_events

CREATE TABLE media_processing_events (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    version integer NOT NULL,
    state text NOT NULL,
    actor_id text,
    code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_processing_events_code_check CHECK ((code ~ '^[A-Z0-9_]{3,80}$'::text)),
    CONSTRAINT media_processing_events_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'running'::text, 'scanning'::text, 'ready'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT media_processing_events_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE media_processing_jobs

CREATE TABLE media_processing_jobs (
    id uuid NOT NULL,
    source_asset_id text NOT NULL,
    created_by text NOT NULL,
    kind text NOT NULL,
    profile text,
    locale text,
    name text NOT NULL,
    subtitle_vtt text,
    source_sha256 text NOT NULL,
    source_policy_version bigint NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    lock_token uuid,
    locked_until timestamp with time zone,
    result_asset_id text,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_error text,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT media_processing_jobs_attempts_check CHECK (((attempts >= 0) AND (attempts <= 3))),
    CONSTRAINT media_processing_jobs_check CHECK ((((kind = 'video'::text) AND (profile IS NOT NULL) AND (locale IS NULL) AND (subtitle_vtt IS NULL)) OR ((kind = 'subtitle'::text) AND (profile IS NULL) AND (locale IS NOT NULL) AND (subtitle_vtt IS NOT NULL)))),
    CONSTRAINT media_processing_jobs_check1 CHECK ((((state = ANY (ARRAY['scanning'::text, 'ready'::text])) AND (result_asset_id IS NOT NULL)) OR (state <> ALL (ARRAY['scanning'::text, 'ready'::text])))),
    CONSTRAINT media_processing_jobs_check2 CHECK ((((state = 'running'::text) AND (lock_token IS NOT NULL) AND (locked_until IS NOT NULL)) OR ((state <> 'running'::text) AND (lock_token IS NULL) AND (locked_until IS NULL)))),
    CONSTRAINT media_processing_jobs_idempotency_key_check CHECK (((length(idempotency_key) >= 16) AND (length(idempotency_key) <= 128))),
    CONSTRAINT media_processing_jobs_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'subtitle'::text]))),
    CONSTRAINT media_processing_jobs_last_error_check CHECK ((last_error ~ '^[A-Z0-9_]{3,80}$'::text)),
    CONSTRAINT media_processing_jobs_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT media_processing_jobs_name_check CHECK (((length(name) >= 1) AND (length(name) <= 170))),
    CONSTRAINT media_processing_jobs_profile_check CHECK ((profile = ANY (ARRAY['web_480p'::text, 'web_720p'::text]))),
    CONSTRAINT media_processing_jobs_request_hash_check CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT media_processing_jobs_result_check CHECK (((jsonb_typeof(result) = 'object'::text) AND (octet_length((result)::text) <= 4096))),
    CONSTRAINT media_processing_jobs_source_policy_version_check CHECK ((source_policy_version >= 0)),
    CONSTRAINT media_processing_jobs_source_sha256_check CHECK ((source_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT media_processing_jobs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'running'::text, 'scanning'::text, 'ready'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT media_processing_jobs_subtitle_vtt_check CHECK ((octet_length(subtitle_vtt) <= 262144)),
    CONSTRAINT media_processing_jobs_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE media_processing_lease

CREATE TABLE media_processing_lease (
    singleton boolean DEFAULT true NOT NULL,
    job_id uuid,
    lock_token uuid,
    locked_until timestamp with time zone,
    CONSTRAINT media_processing_lease_singleton_check CHECK (singleton)
);


-- Recovered object: FUNCTION protect_media_processing_job()

CREATE FUNCTION protect_media_processing_job() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Media processing history is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.version<>1 OR NEW.attempts<>0 OR NEW.result_asset_id IS NOT NULL THEN RAISE EXCEPTION 'Media jobs start pending' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['locked_until','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['locked_until','updated_at']) AND OLD.state='running' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','version','attempts','lock_token','locked_until','result_asset_id','result','last_error','updated_at','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','attempts','lock_token','locked_until','result_asset_id','result','last_error','updated_at','completed_at'])
   OR NEW.version<>OLD.version+1 OR (OLD.result_asset_id IS NOT NULL AND NEW.result_asset_id IS DISTINCT FROM OLD.result_asset_id)
   OR NOT ((OLD.state='pending' AND NEW.state IN ('running','cancelled')) OR (OLD.state='running' AND NEW.state IN ('scanning','failed','cancelled')) OR (OLD.state='scanning' AND NEW.state IN ('ready','failed','cancelled')) OR (OLD.state='failed' AND NEW.state IN ('pending','cancelled'))) THEN
    RAISE EXCEPTION 'Invalid media processing transition' USING ERRCODE='23514';
  END IF;
  IF NEW.attempts<>(OLD.attempts+CASE WHEN NEW.state='running' THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'Media attempts advance on a claimed run only' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;


-- Recovered object: FUNCTION require_media_processing_evidence()

CREATE FUNCTION require_media_processing_evidence() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM media_processing_events e WHERE e.job_id=NEW.id AND e.version=NEW.version AND e.state=NEW.state) THEN RAISE EXCEPTION 'Job transition and its evidence must commit together' USING ERRCODE='23514'; END IF;
 IF NEW.state IN ('scanning','ready') AND NOT EXISTS(SELECT 1 FROM asset_media_derivatives d JOIN assets a ON a.id=d.asset_id WHERE d.asset_id=NEW.result_asset_id AND d.job_id=NEW.id AND d.source_asset_id=NEW.source_asset_id AND d.kind=NEW.kind AND d.source_sha256=NEW.source_sha256 AND a.visibility=(SELECT visibility FROM assets WHERE id=NEW.source_asset_id)) THEN RAISE EXCEPTION 'Job output and immutable provenance must commit together without visibility promotion' USING ERRCODE='23514'; END IF;
 IF NEW.state='ready' AND NOT EXISTS(SELECT 1 FROM assets a WHERE a.id=NEW.result_asset_id AND a.scan_status='clean' AND a.deleted_at IS NULL AND a.storage_purged_at IS NULL) THEN RAISE EXCEPTION 'Ready media requires a clean retained output' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;


-- Recovered object: CONSTRAINT asset_media_derivatives asset_media_derivatives_job_id_key

ALTER TABLE ONLY asset_media_derivatives
    ADD CONSTRAINT asset_media_derivatives_job_id_key UNIQUE (job_id);


-- Recovered object: CONSTRAINT asset_media_derivatives asset_media_derivatives_pkey

ALTER TABLE ONLY asset_media_derivatives
    ADD CONSTRAINT asset_media_derivatives_pkey PRIMARY KEY (asset_id);


-- Recovered object: CONSTRAINT media_processing_events media_processing_events_job_id_version_key

ALTER TABLE ONLY media_processing_events
    ADD CONSTRAINT media_processing_events_job_id_version_key UNIQUE (job_id, version);


-- Recovered object: CONSTRAINT media_processing_events media_processing_events_pkey

ALTER TABLE ONLY media_processing_events
    ADD CONSTRAINT media_processing_events_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT media_processing_jobs media_processing_jobs_created_by_idempotency_key_key

ALTER TABLE ONLY media_processing_jobs
    ADD CONSTRAINT media_processing_jobs_created_by_idempotency_key_key UNIQUE (created_by, idempotency_key);


-- Recovered object: CONSTRAINT media_processing_jobs media_processing_jobs_pkey

ALTER TABLE ONLY media_processing_jobs
    ADD CONSTRAINT media_processing_jobs_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT media_processing_lease media_processing_lease_pkey

ALTER TABLE ONLY media_processing_lease
    ADD CONSTRAINT media_processing_lease_pkey PRIMARY KEY (singleton);


-- Recovered object: INDEX asset_media_source

CREATE INDEX asset_media_source ON asset_media_derivatives USING btree (source_asset_id);


-- Recovered object: INDEX media_processing_creator

CREATE INDEX media_processing_creator ON media_processing_jobs USING btree (created_by, created_at DESC, id);


-- Recovered object: INDEX media_processing_pending

CREATE INDEX media_processing_pending ON media_processing_jobs USING btree (created_at, id) WHERE (state = 'pending'::text);


-- Recovered object: INDEX media_processing_source

CREATE INDEX media_processing_source ON media_processing_jobs USING btree (source_asset_id, created_at DESC, id);


-- Recovered object: FK CONSTRAINT asset_media_derivatives asset_media_derivatives_asset_id_fkey

ALTER TABLE ONLY asset_media_derivatives
    ADD CONSTRAINT asset_media_derivatives_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES assets(id);


-- Recovered object: FK CONSTRAINT asset_media_derivatives asset_media_derivatives_created_by_fkey

ALTER TABLE ONLY asset_media_derivatives
    ADD CONSTRAINT asset_media_derivatives_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT asset_media_derivatives asset_media_derivatives_job_id_fkey

ALTER TABLE ONLY asset_media_derivatives
    ADD CONSTRAINT asset_media_derivatives_job_id_fkey FOREIGN KEY (job_id) REFERENCES media_processing_jobs(id);


-- Recovered object: FK CONSTRAINT asset_media_derivatives asset_media_derivatives_source_asset_id_fkey

ALTER TABLE ONLY asset_media_derivatives
    ADD CONSTRAINT asset_media_derivatives_source_asset_id_fkey FOREIGN KEY (source_asset_id) REFERENCES assets(id);


-- Recovered object: FK CONSTRAINT media_processing_events media_processing_events_actor_id_fkey

ALTER TABLE ONLY media_processing_events
    ADD CONSTRAINT media_processing_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT media_processing_events media_processing_events_job_id_fkey

ALTER TABLE ONLY media_processing_events
    ADD CONSTRAINT media_processing_events_job_id_fkey FOREIGN KEY (job_id) REFERENCES media_processing_jobs(id);


-- Recovered object: FK CONSTRAINT media_processing_jobs media_processing_jobs_created_by_fkey

ALTER TABLE ONLY media_processing_jobs
    ADD CONSTRAINT media_processing_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT media_processing_jobs media_processing_jobs_result_asset_id_fkey

ALTER TABLE ONLY media_processing_jobs
    ADD CONSTRAINT media_processing_jobs_result_asset_id_fkey FOREIGN KEY (result_asset_id) REFERENCES assets(id);


-- Recovered object: FK CONSTRAINT media_processing_jobs media_processing_jobs_source_asset_id_fkey

ALTER TABLE ONLY media_processing_jobs
    ADD CONSTRAINT media_processing_jobs_source_asset_id_fkey FOREIGN KEY (source_asset_id) REFERENCES assets(id);


-- Recovered object: FK CONSTRAINT media_processing_lease media_processing_lease_job_id_fkey

ALTER TABLE ONLY media_processing_lease
    ADD CONSTRAINT media_processing_lease_job_id_fkey FOREIGN KEY (job_id) REFERENCES media_processing_jobs(id);


-- Recovered object: TRIGGER asset_media_derivatives asset_media_derivative_immutable

CREATE TRIGGER asset_media_derivative_immutable BEFORE DELETE OR UPDATE ON asset_media_derivatives FOR EACH ROW EXECUTE FUNCTION workspace_append_only();


-- Recovered object: TRIGGER media_processing_events media_processing_events_immutable

CREATE TRIGGER media_processing_events_immutable BEFORE DELETE OR UPDATE ON media_processing_events FOR EACH ROW EXECUTE FUNCTION workspace_append_only();


-- Recovered object: TRIGGER media_processing_jobs media_processing_evidence_required

CREATE CONSTRAINT TRIGGER media_processing_evidence_required AFTER INSERT OR UPDATE ON media_processing_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_media_processing_evidence();


-- Recovered object: TRIGGER media_processing_jobs media_processing_job_guard

CREATE TRIGGER media_processing_job_guard BEFORE INSERT OR DELETE OR UPDATE ON media_processing_jobs FOR EACH ROW EXECUTE FUNCTION protect_media_processing_job();

INSERT INTO media_processing_lease(singleton) VALUES(true) ON CONFLICT DO NOTHING;
