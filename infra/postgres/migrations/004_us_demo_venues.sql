-- Demo venue coverage for the US (South Bay / Peninsula). App Review is done
-- from Cupertino: a `nearby` query there must return a populated list with
-- scores, not an empty screen (App Store guideline 4.2). google_rating is
-- populated so scoring.GetVenueScoreOrFallback gives each venue a cold-start
-- score with zero check-ins.
-- Run manually against existing databases:
--   psql "$DATABASE_URL" -f infra/postgres/migrations/004_us_demo_venues.sql

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
