CREATE TABLE crm_pipelines (
  id text PRIMARY KEY,is_default boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1 CHECK(version>0),
  draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object'),draft_by text REFERENCES users(id),active_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_pipeline_default ON crm_pipelines(is_default) WHERE is_default;
CREATE TABLE crm_pipeline_revisions (
  id uuid PRIMARY KEY,pipeline_id text NOT NULL REFERENCES crm_pipelines(id),revision_number integer NOT NULL CHECK(revision_number>0),
  definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'),
  maker_id text REFERENCES users(id),approved_by text REFERENCES users(id),approved_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK(source IN ('system-default','reviewed')),
  CHECK((source='system-default' AND maker_id IS NULL AND approved_by IS NULL) OR (source='reviewed' AND maker_id IS NOT NULL AND approved_by IS NOT NULL AND maker_id<>approved_by)),
  UNIQUE(pipeline_id,revision_number),UNIQUE(id,pipeline_id)
);
ALTER TABLE crm_pipelines ADD CONSTRAINT crm_pipeline_current_revision FOREIGN KEY(active_revision_id,id) REFERENCES crm_pipeline_revisions(id,pipeline_id);
CREATE TRIGGER crm_pipeline_revision_immutable BEFORE UPDATE OR DELETE ON crm_pipeline_revisions FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE crm_pipeline_stages (
  revision_id uuid NOT NULL REFERENCES crm_pipeline_revisions(id),stage_id text NOT NULL CHECK(stage_id~'^[a-z][a-z0-9_-]{0,59}$'),
  position integer NOT NULL CHECK(position BETWEEN 0 AND 29),title jsonb NOT NULL CHECK(jsonb_typeof(title)='object'),
  kind text NOT NULL CHECK(kind IN ('open','won','lost')),probability_percent numeric(9,6) NOT NULL CHECK(probability_percent BETWEEN 0 AND 100),
  entry_checklist jsonb NOT NULL CHECK(jsonb_typeof(entry_checklist)='array'),
  CHECK((kind<>'won' OR probability_percent=100) AND (kind<>'lost' OR probability_percent=0)),
  PRIMARY KEY(revision_id,stage_id),UNIQUE(revision_id,position),UNIQUE(revision_id,stage_id,probability_percent,kind)
);
CREATE TRIGGER crm_pipeline_stage_immutable BEFORE UPDATE OR DELETE ON crm_pipeline_stages FOR EACH ROW EXECUTE FUNCTION workspace_append_only();
CREATE TABLE crm_opportunity_positions (
  opportunity_id text PRIMARY KEY,document_bucket text NOT NULL DEFAULT 'records' CHECK(document_bucket='records'),
  pipeline_id text NOT NULL REFERENCES crm_pipelines(id),revision_id uuid NOT NULL,stage_id text NOT NULL,
  probability_percent numeric(9,6) NOT NULL,stage_kind text NOT NULL,checked_ids jsonb NOT NULL CHECK(jsonb_typeof(checked_ids)='array'),
  entered_at timestamptz NOT NULL DEFAULT now(),entered_by text NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(document_bucket,opportunity_id) REFERENCES workspace_entities(bucket,id),
  FOREIGN KEY(revision_id,pipeline_id) REFERENCES crm_pipeline_revisions(id,pipeline_id),
  FOREIGN KEY(revision_id,stage_id,probability_percent,stage_kind) REFERENCES crm_pipeline_stages(revision_id,stage_id,probability_percent,kind)
);
CREATE INDEX crm_pipeline_open_positions ON crm_opportunity_positions(pipeline_id,stage_id,opportunity_id) WHERE stage_kind='open';
CREATE TABLE crm_pipeline_events (
  id uuid PRIMARY KEY,opportunity_id text NOT NULL REFERENCES crm_opportunity_positions(opportunity_id),
  action text NOT NULL CHECK(action IN ('created','transitioned','checklist_updated','reconfigured')),
  from_revision_id uuid,from_stage_id text,to_revision_id uuid NOT NULL,to_stage_id text NOT NULL,
  checked_ids jsonb NOT NULL CHECK(jsonb_typeof(checked_ids)='array'),actor_id text NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((from_revision_id IS NULL)=(from_stage_id IS NULL)),
  FOREIGN KEY(from_revision_id,from_stage_id) REFERENCES crm_pipeline_stages(revision_id,stage_id),
  FOREIGN KEY(to_revision_id,to_stage_id) REFERENCES crm_pipeline_stages(revision_id,stage_id)
);
CREATE INDEX crm_pipeline_event_history ON crm_pipeline_events(opportunity_id,created_at DESC,id);
CREATE TRIGGER crm_pipeline_event_immutable BEFORE UPDATE OR DELETE ON crm_pipeline_events FOR EACH ROW EXECUTE FUNCTION workspace_append_only();

-- The initial software policy contains no customer data and explicitly records
-- system-default provenance. Every subsequent activation needs two real users.
INSERT INTO crm_pipelines(id,is_default,draft) VALUES('default-sales',true,
'{"schemaVersion":1,"title":{"fa":"قیف فروش اصلی","en":"Default sales pipeline","tr":"Varsayılan satış hattı","ar":"مسار المبيعات الرئيسي","ru":"Основная воронка продаж"},"active":true,"stages":[
 {"id":"new","title":{"fa":"جدید","en":"New","tr":"Yeni","ar":"جديد","ru":"Новая"},"kind":"open","probabilityPercentDecimal":"0","entryChecklist":[]},
 {"id":"working","title":{"fa":"در حال بررسی","en":"Working","tr":"İşleniyor","ar":"قيد العمل","ru":"В работе"},"kind":"open","probabilityPercentDecimal":"10","entryChecklist":[]},
 {"id":"qualified","title":{"fa":"واجد شرایط","en":"Qualified","tr":"Nitelikli","ar":"مؤهل","ru":"Квалифицирована"},"kind":"open","probabilityPercentDecimal":"30","entryChecklist":[]},
 {"id":"proposal","title":{"fa":"پیشنهاد","en":"Proposal","tr":"Teklif","ar":"عرض","ru":"Предложение"},"kind":"open","probabilityPercentDecimal":"60","entryChecklist":[]},
 {"id":"won","title":{"fa":"موفق","en":"Won","tr":"Kazanıldı","ar":"ناجح","ru":"Выиграна"},"kind":"won","probabilityPercentDecimal":"100","entryChecklist":[]},
 {"id":"lost","title":{"fa":"ناموفق","en":"Lost","tr":"Kaybedildi","ar":"غير ناجح","ru":"Проиграна"},"kind":"lost","probabilityPercentDecimal":"0","entryChecklist":[]}
]}');
INSERT INTO crm_pipeline_revisions(id,pipeline_id,revision_number,definition,checksum,source)
SELECT '00000000-0000-4000-8000-000000000014',id,1,draft,encode(sha256(convert_to(draft::text,'UTF8')),'hex'),'system-default' FROM crm_pipelines WHERE is_default;
INSERT INTO crm_pipeline_stages(revision_id,stage_id,position,title,kind,probability_percent,entry_checklist)
SELECT '00000000-0000-4000-8000-000000000014',item->>'id',(ordinality-1)::integer,item->'title',item->>'kind',(item->>'probabilityPercentDecimal')::numeric,item->'entryChecklist'
FROM crm_pipelines,jsonb_array_elements(draft->'stages') WITH ORDINALITY AS stages(item,ordinality) WHERE is_default;
UPDATE crm_pipelines SET active_revision_id='00000000-0000-4000-8000-000000000014' WHERE is_default;
