CREATE TABLE crm_account_profiles (
  record_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),legal_name text NOT NULL CHECK(length(legal_name) BETWEEN 1 AND 240),
  activity text NOT NULL CHECK(activity IN ('laboratory','clinic','distributor','hospital','university','manufacturer','other')),
  lifecycle text NOT NULL CHECK(lifecycle IN ('prospect','active','inactive')),parent_account_id text REFERENCES crm_account_profiles(record_id),
  registrations jsonb NOT NULL CHECK(jsonb_typeof(registrations)='array'),addresses jsonb NOT NULL CHECK(jsonb_typeof(addresses)='array'),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(document_bucket,record_id) REFERENCES workspace_entities(bucket,id),CHECK(parent_account_id IS DISTINCT FROM record_id)
);
CREATE INDEX crm_account_parent ON crm_account_profiles(parent_account_id);
CREATE FUNCTION crm_guard_account_hierarchy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-account-hierarchy',0));
  IF NEW.parent_account_id IS NOT NULL AND EXISTS(
    WITH RECURSIVE ancestors AS (
      SELECT record_id,parent_account_id FROM crm_account_profiles WHERE record_id=NEW.parent_account_id
      UNION SELECT p.record_id,p.parent_account_id FROM crm_account_profiles p JOIN ancestors a ON p.record_id=a.parent_account_id
    ) SELECT 1 FROM ancestors WHERE record_id=NEW.record_id
  ) THEN RAISE EXCEPTION 'Account hierarchy cycle' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_account_hierarchy BEFORE INSERT OR UPDATE OF parent_account_id ON crm_account_profiles FOR EACH ROW EXECUTE FUNCTION crm_guard_account_hierarchy();
CREATE TABLE crm_account_branches (
  id uuid PRIMARY KEY,account_id text NOT NULL REFERENCES crm_account_profiles(record_id),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  address jsonb NOT NULL CHECK(jsonb_typeof(address)='object'),registrations jsonb NOT NULL CHECK(jsonb_typeof(registrations)='array'),
  active boolean NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,account_id)
);
CREATE INDEX crm_account_active_branches ON crm_account_branches(account_id,id) WHERE active;
CREATE TABLE crm_contact_profiles (
  record_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),
  given_name text NOT NULL,family_name text NOT NULL,display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 200),
  locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(document_bucket,record_id) REFERENCES workspace_entities(bucket,id) ON DELETE CASCADE
);
CREATE TABLE crm_contact_affiliations (
  id uuid PRIMARY KEY,contact_id text NOT NULL REFERENCES crm_contact_profiles(record_id),account_id text NOT NULL REFERENCES crm_account_profiles(record_id),
  branch_id uuid,role text NOT NULL CHECK(length(role) BETWEEN 1 AND 160),valid_from date NOT NULL,valid_to date,
  recorded_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(valid_to IS NULL OR valid_to>=valid_from),FOREIGN KEY(branch_id,account_id) REFERENCES crm_account_branches(id,account_id)
);
CREATE INDEX crm_contact_affiliation_history ON crm_contact_affiliations(contact_id,valid_from DESC,id);
CREATE INDEX crm_contact_affiliation_account ON crm_contact_affiliations(account_id,contact_id);
CREATE FUNCTION crm_guard_affiliation_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.contact_id<>OLD.contact_id OR NEW.account_id<>OLD.account_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.role<>OLD.role OR NEW.valid_from<>OLD.valid_from OR OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to)
  THEN RAISE EXCEPTION 'Recorded affiliation history is immutable; close and add a new interval' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-affiliation:'||NEW.contact_id||':'||NEW.account_id,0));
  IF EXISTS(SELECT 1 FROM crm_contact_affiliations a WHERE a.id<>NEW.id AND a.contact_id=NEW.contact_id AND a.account_id=NEW.account_id
    AND a.branch_id IS NOT DISTINCT FROM NEW.branch_id AND daterange(a.valid_from,a.valid_to,'[]')&&daterange(NEW.valid_from,NEW.valid_to,'[]'))
  THEN RAISE EXCEPTION 'Overlapping affiliation intervals' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_affiliation_dates BEFORE INSERT OR UPDATE ON crm_contact_affiliations FOR EACH ROW EXECUTE FUNCTION crm_guard_affiliation_dates();
CREATE TRIGGER crm_affiliation_history BEFORE DELETE ON crm_contact_affiliations FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE communication_recipients (
  id uuid PRIMARY KEY,subject_type text NOT NULL CHECK(subject_type IN ('user','crm-contact')),subject_id text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE CASCADE,contact_id text REFERENCES crm_contact_profiles(record_id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(subject_type,subject_id),UNIQUE(id,contact_id),
  CHECK((subject_type='user' AND user_id IS NOT NULL AND user_id=subject_id AND contact_id IS NULL) OR (subject_type='crm-contact' AND contact_id IS NOT NULL AND contact_id=subject_id AND user_id IS NULL))
);
CREATE FUNCTION crm_register_user_recipient() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO communication_recipients(id,subject_type,subject_id,user_id) VALUES(gen_random_uuid(),'user',NEW.id,NEW.id) ON CONFLICT(subject_type,subject_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_user_recipient AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION crm_register_user_recipient();
INSERT INTO communication_recipients(id,subject_type,subject_id,user_id) SELECT gen_random_uuid(),'user',id,id FROM users;
CREATE TABLE crm_contact_endpoints (
  id uuid PRIMARY KEY,contact_id text NOT NULL REFERENCES crm_contact_profiles(record_id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES communication_recipients(id) ON DELETE CASCADE,channel text NOT NULL CHECK(channel IN ('email','phone')),
  value text NOT NULL,normalized_value text NOT NULL CHECK(length(normalized_value) BETWEEN 1 AND 254),label text NOT NULL,
  active boolean NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contact_id,channel,normalized_value),FOREIGN KEY(recipient_id,contact_id) REFERENCES communication_recipients(id,contact_id)
);
CREATE INDEX crm_endpoint_resolution ON crm_contact_endpoints(recipient_id,channel,id) WHERE active AND verified_at IS NOT NULL;
CREATE TABLE crm_endpoint_challenges (
  token_hash text PRIMARY KEY CHECK(token_hash~'^[a-f0-9]{64}$'),endpoint_id uuid NOT NULL REFERENCES crm_contact_endpoints(id) ON DELETE CASCADE,
  endpoint_version integer NOT NULL,value_hash text NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_endpoint_pending_challenges ON crm_endpoint_challenges(endpoint_id,expires_at) WHERE consumed_at IS NULL;
CREATE TABLE crm_endpoint_consent_events (
  id bigserial PRIMARY KEY,endpoint_id uuid NOT NULL REFERENCES crm_contact_endpoints(id),endpoint_version integer NOT NULL,
  topic text NOT NULL CHECK(topic IN ('products','research','events')),accepted boolean NOT NULL,
  source text NOT NULL CHECK(source IN ('verified-recipient','recipient-unsubscribe','endpoint-changed')),policy_version text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_endpoint_latest_consent ON crm_endpoint_consent_events(endpoint_id,topic,id DESC);
CREATE TRIGGER crm_endpoint_consent_immutable BEFORE UPDATE OR DELETE ON crm_endpoint_consent_events FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
-- Verification mail contains an encrypted contact endpoint and must be included
-- in privacy assessment; it cannot survive an unnoticed profile cascade.
ALTER TABLE outbox ADD COLUMN crm_contact_id text REFERENCES crm_contact_profiles(record_id);
CREATE INDEX crm_contact_outbox_history ON outbox(crm_contact_id) WHERE crm_contact_id IS NOT NULL;
CREATE TABLE crm_lead_qualifications (
  lead_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),
  need_confirmed boolean NOT NULL,contact_confirmed boolean NOT NULL,authority_confirmed boolean NOT NULL,timeframe_confirmed boolean NOT NULL,notes text NOT NULL,
  confirmed_by text NOT NULL REFERENCES users(id),confirmed_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(document_bucket,lead_id) REFERENCES workspace_entities(bucket,id)
);
CREATE TABLE crm_lead_origins (
  origin_type text NOT NULL CHECK(origin_type IN ('request','campaign','chat','manual-import')),origin_id text NOT NULL,lead_id text NOT NULL,
  document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(origin_type,origin_id),FOREIGN KEY(document_bucket,lead_id) REFERENCES workspace_entities(bucket,id)
);
ALTER TABLE crm_lead_conversions ALTER COLUMN opportunity_id DROP NOT NULL;
ALTER TABLE crm_lead_conversions DROP CONSTRAINT crm_lead_conversions_opportunity_id_key;
ALTER TABLE crm_lead_conversions ADD COLUMN account_id text REFERENCES crm_account_profiles(record_id),ADD COLUMN contact_id text REFERENCES crm_contact_profiles(record_id),ADD COLUMN no_opportunity_reason text;
ALTER TABLE crm_lead_conversions ADD CONSTRAINT crm_conversion_outcome CHECK(opportunity_id IS NOT NULL OR no_opportunity_reason IS NOT NULL AND length(no_opportunity_reason)>0);
CREATE INDEX crm_conversion_opportunity ON crm_lead_conversions(opportunity_id);
CREATE TABLE crm_opportunity_details (
  opportunity_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),
  account_id text REFERENCES crm_account_profiles(record_id),locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),need_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(document_bucket,opportunity_id) REFERENCES workspace_entities(bucket,id)
);
CREATE UNIQUE INDEX crm_distinct_account_need ON crm_opportunity_details(account_id,need_key) WHERE need_key IS NOT NULL;
CREATE TABLE crm_opportunity_contacts (
  opportunity_id text NOT NULL REFERENCES crm_opportunity_details(opportunity_id),contact_id text NOT NULL REFERENCES crm_contact_profiles(record_id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(opportunity_id,contact_id)
);
CREATE TABLE crm_opportunity_requests (
  opportunity_id text NOT NULL REFERENCES crm_opportunity_details(opportunity_id),request_id text NOT NULL REFERENCES requests(id),linked_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(opportunity_id,request_id)
);
CREATE INDEX crm_request_opportunities ON crm_opportunity_requests(request_id,opportunity_id);
CREATE TABLE crm_opportunity_items (
  id uuid PRIMARY KEY,opportunity_id text NOT NULL REFERENCES crm_opportunity_details(opportunity_id),product_id text NOT NULL,variant_id text,unit text NOT NULL,
  quantity numeric(24,6) NOT NULL CHECK(quantity>0),note text NOT NULL,snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,opportunity_id)
);
CREATE INDEX crm_active_opportunity_items ON crm_opportunity_items(opportunity_id,id) WHERE active;
CREATE FUNCTION crm_guard_item_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opportunity_id<>OLD.opportunity_id OR NEW.product_id<>OLD.product_id OR NEW.variant_id IS DISTINCT FROM OLD.variant_id OR NEW.unit<>OLD.unit OR NEW.snapshot<>OLD.snapshot
  THEN RAISE EXCEPTION 'Opportunity item product snapshot is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_item_snapshot BEFORE UPDATE ON crm_opportunity_items FOR EACH ROW EXECUTE FUNCTION crm_guard_item_snapshot();
CREATE TRIGGER crm_item_history BEFORE DELETE ON crm_opportunity_items FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE crm_sample_cases (
  sample_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),opportunity_id text NOT NULL REFERENCES crm_opportunity_details(opportunity_id),request_id text NOT NULL REFERENCES requests(id),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','reviewed','shipped','received','evaluated')),carrier_evidence jsonb,
  evidence_asset_id text REFERENCES assets(id),received_at timestamptz,evaluation jsonb,quality_request_id text UNIQUE REFERENCES requests(id),
  updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(document_bucket,sample_id) REFERENCES workspace_entities(bucket,id),
  CHECK(status NOT IN ('shipped','received','evaluated') OR carrier_evidence IS NOT NULL),CHECK(status NOT IN ('received','evaluated') OR received_at IS NOT NULL),CHECK(status<>'evaluated' OR evaluation IS NOT NULL)
);
CREATE TABLE crm_order_handoffs (
  handoff_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),opportunity_id text NOT NULL REFERENCES crm_opportunity_details(opportunity_id),quote_id text REFERENCES quote_snapshots(id),
  mode text NOT NULL CHECK(mode='manual'),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','submitted','acknowledged','failed','uncertain')),
  external_status text,external_reference text,last_evidence_asset_id text REFERENCES assets(id),attempt integer NOT NULL DEFAULT 0 CHECK(attempt>=0),last_note text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(document_bucket,handoff_id) REFERENCES workspace_entities(bucket,id),CHECK(status NOT IN ('submitted','acknowledged') OR last_evidence_asset_id IS NOT NULL)
);
CREATE TABLE crm_partner_agreements (
  partner_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),account_id text NOT NULL REFERENCES crm_account_profiles(record_id),territory_id text NOT NULL REFERENCES crm_territories(id),
  product_ids text[] NOT NULL,valid_from date NOT NULL,valid_to date,exclusive boolean NOT NULL,active boolean NOT NULL,reference text NOT NULL,document_asset_id text REFERENCES assets(id),updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(document_bucket,partner_id) REFERENCES workspace_entities(bucket,id),CHECK(valid_to IS NULL OR valid_to>=valid_from)
);
CREATE INDEX crm_agreement_overlap ON crm_partner_agreements(territory_id,valid_from,valid_to) WHERE active;
CREATE FUNCTION crm_guard_agreement_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-agreement:'||NEW.territory_id,0));
  IF NEW.active AND EXISTS(SELECT 1 FROM crm_partner_agreements a WHERE a.partner_id<>NEW.partner_id AND a.active AND a.territory_id=NEW.territory_id AND (a.exclusive OR NEW.exclusive)
    AND daterange(a.valid_from,a.valid_to,'[]')&&daterange(NEW.valid_from,NEW.valid_to,'[]')
    AND (cardinality(a.product_ids)=0 OR cardinality(NEW.product_ids)=0 OR a.product_ids&&NEW.product_ids))
  THEN RAISE EXCEPTION 'Overlapping exclusive partner agreement' USING ERRCODE='23P01'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_agreement_overlap BEFORE INSERT OR UPDATE ON crm_partner_agreements FOR EACH ROW EXECUTE FUNCTION crm_guard_agreement_overlap();
CREATE TABLE crm_domain_events (
  id uuid PRIMARY KEY,record_id text NOT NULL,action text NOT NULL,actor_id text NOT NULL REFERENCES users(id),
  metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_domain_history ON crm_domain_events(record_id,created_at DESC,id);
CREATE TRIGGER crm_domain_event_immutable BEFORE UPDATE OR DELETE ON crm_domain_events FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
-- Every saved evidence use remains retained, including superseded agreement
-- files and previous manual handoff attempts. Current pointers are insufficient.
CREATE TABLE crm_domain_asset_refs (
  record_bucket text NOT NULL DEFAULT 'records' CHECK(record_bucket='records'),record_id text NOT NULL,asset_id text NOT NULL REFERENCES assets(id),
  first_used_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(record_bucket,record_id,asset_id),
  FOREIGN KEY(record_bucket,record_id) REFERENCES workspace_entities(bucket,id)
);
CREATE INDEX crm_domain_asset_retention ON crm_domain_asset_refs(asset_id,record_id);
CREATE TRIGGER crm_domain_asset_refs_immutable BEFORE UPDATE OR DELETE ON crm_domain_asset_refs FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
