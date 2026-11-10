CREATE TABLE IF NOT EXISTS customer_organizations (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 city text NOT NULL DEFAULT '',
 country text NOT NULL DEFAULT '',
 owner_id text NOT NULL REFERENCES users(id),
 version integer NOT NULL DEFAULT 1,
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_memberships (
 organization_id uuid NOT NULL REFERENCES customer_organizations(id),
 user_id text NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('owner','admin','member','viewer')),
 active boolean NOT NULL DEFAULT true,
 joined_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 PRIMARY KEY(organization_id,user_id)
);
CREATE INDEX IF NOT EXISTS organization_member_lookup ON organization_memberships(user_id,organization_id) WHERE active;
CREATE TABLE IF NOT EXISTS organization_invitations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES customer_organizations(id),
 email text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','member','viewer')),
 token_hash text NOT NULL UNIQUE,
 invited_by text NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,
 accepted_at timestamptz,
 accepted_by text REFERENCES users(id),
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_pending_invite ON organization_invitations(organization_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS request_shares (
 organization_id uuid NOT NULL REFERENCES customer_organizations(id),
 request_id text NOT NULL REFERENCES requests(id),
 permission text NOT NULL CHECK(permission IN ('view','reply')),
 shared_by text NOT NULL REFERENCES users(id),
 shared_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz,
 PRIMARY KEY(organization_id,request_id)
);
CREATE INDEX IF NOT EXISTS request_shares_lookup ON request_shares(request_id,organization_id) WHERE revoked_at IS NULL;
