SET LOCAL search_path TO sentinel;
CREATE TABLE lab_hosts (
    id text PRIMARY KEY, last_seen timestamptz NOT NULL, ready boolean NOT NULL DEFAULT false,
    capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 8),
    external_busy integer NOT NULL DEFAULT 0 CHECK(external_busy BETWEEN 0 AND 32),
    reason text NOT NULL DEFAULT 'preparing', version text NOT NULL
);
CREATE TABLE managed_labs (
    id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
    host_id text NOT NULL REFERENCES lab_hosts(id), requested_by uuid NOT NULL,
    request_id uuid NOT NULL, collector_id text NOT NULL UNIQUE,
    desired_state text NOT NULL CHECK(desired_state IN ('running','stopped')),
    state text NOT NULL CHECK(state IN ('queued','starting','awaiting_controller','awaiting_flows','running','stopping','stopped','failed','expired')),
    revision integer NOT NULL DEFAULT 1, message text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL, idle_expires_at timestamptz NOT NULL,
    started_at timestamptz, controller_seen_at timestamptz, first_flow_at timestamptz, stopped_at timestamptz,
    FOREIGN KEY(workspace_id,requested_by) REFERENCES users(workspace_id,id),
    UNIQUE(workspace_id,request_id), UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX one_desired_lab ON managed_labs(workspace_id) WHERE desired_state='running';
CREATE INDEX managed_labs_host ON managed_labs(host_id,stopped_at,created_at);
ALTER TABLE collector_credentials ADD COLUMN purpose text NOT NULL DEFAULT 'manual' CHECK(purpose IN ('manual','managed_lab'));
ALTER TABLE collector_credentials ADD COLUMN lab_run_id uuid REFERENCES managed_labs(id);
ALTER TABLE collector_credentials ADD COLUMN expires_at timestamptz;
ALTER TABLE collector_credentials ADD CONSTRAINT credential_lab_workspace
    FOREIGN KEY(workspace_id,lab_run_id) REFERENCES managed_labs(workspace_id,id);
DROP INDEX one_active_collector_key;
CREATE UNIQUE INDEX one_active_collector_key ON collector_credentials(workspace_id,purpose) WHERE revoked_at IS NULL;
ALTER TABLE collectors ADD COLUMN lab_run_id uuid;
ALTER TABLE collectors ADD CONSTRAINT collector_lab_workspace
    FOREIGN KEY(workspace_id,lab_run_id) REFERENCES managed_labs(workspace_id,id);
CREATE TRIGGER sentinel_change_managed_labs AFTER INSERT OR UPDATE OR DELETE ON managed_labs
    FOR EACH STATEMENT EXECUTE FUNCTION sentinel.record_change();
CREATE TRIGGER sentinel_change_lab_hosts AFTER INSERT OR UPDATE OR DELETE ON lab_hosts
    FOR EACH STATEMENT EXECUTE FUNCTION sentinel.record_change();
INSERT INTO schema_versions(version) VALUES (7);
