CREATE TABLE IF NOT EXISTS event_sessions (
  id uuid PRIMARY KEY,
  record_id text,
  kind text NOT NULL CHECK (kind IN ('event','factory_visit')),
  title jsonb NOT NULL CHECK (jsonb_typeof(title)='object'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at>starts_at),
  timezone text NOT NULL DEFAULT 'Asia/Tehran',
  location text NOT NULL DEFAULT '',
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 100000),
  waitlist_enabled boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed','cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL REFERENCES users(id),
  updated_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind<>'event' OR record_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS event_sessions_record_idx ON event_sessions(record_id,starts_at) WHERE state<>'cancelled';
CREATE INDEX IF NOT EXISTS event_sessions_public_idx ON event_sessions(kind,starts_at) WHERE state='open';

CREATE TABLE IF NOT EXISTS event_registrations (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES event_sessions(id),
  request_id text NOT NULL UNIQUE REFERENCES requests(id),
  user_id text NOT NULL REFERENCES users(id),
  subject_hash text NOT NULL,
  seats integer NOT NULL DEFAULT 1 CHECK (seats BETWEEN 1 AND 20),
  locale text NOT NULL CHECK (locale IN ('fa','en','tr','ar','ru')),
  status text NOT NULL CHECK (status IN ('confirmed','waitlisted','cancelled','attended','no_show')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS event_registration_subject_active ON event_registrations(session_id,subject_hash) WHERE status IN ('confirmed','waitlisted');
CREATE INDEX IF NOT EXISTS event_registration_queue_idx ON event_registrations(session_id,created_at,id) WHERE status='waitlisted';
CREATE INDEX IF NOT EXISTS event_registration_user_idx ON event_registrations(user_id,created_at DESC);

CREATE OR REPLACE FUNCTION guard_event_registration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE maximum integer; occupied integer;
BEGIN
  IF TG_OP='UPDATE' AND ROW(OLD.session_id,OLD.request_id,OLD.user_id,OLD.subject_hash,OLD.seats,OLD.locale,OLD.created_at) IS DISTINCT FROM ROW(NEW.session_id,NEW.request_id,NEW.user_id,NEW.subject_hash,NEW.seats,NEW.locale,NEW.created_at) THEN
    RAISE EXCEPTION 'Registration identity and seat count are immutable';
  END IF;
  SELECT capacity INTO maximum FROM event_sessions WHERE id=NEW.session_id FOR UPDATE;
  IF NEW.status IN ('confirmed','attended','no_show') THEN
    SELECT coalesce(sum(seats),0) INTO occupied FROM event_registrations WHERE session_id=NEW.session_id AND id<>NEW.id AND status IN ('confirmed','attended','no_show');
    IF occupied+NEW.seats>maximum THEN RAISE EXCEPTION 'Event capacity exceeded'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS event_registration_guard ON event_registrations;
CREATE TRIGGER event_registration_guard BEFORE INSERT OR UPDATE ON event_registrations FOR EACH ROW EXECUTE FUNCTION guard_event_registration();
