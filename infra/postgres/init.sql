-- =========================
-- EXTENSIONS
-- =========================
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================
-- PLACES
-- =========================
CREATE TABLE places (
  id            VARCHAR(255) PRIMARY KEY,
  name          TEXT         NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  location      GEOMETRY(Point, 4326),
  type          TEXT,
  address       TEXT,
  photo_url     TEXT,
  opening_hours JSONB,
  places_synced_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_places_location ON places USING GIST(location);

-- =========================
-- USERS
-- =========================
CREATE TABLE users (
  id             VARCHAR(128) PRIMARY KEY,
  display_name   TEXT,
  photo_url      TEXT,
  trust_score    FLOAT        DEFAULT 0.7,
  check_in_count INT          DEFAULT 0,
  streak_days    INT          DEFAULT 0,
  last_checkin   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- =========================
-- VIBE CONTRIBUTIONS (PARTITIONED)
-- =========================
CREATE TABLE vibe_contributions (
  id             UUID DEFAULT gen_random_uuid(),
  place_id       VARCHAR(255) REFERENCES places(id),
  user_id        VARCHAR(128) REFERENCES users(id),

  crowd_energy   FLOAT NOT NULL CHECK (crowd_energy BETWEEN 0 AND 1),
  music_energy   FLOAT NOT NULL CHECK (music_energy BETWEEN 0 AND 1),
  ambient_db     FLOAT NOT NULL CHECK (ambient_db BETWEEN 0 AND 1),

  raw_score      FLOAT NOT NULL,
  is_manual      BOOLEAN DEFAULT FALSE,
  trust_weight   FLOAT DEFAULT 1.0,
  flagged        BOOLEAN DEFAULT FALSE,

  created_at     TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- =========================
-- PARTITIONS (REQUIRED)
-- =========================

-- April 2026
CREATE TABLE vibe_contributions_2026_04
PARTITION OF vibe_contributions
FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

-- May 2026
CREATE TABLE vibe_contributions_2026_05
PARTITION OF vibe_contributions
FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- Default partition (safety)
CREATE TABLE vibe_contributions_default
PARTITION OF vibe_contributions DEFAULT;

-- Indexes on partitions
CREATE INDEX idx_vibe_place_time_2026_04
ON vibe_contributions_2026_04(place_id, created_at DESC);

CREATE INDEX idx_vibe_place_time_2026_05
ON vibe_contributions_2026_05(place_id, created_at DESC);

-- =========================
-- BADGES
-- =========================
CREATE TABLE badges (
  id         SERIAL PRIMARY KEY,
  user_id    VARCHAR(128) REFERENCES users(id),
  badge_type TEXT NOT NULL,
  place_id   VARCHAR(255),
  earned_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =========================
-- NOTIFICATIONS
-- =========================
CREATE TABLE notification_subscriptions (
  user_id    VARCHAR(128) REFERENCES users(id),
  place_id   VARCHAR(255) REFERENCES places(id),
  threshold  INT DEFAULT 70,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, place_id)
);

-- =========================
-- PUSH TOKENS
-- =========================
CREATE TABLE push_tokens (
  user_id    VARCHAR(128) REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, token)
);

-- =========================
-- SEED DATA (from places_seed.csv — 61 Bengaluru nightlife venues)
-- =========================

-- Stage the CSV into a temp table, then upsert with PostGIS geometry.
CREATE TEMP TABLE places_import (
  id        TEXT,
  name      TEXT,
  lat       DOUBLE PRECISION,
  lng       DOUBLE PRECISION,
  type      TEXT,
  address   TEXT,
  photo_url TEXT
);

COPY places_import (id, name, lat, lng, type, address, photo_url)
FROM '/docker-entrypoint-initdb.d/places_seed.csv'
WITH (FORMAT csv, HEADER true);

INSERT INTO places (id, name, lat, lng, location, type, address, photo_url)
SELECT
  id, name, lat, lng,
  ST_SetSRID(ST_MakePoint(lng, lat), 4326),
  type, address, photo_url
FROM places_import
ON CONFLICT (id) DO NOTHING;

DROP TABLE places_import;