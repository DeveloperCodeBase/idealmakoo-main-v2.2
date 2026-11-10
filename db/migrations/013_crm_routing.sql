CREATE TABLE crm_work_calendars (
  id text PRIMARY KEY,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  active boolean NOT NULL DEFAULT true,is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
  configured_by text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT is_default OR active)
);
CREATE UNIQUE INDEX crm_calendar_default ON crm_work_calendars(is_default) WHERE is_default;
CREATE UNIQUE INDEX crm_calendar_name ON crm_work_calendars(lower(name)) WHERE active;
CREATE TABLE crm_calendar_revisions (
  calendar_id text NOT NULL REFERENCES crm_work_calendars(id),version integer NOT NULL CHECK(version>0),
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),
  configured_by text,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(calendar_id,version)
);
CREATE TRIGGER crm_calendar_revision_immutable BEFORE UPDATE OR DELETE ON crm_calendar_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
INSERT INTO crm_work_calendars(id,name,is_default,definition) VALUES('factory-calendar','Factory business calendar',true,
  '{"name":"Factory business calendar","active":true,"timeZone":"Asia/Tehran","weekdays":[0,1,2,3,4,6],"intervals":[{"startMinute":480,"endMinute":1020}],"holidays":[],"assignmentMinutes":120,"firstResponseMinutes":480,"resolutionMinutes":2880}');
-- Initial revision uses an explicit immutable fingerprint; runtime writes use the
-- same canonical JSON SHA-256 function as other workspace revisions.
INSERT INTO crm_calendar_revisions(calendar_id,version,definition,checksum)
SELECT id,version,definition,encode(sha256(convert_to(definition::text,'UTF8')),'hex') FROM crm_work_calendars;

CREATE TABLE crm_routing_rules (
  id text PRIMARY KEY,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL CHECK(priority BETWEEN 0 AND 10000),team_id text NOT NULL REFERENCES crm_teams(id),
  territory_id text REFERENCES crm_territories(id),calendar_id text NOT NULL REFERENCES crm_work_calendars(id),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
  configured_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_routing_rule_name ON crm_routing_rules(lower(name)) WHERE active;
CREATE INDEX crm_routing_rule_priority ON crm_routing_rules(priority,id) WHERE active;
CREATE TABLE crm_routing_rule_revisions (
  rule_id text NOT NULL REFERENCES crm_routing_rules(id),version integer NOT NULL CHECK(version>0),
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),
  configured_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(rule_id,version)
);
CREATE TRIGGER crm_routing_rule_revision_immutable BEFORE UPDATE OR DELETE ON crm_routing_rule_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE crm_routing_cursors (
  rule_id text PRIMARY KEY REFERENCES crm_routing_rules(id),last_assignee_id text REFERENCES users(id),
  sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_routing_decisions (
  id uuid PRIMARY KEY,request_id text NOT NULL UNIQUE REFERENCES requests(id),
  rule_id text,rule_version integer,assignee_id text REFERENCES users(id),team_id text REFERENCES crm_teams(id),territory_id text REFERENCES crm_territories(id),
  calendar_id text NOT NULL,calendar_version integer NOT NULL,status text NOT NULL CHECK(status IN ('assigned','intake','preserved')),
  reason text NOT NULL CHECK(reason IN ('assigned','no_rule','no_candidate','rule_creator_revoked','group_inactive','manual_assignment','excluded_kind')),
  cursor_sequence bigint,created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((rule_id IS NULL)=(rule_version IS NULL)),CHECK(status<>'assigned' OR (assignee_id IS NOT NULL AND rule_id IS NOT NULL AND cursor_sequence IS NOT NULL)),
  FOREIGN KEY(rule_id,rule_version) REFERENCES crm_routing_rule_revisions(rule_id,version),
  FOREIGN KEY(calendar_id,calendar_version) REFERENCES crm_calendar_revisions(calendar_id,version)
);
CREATE UNIQUE INDEX crm_routing_unique_turn ON crm_routing_decisions(rule_id,cursor_sequence) WHERE cursor_sequence IS NOT NULL;
CREATE INDEX crm_routing_decision_staff ON crm_routing_decisions(assignee_id,created_at DESC);
CREATE TRIGGER crm_routing_decision_immutable BEFORE UPDATE OR DELETE ON crm_routing_decisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
