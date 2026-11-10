CREATE TABLE crm_timeline_entries (
  id uuid PRIMARY KEY,record_bucket text NOT NULL DEFAULT 'records' CHECK(record_bucket='records'),record_id text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),kind text NOT NULL CHECK(kind IN ('call','meeting','note')),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000),occurred_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),
  author_id text NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),archived_at timestamptz,
  FOREIGN KEY(record_bucket,record_id) REFERENCES workspace_entities(bucket,id)
);
CREATE INDEX crm_timeline_cursor ON crm_timeline_entries(record_id,occurred_at DESC,id DESC) WHERE archived_at IS NULL;
CREATE FUNCTION crm_timeline_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.id<>NEW.id OR OLD.record_id<>NEW.record_id OR OLD.author_id<>NEW.author_id OR OLD.recorded_at<>NEW.recorded_at OR OLD.occurred_at<>NEW.occurred_at THEN RAISE EXCEPTION 'Timeline identity and chronology are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_timeline_identity BEFORE UPDATE ON crm_timeline_entries FOR EACH ROW EXECUTE FUNCTION crm_timeline_identity_guard();

CREATE TABLE crm_task_series (
  id uuid PRIMARY KEY,record_bucket text NOT NULL DEFAULT 'records' CHECK(record_bucket='records'),record_id text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),generation integer NOT NULL DEFAULT 1 CHECK(generation>0),active boolean NOT NULL DEFAULT true,
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),assignee_user_id text NOT NULL REFERENCES users(id),created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(record_bucket,record_id) REFERENCES workspace_entities(bucket,id)
);
CREATE INDEX crm_task_record ON crm_task_series(record_id,created_at DESC,id);
CREATE TABLE crm_task_occurrences (
  id uuid PRIMARY KEY,series_id uuid NOT NULL REFERENCES crm_task_series(id),generation integer NOT NULL CHECK(generation>0),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 51),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),due_at timestamptz NOT NULL,due_date date,reminder_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed','cancelled')),completed_at timestamptz,completed_by text REFERENCES users(id),reminded_at timestamptz,
  reminder_state text NOT NULL DEFAULT 'pending' CHECK(reminder_state IN ('pending','delivered','cancelled')),reminder_error text,
  UNIQUE(series_id,generation,ordinal),CHECK((status='completed')=(completed_at IS NOT NULL))
);
CREATE INDEX crm_task_reminder_due ON crm_task_occurrences(reminder_at,id) WHERE status='open' AND reminder_state='pending';

CREATE TABLE crm_report_snapshots (
  id uuid PRIMARY KEY,created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  source_ids jsonb NOT NULL CHECK(jsonb_typeof(source_ids)='array' AND jsonb_array_length(source_ids)<=5000),
  report jsonb NOT NULL CHECK(jsonb_typeof(report)='object'),checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$')
);
CREATE TRIGGER crm_report_snapshot_immutable BEFORE UPDATE OR DELETE ON crm_report_snapshots FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE INDEX crm_report_creator ON crm_report_snapshots(created_by,created_at DESC,id);

CREATE TABLE crm_success_plans (
  id uuid PRIMARY KEY,record_bucket text NOT NULL DEFAULT 'records' CHECK(record_bucket='records'),record_id text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','closed','archived')),
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(record_bucket,record_id) REFERENCES workspace_entities(bucket,id)
);
CREATE INDEX crm_success_record ON crm_success_plans(record_id,state,updated_at DESC,id);
CREATE TABLE crm_survey_invitations (
  id uuid PRIMARY KEY,request_id text NOT NULL REFERENCES requests(id),user_id text NOT NULL REFERENCES users(id),email_hash text NOT NULL CHECK(email_hash~'^[a-f0-9]{64}$'),
  kind text NOT NULL CHECK(kind IN ('csat','nps')),locale text NOT NULL CHECK(locale IN ('fa','en','tr','ar','ru')),question text NOT NULL CHECK(length(question) BETWEEN 1 AND 1000),
  token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),created_by text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,revoked_at timestamptz,CHECK(expires_at>created_at)
);
CREATE INDEX crm_survey_request ON crm_survey_invitations(request_id,created_at DESC,id);
CREATE TABLE crm_survey_responses (
  invitation_id uuid PRIMARY KEY REFERENCES crm_survey_invitations(id),score integer NOT NULL CHECK(score BETWEEN 0 AND 10),
  comment text NOT NULL DEFAULT '' CHECK(length(comment)<=5000),submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER crm_survey_response_immutable BEFORE UPDATE OR DELETE ON crm_survey_responses FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE FUNCTION crm_survey_invitation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (to_jsonb(OLD)-'revoked_at') IS DISTINCT FROM (to_jsonb(NEW)-'revoked_at') OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN RAISE EXCEPTION 'Survey invitation is immutable except irreversible revocation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_survey_invitation_immutable BEFORE UPDATE ON crm_survey_invitations FOR EACH ROW EXECUTE FUNCTION crm_survey_invitation_guard();
