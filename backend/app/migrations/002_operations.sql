ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES users(id);
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE collectors ADD COLUMN IF NOT EXISTS topology jsonb NOT NULL DEFAULT '{}';
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS lease_until timestamptz;
CREATE TABLE IF NOT EXISTS realtime_events (
 id bigserial PRIMARY KEY, kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION sentinel.record_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO sentinel.realtime_events(kind) VALUES (TG_TABLE_NAME);
 RETURN NULL;
END $$;
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['batches','collectors','incidents','commands','ai_reports','users','sessions','audit_log'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sentinel_change_'||relation) THEN
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON sentinel.%I FOR EACH STATEMENT EXECUTE FUNCTION sentinel.record_change()', 'sentinel_change_'||relation,relation);
  END IF;
 END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS flows_search_time ON flows(protocol,observed_at DESC);
CREATE INDEX IF NOT EXISTS incidents_status_seen ON incidents(status,last_seen DESC);
INSERT INTO schema_versions(version) VALUES (2) ON CONFLICT DO NOTHING;
