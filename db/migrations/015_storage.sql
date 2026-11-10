ALTER TABLE assets ADD COLUMN quota_subject text NOT NULL DEFAULT 'legacy-unattributed';
ALTER TABLE assets ADD COLUMN storage_purged_at timestamptz;
UPDATE assets SET quota_subject=CASE WHEN owner_id IS NOT NULL THEN 'user:'||owner_id ELSE 'guest:'||coalesce(metadata->>'guestHash','legacy-unattributed') END;
CREATE INDEX assets_quota_subject_idx ON assets(quota_subject) WHERE storage_purged_at IS NULL;
CREATE TABLE storage_reservations (
  id uuid PRIMARY KEY, storage_key text NOT NULL UNIQUE,
  subject_key text NOT NULL, bytes bigint NOT NULL CHECK(bytes>0),
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','committed','released')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  last_error text
);
CREATE INDEX storage_reserved_expiry_idx ON storage_reservations(expires_at) WHERE state='reserved';
CREATE INDEX storage_reserved_subject_idx ON storage_reservations(subject_key) WHERE state='reserved';
