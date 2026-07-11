-- Audit log for the Trust & Anti-Spam Agent (api/trust).
-- Run manually against existing databases:
--   psql "$DATABASE_URL" -f infra/postgres/migrations/001_trust_events.sql

CREATE TABLE IF NOT EXISTS trust_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         VARCHAR(128) REFERENCES users(id),
  contribution_id UUID,
  place_id        VARCHAR(255),
  rule_hits       TEXT[] NOT NULL DEFAULT '{}',
  verdict         TEXT NOT NULL CHECK (verdict IN ('clean','suspicious','abusive','manual_override')),
  delta           FLOAT NOT NULL,
  old_score       FLOAT NOT NULL,
  new_score       FLOAT NOT NULL,
  enforced        BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trust_events_user_time ON trust_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_events_contribution ON trust_events(contribution_id);
