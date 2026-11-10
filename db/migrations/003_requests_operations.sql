ALTER TABLE requests ADD COLUMN IF NOT EXISTS guest_token_hash text;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS sla jsonb NOT NULL DEFAULT '{}';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS consent_snapshot jsonb NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS requests_guest_idx ON requests(guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE OR REPLACE FUNCTION protect_quote_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
    RAISE EXCEPTION 'Issued quote snapshots are immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quote_snapshot_immutable ON quote_snapshots;
CREATE TRIGGER quote_snapshot_immutable BEFORE UPDATE ON quote_snapshots FOR EACH ROW EXECUTE FUNCTION protect_quote_snapshot();
CREATE TABLE IF NOT EXISTS consent_events (
  id bigserial PRIMARY KEY, user_id text REFERENCES users(id), purpose text NOT NULL,
  accepted boolean NOT NULL, policy_version text NOT NULL, ip_hash text,
  request_id text REFERENCES requests(id), created_at timestamptz NOT NULL DEFAULT now()
);

