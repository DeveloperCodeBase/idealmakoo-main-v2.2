-- Explicit factory-maintained lookup records. Installation creates no batch,
-- serial, stock or authenticity records. Registry matching is not a physical
-- product authenticity determination.
CREATE TABLE product_registry (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9._/-]{3,79}$'),
  kind text NOT NULL CHECK (kind IN ('serial','batch')),
  product_id text NOT NULL,
  batch_code text NOT NULL DEFAULT '' CHECK (batch_code='' OR batch_code ~ '^[A-Z0-9][A-Z0-9._/-]{3,79}$'),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','recalled','withdrawn')),
  internal_note text NOT NULL DEFAULT '' CHECK (char_length(internal_note)<=2000),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (kind<>'batch' OR batch_code='')
);
CREATE INDEX product_registry_product_idx ON product_registry(product_id) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION guard_product_registry_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Registry identifier and identifier type are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_registry_identity_immutable BEFORE UPDATE ON product_registry
FOR EACH ROW EXECUTE FUNCTION guard_product_registry_identity();
