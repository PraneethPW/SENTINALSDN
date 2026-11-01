SET LOCAL search_path TO sentinel;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS link_session_hash text REFERENCES sessions(token_hash) ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS oauth_link_tickets (
    ticket_hash text PRIMARY KEY, session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
INSERT INTO schema_versions(version) VALUES (4) ON CONFLICT DO NOTHING;
