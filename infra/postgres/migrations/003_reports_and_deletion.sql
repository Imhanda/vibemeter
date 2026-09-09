-- User-generated-content moderation (venue vibe reports) + schema support for
-- in-app account deletion. Account deletion anonymises a user's vibe history
-- (user_id -> NULL) so venue scores stay stable; see api/handlers/account.go.
-- Run manually against existing databases:
--   psql "$DATABASE_URL" -f infra/postgres/migrations/003_reports_and_deletion.sql

CREATE TABLE IF NOT EXISTS venue_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id     VARCHAR(255) NOT NULL REFERENCES places(id),
  reporter_id  VARCHAR(128) REFERENCES users(id) ON DELETE SET NULL,
  vibe_id      UUID,
  reason       TEXT NOT NULL CHECK (reason IN ('wrong','closed','spam','unsafe')),
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','reviewing','actioned','dismissed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  VARCHAR(128)
);

CREATE INDEX IF NOT EXISTS idx_venue_reports_status_time ON venue_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_venue_reports_place       ON venue_reports(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_venue_reports_reporter    ON venue_reports(reporter_id, created_at DESC);

-- Account deletion sets user_id to NULL on these rather than deleting the rows,
-- so aggregate venue scores and the trust audit trail survive. Both columns are
-- already nullable in init.sql; these statements are no-ops there but make the
-- intent explicit for databases created before this migration.
ALTER TABLE vibe_contributions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE trust_events       ALTER COLUMN user_id DROP NOT NULL;
