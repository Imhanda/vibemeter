-- Adds the missing monthly partitions for vibe_contributions.
-- Without these, all check-ins since 2026-06-01 fall into
-- vibe_contributions_default, which has no place_id/created_at index.
-- Run manually against existing databases:
--   psql "$DATABASE_URL" -f infra/postgres/migrations/000_partitions.sql

CREATE TABLE IF NOT EXISTS vibe_contributions_2026_06
  PARTITION OF vibe_contributions FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS vibe_contributions_2026_07
  PARTITION OF vibe_contributions FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS vibe_contributions_2026_08
  PARTITION OF vibe_contributions FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX IF NOT EXISTS idx_vibe_place_time_2026_06 ON vibe_contributions_2026_06(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vibe_place_time_2026_07 ON vibe_contributions_2026_07(place_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vibe_place_time_2026_08 ON vibe_contributions_2026_08(place_id, created_at DESC);

-- Note: rows already misfiled into vibe_contributions_default since 2026-06-01
-- are NOT moved by this script — Postgres does not retroactively repartition
-- existing rows. This only prevents further rows from landing there.
