SET LOCAL search_path TO sentinel;
ALTER TABLE collectors ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'sdn_controller'
    CHECK(source_type IN ('sdn_controller','isolated_lab'));
UPDATE collectors SET source_type='isolated_lab'
    WHERE workspace_id='00000000-0000-0000-0000-000000000001'
    AND id IN ('local-mininet-lab','local-independent-lab');
INSERT INTO schema_versions(version) VALUES (6) ON CONFLICT DO NOTHING;
