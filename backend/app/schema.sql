CREATE SCHEMA IF NOT EXISTS sentinel;
SET LOCAL search_path TO sentinel;
CREATE TABLE IF NOT EXISTS schema_versions (version integer PRIMARY KEY, applied_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin','operator','viewer')), created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS login_attempts (identity text NOT NULL, attempted_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS login_attempt_identity ON login_attempts(identity, attempted_at);
CREATE TABLE IF NOT EXISTS ws_tickets (
    ticket_hash text PRIMARY KEY, session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS collectors (
    id text PRIMARY KEY, last_seen timestamptz NOT NULL, switches jsonb NOT NULL,
    controller_status text NOT NULL, version text NOT NULL
);
CREATE TABLE IF NOT EXISTS batches (
    id uuid PRIMARY KEY, collector_id text NOT NULL REFERENCES collectors(id), received_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS flows (
    id bigserial PRIMARY KEY, batch_id uuid NOT NULL REFERENCES batches(id), collector_id text NOT NULL,
    observed_at timestamptz NOT NULL, switch_id text NOT NULL, source_ip inet NOT NULL, destination_ip inet NOT NULL,
    protocol smallint NOT NULL, destination_port integer, packets bigint NOT NULL, bytes bigint NOT NULL,
    interval_seconds double precision NOT NULL, duration_seconds double precision NOT NULL,
    packet_rate double precision NOT NULL, byte_rate double precision NOT NULL,
    prediction text NOT NULL, attack_probability double precision, model_version text
);
CREATE INDEX IF NOT EXISTS flows_observed ON flows(observed_at DESC);
CREATE INDEX IF NOT EXISTS flows_collector ON flows(collector_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS incidents (
    id uuid PRIMARY KEY, collector_id text NOT NULL, switch_id text NOT NULL,
    source_ip inet NOT NULL, destination_ip inet NOT NULL, protocol smallint NOT NULL, destination_port integer,
    first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, probability double precision NOT NULL,
    packets bigint NOT NULL, bytes bigint NOT NULL, model_version text NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
    notes text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS incidents_seen ON incidents(last_seen DESC);
CREATE TABLE IF NOT EXISTS commands (
    id uuid PRIMARY KEY, incident_id uuid NOT NULL REFERENCES incidents(id), collector_id text NOT NULL,
    kind text NOT NULL CHECK(kind IN ('block','unblock')),
    status text NOT NULL CHECK(status IN ('queued','dispatched','enforced','failed','expired','revoked')),
    cookie bigint NOT NULL, payload jsonb NOT NULL, requested_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz DEFAULT now(), lease_until timestamptz, expires_at timestamptz, detail text,
    completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_block ON commands(incident_id)
    WHERE kind='block' AND status IN ('queued','dispatched','enforced');
CREATE TABLE IF NOT EXISTS audit_log (
    id bigserial PRIMARY KEY, actor text NOT NULL, action text NOT NULL, resource text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_reports (
    id uuid PRIMARY KEY, incident_id uuid REFERENCES incidents(id), requested_by uuid NOT NULL REFERENCES users(id),
    status text NOT NULL, content text NOT NULL DEFAULT '', model text NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reports_user ON ai_reports(requested_by,created_at DESC);
INSERT INTO schema_versions(version) VALUES (1) ON CONFLICT DO NOTHING;
