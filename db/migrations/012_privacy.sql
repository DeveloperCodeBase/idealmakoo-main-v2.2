CREATE TABLE IF NOT EXISTS privacy_requests (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL CHECK(subject_type IN ('user','crm-contact')),
  subject_id text NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 160),
  action text NOT NULL CHECK(action IN ('export','erase')),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','blocked','completed','rejected')),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
  requested_by text NOT NULL,
  approved_by text,
  decision_reason text,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  blockers jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(blockers)='array'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK(approved_by IS NULL OR approved_by<>requested_by)
);
CREATE INDEX IF NOT EXISTS privacy_request_owner ON privacy_requests(requested_by,created_at DESC);
CREATE INDEX IF NOT EXISTS privacy_request_subject ON privacy_requests(subject_type,subject_id,created_at DESC);

CREATE TABLE IF NOT EXISTS privacy_holds (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL CHECK(subject_type IN ('user','crm-contact')),
  subject_id text NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 160),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  release_reason text,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS privacy_hold_subject ON privacy_holds(subject_type,subject_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS privacy_ledger_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  fingerprint text,
  applied_sequence bigint NOT NULL DEFAULT 0 CHECK(applied_sequence>=0),
  applied_hash text NOT NULL DEFAULT repeat('0',64) CHECK(applied_hash~'^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO privacy_ledger_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS privacy_tombstones (
  subject_type text NOT NULL CHECK(subject_type IN ('user','crm-contact')),
  subject_id text NOT NULL,
  request_id uuid NOT NULL,
  ledger_sequence bigint NOT NULL UNIQUE CHECK(ledger_sequence>0),
  ledger_hash text NOT NULL CHECK(ledger_hash~'^[a-f0-9]{64}$'),
  erased_at timestamptz NOT NULL,
  PRIMARY KEY(subject_type,subject_id)
);
CREATE TRIGGER privacy_tombstones_immutable BEFORE UPDATE OR DELETE ON privacy_tombstones
  FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

-- The ledger remains authoritative after recovery; ordinary imports cannot
-- create the same erased identity again. A new explicit signup uses a new ID.
CREATE OR REPLACE FUNCTION privacy_prevent_revival() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM privacy_tombstones WHERE subject_type=TG_ARGV[0] AND subject_id=NEW.id) THEN
    RAISE EXCEPTION 'This identity was erased; recovery reconciliation is required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER privacy_user_revival BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION privacy_prevent_revival('user');
CREATE TRIGGER privacy_contact_revival BEFORE INSERT OR UPDATE ON workspace_entities FOR EACH ROW WHEN (NEW.bucket='records') EXECUTE FUNCTION privacy_prevent_revival('crm-contact');

-- Server account notifications bind ownership at the database level. This also
-- makes an in-flight enqueue wait for an erasure's account row lock.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS account_id text REFERENCES users(id);
CREATE INDEX IF NOT EXISTS outbox_account ON outbox(account_id) WHERE account_id IS NOT NULL;
