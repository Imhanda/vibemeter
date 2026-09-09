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
  google_rating       FLOAT,
  google_rating_count INT,
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
  tags           TEXT[] DEFAULT '{}',

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

-- June 2026
CREATE TABLE vibe_contributions_2026_06
PARTITION OF vibe_contributions
FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- July 2026
CREATE TABLE vibe_contributions_2026_07
PARTITION OF vibe_contributions
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- August 2026
CREATE TABLE vibe_contributions_2026_08
PARTITION OF vibe_contributions
FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- Default partition (safety)
CREATE TABLE vibe_contributions_default
PARTITION OF vibe_contributions DEFAULT;

-- Indexes on partitions
CREATE INDEX idx_vibe_place_time_2026_04
ON vibe_contributions_2026_04(place_id, created_at DESC);

CREATE INDEX idx_vibe_place_time_2026_05
ON vibe_contributions_2026_05(place_id, created_at DESC);

CREATE INDEX idx_vibe_place_time_2026_06
ON vibe_contributions_2026_06(place_id, created_at DESC);

CREATE INDEX idx_vibe_place_time_2026_07
ON vibe_contributions_2026_07(place_id, created_at DESC);

CREATE INDEX idx_vibe_place_time_2026_08
ON vibe_contributions_2026_08(place_id, created_at DESC);

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
-- TRUST EVENTS (anti-spam agent audit log)
-- =========================
CREATE TABLE trust_events (
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

CREATE INDEX idx_trust_events_user_time ON trust_events(user_id, created_at DESC);
CREATE INDEX idx_trust_events_contribution ON trust_events(contribution_id);

-- =========================
-- VENUE REPORTS (user-generated-content moderation)
-- =========================
CREATE TABLE venue_reports (
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

CREATE INDEX idx_venue_reports_status_time ON venue_reports(status, created_at DESC);
CREATE INDEX idx_venue_reports_place       ON venue_reports(place_id, created_at DESC);
CREATE INDEX idx_venue_reports_reporter    ON venue_reports(reporter_id, created_at DESC);

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

-- =========================
-- US DEMO SEED (South Bay / Peninsula) — keeps App Review's Cupertino
-- `nearby` query populated. Kept in sync with migrations/004_us_demo_venues.sql.
-- =========================
INSERT INTO places (id, name, lat, lng, location, type, address, google_rating, google_rating_count, places_synced_at)
SELECT v.id, v.name, v.lat, v.lng,
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326),
       v.type, v.address, v.rating, v.rating_count, NOW()
FROM (VALUES
  ('us-demo-01','BJ''s Restaurant & Brewhouse',37.32360,-122.03130,'restaurant','19060 Vallco Pkwy, Cupertino, CA',4.0,2100),
  ('us-demo-02','Alexander''s Steakhouse',37.32355,-122.01460,'restaurant','10330 N Wolfe Rd, Cupertino, CA',4.5,1800),
  ('us-demo-03','Bibo''s NY Pizza',37.31840,-122.03110,'restaurant','20488 Stevens Creek Blvd, Cupertino, CA',4.2,700),
  ('us-demo-04','Dish Dash',37.36870,-122.03600,'restaurant','190 S Murphy Ave, Sunnyvale, CA',4.4,2600),
  ('us-demo-05','Murphy''s Law Irish Pub',37.37760,-122.03050,'bar','135 S Murphy Ave, Sunnyvale, CA',4.3,900),
  ('us-demo-06','The Bulldog English Pub',37.37650,-122.03130,'bar','145 S Murphy Ave, Sunnyvale, CA',4.2,650),
  ('us-demo-07','Rooster T. Feathers Comedy Club',37.37180,-122.02440,'club','157 W El Camino Real, Sunnyvale, CA',4.4,800),
  ('us-demo-08','Pedro''s Restaurant & Cantina',37.36990,-121.99600,'bar','3935 Freedom Cir, Santa Clara, CA',4.2,3100),
  ('us-demo-09','Barebottle Brewing Company',37.38820,-121.94540,'bar','2520 Cabrillo Ave, Santa Clara, CA',4.6,500),
  ('us-demo-10','Original Gravity Public House',37.33690,-121.88650,'bar','66 S 1st St, San Jose, CA',4.5,1200),
  ('us-demo-11','Haberdasher',37.33430,-121.88870,'bar','43 W San Salvador St, San Jose, CA',4.6,900),
  ('us-demo-12','Miniboss',37.33470,-121.89330,'bar','52 E Santa Clara St, San Jose, CA',4.5,700),
  ('us-demo-13','The Continental Bar Lounge',37.32930,-121.87730,'club','349 S 1st St, San Jose, CA',4.2,600),
  ('us-demo-14','SP2 Communal Bar + Restaurant',37.33450,-121.89400,'bar','72 N Almaden Ave, San Jose, CA',4.1,1500),
  ('us-demo-15','55 South',37.33150,-121.89050,'club','55 S 1st St, San Jose, CA',4.0,800),
  ('us-demo-16','Motif',37.33250,-121.88950,'club','389 S 1st St, San Jose, CA',3.9,700),
  ('us-demo-17','Steins Beer Garden',37.39300,-122.08200,'bar','895 Villa St, Mountain View, CA',4.3,2400),
  ('us-demo-18','Tied House Brewery & Cafe',37.39500,-122.08000,'bar','954 Villa St, Mountain View, CA',4.1,1900),
  ('us-demo-19','St. Stephen''s Green',37.39600,-122.07600,'bar','223 Castro St, Mountain View, CA',4.3,1100),
  ('us-demo-20','Scratch',37.39400,-122.07900,'restaurant','401 Castro St, Mountain View, CA',4.2,1300),
  ('us-demo-21','The Old Pro',37.44500,-122.16100,'bar','541 Ramona St, Palo Alto, CA',4.1,1600),
  ('us-demo-22','NOLA Restaurant & Bar',37.44400,-122.16150,'bar','535 Ramona St, Palo Alto, CA',4.3,2800)
) AS v(id,name,lat,lng,type,address,rating,rating_count)
ON CONFLICT (id) DO NOTHING;