-- Environment-provisioned staff identities are owned by the migration role.
-- The runtime may read ownership, but must never create or rewrite that ownership.
CREATE TABLE staff_provisioned_accounts (
  provision_key text PRIMARY KEY CHECK (provision_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  user_id text NOT NULL UNIQUE REFERENCES users(id),
  configured_email text NOT NULL UNIQUE CHECK (configured_email=lower(configured_email)),
  applied_grants_sha256 text NOT NULL CHECK (applied_grants_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  synchronized_at timestamptz NOT NULL DEFAULT now()
);

-- An empty policy uses validated environment defaults. First seed or admin save
-- persists it. Updates use version CAS and the same lock as quota reservations.
CREATE TABLE storage_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  limits jsonb CHECK (limits IS NULL OR jsonb_typeof(limits)='object'),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO storage_policy(singleton) VALUES(true);

CREATE OR REPLACE FUNCTION guard_staff_provisioning_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provision_key IS DISTINCT FROM OLD.provision_key
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.configured_email IS DISTINCT FROM OLD.configured_email THEN
    RAISE EXCEPTION 'Provisioned identity binding is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_provisioning_identity_immutable BEFORE UPDATE ON staff_provisioned_accounts
FOR EACH ROW EXECUTE FUNCTION guard_staff_provisioning_identity();
