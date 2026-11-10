ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_scope text NOT NULL DEFAULT 'assigned' CHECK (crm_scope IN ('assigned','team','all'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_permissions jsonb NOT NULL DEFAULT '{}';
CREATE OR REPLACE FUNCTION valid_crm_permissions(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value)='object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(value) AS permission WHERE permission.key NOT IN ('contact','financial','baseCost','assign','intake') OR jsonb_typeof(permission.value)<>'boolean'
  );
$$;
ALTER TABLE users ADD CONSTRAINT users_crm_permissions_valid CHECK (valid_crm_permissions(crm_permissions));

CREATE TABLE crm_teams (
  id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_teams_active_name ON crm_teams(lower(name)) WHERE active;
CREATE TABLE crm_territories (
  id text PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_territories_active_name ON crm_territories(lower(name)) WHERE active;
CREATE TABLE crm_team_memberships (
  team_id text NOT NULL REFERENCES crm_teams(id), user_id text NOT NULL REFERENCES users(id), active boolean NOT NULL DEFAULT true,
  granted_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,user_id)
);
CREATE INDEX crm_team_user_access ON crm_team_memberships(user_id,team_id) WHERE active;
CREATE TABLE crm_territory_memberships (
  territory_id text NOT NULL REFERENCES crm_territories(id), user_id text NOT NULL REFERENCES users(id), active boolean NOT NULL DEFAULT true,
  granted_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(territory_id,user_id)
);
CREATE INDEX crm_territory_user_access ON crm_territory_memberships(user_id,territory_id) WHERE active;

-- The legacy owner_id column holds a role. Actual person/group references are
-- separate generated columns, indexed and constrained to the authoritative IDs.
ALTER TABLE workspace_entities ADD COLUMN owner_user_id text GENERATED ALWAYS AS (NULLIF(data->>'ownerId','')) STORED REFERENCES users(id);
ALTER TABLE workspace_entities ADD COLUMN assignee_id text GENERATED ALWAYS AS (NULLIF(data->>'assigneeId','')) STORED REFERENCES users(id);
ALTER TABLE workspace_entities ADD COLUMN team_id text GENERATED ALWAYS AS (NULLIF(data->>'teamId','')) STORED REFERENCES crm_teams(id);
ALTER TABLE workspace_entities ADD COLUMN territory_id text GENERATED ALWAYS AS (NULLIF(data->>'territoryId','')) STORED REFERENCES crm_territories(id);
CREATE INDEX workspace_person_scope ON workspace_entities(owner_user_id,collection,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX workspace_assignee_scope ON workspace_entities(assignee_id,collection,updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX workspace_team_scope ON workspace_entities(team_id,territory_id,collection,updated_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE requests ADD COLUMN assignee_id text REFERENCES users(id);
ALTER TABLE requests ADD COLUMN team_id text REFERENCES crm_teams(id);
ALTER TABLE requests ADD COLUMN territory_id text REFERENCES crm_territories(id);
CREATE INDEX requests_staff_scope ON requests(assignee_id,team_id,territory_id,created_at DESC);

-- Existing operator-created CRM rows remain with their real active author;
-- customer request ownership is never treated as a staff ownership grant.
UPDATE workspace_entities e SET data=jsonb_set(e.data,'{ownerId}',to_jsonb(u.id))
FROM users u WHERE e.bucket='records' AND e.collection IN ('leads','accounts','contacts','opportunities','activities','quotes','pricebooks','samples','handoffs','partners','tickets','segments','campaigns','inbox','automations','success')
AND e.created_by=u.id AND u.active AND u.role<>'customer' AND NOT e.data ? 'ownerId' AND COALESCE(e.data->>'requestId','')='';
