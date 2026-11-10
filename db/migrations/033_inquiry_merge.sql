-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): 7b463a173e8889203461842d807530af9660ad36a95538d65f2a7c8573b5a43d

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.

ALTER TABLE user_settings ADD COLUMN collection_version integer DEFAULT 1 NOT NULL;

ALTER TABLE user_settings ADD CONSTRAINT user_settings_collection_version_check CHECK ((collection_version > 0));


-- Recovered object: TABLE inquiry_merge_receipts

CREATE TABLE inquiry_merge_receipts (
    id uuid NOT NULL,
    user_id text NOT NULL,
    request_hash text NOT NULL,
    summary jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inquiry_merge_receipts_request_hash_check CHECK ((request_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT inquiry_merge_receipts_summary_check CHECK ((jsonb_typeof(summary) = 'object'::text))
);


-- Recovered object: CONSTRAINT inquiry_merge_receipts inquiry_merge_receipts_pkey

ALTER TABLE ONLY inquiry_merge_receipts
    ADD CONSTRAINT inquiry_merge_receipts_pkey PRIMARY KEY (id);


-- Recovered object: INDEX inquiry_merge_owner

CREATE INDEX inquiry_merge_owner ON inquiry_merge_receipts USING btree (user_id, created_at, id);


-- Recovered object: FK CONSTRAINT inquiry_merge_receipts inquiry_merge_receipts_user_id_fkey

ALTER TABLE ONLY inquiry_merge_receipts
    ADD CONSTRAINT inquiry_merge_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;


-- Recovered object: TRIGGER inquiry_merge_receipts inquiry_merge_receipt_immutable

CREATE TRIGGER inquiry_merge_receipt_immutable BEFORE UPDATE ON inquiry_merge_receipts FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
