CREATE FUNCTION valid_crm_discount_ceilings(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item record;
BEGIN
  IF jsonb_typeof(value)<>'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(value))<>12 THEN RETURN false; END IF;
  FOR item IN SELECT key,val FROM jsonb_each(value) AS fields(key,val) LOOP
    IF item.key NOT IN ('customer','superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support') OR jsonb_typeof(item.val)<>'string' THEN RETURN false; END IF;
    IF (item.val#>>'{}') !~ '^\d{1,3}(\.\d{1,6})?$' THEN RETURN false; END IF;
    IF (item.val#>>'{}')::numeric>100 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
CREATE TABLE crm_commercial_policies (
  version bigserial PRIMARY KEY,
  discount_ceilings jsonb NOT NULL CHECK(valid_crm_discount_ceilings(discount_ceilings)),
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO crm_commercial_policies(discount_ceilings) VALUES ('{"customer":"0","superAdmin":"100","admin":"10","contentEditor":"0","productManager":"0","scientificReviewer":"0","translator":"0","publisher":"0","hr":"0","business":"0","analyst":"0","support":"0"}');
CREATE TRIGGER crm_commercial_policies_immutable BEFORE UPDATE OR DELETE ON crm_commercial_policies FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

CREATE TABLE crm_pricebook_revisions (
  id uuid PRIMARY KEY,
  pricebook_id text NOT NULL,
  document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),
  content_revision_id uuid NOT NULL REFERENCES content_revisions(id),
  version integer NOT NULL CHECK(version>0),
  title jsonb NOT NULL CHECK(jsonb_typeof(title)='object'),
  market text NOT NULL CHECK(length(market) BETWEEN 1 AND 80),
  currency text NOT NULL CHECK(currency IN ('IRR','USD','EUR','TRY','RUB')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz CHECK(valid_until IS NULL OR valid_until>valid_from),
  source_checksum text NOT NULL CHECK(source_checksum~'^[a-f0-9]{64}$'),
  snapshot_hash text NOT NULL CHECK(snapshot_hash~'^[a-f0-9]{64}$'),
  maker_id text NOT NULL REFERENCES users(id),
  approved_by text NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK(maker_id<>approved_by),
  UNIQUE(pricebook_id,version),
  UNIQUE(pricebook_id,content_revision_id,approved_by),
  UNIQUE(id,pricebook_id),
  FOREIGN KEY(document_bucket,pricebook_id) REFERENCES workspace_entities(bucket,id)
);
CREATE INDEX crm_pricebook_market_validity ON crm_pricebook_revisions(currency,market,valid_from,valid_until);
CREATE TRIGGER crm_pricebook_revisions_immutable BEFORE UPDATE OR DELETE ON crm_pricebook_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

CREATE TABLE crm_price_entries (
  revision_id uuid NOT NULL REFERENCES crm_pricebook_revisions(id),
  line_id text NOT NULL CHECK(length(line_id) BETWEEN 1 AND 160),
  product_id text NOT NULL CHECK(length(product_id) BETWEEN 1 AND 160),
  title_snapshot text NOT NULL CHECK(length(title_snapshot) BETWEEN 1 AND 1000),
  unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 100),
  unit_price numeric(30,6) NOT NULL CHECK(unit_price>=0),
  PRIMARY KEY(revision_id,line_id),
  UNIQUE(revision_id,product_id,unit)
);
CREATE TRIGGER crm_price_entries_immutable BEFORE UPDATE OR DELETE ON crm_price_entries FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE crm_pricebook_heads (
  pricebook_id text PRIMARY KEY,
  revision_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(revision_id,pricebook_id) REFERENCES crm_pricebook_revisions(id,pricebook_id)
);

CREATE TABLE crm_quote_approvals (
  id uuid PRIMARY KEY,
  quote_id text NOT NULL,
  content_revision_id uuid NOT NULL REFERENCES content_revisions(id),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),
  commercial_hash text NOT NULL CHECK(commercial_hash~'^[a-f0-9]{64}$'),
  pricebook_revision_id uuid NOT NULL REFERENCES crm_pricebook_revisions(id),
  calculation_policy_version text NOT NULL,
  policy_version bigint NOT NULL REFERENCES crm_commercial_policies(version),
  max_discount_percent numeric(9,6) NOT NULL CHECK(max_discount_percent BETWEEN 0 AND 100),
  maker_id text NOT NULL REFERENCES users(id),
  approved_by text NOT NULL REFERENCES users(id),
  approved_role text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK(maker_id<>approved_by),
  UNIQUE(content_revision_id,commercial_hash,approved_by)
);
CREATE INDEX crm_quote_approval_lookup ON crm_quote_approvals(quote_id,locale,commercial_hash,approved_at DESC);
CREATE TRIGGER crm_quote_approvals_immutable BEFORE UPDATE OR DELETE ON crm_quote_approvals FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
