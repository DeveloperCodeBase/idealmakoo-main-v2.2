-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): adcdf5bc457f1fa34808c5efa8981334c018379fcf564ba2b08977f2a09e4d66

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.

ALTER TABLE user_settings ADD COLUMN wishlists_migrated_at timestamp with time zone;


-- Recovered object: TABLE wishlist_items

CREATE TABLE wishlist_items (
    id uuid NOT NULL,
    wishlist_id uuid NOT NULL,
    reference_key text NOT NULL,
    reference jsonb NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    "position" integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wishlist_items_note_check CHECK ((length(note) <= 2000)),
    CONSTRAINT wishlist_items_position_check CHECK ((("position" >= 0) AND ("position" <= 499))),
    CONSTRAINT wishlist_items_reference_check CHECK (((jsonb_typeof(reference) = 'object'::text) AND (octet_length((reference)::text) <= 2048))),
    CONSTRAINT wishlist_items_reference_key_check CHECK (((length(reference_key) >= 1) AND (length(reference_key) <= 260)))
);


-- Recovered object: TABLE wishlist_shares

CREATE TABLE wishlist_shares (
    id uuid NOT NULL,
    wishlist_id uuid NOT NULL,
    token_hash text NOT NULL,
    title text NOT NULL,
    locale text NOT NULL,
    source_version integer NOT NULL,
    item_references jsonb NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT wishlist_shares_check CHECK (((expires_at > created_at) AND (expires_at <= (created_at + '30 days'::interval)))),
    CONSTRAINT wishlist_shares_item_references_check CHECK (((jsonb_typeof(item_references) = 'array'::text) AND ((jsonb_array_length(item_references) >= 1) AND (jsonb_array_length(item_references) <= 500)) AND (octet_length((item_references)::text) <= 256000))),
    CONSTRAINT wishlist_shares_locale_check CHECK ((locale = ANY (ARRAY['fa'::text, 'en'::text, 'tr'::text, 'ar'::text, 'ru'::text]))),
    CONSTRAINT wishlist_shares_source_version_check CHECK ((source_version > 0)),
    CONSTRAINT wishlist_shares_title_check CHECK (((length(title) >= 1) AND (length(title) <= 120))),
    CONSTRAINT wishlist_shares_token_hash_check CHECK ((token_hash ~ '^[a-f0-9]{64}$'::text)),
    CONSTRAINT wishlist_shares_version_check CHECK ((version > 0))
);


-- Recovered object: TABLE wishlists

CREATE TABLE wishlists (
    id uuid NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    purpose text DEFAULT 'general'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT wishlists_description_check CHECK ((length(description) <= 2000)),
    CONSTRAINT wishlists_name_check CHECK (((length(name) >= 1) AND (length(name) <= 120))),
    CONSTRAINT wishlists_purpose_check CHECK ((purpose = ANY (ARRAY['general'::text, 'project'::text]))),
    CONSTRAINT wishlists_version_check CHECK ((version > 0))
);


-- Recovered object: FUNCTION guard_wishlist_share_snapshot()

CREATE FUNCTION guard_wishlist_share_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.wishlist_id IS DISTINCT FROM OLD.wishlist_id
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.locale IS DISTINCT FROM OLD.locale OR NEW.source_version IS DISTINCT FROM OLD.source_version
    OR NEW.item_references IS DISTINCT FROM OLD.item_references OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR OLD.revoked_at IS NOT NULL
    OR NEW.revoked_at IS NULL OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Wishlist share scope is immutable; revoke it and create a new link';
  END IF;
  RETURN NEW;
END;
$$;


-- Recovered object: CONSTRAINT wishlist_items wishlist_items_pkey

ALTER TABLE ONLY wishlist_items
    ADD CONSTRAINT wishlist_items_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT wishlist_items wishlist_items_wishlist_id_position_key

ALTER TABLE ONLY wishlist_items
    ADD CONSTRAINT wishlist_items_wishlist_id_position_key UNIQUE (wishlist_id, "position") DEFERRABLE INITIALLY DEFERRED;


-- Recovered object: CONSTRAINT wishlist_items wishlist_items_wishlist_id_reference_key_key

ALTER TABLE ONLY wishlist_items
    ADD CONSTRAINT wishlist_items_wishlist_id_reference_key_key UNIQUE (wishlist_id, reference_key);


-- Recovered object: CONSTRAINT wishlist_shares wishlist_shares_pkey

ALTER TABLE ONLY wishlist_shares
    ADD CONSTRAINT wishlist_shares_pkey PRIMARY KEY (id);


-- Recovered object: CONSTRAINT wishlist_shares wishlist_shares_token_hash_key

ALTER TABLE ONLY wishlist_shares
    ADD CONSTRAINT wishlist_shares_token_hash_key UNIQUE (token_hash);


-- Recovered object: CONSTRAINT wishlists wishlists_pkey

ALTER TABLE ONLY wishlists
    ADD CONSTRAINT wishlists_pkey PRIMARY KEY (id);


-- Recovered object: INDEX wishlist_shares_owner

CREATE INDEX wishlist_shares_owner ON wishlist_shares USING btree (wishlist_id, created_at DESC, id);


-- Recovered object: INDEX wishlists_one_default

CREATE UNIQUE INDEX wishlists_one_default ON wishlists USING btree (user_id) WHERE is_default;


-- Recovered object: INDEX wishlists_owner_name

CREATE UNIQUE INDEX wishlists_owner_name ON wishlists USING btree (user_id, lower(name));


-- Recovered object: INDEX wishlists_owner_order

CREATE INDEX wishlists_owner_order ON wishlists USING btree (user_id, created_at, id);


-- Recovered object: FK CONSTRAINT wishlist_items wishlist_items_wishlist_id_fkey

ALTER TABLE ONLY wishlist_items
    ADD CONSTRAINT wishlist_items_wishlist_id_fkey FOREIGN KEY (wishlist_id) REFERENCES wishlists(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT wishlist_shares wishlist_shares_wishlist_id_fkey

ALTER TABLE ONLY wishlist_shares
    ADD CONSTRAINT wishlist_shares_wishlist_id_fkey FOREIGN KEY (wishlist_id) REFERENCES wishlists(id) ON DELETE CASCADE;


-- Recovered object: FK CONSTRAINT wishlists wishlists_user_id_fkey

ALTER TABLE ONLY wishlists
    ADD CONSTRAINT wishlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;


-- Recovered object: TRIGGER wishlist_shares wishlist_share_snapshot_immutable

CREATE TRIGGER wishlist_share_snapshot_immutable BEFORE UPDATE ON wishlist_shares FOR EACH ROW EXECUTE FUNCTION guard_wishlist_share_snapshot();
