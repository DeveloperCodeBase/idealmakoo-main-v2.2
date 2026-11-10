-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): f7ac5ee83d538bc32eb45c09a98a686d346563985fe2f9a4fb0c136a684d7184

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.


-- Recovered object: TABLE ops_browser_samples

CREATE TABLE ops_browser_samples (
    event_id uuid NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    event text NOT NULL,
    route_key text NOT NULL,
    locale text NOT NULL,
    value numeric(14,6) NOT NULL,
    consent_version text NOT NULL,
    CONSTRAINT ops_browser_samples_check CHECK ((((event = ANY (ARRAY['LCP'::text, 'INP'::text])) AND (value <= (120000)::numeric)) OR ((event = 'CLS'::text) AND (value <= (100)::numeric)) OR ((event = 'product_view'::text) AND (value = (1)::numeric)))),
    CONSTRAINT ops_browser_samples_consent_version_check CHECK ((consent_version = 'analytics-v1'::text)),
    CONSTRAINT ops_browser_samples_event_check CHECK ((event = ANY (ARRAY['LCP'::text, 'INP'::text, 'CLS'::text, 'product_view'::text]))),
    CONSTRAINT ops_browser_samples_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT ops_browser_samples_route_key_check CHECK ((route_key = ANY (ARRAY['home'::text, 'products'::text, 'product'::text, 'research'::text, 'article'::text, 'news'::text, 'events'::text, 'event'::text, 'resources'::text, 'resource'::text, 'contact'::text, 'about'::text, 'request-form'::text]))),
    CONSTRAINT ops_browser_samples_value_check CHECK ((value >= (0)::numeric))
);


-- Recovered object: TABLE ops_http_samples

CREATE TABLE ops_http_samples (
    id uuid NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    method text NOT NULL,
    route_key text NOT NULL,
    status_code integer NOT NULL,
    duration_ms numeric(12,3) NOT NULL,
    CONSTRAINT ops_http_samples_duration_ms_check CHECK (((duration_ms >= (0)::numeric) AND (duration_ms <= (600000)::numeric))),
    CONSTRAINT ops_http_samples_method_check CHECK ((method = ANY (ARRAY['GET'::text, 'POST'::text, 'PUT'::text, 'PATCH'::text, 'DELETE'::text, 'HEAD'::text, 'OPTIONS'::text]))),
    CONSTRAINT ops_http_samples_route_key_check CHECK ((route_key = ANY (ARRAY['site'::text, 'requests'::text, 'workspace'::text, 'crm'::text, 'resources'::text, 'media'::text, 'ai'::text, 'auth'::text, 'account'::text, 'other'::text]))),
    CONSTRAINT ops_http_samples_status_code_check CHECK (((status_code >= 100) AND (status_code <= 599)))
);


-- Recovered object: TABLE ops_http_totals

CREATE TABLE ops_http_totals (
    minute timestamp with time zone NOT NULL,
    route_key text NOT NULL,
    requests bigint NOT NULL,
    failures bigint NOT NULL,
    CONSTRAINT ops_http_totals_failures_check CHECK ((failures >= 0)),
    CONSTRAINT ops_http_totals_requests_check CHECK ((requests > 0)),
    CONSTRAINT ops_http_totals_route_key_check CHECK ((route_key = ANY (ARRAY['site'::text, 'requests'::text, 'workspace'::text, 'crm'::text, 'resources'::text, 'media'::text, 'ai'::text, 'auth'::text, 'account'::text, 'other'::text])))
);


-- Recovered object: TABLE ops_incident_transitions

CREATE TABLE ops_incident_transitions (
    id uuid NOT NULL,
    incident_id uuid NOT NULL,
    from_state text,
    to_state text NOT NULL,
    version integer NOT NULL,
    reason text NOT NULL,
    actor_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_incident_transitions_check CHECK ((((version = 1) AND (from_state IS NULL) AND (to_state = 'new'::text)) OR ((version = 2) AND (from_state = 'new'::text) AND (to_state = 'ack'::text)) OR ((version = 3) AND (from_state = 'ack'::text) AND (to_state = 'investigating'::text)) OR ((version = 4) AND (from_state = 'investigating'::text) AND (to_state = 'resolved'::text)))),
    CONSTRAINT ops_incident_transitions_from_state_check CHECK ((from_state = ANY (ARRAY['new'::text, 'ack'::text, 'investigating'::text]))),
    CONSTRAINT ops_incident_transitions_idempotency_key_check CHECK (((length(idempotency_key) >= 16) AND (length(idempotency_key) <= 128))),
    CONSTRAINT ops_incident_transitions_reason_check CHECK (((length(reason) >= 8) AND (length(reason) <= 2000))),
    CONSTRAINT ops_incident_transitions_request_hash_check CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT ops_incident_transitions_to_state_check CHECK ((to_state = ANY (ARRAY['new'::text, 'ack'::text, 'investigating'::text, 'resolved'::text]))),
    CONSTRAINT ops_incident_transitions_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE ops_incidents

CREATE TABLE ops_incidents (
    id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    service text NOT NULL,
    severity text NOT NULL,
    state text DEFAULT 'new'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    slo_observation_id uuid,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    CONSTRAINT ops_incidents_check CHECK (((state = 'resolved'::text) = (resolved_at IS NOT NULL))),
    CONSTRAINT ops_incidents_description_check CHECK (((length(description) >= 8) AND (length(description) <= 2000))),
    CONSTRAINT ops_incidents_idempotency_key_check CHECK (((length(idempotency_key) >= 16) AND (length(idempotency_key) <= 128))),
    CONSTRAINT ops_incidents_request_hash_check CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT ops_incidents_service_check CHECK ((service = ANY (ARRAY['app'::text, 'database'::text, 'worker'::text, 'notifications'::text, 'ai'::text, 'storage'::text, 'tls'::text, 'recovery'::text, 'security'::text, 'content'::text]))),
    CONSTRAINT ops_incidents_severity_check CHECK ((severity = ANY (ARRAY['sev1'::text, 'sev2'::text, 'sev3'::text, 'sev4'::text]))),
    CONSTRAINT ops_incidents_state_check CHECK ((state = ANY (ARRAY['new'::text, 'ack'::text, 'investigating'::text, 'resolved'::text]))),
    CONSTRAINT ops_incidents_title_check CHECK (((length(title) >= 3) AND (length(title) <= 160))),
    CONSTRAINT ops_incidents_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE ops_monitoring_lease

CREATE TABLE ops_monitoring_lease (
    singleton boolean DEFAULT true NOT NULL,
    next_at timestamp with time zone DEFAULT now() NOT NULL,
    lock_token uuid,
    locked_until timestamp with time zone,
    last_completed_at timestamp with time zone,
    last_error text,
    CONSTRAINT ops_monitoring_lease_singleton_check CHECK (singleton)
);


-- Recovered object: TABLE ops_probe_samples

CREATE TABLE ops_probe_samples (
    id uuid NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    probe_key text NOT NULL,
    state text NOT NULL,
    duration_ms numeric(12,3),
    status_code integer,
    value numeric(20,6),
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ops_probe_samples_details_check CHECK ((jsonb_typeof(details) = 'object'::text)),
    CONSTRAINT ops_probe_samples_duration_ms_check CHECK (((duration_ms >= (0)::numeric) AND (duration_ms <= (600000)::numeric))),
    CONSTRAINT ops_probe_samples_probe_key_check CHECK ((probe_key = ANY (ARRAY['app_live'::text, 'app_ready'::text, 'published_site'::text, 'public_tls'::text, 'worker'::text, 'database'::text, 'process'::text]))),
    CONSTRAINT ops_probe_samples_state_check CHECK ((state = ANY (ARRAY['passing'::text, 'breaching'::text, 'unknown'::text]))),
    CONSTRAINT ops_probe_samples_status_code_check CHECK (((status_code >= 100) AND (status_code <= 599)))
);


-- Recovered object: TABLE ops_recovery_evidence

CREATE TABLE ops_recovery_evidence (
    id uuid NOT NULL,
    operation text NOT NULL,
    run_id text NOT NULL,
    success boolean NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    release_id text NOT NULL,
    archive_sha256 text NOT NULL,
    archive_bytes bigint NOT NULL,
    migration_count integer NOT NULL,
    table_count integer,
    privacy_replay boolean NOT NULL,
    source text NOT NULL,
    failure_code text,
    request_hash text NOT NULL,
    CONSTRAINT ops_recovery_evidence_archive_bytes_check CHECK ((archive_bytes >= 0)),
    CONSTRAINT ops_recovery_evidence_archive_sha256_check CHECK ((archive_sha256 ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT ops_recovery_evidence_check CHECK ((finished_at >= started_at)),
    CONSTRAINT ops_recovery_evidence_check1 CHECK (((NOT (success AND (operation = ANY (ARRAY['restore-drill'::text, 'restore-replace'::text])))) OR privacy_replay)),
    CONSTRAINT ops_recovery_evidence_migration_count_check CHECK (((migration_count >= 0) AND (migration_count <= 10000))),
    CONSTRAINT ops_recovery_evidence_operation_check CHECK ((operation = ANY (ARRAY['backup'::text, 'verify-only'::text, 'restore-drill'::text, 'restore-replace'::text]))),
    CONSTRAINT ops_recovery_evidence_release_id_check CHECK (((length(release_id) >= 1) AND (length(release_id) <= 160))),
    CONSTRAINT ops_recovery_evidence_request_hash_check CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT ops_recovery_evidence_run_id_check CHECK (((length(run_id) >= 8) AND (length(run_id) <= 160))),
    CONSTRAINT ops_recovery_evidence_source_check CHECK ((source = ANY (ARRAY['backup-script'::text, 'restore-script'::text, 'native-drill'::text]))),
    CONSTRAINT ops_recovery_evidence_table_count_check CHECK (((table_count >= 0) AND (table_count <= 10000)))
);


-- Recovered object: TABLE ops_slo_observations

CREATE TABLE ops_slo_observations (
    id uuid NOT NULL,
    slo_id uuid NOT NULL,
    definition_version integer NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    state text NOT NULL,
    observed numeric(20,6),
    target numeric(14,6) NOT NULL,
    sample_count integer NOT NULL,
    reason text,
    CONSTRAINT ops_slo_observations_check CHECK ((window_end >= window_start)),
    CONSTRAINT ops_slo_observations_check1 CHECK ((((state = 'unknown'::text) AND (observed IS NULL)) OR ((state <> 'unknown'::text) AND (observed IS NOT NULL)))),
    CONSTRAINT ops_slo_observations_sample_count_check CHECK ((sample_count >= 0)),
    CONSTRAINT ops_slo_observations_state_check CHECK ((state = ANY (ARRAY['passing'::text, 'breaching'::text, 'unknown'::text])))
);


-- Recovered object: TABLE ops_slo_revisions

CREATE TABLE ops_slo_revisions (
    slo_id uuid NOT NULL,
    version integer NOT NULL,
    definition jsonb NOT NULL,
    changed_by text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_slo_revisions_definition_check CHECK ((jsonb_typeof(definition) = 'object'::text)),
    CONSTRAINT ops_slo_revisions_reason_check CHECK (((length(reason) >= 8) AND (length(reason) <= 500)))
);


-- Recovered object: TABLE ops_slos

CREATE TABLE ops_slos (
    id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    route_key text NOT NULL,
    target numeric(14,6) NOT NULL,
    window_minutes integer NOT NULL,
    minimum_samples integer NOT NULL,
    enabled boolean NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_slos_check CHECK ((((kind = 'http_availability'::text) AND (target <= (100)::numeric)) OR ((kind = 'http_latency_p95'::text) AND (target <= (600000)::numeric)) OR ((kind = 'worker_freshness'::text) AND (target <= (86400)::numeric)))),
    CONSTRAINT ops_slos_check1 CHECK (((kind <> 'worker_freshness'::text) OR ((route_key = 'all'::text) AND (minimum_samples = 1)))),
    CONSTRAINT ops_slos_idempotency_key_check CHECK (((length(idempotency_key) >= 16) AND (length(idempotency_key) <= 128))),
    CONSTRAINT ops_slos_kind_check CHECK ((kind = ANY (ARRAY['http_availability'::text, 'http_latency_p95'::text, 'worker_freshness'::text]))),
    CONSTRAINT ops_slos_minimum_samples_check CHECK (((minimum_samples >= 1) AND (minimum_samples <= 10000))),
    CONSTRAINT ops_slos_name_check CHECK (((length(name) >= 3) AND (length(name) <= 120))),
    CONSTRAINT ops_slos_request_hash_check CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT ops_slos_route_key_check CHECK ((route_key = ANY (ARRAY['all'::text, 'site'::text, 'requests'::text, 'workspace'::text, 'crm'::text, 'resources'::text, 'media'::text, 'ai'::text, 'auth'::text, 'account'::text, 'other'::text]))),
    CONSTRAINT ops_slos_target_check CHECK ((target > (0)::numeric)),
    CONSTRAINT ops_slos_version_check CHECK ((version > 0)),
    CONSTRAINT ops_slos_window_minutes_check CHECK ((window_minutes = ANY (ARRAY[5, 60, 1440, 10080])))
);


-- Recovered object: TABLE ops_telemetry_capacity

CREATE TABLE ops_telemetry_capacity (
    singleton boolean DEFAULT true NOT NULL,
    http_rows integer DEFAULT 0 NOT NULL,
    browser_rows integer DEFAULT 0 NOT NULL,
    CONSTRAINT ops_telemetry_capacity_browser_rows_check CHECK (((browser_rows >= 0) AND (browser_rows <= 50000))),
    CONSTRAINT ops_telemetry_capacity_http_rows_check CHECK (((http_rows >= 0) AND (http_rows <= 200000))),
    CONSTRAINT ops_telemetry_capacity_singleton_check CHECK (singleton)
);


-- Recovered object: FUNCTION protect_ops_incident()

CREATE FUNCTION protect_ops_incident() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Incident histories are retained' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'new' OR NEW.version<>1 THEN RAISE EXCEPTION 'An incident starts as new' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['state','version','updated_at','resolved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','version','updated_at','resolved_at'])
       OR NEW.version<>OLD.version+1 OR NOT ((OLD.state='new' AND NEW.state='ack') OR (OLD.state='ack' AND NEW.state='investigating') OR (OLD.state='investigating' AND NEW.state='resolved')) THEN
      RAISE EXCEPTION 'Incident transitions require the retained lifecycle' USING ERRCODE='23514';
    END IF;
  END IF;RETURN NEW;
END $$;


-- Recovered object: FUNCTION require_ops_incident_transition()

CREATE FUNCTION require_ops_incident_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ops_incident_transitions t WHERE t.incident_id=NEW.id AND t.version=NEW.version AND t.to_state=NEW.state) THEN
    RAISE EXCEPTION 'Incident and append-only transition must commit together' USING ERRCODE='23514';
  END IF;RETURN NEW;
END $$;


-- Recovered object: CONSTRAINT ops_browser_samples ops_browser_samples_pkey

ALTER TABLE ONLY ops_browser_samples
    ADD CONSTRAINT ops_browser_samples_pkey PRIMARY KEY (event_id);


-- Recovered object: CONSTRAINT ops_http_samples ops_http_samples_pkey

ALTER TABLE ONLY ops_http_samples
    ADD CONSTRAINT ops_http_samples_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT ops_http_totals ops_http_totals_pkey

ALTER TABLE ONLY ops_http_totals
    ADD CONSTRAINT ops_http_totals_pkey PRIMARY KEY (minute, route_key);


-- Recovered object: CONSTRAINT ops_incident_transitions ops_incident_transitions_incident_id_idempotency_key_key

ALTER TABLE ONLY ops_incident_transitions
    ADD CONSTRAINT ops_incident_transitions_incident_id_idempotency_key_key UNIQUE (incident_id, idempotency_key);


-- Recovered object: CONSTRAINT ops_incident_transitions ops_incident_transitions_incident_id_version_key

ALTER TABLE ONLY ops_incident_transitions
    ADD CONSTRAINT ops_incident_transitions_incident_id_version_key UNIQUE (incident_id, version);


-- Recovered object: CONSTRAINT ops_incident_transitions ops_incident_transitions_pkey

ALTER TABLE ONLY ops_incident_transitions
    ADD CONSTRAINT ops_incident_transitions_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT ops_incidents ops_incidents_created_by_idempotency_key_key

ALTER TABLE ONLY ops_incidents
    ADD CONSTRAINT ops_incidents_created_by_idempotency_key_key UNIQUE (created_by, idempotency_key);


-- Recovered object: CONSTRAINT ops_incidents ops_incidents_pkey

ALTER TABLE ONLY ops_incidents
    ADD CONSTRAINT ops_incidents_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT ops_monitoring_lease ops_monitoring_lease_pkey

ALTER TABLE ONLY ops_monitoring_lease
    ADD CONSTRAINT ops_monitoring_lease_pkey PRIMARY KEY (singleton);


-- Recovered object: CONSTRAINT ops_probe_samples ops_probe_samples_pkey

ALTER TABLE ONLY ops_probe_samples
    ADD CONSTRAINT ops_probe_samples_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT ops_recovery_evidence ops_recovery_evidence_operation_run_id_key

ALTER TABLE ONLY ops_recovery_evidence
    ADD CONSTRAINT ops_recovery_evidence_operation_run_id_key UNIQUE (operation, run_id);


-- Recovered object: CONSTRAINT ops_recovery_evidence ops_recovery_evidence_pkey

ALTER TABLE ONLY ops_recovery_evidence
    ADD CONSTRAINT ops_recovery_evidence_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT ops_slo_observations ops_slo_observations_pkey

ALTER TABLE ONLY ops_slo_observations
    ADD CONSTRAINT ops_slo_observations_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT ops_slo_revisions ops_slo_revisions_pkey

ALTER TABLE ONLY ops_slo_revisions
    ADD CONSTRAINT ops_slo_revisions_pkey PRIMARY KEY (slo_id, version);


-- Recovered object: CONSTRAINT ops_slos ops_slos_created_by_idempotency_key_key

ALTER TABLE ONLY ops_slos
    ADD CONSTRAINT ops_slos_created_by_idempotency_key_key UNIQUE (created_by, idempotency_key);


-- Recovered object: CONSTRAINT ops_slos ops_slos_pkey

ALTER TABLE ONLY ops_slos
    ADD CONSTRAINT ops_slos_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT ops_telemetry_capacity ops_telemetry_capacity_pkey

ALTER TABLE ONLY ops_telemetry_capacity
    ADD CONSTRAINT ops_telemetry_capacity_pkey PRIMARY KEY (singleton);


-- Recovered object: INDEX ops_browser_window

CREATE INDEX ops_browser_window ON ops_browser_samples USING btree (observed_at DESC, event);


-- Recovered object: INDEX ops_http_route_window

CREATE INDEX ops_http_route_window ON ops_http_samples USING btree (route_key, observed_at DESC);


-- Recovered object: INDEX ops_http_window

CREATE INDEX ops_http_window ON ops_http_samples USING btree (observed_at DESC, id);


-- Recovered object: INDEX ops_incident_state_created

CREATE INDEX ops_incident_state_created ON ops_incidents USING btree (state, created_at DESC, id);


-- Recovered object: INDEX ops_probe_window

CREATE INDEX ops_probe_window ON ops_probe_samples USING btree (probe_key, observed_at DESC, id);


-- Recovered object: INDEX ops_slo_observed

CREATE INDEX ops_slo_observed ON ops_slo_observations USING btree (slo_id, observed_at DESC, id);


-- Recovered object: FK CONSTRAINT ops_incident_transitions ops_incident_transitions_actor_id_fkey

ALTER TABLE ONLY ops_incident_transitions
    ADD CONSTRAINT ops_incident_transitions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT ops_incident_transitions ops_incident_transitions_incident_id_fkey

ALTER TABLE ONLY ops_incident_transitions
    ADD CONSTRAINT ops_incident_transitions_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES ops_incidents(id);


-- Recovered object: FK CONSTRAINT ops_incidents ops_incidents_created_by_fkey

ALTER TABLE ONLY ops_incidents
    ADD CONSTRAINT ops_incidents_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT ops_incidents ops_incidents_slo_observation_id_fkey

ALTER TABLE ONLY ops_incidents
    ADD CONSTRAINT ops_incidents_slo_observation_id_fkey FOREIGN KEY (slo_observation_id) REFERENCES ops_slo_observations(id);


-- Recovered object: FK CONSTRAINT ops_slo_observations ops_slo_observations_slo_id_definition_version_fkey

ALTER TABLE ONLY ops_slo_observations
    ADD CONSTRAINT ops_slo_observations_slo_id_definition_version_fkey FOREIGN KEY (slo_id, definition_version) REFERENCES ops_slo_revisions(slo_id, version);


-- Recovered object: FK CONSTRAINT ops_slo_revisions ops_slo_revisions_changed_by_fkey

ALTER TABLE ONLY ops_slo_revisions
    ADD CONSTRAINT ops_slo_revisions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT ops_slo_revisions ops_slo_revisions_slo_id_fkey

ALTER TABLE ONLY ops_slo_revisions
    ADD CONSTRAINT ops_slo_revisions_slo_id_fkey FOREIGN KEY (slo_id) REFERENCES ops_slos(id);


-- Recovered object: FK CONSTRAINT ops_slos ops_slos_created_by_fkey

ALTER TABLE ONLY ops_slos
    ADD CONSTRAINT ops_slos_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);


-- Recovered object: TRIGGER ops_incident_transitions ops_incident_transitions_immutable

CREATE TRIGGER ops_incident_transitions_immutable BEFORE DELETE OR UPDATE ON ops_incident_transitions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();


-- Recovered object: TRIGGER ops_incidents ops_incident_protected

CREATE TRIGGER ops_incident_protected BEFORE INSERT OR DELETE OR UPDATE ON ops_incidents FOR EACH ROW EXECUTE FUNCTION protect_ops_incident();


-- Recovered object: TRIGGER ops_incidents ops_incident_transition_required

CREATE CONSTRAINT TRIGGER ops_incident_transition_required AFTER INSERT OR UPDATE ON ops_incidents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_ops_incident_transition();


-- Recovered object: TRIGGER ops_recovery_evidence ops_recovery_evidence_immutable

CREATE TRIGGER ops_recovery_evidence_immutable BEFORE DELETE OR UPDATE ON ops_recovery_evidence FOR EACH ROW EXECUTE FUNCTION workspace_append_only();


-- Recovered object: TRIGGER ops_slo_revisions ops_slo_revisions_immutable

CREATE TRIGGER ops_slo_revisions_immutable BEFORE DELETE OR UPDATE ON ops_slo_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

INSERT INTO ops_telemetry_capacity(singleton) VALUES(true) ON CONFLICT DO NOTHING;

INSERT INTO ops_monitoring_lease(singleton) VALUES(true) ON CONFLICT DO NOTHING;
