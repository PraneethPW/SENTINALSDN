SET LOCAL search_path TO sentinel;
CREATE TABLE IF NOT EXISTS workspaces (
    id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL DEFAULT 'private'
        CHECK(kind IN ('private','research_lab')),
    created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workspaces(id,name,kind) VALUES
    ('00000000-0000-0000-0000-000000000001','Sentinel Research Lab','research_lab')
    ON CONFLICT DO NOTHING;
DO $$ DECLARE relation text; BEGIN
    FOREACH relation IN ARRAY ARRAY['users','collectors','batches','flows','incidents','commands','audit_log','ai_reports'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS workspace_id uuid NOT NULL DEFAULT ''00000000-0000-0000-0000-000000000001'' REFERENCES workspaces(id)',relation);
    END LOOP;
END $$;
-- Collector names are local to a workspace; two networks may both use "sdn-edge-01".
ALTER TABLE batches DROP CONSTRAINT IF EXISTS batches_collector_id_fkey;
ALTER TABLE collectors DROP CONSTRAINT IF EXISTS collectors_pkey;
ALTER TABLE collectors ADD CONSTRAINT collectors_pkey PRIMARY KEY(workspace_id,id);
ALTER TABLE batches ADD CONSTRAINT batches_workspace_collector_fkey
    FOREIGN KEY(workspace_id,collector_id) REFERENCES collectors(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS batches_workspace_id ON batches(workspace_id,id);
ALTER TABLE flows ADD CONSTRAINT flows_workspace_batch_fkey
    FOREIGN KEY(workspace_id,batch_id) REFERENCES batches(workspace_id,id);
CREATE INDEX IF NOT EXISTS flows_workspace_time ON flows(workspace_id,observed_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS incidents_workspace_time ON incidents(workspace_id,last_seen DESC);
CREATE INDEX IF NOT EXISTS commands_workspace_time ON commands(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS audit_workspace_time ON audit_log(workspace_id,id DESC);
CREATE INDEX IF NOT EXISTS reports_workspace_time ON ai_reports(workspace_id,created_at DESC);
CREATE INDEX IF NOT EXISTS users_workspace ON users(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_workspace_id ON users(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_workspace_id ON incidents(workspace_id,id);
ALTER TABLE incidents ADD CONSTRAINT incidents_workspace_assignee_fkey
    FOREIGN KEY(workspace_id,assignee_id) REFERENCES users(workspace_id,id);
ALTER TABLE commands ADD CONSTRAINT commands_workspace_incident_fkey
    FOREIGN KEY(workspace_id,incident_id) REFERENCES incidents(workspace_id,id);
ALTER TABLE commands ADD CONSTRAINT commands_workspace_requester_fkey
    FOREIGN KEY(workspace_id,requested_by) REFERENCES users(workspace_id,id);
ALTER TABLE ai_reports ADD CONSTRAINT reports_workspace_incident_fkey
    FOREIGN KEY(workspace_id,incident_id) REFERENCES incidents(workspace_id,id);
ALTER TABLE ai_reports ADD CONSTRAINT reports_workspace_requester_fkey
    FOREIGN KEY(workspace_id,requested_by) REFERENCES users(workspace_id,id);
CREATE TABLE IF NOT EXISTS collector_credentials (
    id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
    token_hash text UNIQUE NOT NULL, prefix text NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz, revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_collector_key ON collector_credentials(workspace_id)
    WHERE revoked_at IS NULL;
-- Public signups still awaiting their first approval get their own empty workspace.
-- Explicit approval/revocation decisions and existing operational ownership are preserved.
DO $$ DECLARE account record; wid uuid; BEGIN
    FOR account IN SELECT u.id,u.display_name,u.email FROM users u
        WHERE NOT u.approved
        AND EXISTS (SELECT 1 FROM audit_log a WHERE a.actor=u.id::text AND a.action='account.registered' AND a.detail->>'approval'='pending')
        AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.resource=u.id::text AND a.action='user.updated' AND jsonb_typeof(a.detail->'approved')='boolean')
        AND NOT EXISTS (SELECT 1 FROM incidents i WHERE i.assignee_id=u.id)
        AND NOT EXISTS (SELECT 1 FROM commands c WHERE c.requested_by=u.id)
        AND NOT EXISTS (SELECT 1 FROM ai_reports r WHERE r.requested_by=u.id)
    LOOP
        wid := gen_random_uuid();
        INSERT INTO workspaces(id,name) VALUES(wid,coalesce(nullif(account.display_name,''),split_part(account.email,'@',1))||'''s network');
        UPDATE users SET workspace_id=wid,role='admin',approved=true WHERE id=account.id;
        INSERT INTO audit_log(actor,action,resource,workspace_id,detail)
            VALUES(account.id::text,'workspace.created',wid::text,wid,'{"source":"pending_registration_migration"}'::jsonb);
        DELETE FROM ws_tickets WHERE session_hash IN (SELECT token_hash FROM sessions WHERE user_id=account.id);
    END LOOP;
END $$;
INSERT INTO schema_versions(version) VALUES (5) ON CONFLICT DO NOTHING;
