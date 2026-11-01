SET LOCAL search_path TO sentinel;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_enabled boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS oauth_identities (
    provider text NOT NULL, subject text NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(provider,subject), UNIQUE(provider,user_id)
);
CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash text PRIMARY KEY, nonce text NOT NULL, verifier text NOT NULL,
    origin text NOT NULL, handoff_challenge text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_handoffs (
    code_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge text NOT NULL, expires_at timestamptz NOT NULL
);
INSERT INTO schema_versions(version) VALUES (3) ON CONFLICT DO NOTHING;
