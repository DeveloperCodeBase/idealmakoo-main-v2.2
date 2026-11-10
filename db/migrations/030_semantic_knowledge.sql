-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): df44e34a156866ec4605ac23bf9a7279f895f33fb9332890edacdf4ecec99d4e

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


-- Recovered object: TABLE knowledge_chunks

CREATE TABLE knowledge_chunks (
    id uuid NOT NULL,
    source_id uuid NOT NULL,
    ordinal integer NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    dimensions integer NOT NULL,
    model text NOT NULL,
    embedding public.vector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_chunks_check CHECK (((embedding IS NULL) OR ((public.vector_dims(embedding) = dimensions) AND (public.vector_norm(embedding) > (0)::double precision)))),
    CONSTRAINT knowledge_chunks_content_check CHECK (((length(content) >= 1) AND (length(content) <= 1600))),
    CONSTRAINT knowledge_chunks_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT knowledge_chunks_dimensions_check CHECK ((dimensions = ANY (ARRAY[768, 1024, 1536]))),
    CONSTRAINT knowledge_chunks_ordinal_check CHECK (((ordinal >= 0) AND (ordinal <= 119)))
);


-- Recovered object: TABLE knowledge_ingestion_jobs

CREATE TABLE knowledge_ingestion_jobs (
    id uuid NOT NULL,
    source_id uuid NOT NULL,
    source_version integer NOT NULL,
    source_hash text NOT NULL,
    created_by text,
    state text DEFAULT 'pending'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    lock_token text,
    locked_at timestamp with time zone,
    last_usage_id text,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT knowledge_ingestion_jobs_error_code_check CHECK (((error_code IS NULL) OR (length(error_code) <= 80))),
    CONSTRAINT knowledge_ingestion_jobs_source_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT knowledge_ingestion_jobs_source_version_check CHECK ((source_version > 0)),
    CONSTRAINT knowledge_ingestion_jobs_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'running'::text, 'complete'::text, 'failed'::text, 'cancelled'::text, 'uncertain'::text]))),
    CONSTRAINT knowledge_ingestion_jobs_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE knowledge_sources

CREATE TABLE knowledge_sources (
    id uuid NOT NULL,
    locale text NOT NULL,
    source_id text NOT NULL,
    source_hash text NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    kind text NOT NULL,
    source_url text,
    source_text text NOT NULL,
    model text NOT NULL,
    dimensions integer NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    chunk_count integer NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT knowledge_sources_chunk_count_check CHECK (((chunk_count >= 1) AND (chunk_count <= 120))),
    CONSTRAINT knowledge_sources_dimensions_check CHECK ((dimensions = ANY (ARRAY[768, 1024, 1536]))),
    CONSTRAINT knowledge_sources_kind_check CHECK (((length(kind) >= 1) AND (length(kind) <= 80))),
    CONSTRAINT knowledge_sources_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT knowledge_sources_model_check CHECK (((length(model) >= 1) AND (length(model) <= 200))),
    CONSTRAINT knowledge_sources_source_hash_check CHECK ((source_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT knowledge_sources_source_id_check CHECK (((length(source_id) >= 1) AND (length(source_id) <= 240))),
    CONSTRAINT knowledge_sources_source_text_check CHECK (((length(source_text) >= 1) AND (length(source_text) <= 120000))),
    CONSTRAINT knowledge_sources_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'indexing'::text, 'ready'::text, 'failed'::text, 'uncertain'::text, 'withdrawn'::text]))),
    CONSTRAINT knowledge_sources_title_check CHECK (((length(title) >= 1) AND (length(title) <= 2000))),
    CONSTRAINT knowledge_sources_url_check CHECK (((length(url) BETWEEN 1 AND 1000) AND (url ~ '^/(fa|en|tr|ar|ru)/'::text))),
    CONSTRAINT knowledge_sources_version_check CHECK ((version > 0))
);


-- Recovered object: CONSTRAINT knowledge_chunks knowledge_chunks_pkey

ALTER TABLE ONLY knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT knowledge_chunks knowledge_chunks_source_id_ordinal_key

ALTER TABLE ONLY knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_source_id_ordinal_key UNIQUE (source_id, ordinal);


-- Recovered object: CONSTRAINT knowledge_ingestion_jobs knowledge_ingestion_jobs_pkey

ALTER TABLE ONLY knowledge_ingestion_jobs
    ADD CONSTRAINT knowledge_ingestion_jobs_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT knowledge_sources knowledge_sources_id_dimensions_model_key

ALTER TABLE ONLY knowledge_sources
    ADD CONSTRAINT knowledge_sources_id_dimensions_model_key UNIQUE (id, dimensions, model);


-- Recovered object: CONSTRAINT knowledge_sources knowledge_sources_locale_source_id_model_dimensions_key

ALTER TABLE ONLY knowledge_sources
    ADD CONSTRAINT knowledge_sources_locale_source_id_model_dimensions_key UNIQUE (locale, source_id, model, dimensions);


-- Recovered object: CONSTRAINT knowledge_sources knowledge_sources_pkey

ALTER TABLE ONLY knowledge_sources
    ADD CONSTRAINT knowledge_sources_pkey PRIMARY KEY (id);


-- Recovered object: INDEX knowledge_active_source_job

CREATE UNIQUE INDEX knowledge_active_source_job ON knowledge_ingestion_jobs USING btree (source_id) WHERE (state = ANY (ARRAY['pending'::text, 'running'::text]));


-- Recovered object: INDEX knowledge_chunks_source

CREATE INDEX knowledge_chunks_source ON knowledge_chunks USING btree (source_id, ordinal);


-- Recovered object: INDEX knowledge_pending_jobs

CREATE INDEX knowledge_pending_jobs ON knowledge_ingestion_jobs USING btree (created_at, id) WHERE (state = 'pending'::text);


-- Recovered object: INDEX knowledge_sources_locale_state

CREATE INDEX knowledge_sources_locale_state ON knowledge_sources USING btree (locale, model, dimensions, state);


-- Recovered object: INDEX knowledge_vectors_1024

CREATE INDEX knowledge_vectors_1024 ON knowledge_chunks USING hnsw (((embedding)::public.vector(1024)) public.vector_cosine_ops) WHERE ((dimensions = 1024) AND (embedding IS NOT NULL));


-- Recovered object: INDEX knowledge_vectors_1536

CREATE INDEX knowledge_vectors_1536 ON knowledge_chunks USING hnsw (((embedding)::public.vector(1536)) public.vector_cosine_ops) WHERE ((dimensions = 1536) AND (embedding IS NOT NULL));


-- Recovered object: INDEX knowledge_vectors_768

CREATE INDEX knowledge_vectors_768 ON knowledge_chunks USING hnsw (((embedding)::public.vector(768)) public.vector_cosine_ops) WHERE ((dimensions = 768) AND (embedding IS NOT NULL));


-- Recovered object: FK CONSTRAINT knowledge_chunks knowledge_chunks_source_id_dimensions_model_fkey

ALTER TABLE ONLY knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_source_id_dimensions_model_fkey FOREIGN KEY (source_id, dimensions, model) REFERENCES knowledge_sources(id, dimensions, model) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT knowledge_ingestion_jobs knowledge_ingestion_jobs_source_id_fkey

ALTER TABLE ONLY knowledge_ingestion_jobs
    ADD CONSTRAINT knowledge_ingestion_jobs_source_id_fkey FOREIGN KEY (source_id) REFERENCES knowledge_sources(id) ON DELETE CASCADE;
