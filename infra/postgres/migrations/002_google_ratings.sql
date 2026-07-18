-- Adds Google rating fields to places, used as a cold-start fallback score
-- for venues with no check-in history yet (see api/scoring/engine.go
-- BlendWithGoogleRating).
-- Run manually against existing databases:
--   psql "$DATABASE_URL" -f infra/postgres/migrations/002_google_ratings.sql

ALTER TABLE places ADD COLUMN IF NOT EXISTS google_rating FLOAT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS google_rating_count INT;
