-- Reconstructed migration: native PostgreSQL schema was retained; original SQL source bytes were lost.

-- This file is intentionally NOT claimed to match the historical applied checksum.

-- Historical checksum (read-only evidence): 22c9d8a99ca2b8945a746dcecdd031e82d0871b380f1f8b8bec935a79e2c9697

-- Existing databases with the historical migration ledger must not have their checksums rewritten.

-- Reconstruction is verified on a fresh database; historical data backfills need an explicit migration review.

ALTER TABLE customer_organizations ADD COLUMN crm_account_id text;

ALTER TABLE customer_organizations ADD COLUMN crm_link_state text DEFAULT 'pending'::text NOT NULL;

ALTER TABLE customer_organizations ADD COLUMN crm_linked_by text;

ALTER TABLE customer_organizations ADD COLUMN crm_linked_at timestamp with time zone;

ALTER TABLE customer_organizations ADD CONSTRAINT customer_organizations_crm_link_state_check CHECK ((crm_link_state = ANY (ARRAY['pending'::text, 'linked'::text])));

ALTER TABLE customer_organizations ADD CONSTRAINT organization_crm_review CHECK ((((crm_link_state = 'pending'::text) AND (crm_linked_by IS NULL) AND (crm_linked_at IS NULL)) OR ((crm_link_state = 'linked'::text) AND (crm_linked_by IS NOT NULL) AND (crm_linked_at IS NOT NULL))));


-- Recovered object: TABLE organization_crm_link_events

CREATE TABLE organization_crm_link_events (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    previous_account_id text,
    account_id text NOT NULL,
    link_state text NOT NULL,
    actor_id text NOT NULL,
    organization_version integer NOT NULL,
    account_version integer NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_crm_link_events_account_version_check CHECK ((account_version > 0)),
    CONSTRAINT organization_crm_link_events_link_state_check CHECK ((link_state = ANY (ARRAY['pending'::text, 'linked'::text]))),
    CONSTRAINT organization_crm_link_events_organization_version_check CHECK ((organization_version > 0)),
    CONSTRAINT organization_crm_link_events_reason_check CHECK (((length(reason) >= 10) AND (length(reason) <= 2000)))
);

-- Upgrade existing portal organizations without inferring an existing business
-- identity, consent, membership or request share from an email or company name.
-- Each receives a distinct pending/unverified prospect. A reserved-ID collision
-- intentionally fails this migration instead of linking an unrelated CRM row.
INSERT INTO workspace_entities(bucket,id,collection,status,owner_id,data,created_by,updated_by,created_at,updated_at)
SELECT 'records','portal-account-'||o.id::text,'accounts','new','business',
  jsonb_build_object(
    'id','portal-account-'||o.id::text,'collection','accounts',
    'title',jsonb_build_object('fa',o.name,'en',o.name,'tr',o.name,'ar',o.name,'ru',o.name),
    'summary',jsonb_build_object('fa','','en','','tr','','ar','','ru',''),
    'status','new','owner','business','tags',jsonb_build_array('portal-organization','unverified'),
    'history','[]'::jsonb,'demo',false,'createdAt',o.created_at,'updatedAt',o.updated_at,
    'details',jsonb_build_object('crmDomain',jsonb_build_object('schemaVersion',1,'kind','account','revision',1),
      'portalOrganizationImport',jsonb_build_object('migration','026_portal_crm_accounts.sql','review','unverified'))),
  o.owner_id,o.owner_id,o.created_at,o.updated_at
FROM customer_organizations o;

INSERT INTO crm_account_profiles(record_id,display_name,legal_name,activity,lifecycle,registrations,addresses)
SELECT 'portal-account-'||o.id::text,o.name,o.name,'other','prospect','[]'::jsonb,'[]'::jsonb
FROM customer_organizations o;

UPDATE customer_organizations SET crm_account_id='portal-account-'||id::text;

INSERT INTO organization_crm_link_events(id,organization_id,account_id,link_state,actor_id,organization_version,account_version,reason)
SELECT gen_random_uuid(),o.id,o.crm_account_id,'pending',o.owner_id,o.version,1,
  'Migration 026 created a separate unverified prospect; no existing CRM identity or access was inferred.'
FROM customer_organizations o;

INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details)
SELECT o.owner_id,'organization.crm.imported','organization',o.id::text,
  jsonb_build_object('migration','026_portal_crm_accounts.sql','accountId',o.crm_account_id,'linkState','pending','inferredAccess',false)
FROM customer_organizations o;

ALTER TABLE customer_organizations ALTER COLUMN crm_account_id SET NOT NULL;


-- Recovered object: CONSTRAINT organization_crm_link_events organization_crm_link_events_organization_id_organization_v_key

ALTER TABLE ONLY organization_crm_link_events
    ADD CONSTRAINT organization_crm_link_events_organization_id_organization_v_key UNIQUE (organization_id, organization_version);


-- Recovered object: CONSTRAINT organization_crm_link_events organization_crm_link_events_pkey

ALTER TABLE ONLY organization_crm_link_events
    ADD CONSTRAINT organization_crm_link_events_pkey PRIMARY KEY (id);


-- Recovered object: INDEX organization_crm_history

CREATE INDEX organization_crm_history ON organization_crm_link_events USING btree (organization_id, created_at DESC, id);


-- Recovered object: INDEX portal_account_mapping_lookup

CREATE INDEX portal_account_mapping_lookup ON customer_organizations USING btree (crm_account_id, crm_link_state, id);


-- Recovered object: INDEX portal_account_one_active_organization

CREATE UNIQUE INDEX portal_account_one_active_organization ON customer_organizations USING btree (crm_account_id) WHERE (archived_at IS NULL);


-- Recovered object: FK CONSTRAINT customer_organizations customer_organizations_crm_account_id_fkey

ALTER TABLE ONLY customer_organizations
    ADD CONSTRAINT customer_organizations_crm_account_id_fkey FOREIGN KEY (crm_account_id) REFERENCES crm_account_profiles(record_id);


-- Recovered object: FK CONSTRAINT customer_organizations customer_organizations_crm_linked_by_fkey

ALTER TABLE ONLY customer_organizations
    ADD CONSTRAINT customer_organizations_crm_linked_by_fkey FOREIGN KEY (crm_linked_by) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT organization_crm_link_events organization_crm_link_events_account_id_fkey

ALTER TABLE ONLY organization_crm_link_events
    ADD CONSTRAINT organization_crm_link_events_account_id_fkey FOREIGN KEY (account_id) REFERENCES crm_account_profiles(record_id);


-- Recovered object: FK CONSTRAINT organization_crm_link_events organization_crm_link_events_actor_id_fkey

ALTER TABLE ONLY organization_crm_link_events
    ADD CONSTRAINT organization_crm_link_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES users(id);


-- Recovered object: FK CONSTRAINT organization_crm_link_events organization_crm_link_events_organization_id_fkey

ALTER TABLE ONLY organization_crm_link_events
    ADD CONSTRAINT organization_crm_link_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES customer_organizations(id);


-- Recovered object: FK CONSTRAINT organization_crm_link_events organization_crm_link_events_previous_account_id_fkey

ALTER TABLE ONLY organization_crm_link_events
    ADD CONSTRAINT organization_crm_link_events_previous_account_id_fkey FOREIGN KEY (previous_account_id) REFERENCES crm_account_profiles(record_id);


-- Recovered object: VIEW crm_account_memberships

CREATE VIEW crm_account_memberships AS
 SELECT o.crm_account_id AS account_id,
    m.organization_id,
    m.user_id,
    m.role,
    (m.active AND (o.archived_at IS NULL)) AS active,
    m.joined_at,
    m.revoked_at
   FROM (organization_memberships m
     JOIN customer_organizations o ON ((o.id = m.organization_id)));


-- Recovered object: TRIGGER organization_crm_link_events organization_crm_link_immutable

CREATE TRIGGER organization_crm_link_immutable BEFORE DELETE OR UPDATE ON organization_crm_link_events FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
